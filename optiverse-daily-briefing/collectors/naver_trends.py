"""
네이버 데이터랩 쇼핑인사이트 API 수집기
- 카테고리별 키워드 검색량 트렌드 수집
- 전주 대비 증감률 계산
"""

import os
import logging
import requests
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

CLIENT_ID = os.environ.get("NAVER_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("NAVER_CLIENT_SECRET", "")

DATALAB_URL = "https://openapi.naver.com/v1/datalab/shopping/category/keywords"


def _get_date_range(days_back: int = 7) -> tuple[str, str]:
    """오늘 기준 days_back일 전 ~ 어제 날짜 반환 (YYYY-MM-DD)"""
    end = datetime.utcnow() - timedelta(days=1)
    start = end - timedelta(days=days_back - 1)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def fetch_keyword_trends(
    category_id: str,
    keywords: list[str],
    period_type: str = "date",
) -> Optional[dict]:
    """
    네이버 데이터랩 키워드 트렌드 조회.
    period_type: 'date'(일별), 'week'(주별), 'month'(월별)
    반환: {keyword: [{"period": "YYYY-MM-DD", "ratio": float}]}
    """
    if not CLIENT_ID or not CLIENT_SECRET:
        logger.warning("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수 미설정")
        return None

    start_date, end_date = _get_date_range(days_back=28)

    # 키워드는 최대 5개씩 묶어 조회
    results = {}
    for i in range(0, len(keywords), 5):
        batch = keywords[i : i + 5]
        keyword_groups = [
            {"groupName": kw, "keywords": [kw]} for kw in batch
        ]

        payload = {
            "startDate": start_date,
            "endDate": end_date,
            "timeUnit": period_type,
            "category": category_id,
            "keyword": keyword_groups,
            "device": "",
            "ages": [],
            "gender": "",
        }

        headers = {
            "X-Naver-Client-Id": CLIENT_ID,
            "X-Naver-Client-Secret": CLIENT_SECRET,
            "Content-Type": "application/json",
        }

        try:
            resp = requests.post(DATALAB_URL, json=payload, headers=headers, timeout=30)
            resp.raise_for_status()
            data = resp.json()

            for group_result in data.get("results", []):
                group_name = group_result["title"]
                results[group_name] = group_result.get("data", [])

        except requests.HTTPError as e:
            logger.error(f"네이버 데이터랩 API 오류: {e} | 응답: {e.response.text}")
        except Exception as e:
            logger.error(f"네이버 데이터랩 요청 실패: {e}")

    return results


def calculate_trend_change(trends: dict) -> dict:
    """
    전주 대비 증감률 계산.
    반환: {keyword: {"current_avg": float, "prev_avg": float, "change_pct": float, "trend": str}}
    """
    analysis = {}

    for keyword, data in trends.items():
        if not data or len(data) < 14:
            analysis[keyword] = {
                "current_avg": 0,
                "prev_avg": 0,
                "change_pct": 0,
                "trend": "데이터 부족",
            }
            continue

        # 최근 7일 vs 그 이전 7일
        recent = data[-7:]
        previous = data[-14:-7]

        current_avg = sum(d["ratio"] for d in recent) / len(recent)
        prev_avg = sum(d["ratio"] for d in previous) / len(previous)

        if prev_avg > 0:
            change_pct = (current_avg - prev_avg) / prev_avg * 100
        else:
            change_pct = 0

        if change_pct >= 20:
            trend = "급상승"
        elif change_pct >= 5:
            trend = "상승"
        elif change_pct <= -20:
            trend = "급하락"
        elif change_pct <= -5:
            trend = "하락"
        else:
            trend = "보합"

        analysis[keyword] = {
            "current_avg": round(current_avg, 2),
            "prev_avg": round(prev_avg, 2),
            "change_pct": round(change_pct, 1),
            "trend": trend,
        }

    return analysis


def collect_client_trends(client: dict) -> dict:
    """고객사 키워드 트렌드 전체 수집 + 증감률 계산"""
    category_id = client.get("coupang_category_id", "")
    keywords = client.get("keywords", [])

    raw_trends = fetch_keyword_trends(category_id, keywords)
    if not raw_trends:
        return {
            "client_id": client["id"],
            "trends": {},
            "analysis": {},
        }

    analysis = calculate_trend_change(raw_trends)

    return {
        "client_id": client["id"],
        "client_name": client["name"],
        "collected_at": datetime.utcnow().isoformat(),
        "trends": raw_trends,
        "analysis": analysis,
    }
