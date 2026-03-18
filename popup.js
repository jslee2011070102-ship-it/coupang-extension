/**
 * popup.js
 * 역할: 확장프로그램 팝업 메인 로직 (1~4단계 통합)
 */

// ===== 전역 상태 =====
const state = {
  keyword: '',
  keywordEn: '',
  keywordZh: '',
  productInfo: null,      // 쿠팡 페이지에서 추출한 제품 전체 정보
  productImageUrl: '',    // 제품 대표 이미지 URL (이미지 검색용)
  script: '',
  titleCandidates: [],    // 생성된 제목 후보 3개
  selectedTitle: '',      // 선택된 제목
  audioBlob: null,
  srtContent: '',
  thumbnailImage: null,   // 업로드된 제품 이미지 (HTMLImageElement)
  thumbnailBlob: null
};

// ===== DOM 헬퍼 =====
const $ = id => document.getElementById(id);
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
function showError(id, msg) { $(id).textContent = msg; show(id); }

// ===== 탭 전환 =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    $(btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'tab-package') updateChecklist();
  });
});

// ===== 설정 패널 =====
$('btn-settings').addEventListener('click', () => show('settings-panel'));
$('btn-settings-close').addEventListener('click', () => hide('settings-panel'));

$('btn-toggle-key').addEventListener('click', () => {
  const input = $('input-api-key');
  input.type = input.type === 'password' ? 'text' : 'password';
});

$('btn-save-key').addEventListener('click', async () => {
  const key = $('input-api-key').value.trim();
  if (!key) return;
  await chrome.storage.local.set({ claudeApiKey: key });
  show('key-saved-msg');
  setTimeout(() => hide('key-saved-msg'), 2000);
});

// ===== 1단계: 제품 정보 추출 + 번역 + 링크 생성 =====

async function initKeyword() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url || !tab.url.includes('coupang.com')) {
    hide('keyword-loading');
    show('keyword-not-coupang');
    show('script-no-product');
    $('search-links-placeholder').textContent = '쿠팡 상품 페이지에서 실행해주세요';
    return;
  }

  show('keyword-loading');

  // ── content.js로 제품 정보 전체 요청 ──
  let info = null;
  try {
    info = await chrome.tabs.sendMessage(tab.id, { action: 'getProductInfo' });
  } catch (e) {
    // content script 미로드 시 scripting API로 직접 실행
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // content.js의 extractProductInfo를 인라인으로 실행
          const info = { keyword: null, title: null, brand: null, price: null,
            rating: null, reviewCount: null, category: null, features: [], description: null };
          const urlParams = new URL(window.location.href).searchParams;
          const q = urlParams.get('q');
          if (q) info.keyword = q.trim();
          const titleEl = document.querySelector('h1.prod-buy-header__title, h1[class*="title"], h1');
          if (titleEl) {
            info.title = titleEl.textContent.trim().substring(0, 100);
            if (!info.keyword) info.keyword = info.title.substring(0, 50);
          }
          if (!info.title) {
            const dt = document.title.replace(/\s*[-|]\s*쿠팡.*$/i, '').trim();
            if (dt) { info.title = dt.substring(0, 100); info.keyword = info.keyword || dt.substring(0, 50); }
          }
          const priceEl = document.querySelector('.total-price strong, [class*="price"] strong, .sale-price');
          if (priceEl) info.price = priceEl.textContent.replace(/[^0-9,]/g, '') + '원';
          const ratingEl = document.querySelector('[class*="star-score"], .star-score');
          if (ratingEl) info.rating = ratingEl.textContent.trim().split('/')[0].trim();
          const reviewEl = document.querySelector('[class*="review-count"], [class*="rating-count"]');
          if (reviewEl) info.reviewCount = reviewEl.textContent.replace(/[^0-9,]/g, '').trim();
          const crumbs = document.querySelectorAll('.breadcrumb li, [class*="breadcrumb"] li');
          if (crumbs.length > 1) {
            info.category = Array.from(crumbs).map(e => e.textContent.trim())
              .filter(t => t && t !== '홈' && t !== '쿠팡').join(' > ').substring(0, 80);
          }
          const specRows = document.querySelectorAll('.prod-attr-list li, [class*="spec"] tr, [class*="attr"] li');
          Array.from(specRows).slice(0, 5).forEach(r => {
            const t = r.textContent.replace(/\s+/g, ' ').trim();
            if (t && t.length > 2 && t.length < 80) info.features.push(t);
          });
          return info;
        }
      });
      info = results?.[0]?.result;
    } catch (e2) {
      hide('keyword-loading');
      showError('keyword-error-msg', '키워드 추출에 실패했습니다. 페이지를 새로고침 후 다시 시도하세요.');
      show('keyword-error');
      return;
    }
  }

  hide('keyword-loading');

  if (!info?.keyword) {
    showError('keyword-error-msg', '제품 키워드를 찾을 수 없습니다.');
    show('keyword-error');
    return;
  }

  // 상태 저장
  state.productInfo = info;
  state.keyword = info.keyword;
  state.productImageUrl = info.productImageUrl || '';

  // 키워드 헤더 표시
  $('keyword-ko').textContent = info.title || info.keyword;
  show('keyword-result');
  hide('search-links-placeholder');

  // 이미지 검색 섹션 렌더링 (번역 전에 먼저 표시)
  renderImageSection();

  // 대본 탭 — 제품 분석 카드 렌더링
  renderProductCard(info);

  // 번역 (Google Translate 무료 API)
  await translateKeyword(info.keyword);
}

/** 대본 탭의 제품 분석 카드를 렌더링한다 */
function renderProductCard(info) {
  hide('script-no-product');
  const body = $('product-card-body');
  const rows = [];

  if (info.title)       rows.push(['제품명', info.title]);
  if (info.brand)       rows.push(['브랜드', info.brand]);
  if (info.price)       rows.push(['가격', info.price]);
  if (info.rating)      rows.push(['평점', `⭐ ${info.rating}${info.reviewCount ? ' (' + info.reviewCount + '개 리뷰)' : ''}`]);
  if (info.category)    rows.push(['카테고리', info.category]);
  if (info.features?.length) rows.push(['주요특징', info.features.join(' / ')]);

  body.innerHTML = rows.map(([k, v]) =>
    `<div class="product-row"><span class="product-label">${k}</span><span class="product-value">${v}</span></div>`
  ).join('');

  show('product-info-card');
}

async function translateKeyword(keyword) {
  try {
    const [enRes, zhRes] = await Promise.all([
      fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=en&dt=t&q=${encodeURIComponent(keyword)}`),
      fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl=zh-CN&dt=t&q=${encodeURIComponent(keyword)}`)
    ]);
    const enData = await enRes.json();
    const zhData = await zhRes.json();

    state.keywordEn = enData[0][0][0];
    state.keywordZh = zhData[0][0][0];

    $('keyword-translations').textContent =
      `검색 키워드: ${state.keywordEn} / ${state.keywordZh}`;

    renderSearchLinks();
  } catch (e) {
    // 번역 실패 시 원본 키워드로 폴백
    state.keywordEn = keyword;
    state.keywordZh = keyword;
    $('keyword-translations').textContent = `(번역 실패 — 원본 키워드로 검색)`;
    renderSearchLinks();
  }
}

// ── 링크 빌더 공통 유틸 ──
function buildLinkItems(containerId, list) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = '';
  list.forEach(p => {
    const a = document.createElement('a');
    a.href = p.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'link-item';
    a.innerHTML = `<span class="link-icon">${p.icon}</span><span>${p.name}</span>`;
    container.appendChild(a);
  });
}

// ── 섹션 B: 쇼츠 & SNS 링크 ──
function renderSnsLinks(keywordEn, keywordZh) {
  const en = encodeURIComponent(keywordEn);
  const zh = encodeURIComponent(keywordZh);

  buildLinkItems('links-sns', [
    { icon: '🎵', name: 'TikTok',
      url: `https://www.tiktok.com/search?q=${en}` },
    { icon: '🎵', name: '抖音 (Douyin)',
      url: `https://www.douyin.com/search/${zh}` },
    { icon: '📸', name: 'Instagram',
      url: `https://www.instagram.com/explore/tags/${encodeURIComponent(keywordEn.replace(/ /g, ''))}` },
    { icon: '🛍️', name: '小红书 (Xiaohongshu)',
      url: `https://www.xiaohongshu.com/search_result?keyword=${zh}` },
  ]);
  show('section-sns-links');
}

// ── 섹션 C: 해외 쇼핑몰 링크 ──
function renderShopLinks(keywordEn, keywordZh) {
  const en = encodeURIComponent(keywordEn);
  const zh = encodeURIComponent(keywordZh);

  buildLinkItems('links-shop', [
    { icon: '🛒', name: 'Amazon',
      url: `https://www.amazon.com/s?k=${en}` },
    { icon: '🛍️', name: 'AliExpress',
      url: `https://www.aliexpress.com/wholesale?SearchText=${en}` },
    { icon: '🏭', name: '1688 도매',
      url: `https://s.1688.com/selloffer/offerlist.htm?keywords=${zh}` },
    { icon: '🌐', name: 'Alibaba.com',
      url: `https://www.alibaba.com/trade/search?SearchText=${en}` },
  ]);
  show('section-shop-links');
}

// ── renderSearchLinks: translateKeyword()에서 호출 ──
function renderSearchLinks() {
  renderSnsLinks(state.keywordEn, state.keywordZh);
  renderShopLinks(state.keywordEn, state.keywordZh);
  renderOpenAllButton();
}

/** 모두 열기 버튼 활성화 (키워드 번역 완료 후) */
function renderOpenAllButton() {
  const en = encodeURIComponent(state.keywordEn);
  const zh = encodeURIComponent(state.keywordZh);
  const enNoSpace = encodeURIComponent(state.keywordEn.replace(/ /g, ''));

  const allUrls = [
    `https://www.tiktok.com/search/video?q=${en}`,
    `https://www.douyin.com/search/${zh}`,
    `https://www.instagram.com/explore/tags/${enNoSpace}`,
    `https://www.xiaohongshu.com/search_result?keyword=${zh}`,
    `https://s.1688.com/selloffer/offerlist.htm?keywords=${zh}`,
    `https://www.aliexpress.com/wholesale?SearchText=${en}`,
    `https://www.amazon.com/s?k=${en}`,
    `https://www.alibaba.com/trade/search?SearchText=${en}`,
  ];

  const btn = $('btn-open-all-tabs');
  btn.onclick = () => allUrls.forEach(url => chrome.tabs.create({ url, active: false }));
  show('btn-open-all-wrap');
}

/** 이미지 검색 섹션: 이미지 URL 자동방식 또는 클립보드 방식 */
function renderImageSection() {
  const imgUrl = state.productImageUrl;

  if (imgUrl) {
    // ── A: 이미지 URL 자동 방식 ──
    // 붙여넣기 영역 숨기기, 자동 이미지 미리보기 표시
    $('image-paste-zone').style.display = 'none';
    hide('image-paste-clear-row');
    hide('image-search-hint-manual');
    show('image-search-hint-auto');

    const preview = $('image-paste-preview');
    preview.src = imgUrl;
    preview.style.display = 'block';

    // 이미지 검색 링크 (URL 파라미터 방식 — 클립보드 불필요)
    $('image-search-links-hint').textContent = '→ 클릭하면 해당 사이트에서 바로 검색됩니다';
    show('image-search-links');
    buildImageUrlSearchLinks(imgUrl);
  } else {
    // ── B: Fallback — 기존 클립보드 방식 ──
    $('image-paste-zone').style.display = '';
    show('image-search-hint-manual');
    hide('image-search-hint-auto');
  }
}

/** 이미지 URL 파라미터 방식 검색 링크 생성 */
function buildImageUrlSearchLinks(imgUrl) {
  const enc = encodeURIComponent(imgUrl);
  buildLinkItems('links-image-search', [
    { icon: '🔍', name: 'Google Lens',    url: `https://lens.google.com/uploadbyurl?url=${enc}` },
    { icon: '🏭', name: '1688 이미지 검색', url: `https://s.1688.com/youyuan/index.htm?imageAddress=${enc}` },
  ]);
}

// ===== 이미지 검색 (Ctrl+V 붙여넣기 → 자동 주입) =====

let pastedImageBlob = null;  // 전역 보관

(function initImageSearch() {
  const pasteZone = $('image-paste-zone');
  const pasteHint = $('image-paste-hint');
  const preview   = $('image-paste-preview');

  function showPastedImage(blob) {
    pastedImageBlob = blob;
    preview.src = URL.createObjectURL(blob);
    preview.style.display = 'block';
    pasteHint.style.display = 'none';
    show('image-paste-clear-row');
    show('image-search-links');
    renderImageSearchLinks();
  }

  // 이미지 제거
  $('btn-image-paste-clear').addEventListener('click', () => {
    pastedImageBlob = null;
    preview.src = '';
    preview.style.display = 'none';
    pasteHint.style.display = '';
    hide('image-paste-clear-row');
    hide('image-search-links');
    pasteZone.classList.remove('focused');
  });

  // 클릭 → 포커스
  pasteZone.addEventListener('click', () => pasteZone.focus());
  pasteZone.addEventListener('focus', () => pasteZone.classList.add('focused'));
  pasteZone.addEventListener('blur',  () => pasteZone.classList.remove('focused'));

  // Ctrl+V — document 전체에서 수신
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) { showPastedImage(blob); break; }
      }
    }
  });

  // 드래그 앤 드롭
  pasteZone.addEventListener('dragover',  (e) => { e.preventDefault(); pasteZone.classList.add('drag-over'); });
  pasteZone.addEventListener('dragleave', ()  => pasteZone.classList.remove('drag-over'));
  pasteZone.addEventListener('drop', (e) => {
    e.preventDefault();
    pasteZone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) showPastedImage(file);
  });
})();

/** Blob → base64 data URL */
function blobToBase64(blob) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

/** 새 탭 열고 이미지 자동 주입 */
async function openImageSearchTab(url, injectFn) {
  if (!pastedImageBlob) return;

  const base64 = await blobToBase64(pastedImageBlob);
  const tab    = await chrome.tabs.create({ url, active: true });

  const listener = async (tabId, info) => {
    if (tabId !== tab.id || info.status !== 'complete') return;
    chrome.tabs.onUpdated.removeListener(listener);

    // 페이지 JS 초기화 시간 대기 (SPA 렌더링)
    await new Promise(r => setTimeout(r, 1200));

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: injectFn,
        args: [base64]
      });
    } catch (e) {
      console.warn('Image inject failed:', e.message);
    }
  };
  chrome.tabs.onUpdated.addListener(listener);
}

/** 이미지 inject 공통 로직 (base64 → File → input[type=file] 설정) */
function _injectImageToFileInput(base64) {
  function b64ToFile(b64) {
    const arr  = b64.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    const u8   = new Uint8Array(bstr.length);
    for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
    return new File([u8], 'image.png', { type: mime });
  }

  const file = b64ToFile(base64);
  const dt   = new DataTransfer();
  dt.items.add(file);

  // 모든 file input에 설정 시도
  const inputs = document.querySelectorAll('input[type="file"]');
  inputs.forEach(input => {
    try {
      input.files = dt.files;
      ['change', 'input'].forEach(name =>
        input.dispatchEvent(new Event(name, { bubbles: true }))
      );
    } catch (_) {}
  });

  // Drop 이벤트로도 시도 (파일 input이 숨어있는 경우)
  const dropTargets = [
    document.querySelector('[role="img"][draggable]'),
    document.querySelector('[data-drop-zone]'),
    document.querySelector('.upload-content'),
    document.querySelector('main'),
    document.body
  ].filter(Boolean);

  dropTargets.slice(0, 2).forEach(target => {
    try {
      ['dragenter', 'dragover', 'drop'].forEach(name => {
        target.dispatchEvent(new DragEvent(name, {
          bubbles: true, cancelable: true, dataTransfer: dt
        }));
      });
    } catch (_) {}
  });
}

/** 이미지 검색 버튼 렌더링 (버튼 클릭 → 자동 inject) */
function renderImageSearchLinks() {
  const container = $('links-image-search');
  container.innerHTML = '';

  const platforms = [
    { icon: '🔍', name: 'Google Lens',           url: 'https://lens.google.com/' },
    { icon: '🏭', name: '1688 이미지 검색',        url: 'https://s.1688.com/youyuan/index.htm' },
    { icon: '🛍️', name: 'AliExpress 이미지 검색', url: 'https://www.aliexpress.com/p/calp-plus/photo-search.html' },
    { icon: '🛒', name: 'Amazon 이미지 검색',      url: 'https://www.amazon.com/camera/snap' },
  ];

  platforms.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'link-item';
    btn.style.cssText = 'width:100%;text-align:left;cursor:pointer;background:white;border:1px solid #e9ecef;';
    btn.innerHTML = `<span class="link-icon">${p.icon}</span><span>${p.name}</span>`;
    btn.addEventListener('click', () => openImageSearchTab(p.url, _injectImageToFileInput));
    container.appendChild(btn);
  });
}

// ===== 2단계: AI 제목 + 대본 생성 (쇼핑쇼츠 가이드 기반) =====

$('btn-generate-script').addEventListener('click', generateScript);
$('btn-regen-script').addEventListener('click', generateScript);

async function generateScript() {
  const { claudeApiKey } = await chrome.storage.local.get('claudeApiKey');
  if (!claudeApiKey) {
    showError('script-error-msg', '⚙️ 설정에서 Claude API 키를 먼저 입력해주세요.');
    show('script-error');
    return;
  }

  hide('script-error');
  hide('script-result');
  $('script-loading-msg').textContent = '제품 분석 중... 제목·대본 생성 중';
  show('script-loading');

  // ── 제품 정보 구성 ──
  const info = state.productInfo;
  const extra = $('input-extra')?.value.trim() || '';

  let productContext = '';
  if (info) {
    productContext = [
      info.title       ? `제품명: ${info.title}` : '',
      info.brand       ? `브랜드: ${info.brand}` : '',
      info.price       ? `가격: ${info.price}` : '',
      info.rating      ? `평점: ${info.rating}${info.reviewCount ? ' (' + info.reviewCount + '개 리뷰)' : ''}` : '',
      info.category    ? `카테고리: ${info.category}` : '',
      info.features?.length ? `주요특징:\n${info.features.map(f => `- ${f}`).join('\n')}` : '',
      info.description ? `상품설명: ${info.description}` : ''
    ].filter(Boolean).join('\n');
  } else {
    productContext = `제품명: ${state.keyword || '(미입력)'}`;
  }

  // ══════════════════════════════════════════════
  // 시스템 프롬프트 — 쇼핑쇼츠_대본_자동생성_가이드 기반
  // ══════════════════════════════════════════════
  const systemPrompt = `당신은 대한민국 SNS 쇼핑 쇼츠 전문 카피라이터입니다.
아래 규칙을 철저히 따라 제목 3개와 대본 1개를 생성하세요.

════════════════════════════════
★ 최우선 규칙: 문맥 일관성
════════════════════════════════

제목과 대본에 등장하는 모든 상황·행동·감정은 반드시 해당 제품의
실제 사용 맥락에서 자연스럽게 발생해야 합니다.

[나쁜 예 — 억지스러운 연결]
- "옷 버리려다 환장했다는 미친 활용법"
  → "버리려다"와 "환장했다"가 충돌하고 제품 기능이 불명확함

[좋은 예 — 자연스러운 연결]
- "보풀 생긴 옷 살린다는 역대급 꿀템 정체" (보풀제거기)
- "주부들이 환장한다는 청소 꿀템 정체" (청소기)

작성 전에 반드시 확인:
✓ 이 제목을 한국인 10명이 읽었을 때 뜻이 바로 이해되는가?
✓ 언급된 상황이 제품 사용과 직접 연결되는가?
✓ 동사·형용사·명사 조합이 자연스러운 한국어인가?

════════════════════════════════
제목 작성 규칙
════════════════════════════════

[구조 패턴 — 서로 다른 패턴 3개 사용]
1. [반응/상태] + [대상] + [제품/현상]   예) 주부들 환장한다는 청소기 정체
2. [플랫폼] + [반응] + [제품]            예) 해외 SNS에서 난리난 역대급 꿀템 정체
3. [사용자 상황] + [결과]               예) 매일 쓰던 물건에 이게 숨어있다는 거
4. [수식어] + [대상] + [반응]            예) 써본 사람들이 다시 못 산다는 제품 정체
5. [플랫폼] + [떡상/난리] + [제품]       예) 미친 가성비로 요즘 완전 뜬 일본 제품
6. [예상 못한 효과] + [놀란 이유]        예) 한 번 써본 사람이 주변에 다 뿌린다는 제품

[필수 키워드 — 제목마다 1개 이상]
반응 표현: 환장한다 / 난리 / 화제 / 떡상 / 대박
수식어: 미친 / 역대급 / 반전 / 예상 못한
대상 표현: 정체 / 활용법 / 꿀템

[제목 금지 사항]
- 물음표(?) 사용 금지
- 가격 직접 언급 금지
- 평범한 설명체 금지 (~하는 제품입니다 등)
- 이모지·영어 사용 금지
- 반드시 명사형 또는 명사절로 종결
- 의미가 불명확하거나 비문이 되는 조합 금지

════════════════════════════════
대본 작성 규칙
════════════════════════════════

[전체 구조 — 반드시 이 순서대로]
도입부 → 정체 공개 → 핵심 포인트 → 마무리

[1. 도입부 — 1~2문장]
역할: 시청자의 시선을 낚아채는 훅(Hook)
방식: 제품의 실제 사용 상황에서 시작 → 반응/현상 언급
예시: "요즘 주부들 사이에서 이거 써봤냐고 난리난 청소기가 있는데"

[2. 정체 공개 — 1문장]
역할: 제품의 핵심 기능/특징을 한 문장으로 밝힘
방식: "사실 ~라는 거" / "바로 ~라는 거" 형식
예시: "겉보기엔 평범해 보이지만 사실 흡입력이 일반 제품의 세 배라는 거"

[3. 핵심 포인트 — 2~3문장 ★ 가장 중요]
역할: 왜 이 제품이 특별한지 구체적으로 설명
방식: 반드시 "이게 미친 포인트인게" 로 시작
구성:
  a) 기존의 불편함/한계 → "원래는 ~했는데" / "보통 ~하려면"
  b) 이 제품의 해결 방식 → "이건 ~하기만 하면 끝"
  c) 구체적인 수치나 효과 → "30초 만에" / "무게가 절반" / "충전 없이 2시간" 등
주의: 수치나 효과는 제품 카테고리상 실제로 가능한 범위로만 작성

[4. 마무리 — 1문장]
역할: 입소문/인기를 증명하며 마무리
방식: 짧고 임팩트 있게, 반드시 한국어로만 종결 (영어 사용 절대 금지)
마무리 표현 풀 (택1):
  ~라 불린다고 / ~라 불리고 있다고 / ~라 환장한다고
  ~로 개꿀이라고 / ~라 난리났다고 / ~라 요즘 완전 뜬다고
  ~라 입소문 났다고 / ~라 다들 사재기 중이라고

[말투 & 문체 규칙]
반드시 사용할 표현: "미친 포인트인게" / "~라는 거" / "~한다는 거" / "난리/화제" / "~만 하면 끝"
문체: 구어체 (문어체 절대 금지), 짧은 문장들을 빠르게 연결, 쉼표 활용
강조: "진짜 미친게", "심지어", "게다가" 로 레이어 쌓기
전체 길이: 100~150자 내외 (15~20초 분량)
각 문장은 줄바꿈으로 구분 (TTS 자막 처리용)
이모지·영어 사용 금지 (TTS 낭독 시 이상하게 읽힘)

[금지 표현]
~입니다 / ~습니다 / 정말 / 매우 / 굉장히 / 추천드립니다 / 구매하세요 / 가격 언급
yeah / M / OK / wow 등 영어 감탄사 일체 금지

════════════════════════════════
출력 형식 — 반드시 이 형식으로만 출력
════════════════════════════════

TITLES:
1. (제목1)
2. (제목2)
3. (제목3)
SCRIPT:
(대본 — 문장마다 줄바꿈)`;

  // ── 유저 메시지 ──
  const userMessage = [
    `[제품 정보]\n${productContext}`,
    extra ? `[추가 지시사항]\n${extra}` : ''
  ].filter(Boolean).join('\n\n');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    const raw = data.content[0].text.trim();

    // ── 파싱: TITLES + SCRIPT 분리 ──
    const { titles, script } = parseScriptResponse(raw);

    state.script = script;
    state.titleCandidates = titles;

    // 대본 textarea
    $('output-script').value = script;

    // 제목 후보 카드 렌더링
    renderTitleCandidates(titles);

    hide('script-loading');
    show('script-result');
    hide('tts-result');
    hide('srt-result');
    updateChecklist();
  } catch (e) {
    hide('script-loading');
    showError('script-error-msg', `생성 실패: ${e.message}`);
    show('script-error');
  }
}

/**
 * Claude 응답 텍스트에서 제목 배열과 대본 문자열을 파싱한다.
 * 형식:
 *   TITLES:
 *   1. ...
 *   2. ...
 *   3. ...
 *   SCRIPT:
 *   ...
 */
function parseScriptResponse(raw) {
  const titles = [];
  let script = '';

  const titlesMatch = raw.match(/TITLES:\s*([\s\S]*?)SCRIPT:/i);
  const scriptMatch = raw.match(/SCRIPT:\s*([\s\S]*?)$/i);

  if (titlesMatch) {
    titlesMatch[1].trim().split('\n').forEach(line => {
      const t = line.replace(/^\d+[\.\)]\s*/, '').trim();
      if (t) titles.push(t);
    });
  }

  if (scriptMatch) {
    script = scriptMatch[1].trim();
  }

  // 파싱 실패 시 전체를 대본으로 취급
  if (!script) script = raw;

  return { titles, script };
}

/**
 * 제목 후보 카드를 렌더링한다.
 * 클릭 시 선택 상태가 되고 썸네일 제목 input에도 반영된다.
 */
function renderTitleCandidates(titles) {
  const container = $('title-candidates');
  container.innerHTML = '';

  if (!titles.length) {
    container.innerHTML = '<div class="text-small" style="color:#aaa;">제목 파싱 실패 — 대본에서 직접 추출해주세요</div>';
    return;
  }

  titles.forEach((title, i) => {
    const card = document.createElement('div');
    card.className = 'title-card';
    card.dataset.index = i;
    card.textContent = title;
    card.addEventListener('click', () => {
      // 선택 상태 토글
      document.querySelectorAll('.title-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      state.selectedTitle = title;
      // 썸네일 제목 input에도 반영
      const thumbTitleInput = $('thumb-title');
      if (thumbTitleInput) {
        thumbTitleInput.value = title;
        renderThumbnailPreview();
      }
    });
    container.appendChild(card);
  });

  // 첫 번째 자동 선택
  if (titles.length > 0) {
    container.querySelector('.title-card').click();
  }
}

// ===== 2단계: TTS 생성 =====

$('btn-generate-tts').addEventListener('click', generateTTS);

async function generateTTS() {
  const text = $('output-script').value.trim();
  if (!text) return;

  state.script = text;
  hide('script-error');
  $('script-loading-msg').textContent = '음성 생성 중...';
  show('script-loading');

  try {
    const { audioBlob, timings } = await window.TTS.generate(text);
    state.audioBlob = audioBlob;

    const url = URL.createObjectURL(audioBlob);
    $('audio-player').src = url;

    $('btn-download-audio').onclick = () => {
      const a = document.createElement('a');
      a.href = url;
      // WAV 병합 성공 시 .wav, MP3 폴백 시 .mp3
      const ext = audioBlob.type.includes('wav') ? 'wav' : 'mp3';
      a.download = `tts_audio_${Date.now()}.${ext}`;
      a.click();
    };

    // SRT 생성
    state.srtContent = buildSRT(text, timings);
    $('output-srt').value = state.srtContent;

    $('btn-download-srt').onclick = () => {
      const blob = new Blob([state.srtContent], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `subtitle_${Date.now()}.srt`;
      a.click();
    };

    hide('script-loading');
    show('tts-result');
    show('srt-result');
    updateChecklist();
  } catch (e) {
    hide('script-loading');
    showError('script-error-msg', `음성 생성 실패: ${e.message}`);
    show('script-error');
  }
}

function buildSRT(text, timings) {
  const sentences = text.split('\n').filter(s => s.trim());
  return sentences.map((sentence, i) => {
    const start = timings[i]?.start ?? i * 3000;
    const end = timings[i]?.end ?? (i + 1) * 3000;
    return `${i + 1}\n${msToSRT(start)} --> ${msToSRT(end)}\n${sentence.trim()}`;
  }).join('\n\n');
}

function msToSRT(ms) {
  const h = Math.floor(ms / 3600000).toString().padStart(2, '0');
  const m = Math.floor((ms % 3600000) / 60000).toString().padStart(2, '0');
  const s = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
  const ms3 = (ms % 1000).toString().padStart(3, '0');
  return `${h}:${m}:${s},${ms3}`;
}

// ===== 3단계: 썸네일 에디터 (9:16 쇼츠 레이아웃) =====

// 실시간 업데이트 트리거 input 목록
['thumb-channel', 'thumb-title', 'thumb-subtitle', 'thumb-font', 'thumb-accent-color']
  .forEach(id => $(id)?.addEventListener('input', renderThumbnailPreview));

// 이미지 업로드 처리
$('thumb-image-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    const img = new Image();
    img.onload = () => {
      state.thumbnailImage = img;

      // 미리보기 박스 업데이트
      const preview = $('thumb-image-preview');
      preview.innerHTML = '';
      const miniImg = document.createElement('img');
      miniImg.src = evt.target.result;
      miniImg.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:4px;';
      preview.appendChild(miniImg);

      renderThumbnailPreview();
    };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);
});

// 이미지 제거
$('btn-thumb-image-clear').addEventListener('click', () => {
  state.thumbnailImage = null;
  $('thumb-image-input').value = '';
  $('thumb-image-preview').innerHTML = '<span class="text-small" style="color:#bbb;">이미지 없음</span>';
  renderThumbnailPreview();
});

function renderThumbnailPreview() {
  if (window.Thumbnail) {
    window.Thumbnail.render($('thumb-canvas'), getThumbnailOptions());
  }
}

function getThumbnailOptions() {
  return {
    channel:     $('thumb-channel')?.value.trim()     || '채널명',
    title:       $('thumb-title')?.value.trim()       || '영상 제목',
    caption:     $('thumb-subtitle')?.value.trim()    || '',
    accentColor: $('thumb-accent-color')?.value       || '#e8133a',
    font:        $('thumb-font')?.value               || "'Noto Sans KR', sans-serif",
    image:       state.thumbnailImage || null
  };
}

$('btn-save-thumbnail').addEventListener('click', () => {
  const canvas = $('thumb-canvas');
  // 고해상도 재렌더 (1080×1920 원본)
  window.Thumbnail.render(canvas, getThumbnailOptions());

  canvas.toBlob(blob => {
    state.thumbnailBlob = blob;
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[-:.TZ]/g, '').substring(0, 14);
    a.href = URL.createObjectURL(blob);
    a.download = `thumbnail_${ts}.png`;
    a.click();
    updateChecklist();
  }, 'image/png');
});

// ===== 4단계: ZIP 패키징 =====

function updateChecklist() {
  function setCheck(id, done) {
    const el = $(id);
    if (!el) return;
    el.querySelector('.check-icon').textContent = done ? '✅' : '⬜';
    el.classList.toggle('done', done);
  }
  setCheck('check-script', !!state.script);
  setCheck('check-audio', !!state.audioBlob);
  setCheck('check-srt', !!state.srtContent);
  setCheck('check-thumbnail', !!state.thumbnailBlob);
}

$('btn-download-zip').addEventListener('click', downloadZip);

async function downloadZip() {
  if (typeof JSZip === 'undefined') {
    alert('JSZip 라이브러리를 찾을 수 없습니다. jszip.min.js 파일을 확인해주세요.');
    return;
  }

  const incomplete = [];
  if (!state.script) incomplete.push('AI 대본');
  if (!state.audioBlob) incomplete.push('TTS 음성');
  if (!state.srtContent) incomplete.push('SRT 자막');
  if (!state.thumbnailBlob) incomplete.push('썸네일');

  if (incomplete.length > 0) {
    const msg = `미완성 항목: ${incomplete.join(', ')}\n완성된 항목만으로 다운로드하시겠습니까?`;
    $('package-warning-msg').textContent = `⚠️ 미완성: ${incomplete.join(', ')}`;
    show('package-warning');
    if (!confirm(msg)) return;
  } else {
    hide('package-warning');
  }

  show('package-loading');

  const zip = new JSZip();
  const kw = state.keyword || 'coupang';
  const now = new Date();
  const ts = now.toISOString().replace(/[-:.TZ]/g, '').substring(0, 14);

  if (state.script) zip.file('script.txt', state.script);
  if (state.audioBlob) zip.file('tts_audio.mp3', state.audioBlob);
  if (state.srtContent) zip.file('subtitle.srt', state.srtContent);
  if (state.thumbnailBlob) zip.file('thumbnail.png', state.thumbnailBlob);

  const orderTxt = `[캡컷 편집 순서 안내]
키워드: ${kw}
생성일시: ${now.toLocaleString('ko-KR')}

1. thumbnail.png → 첫 장면 (2~3초)
2. 수집한 제품 영상들 (순서대로 배치)
3. tts_audio.mp3 → 전체 오디오 트랙으로 삽입
4. subtitle.srt → 자막 불러오기로 삽입

[편집 팁]
- 캡컷 → 새 프로젝트 → 9:16 세로형 선택
- 오디오 길이에 맞게 영상 클립 길이 조절
- 자막은 상단 메뉴 → 텍스트 → 자막 불러오기`;

  zip.file('order.txt', orderTxt);

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${kw}_${ts}.zip`;
  a.click();

  hide('package-loading');
}

// ===== 초기화 & 사이드 패널 탭 감지 =====

/** 제품 관련 상태만 초기화 (API 키·썸네일 설정 유지) */
function resetProductState() {
  state.keyword       = '';
  state.keywordEn     = '';
  state.keywordZh     = '';
  state.productInfo   = null;
  state.productImageUrl = '';
  state.script        = '';
  state.titleCandidates = [];
  state.selectedTitle = '';
  state.audioBlob     = null;
  state.srtContent    = '';

  // UI 초기화
  hide('keyword-result');
  hide('keyword-error');
  hide('keyword-not-coupang');
  hide('product-info-card');
  show('script-no-product');
  hide('script-result');
  hide('tts-result');
  hide('srt-result');
  // 영상 탭 초기화
  hide('section-sns-links');
  hide('section-shop-links');
  hide('btn-open-all-wrap');
  show('search-links-placeholder');
  // 이미지 검색 섹션 초기화
  const preview = $('image-paste-preview');
  if (preview) { preview.style.display = 'none'; preview.src = ''; }
  $('image-paste-zone').style.display = '';
  hide('image-search-links');
  show('image-search-hint-manual');
  hide('image-search-hint-auto');
  hide('script-loading');
  hide('script-error');
  updateChecklist();
}

/** 현재 활성 탭 기준으로 제품 정보 재감지 */
async function reloadForCurrentTab() {
  resetProductState();
  await initKeyword();
}

// ── 탭 전환 감지 (다른 탭으로 이동) ──
chrome.tabs.onActivated.addListener(async () => {
  await reloadForCurrentTab();
});

// ── 탭 URL 변경 감지 (같은 탭에서 페이지 이동) ──
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;

  // 현재 활성 탭인지 확인
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id !== tabId) return;

  await reloadForCurrentTab();
});

// ── 최초 로드 ──
document.addEventListener('DOMContentLoaded', async () => {
  // API 키 불러오기
  const { claudeApiKey } = await chrome.storage.local.get('claudeApiKey');
  if (claudeApiKey) $('input-api-key').value = claudeApiKey;

  // 키워드 추출
  await initKeyword();

  // 썸네일 초기 렌더링
  renderThumbnailPreview();
});
