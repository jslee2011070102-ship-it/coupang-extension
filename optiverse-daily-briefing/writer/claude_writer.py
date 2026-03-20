"""
Claude API 브리핑 자동 작성기
- 수집된 데이터 + 고객사 정보 → 4개 섹션 HTML 브리핑 생성
- 모델: claude-sonnet-4-5
"""

import os
import logging
from datetime import datetime
from pathlib import Path
import anthropic

logger = logging.getLogger(__name__)

CLAUDE_API_KEY = os.environ.get("CLAUDE_API_KEY", "")
MODEL = "claude-sonnet-4-5"
MAX_TOKENS = 4096

TEMPLATE_PATH = Path(__file__).parent.parent / "templates" / "briefing.html"


def _build_prompt(client: dict, coupang_data: dict, trend_data: dict, news_data: dict) -> str:
    """Claude에 전달할 프롬프트 구성"""
    today = datetime.now().strftime("%Y년 %m월 %d일")

    # 쿠팡 키워드 데이터 요약
    coupang_summary = []
    for keyword, products in coupang_data.get("keywords", {}).items():
        if products:
            top3 = products[:3]
            summary = f"- '{keyword}': 1위 {top3[0]['name']} ({top3[0]['price']:,}원, 리뷰 {top3[0]['review_count']}개)"
            coupang_summary.append(summary)
    coupang_text = "\n".join(coupang_summary) if coupang_summary else "수집 데이터 없음"

    # 네이버 트렌드 요약
    trend_summary = []
    for keyword, analysis in trend_data.get("analysis", {}).items():
        trend_summary.append(
            f"- '{keyword}': {analysis['trend']} ({analysis['change_pct']:+.1f}%)"
        )
    trend_text = "\n".join(trend_summary) if trend_summary else "수집 데이터 없음"

    # 뉴스 요약
    news_items = news_data.get("articles", [])
    news_text = "\n".join(
        f"- [{a['source']}] {a['title']}" for a in news_items[:5]
    ) if news_items else "수집 기사 없음"

    # 경쟁사 정보
    competitors = ", ".join(c["name"] for c in client.get("competitors", []))

    prompt = f"""당신은 쿠팡 운영대행 전문 애널리스트입니다.
아래 데이터를 바탕으로 고객사 {client['name']}을 위한 데일리 브리핑을 작성해주세요.

## 고객사 정보
- 이름: {client['name']}
- 카테고리: {client['category']}
- 타겟 고객: {client['target_customer']}
- 주력 키워드: {', '.join(client['keywords'])}
- 주요 경쟁사: {competitors}

## 오늘 날짜
{today}

## 수집 데이터

### 쿠팡 키워드 순위/가격/리뷰
{coupang_text}

### 네이버 검색 트렌드 (전주 대비)
{trend_text}

### 관련 뉴스 (최근 48시간)
{news_text}

## 작성 지침
다음 4개 섹션으로 구성된 HTML 브리핑을 작성하세요.
각 섹션은 <section id="섹션명"> 태그로 감싸주세요.

1. **시장동향** (id="market-trends")
   - 카테고리 전반 거래 흐름, 소비 트렌드, 시장 이슈
   - 2~3개 핵심 포인트를 bullet로

2. **카테고리 동향** (id="category-trends")
   - 급상승 키워드, 검색량 변화, 제형·성분 트렌드
   - 구체적 수치 포함

3. **경쟁사 동향** (id="competitor-trends")
   - 경쟁사 가격 변동, 신제품, 리뷰 급증 현황
   - 위협/기회 관점으로 서술

4. **오늘의 액션 제안** (id="action-items")
   - 위 데이터 기반 구체적 대응 방안 1~3개
   - 각 액션은 <번호>. 제목 + 이유 + 실행 방법 형식

어조: 전문적이고 간결하게. 숫자와 구체적 근거 필수.
HTML 태그만 반환하세요 (<!DOCTYPE> 등 불필요, section 태그만).
"""
    return prompt


def generate_briefing_sections(
    client: dict,
    coupang_data: dict,
    trend_data: dict,
    news_data: dict,
) -> str:
    """Claude API 호출 → 4개 섹션 HTML 반환"""
    if not CLAUDE_API_KEY:
        raise ValueError("CLAUDE_API_KEY 환경변수가 설정되지 않았습니다.")

    claude = anthropic.Anthropic(api_key=CLAUDE_API_KEY)
    prompt = _build_prompt(client, coupang_data, trend_data, news_data)

    logger.info(f"[{client['name']}] Claude 브리핑 생성 중...")

    message = claude.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        messages=[{"role": "user", "content": prompt}],
    )

    sections_html = message.content[0].text
    logger.info(f"[{client['name']}] 브리핑 생성 완료 (tokens: {message.usage.input_tokens} in / {message.usage.output_tokens} out)")
    return sections_html


def render_full_html(client: dict, sections_html: str) -> str:
    """섹션 HTML을 전체 브리핑 템플릿에 삽입"""
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    today = datetime.now().strftime("%Y년 %m월 %d일")

    html = template.replace("{{CLIENT_NAME}}", client["name"])
    html = html.replace("{{DATE}}", today)
    html = html.replace("{{CATEGORY}}", client["category"])
    html = html.replace("{{SECTIONS}}", sections_html)

    return html


def write_briefing(
    client: dict,
    coupang_data: dict,
    trend_data: dict,
    news_data: dict,
) -> str:
    """전체 브리핑 HTML 생성 (섹션 생성 + 템플릿 렌더링)"""
    sections_html = generate_briefing_sections(client, coupang_data, trend_data, news_data)
    full_html = render_full_html(client, sections_html)
    return full_html
