"""
옵티버스 데일리 브리핑 자동화 시스템 - 메인 파이프라인

실행 순서:
  1. config/clients.json에서 고객사 목록 로드
  2. 각 고객사별: 수집 → 작성 → 발송
  3. 오류 발생 시: 슬랙 알림 + 로그 기록

사용법:
  python main.py                    # 전체 고객사 실행
  python main.py --client client_001  # 특정 고객사만 실행 (테스트용)
  python main.py --dry-run          # 발송 없이 HTML만 생성
"""

import argparse
import json
import logging
import sys
import traceback
from datetime import datetime
from pathlib import Path

from collectors.coupang_partners import collect_client_data
from collectors.naver_trends import collect_client_trends
from collectors.news_rss import collect_client_news
from writer.claude_writer import write_briefing
from publisher.send_email import send_briefing, notify_pipeline_failure

# 로그 설정
LOG_DIR = Path("logs")
LOG_DIR.mkdir(exist_ok=True)

log_file = LOG_DIR / f"briefing_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(log_file, encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)

CONFIG_PATH = Path("config/clients.json")
OUTPUT_DIR = Path("logs/html")


def load_clients(client_id: str = None) -> list[dict]:
    """고객사 설정 로드. client_id 지정 시 해당 고객사만 반환."""
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    clients = config.get("clients", [])
    if client_id:
        clients = [c for c in clients if c["id"] == client_id]
        if not clients:
            raise ValueError(f"고객사 ID '{client_id}'를 찾을 수 없습니다.")
    return clients


def save_html(client: dict, html: str) -> Path:
    """생성된 HTML을 logs/html/에 저장 (검토용)"""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    filename = OUTPUT_DIR / f"{client['id']}_{datetime.now().strftime('%Y%m%d')}.html"
    filename.write_text(html, encoding="utf-8")
    logger.info(f"HTML 저장: {filename}")
    return filename


def run_client_pipeline(client: dict, dry_run: bool = False) -> bool:
    """
    단일 고객사 파이프라인 실행.
    성공 시 True, 실패 시 False 반환.
    """
    name = client["name"]
    logger.info(f"===== [{name}] 파이프라인 시작 =====")

    try:
        # Step 1: 데이터 수집
        logger.info(f"[{name}] 1/4 쿠팡 데이터 수집 중...")
        coupang_data = collect_client_data(client)

        logger.info(f"[{name}] 2/4 네이버 트렌드 수집 중...")
        trend_data = collect_client_trends(client)

        logger.info(f"[{name}] 3/4 뉴스 수집 중...")
        news_data = collect_client_news(client)

        # Step 2: 브리핑 생성
        logger.info(f"[{name}] 4/4 Claude 브리핑 생성 중...")
        html = write_briefing(client, coupang_data, trend_data, news_data)

        # 항상 HTML 저장 (검토용)
        save_html(client, html)

        # Step 3: 이메일 발송
        if dry_run:
            logger.info(f"[{name}] --dry-run 모드: 발송 생략 (HTML만 생성)")
            return True

        success = send_briefing(client, html)
        if success:
            logger.info(f"[{name}] 파이프라인 완료 ✓")
        else:
            logger.error(f"[{name}] 이메일 발송 실패")

        return success

    except Exception as e:
        tb = traceback.format_exc()
        logger.error(f"[{name}] 파이프라인 오류: {e}\n{tb}")
        notify_pipeline_failure(str(e), client_name=name)
        return False


def main():
    parser = argparse.ArgumentParser(description="옵티버스 데일리 브리핑 자동화")
    parser.add_argument("--client", help="특정 고객사 ID만 실행 (예: client_001)")
    parser.add_argument("--dry-run", action="store_true", help="발송 없이 HTML만 생성")
    args = parser.parse_args()

    start_time = datetime.now()
    logger.info(f"옵티버스 데일리 브리핑 시작: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")

    try:
        clients = load_clients(args.client)
    except Exception as e:
        logger.error(f"고객사 설정 로드 실패: {e}")
        sys.exit(1)

    logger.info(f"처리 대상 고객사: {len(clients)}개")

    results = {"success": [], "failure": []}
    for client in clients:
        ok = run_client_pipeline(client, dry_run=args.dry_run)
        if ok:
            results["success"].append(client["name"])
        else:
            results["failure"].append(client["name"])

    # 최종 요약
    elapsed = (datetime.now() - start_time).seconds
    logger.info(
        f"\n{'='*50}\n"
        f"파이프라인 완료 ({elapsed}초)\n"
        f"성공: {results['success']}\n"
        f"실패: {results['failure']}\n"
        f"{'='*50}"
    )

    if results["failure"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
