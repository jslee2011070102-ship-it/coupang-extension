"""
쿠팡파트너스 API 수집기
- 키워드별 상품 순위 / 가격 / 리뷰 수 수집
- HMAC-SHA256 인증
- 시간당 10회 제한 준수 (sleep 400초)
- 3회 연속 오류 시 조기 중단 (계정 보호)
"""

import hmac
import hashlib
import time
import os
import logging
import requests
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

ACCESS_KEY = os.environ.get("COUPANG_ACCESS_KEY", "")
SECRET_KEY = os.environ.get("COUPANG_SECRET_KEY", "")

BASE_URL = "https://api-gateway.coupang.com"
SEARCH_PATH = "/v2/providers/affiliate_open_api/apis/openapi/v1/products/search"

# 시간당 10회 제한 → 호출 간격 최소 400초
CALL_INTERVAL_SEC = 400

# 연속 오류 3회 → 계정 보호를 위해 중단
MAX_CONSECUTIVE_ERRORS = 3


def _generate_hmac(method: str, path: str, query: str) -> dict:
    """쿠팡파트너스 HMAC-SHA256 인증 헤더 생성"""
    datetime_str = time.strftime("%y%m%dT%H%M%SZ", time.gmtime())
    message = f"{datetime_str}\n{method}\n{path}\n{query}"
    signature = hmac.new(
        SECRET_KEY.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    authorization = (
        f"CEA algorithm=HmacSHA256, access-key={ACCESS_KEY}, "
        f"signed-date={datetime_str}, signature={signature}"
    )
    return {"Authorization": authorization, "Content-Type": "application/json"}


def search_products(keyword: str, limit: int = 10) -> list[dict]:
    """
    키워드로 쿠팡 상품 검색.
    반환: [{"rank": int, "name": str, "price": int, "review_count": int,
             "rating": float, "brand": str, "url": str}]
    """
    query = f"keyword={requests.utils.quote(keyword)}&limit={limit}"
    headers = _generate_hmac("GET", SEARCH_PATH, query)
    url = f"{BASE_URL}{SEARCH_PATH}?{query}"

    try:
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        products = data.get("data", {}).get("productData", [])
        result = []
        for rank, item in enumerate(products, start=1):
            result.append({
                "rank": rank,
                "name": item.get("productName", ""),
                "price": item.get("productPrice", 0),
                "review_count": item.get("productReviewCount", 0),
                "rating": item.get("productRating", 0.0),
                "brand": item.get("brandName", ""),
                "url": item.get("productUrl", ""),
            })
        return result
    except requests.HTTPError as e:
        logger.error(f"쿠팡 API HTTP 오류 [{keyword}]: {e}")
        raise
    except Exception as e:
        logger.error(f"쿠팡 API 오류 [{keyword}]: {e}")
        raise


def collect_client_data(client: dict) -> dict:
    """
    고객사 키워드 전체 수집.
    시간당 10회 제한 준수 → 키워드 간 sleep(400).
    3회 연속 오류 발생 시 중단.
    """
    keywords = client.get("keywords", [])
    results = {}
    consecutive_errors = 0

    for i, keyword in enumerate(keywords):
        if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
            logger.error("연속 오류 3회 초과 → 쿠팡 API 수집 중단 (계정 보호)")
            break

        # 첫 호출 제외 sleep
        if i > 0:
            logger.info(f"쿠팡 API 호출 간격 대기 ({CALL_INTERVAL_SEC}초)...")
            time.sleep(CALL_INTERVAL_SEC)

        try:
            logger.info(f"[{client['name']}] 키워드 수집: {keyword}")
            products = search_products(keyword)
            results[keyword] = products
            consecutive_errors = 0
        except Exception:
            consecutive_errors += 1
            results[keyword] = []

    return {
        "client_id": client["id"],
        "client_name": client["name"],
        "collected_at": datetime.utcnow().isoformat(),
        "keywords": results,
    }


def detect_changes(current: dict, previous: dict, sensitivity: dict) -> list[dict]:
    """
    전일 대비 변동 감지.
    price_change_pct: 가격 변동 % 임계값
    review_surge_count: 리뷰 급증 수 임계값
    """
    alerts = []
    price_threshold = sensitivity.get("price_change_pct", 5)
    review_threshold = sensitivity.get("review_surge_count", 30)

    for keyword, products in current.get("keywords", {}).items():
        prev_products = previous.get("keywords", {}).get(keyword, [])
        prev_map = {p["name"]: p for p in prev_products}

        for product in products:
            name = product["name"]
            if name not in prev_map:
                continue
            prev = prev_map[name]

            # 가격 변동 감지
            if prev["price"] > 0:
                price_change = abs(product["price"] - prev["price"]) / prev["price"] * 100
                if price_change >= price_threshold:
                    direction = "인하" if product["price"] < prev["price"] else "인상"
                    alerts.append({
                        "type": "price_change",
                        "keyword": keyword,
                        "product": name,
                        "direction": direction,
                        "change_pct": round(price_change, 1),
                        "prev_price": prev["price"],
                        "curr_price": product["price"],
                    })

            # 리뷰 급증 감지
            review_diff = product["review_count"] - prev["review_count"]
            if review_diff >= review_threshold:
                alerts.append({
                    "type": "review_surge",
                    "keyword": keyword,
                    "product": name,
                    "review_increase": review_diff,
                    "curr_reviews": product["review_count"],
                })

    return alerts
