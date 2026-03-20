"""
뉴스 RSS 수집기
- 카테고리별 뉴스 자동 수집
- 중복 제거 (URL 기반)
- 고객사 키워드 관련 기사 필터링
"""

import logging
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional
import feedparser

logger = logging.getLogger(__name__)

# 카테고리별 RSS 피드 목록
RSS_FEEDS = {
    "건기식/다이어트": [
        "https://www.yna.co.kr/rss/health.xml",
        "https://rss.etnews.com/Section901.xml",
        "https://rss.donga.com/health.xml",
    ],
    "beauty": [
        "https://www.yna.co.kr/rss/culture.xml",
    ],
    "default": [
        "https://www.yna.co.kr/rss/economy.xml",
        "https://rss.etnews.com/Section902.xml",
    ],
}

MAX_AGE_HOURS = 48  # 48시간 이내 기사만 수집


def _fetch_feed(url: str) -> list[dict]:
    """단일 RSS 피드 파싱"""
    try:
        feed = feedparser.parse(url)
        items = []
        cutoff = datetime.now(timezone.utc) - timedelta(hours=MAX_AGE_HOURS)

        for entry in feed.entries:
            # 발행일 파싱
            published = None
            if hasattr(entry, "published_parsed") and entry.published_parsed:
                published = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
            elif hasattr(entry, "updated_parsed") and entry.updated_parsed:
                published = datetime(*entry.updated_parsed[:6], tzinfo=timezone.utc)

            # 너무 오래된 기사 제외
            if published and published < cutoff:
                continue

            items.append({
                "title": entry.get("title", "").strip(),
                "url": entry.get("link", ""),
                "summary": entry.get("summary", "")[:300].strip(),
                "published": published.isoformat() if published else "",
                "source": feed.feed.get("title", url),
            })

        return items
    except Exception as e:
        logger.warning(f"RSS 수집 실패 [{url}]: {e}")
        return []


def _deduplicate(articles: list[dict]) -> list[dict]:
    """URL 해시 기반 중복 제거"""
    seen = set()
    unique = []
    for article in articles:
        key = hashlib.md5(article["url"].encode()).hexdigest()
        if key not in seen:
            seen.add(key)
            unique.append(article)
    return unique


def _filter_by_keywords(articles: list[dict], keywords: list[str]) -> list[dict]:
    """제목 또는 요약에 키워드가 포함된 기사만 반환"""
    if not keywords:
        return articles

    filtered = []
    for article in articles:
        text = (article["title"] + " " + article["summary"]).lower()
        if any(kw.lower() in text for kw in keywords):
            filtered.append(article)
    return filtered


def collect_client_news(client: dict) -> dict:
    """고객사 카테고리 + 키워드 기반 뉴스 수집"""
    category = client.get("category", "default")
    news_keywords = client.get("news_keywords", client.get("keywords", []))

    feeds = RSS_FEEDS.get(category, RSS_FEEDS["default"])
    all_articles = []
    for feed_url in feeds:
        all_articles.extend(_fetch_feed(feed_url))

    # 기본 default 피드도 추가 수집
    if category != "default":
        for feed_url in RSS_FEEDS["default"]:
            all_articles.extend(_fetch_feed(feed_url))

    unique_articles = _deduplicate(all_articles)
    relevant_articles = _filter_by_keywords(unique_articles, news_keywords)

    # 키워드 매칭 기사가 너무 적으면 전체에서 최신 5개 추가
    if len(relevant_articles) < 3:
        extra = [a for a in unique_articles if a not in relevant_articles]
        relevant_articles.extend(extra[:max(0, 5 - len(relevant_articles))])

    # 최대 10개 반환
    return {
        "client_id": client["id"],
        "client_name": client["name"],
        "collected_at": datetime.utcnow().isoformat(),
        "articles": relevant_articles[:10],
    }
