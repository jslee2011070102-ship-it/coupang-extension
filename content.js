/**
 * content.js
 * 역할: 쿠팡 상품 페이지에서 제품 정보를 종합 스크래핑하여 popup.js로 전달
 *
 * 수집 항목:
 *   - keyword   : 검색 키워드 or 제품 타이틀
 *   - title     : 전체 제품명 (최대 100자)
 *   - brand     : 브랜드명
 *   - price     : 판매가 (원)
 *   - rating    : 별점 (예: "4.8")
 *   - reviewCount: 리뷰 수 (예: "12,345")
 *   - category  : 카테고리 경로 (예: "생활가전 > 청소기 > 무선청소기")
 *   - features  : 주요 특징 배열 (상품 옵션/스펙 테이블에서 최대 5개)
 *   - description: 상품 설명 요약 (첫 번째 문단, 최대 200자)
 */

function extractProductInfo() {
  const info = {
    keyword: null,
    title: null,
    brand: null,
    price: null,
    rating: null,
    reviewCount: null,
    category: null,
    features: [],
    description: null,
    productImageUrl: null
  };

  // ── 키워드 (URL q= 파라미터) ──
  const urlParams = new URL(window.location.href).searchParams;
  const qParam = urlParams.get('q');
  if (qParam) info.keyword = qParam.trim();

  // ── 제품 타이틀 ──
  const titleSelectors = [
    'h1.prod-buy-header__title',
    '.prod-buy-header__title',
    'h1[class*="title"]',
    'h1'
  ];
  for (const sel of titleSelectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim()) {
      info.title = el.textContent.trim().substring(0, 100);
      if (!info.keyword) info.keyword = info.title.substring(0, 50);
      break;
    }
  }

  // URL에서 타이틀도 못 찾으면 document.title에서
  if (!info.title) {
    const docTitle = document.title.replace(/\s*[-|]\s*쿠팡.*$/i, '').trim();
    if (docTitle) {
      info.title = docTitle.substring(0, 100);
      info.keyword = info.keyword || docTitle.substring(0, 50);
    }
  }

  // ── 브랜드 ──
  const brandSelectors = [
    '.prod-brand-name',
    '[class*="brand-name"]',
    '[class*="vendor-name"]',
    '.vendor-name'
  ];
  for (const sel of brandSelectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim()) {
      info.brand = el.textContent.trim().substring(0, 30);
      break;
    }
  }

  // ── 가격 ──
  const priceSelectors = [
    '.total-price strong',
    '.prod-price .total-price',
    '[class*="price"] strong',
    '[class*="sale-price"]',
    '.sale-price'
  ];
  for (const sel of priceSelectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim()) {
      const raw = el.textContent.replace(/[^0-9,]/g, '').trim();
      if (raw) { info.price = raw + '원'; break; }
    }
  }

  // ── 평점 + 리뷰수 ──
  const ratingEl = document.querySelector(
    '[class*="rating"] [class*="score"], [class*="star-score"], .star-score'
  );
  if (ratingEl) info.rating = ratingEl.textContent.trim().split('/')[0].trim();

  const reviewSelectors = [
    '[class*="review-count"]',
    '[class*="rating-count"]',
    '.ratingCountInReview'
  ];
  for (const sel of reviewSelectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim()) {
      info.reviewCount = el.textContent.replace(/[^0-9,]/g, '').trim();
      break;
    }
  }

  // ── 카테고리 breadcrumb ──
  const breadcrumbSelectors = [
    '.breadcrumb li',
    '[class*="breadcrumb"] li',
    '[class*="breadcrumb"] a',
    '.breadcrumb a'
  ];
  for (const sel of breadcrumbSelectors) {
    const els = document.querySelectorAll(sel);
    if (els.length > 1) {
      info.category = Array.from(els)
        .map(e => e.textContent.trim())
        .filter(t => t && t !== '홈' && t !== '쿠팡')
        .join(' > ')
        .substring(0, 80);
      break;
    }
  }

  // ── 주요 특징 (옵션/스펙 테이블) ──
  // 방법 1: 상품 상세 스펙 테이블
  const specRows = document.querySelectorAll(
    '.prod-attr-list li, [class*="spec"] tr, [class*="attr"] li, .detail-attr-list li'
  );
  if (specRows.length > 0) {
    Array.from(specRows).slice(0, 6).forEach(row => {
      const text = row.textContent.replace(/\s+/g, ' ').trim();
      if (text && text.length > 2 && text.length < 80) {
        info.features.push(text);
      }
    });
  }

  // 방법 2: 불릿 포인트 / 하이라이트 텍스트
  if (info.features.length < 3) {
    const bulletSelectors = [
      '.prod-detail-summary li',
      '[class*="highlight"] li',
      '[class*="summary"] li',
      '[class*="feature"] li'
    ];
    for (const sel of bulletSelectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        Array.from(els).slice(0, 5).forEach(el => {
          const text = el.textContent.replace(/\s+/g, ' ').trim();
          if (text && text.length > 2 && text.length < 100 && !info.features.includes(text)) {
            info.features.push(text);
          }
        });
        break;
      }
    }
  }

  // 방법 3: 제품 옵션명에서 특징 추출
  if (info.features.length < 2) {
    const optionEls = document.querySelectorAll(
      '.prod-option-dropdown__option-name, [class*="option"] [class*="name"]'
    );
    Array.from(optionEls).slice(0, 4).forEach(el => {
      const text = el.textContent.trim();
      if (text && text.length > 2 && text.length < 60) {
        info.features.push(text);
      }
    });
  }

  // 중복 제거 + 최대 5개
  info.features = [...new Set(info.features)].slice(0, 5);

  // ── 제품 대표 이미지 URL ──
  const imgSelectors = [
    '.prod-image__detail img',
    '[class*="prod-image"] img',
    '.thumbnail-image img',
    '[class*="thumbnail"] img'
  ];
  for (const sel of imgSelectors) {
    const el = document.querySelector(sel);
    if (el && el.src && el.src.startsWith('http')) {
      info.productImageUrl = el.src;
      break;
    }
  }

  // ── 상품 설명 (첫 텍스트 단락) ──
  const descSelectors = [
    '.prod-description p',
    '[class*="item-description"] p',
    '[class*="detail-content"] p',
    '.product-description p'
  ];
  for (const sel of descSelectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim().length > 20) {
      info.description = el.textContent.replace(/\s+/g, ' ').trim().substring(0, 200);
      break;
    }
  }

  return info;
}

// popup.js에서 메시지를 받아 응답
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getKeyword') {
    // 하위 호환 유지
    const info = extractProductInfo();
    sendResponse({ keyword: info.keyword });
  } else if (request.action === 'getProductInfo') {
    const info = extractProductInfo();
    sendResponse(info);
  }
  return true;
});
