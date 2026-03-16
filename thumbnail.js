/**
 * thumbnail.js
 * 역할: 9:16 쇼츠 썸네일 Canvas 렌더링
 *
 * 레이아웃 구조 (위→아래):
 *   ① 채널명 바  — 연회색 배경, 중앙 정렬
 *   ② 구분선 (굵은 검정)
 *   ③ 영상 제목  — 흰 배경, 굵은 대형 타이포
 *   ④ 구분선 (얇은 회색)
 *   ⑤ 자막 텍스트 — 중간 크기
 *   ⑥ 제품 이미지 영역 — 이미지 없으면 플레이스홀더
 *
 * window.Thumbnail.render(canvas, options)
 */

window.Thumbnail = {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{
   *   channel: string,      채널명
   *   title: string,        영상 제목
   *   caption: string,      자막 텍스트
   *   accentColor: string,  강조 색상 (채널바 텍스트 색 등)
   *   font: string,         폰트
   *   image: HTMLImageElement|null  제품 이미지
   * }} options
   */
  render(canvas, options) {
    const W = 1080, H = 1920;
    canvas.width = W;
    canvas.height = H;

    const ctx = canvas.getContext('2d');
    const {
      channel   = '채널명',
      title     = '영상 제목',
      caption   = '',
      accentColor = '#e8133a',
      font      = "'Noto Sans KR', sans-serif",
      image     = null
    } = options;

    // ── 전체 흰 배경 ──
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    let y = 0; // 현재 y 커서

    // ════════════════════════
    // ① 채널명 바
    // ════════════════════════
    const CHANNEL_H = 200;
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, y, W, CHANNEL_H);

    ctx.fillStyle = accentColor;
    ctx.font = `700 56px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(channel || '채널명', W / 2, y + CHANNEL_H / 2);

    y += CHANNEL_H;

    // ════════════════════════
    // ② 구분선 (굵은 검정)
    // ════════════════════════
    const DIVIDER_THICK = 6;
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, y, W, DIVIDER_THICK);
    y += DIVIDER_THICK;

    // ════════════════════════
    // ③ 영상 제목 영역
    // ════════════════════════
    const TITLE_PAD_X = 50;
    const TITLE_PAD_Y = 44;
    const TITLE_FONT_SIZE = 96;
    const TITLE_LINE_H = TITLE_FONT_SIZE * 1.25;

    ctx.font = `900 ${TITLE_FONT_SIZE}px ${font}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const titleLines = wrapText(ctx, title || '영상 제목', W - TITLE_PAD_X * 2);
    const titleBlockH = titleLines.length * TITLE_LINE_H + TITLE_PAD_Y * 2;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, y, W, titleBlockH);

    // 제목 그림자 (가독성)
    ctx.shadowColor = 'rgba(0,0,0,0.08)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;

    ctx.fillStyle = '#111111';
    titleLines.forEach((line, i) => {
      ctx.fillText(line, TITLE_PAD_X, y + TITLE_PAD_Y + i * TITLE_LINE_H);
    });

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    y += titleBlockH;

    // ════════════════════════
    // ④ 구분선 (얇은 회색)
    // ════════════════════════
    const DIVIDER_THIN = 3;
    ctx.fillStyle = '#cccccc';
    ctx.fillRect(0, y, W, DIVIDER_THIN);
    y += DIVIDER_THIN;

    // ════════════════════════
    // ⑤ 자막 영역
    // ════════════════════════
    const CAPTION_FONT_SIZE = 60;
    const CAPTION_LINE_H = CAPTION_FONT_SIZE * 1.45;
    const CAPTION_PAD_X = 50;
    const CAPTION_PAD_Y = 36;

    ctx.font = `500 ${CAPTION_FONT_SIZE}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const captionLines = wrapText(ctx, caption || '', W - CAPTION_PAD_X * 2);
    const captionBlockH = captionLines.length > 0
      ? captionLines.length * CAPTION_LINE_H + CAPTION_PAD_Y * 2
      : CAPTION_FONT_SIZE + CAPTION_PAD_Y * 2;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, y, W, captionBlockH);

    ctx.fillStyle = '#333333';
    captionLines.forEach((line, i) => {
      ctx.fillText(line, W / 2, y + CAPTION_PAD_Y + i * CAPTION_LINE_H);
    });

    y += captionBlockH;

    // ════════════════════════
    // ⑥ 제품 이미지 영역
    // ════════════════════════
    const imageH = H - y;

    if (image) {
      // 이미지를 영역에 꽉 차게 (cover 방식)
      const imgAspect = image.naturalWidth / image.naturalHeight;
      const areaAspect = W / imageH;

      let drawW, drawH, drawX, drawY;
      if (imgAspect > areaAspect) {
        // 이미지가 더 넓음 → 높이 기준으로 맞추고 좌우 크롭
        drawH = imageH;
        drawW = drawH * imgAspect;
        drawX = (W - drawW) / 2;
        drawY = y;
      } else {
        // 이미지가 더 높음 → 너비 기준으로 맞추고 상하 크롭
        drawW = W;
        drawH = drawW / imgAspect;
        drawX = 0;
        drawY = y + (imageH - drawH) / 2;
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y, W, imageH);
      ctx.clip();
      ctx.drawImage(image, drawX, drawY, drawW, drawH);
      ctx.restore();
    } else {
      // 플레이스홀더
      ctx.fillStyle = '#e8e8e8';
      ctx.fillRect(0, y, W, imageH);

      // 중앙 아이콘 느낌
      ctx.fillStyle = '#cccccc';
      ctx.font = `300 72px ${font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('제품 이미지를 업로드하세요', W / 2, y + imageH / 2 - 40);
      ctx.font = `300 52px ${font}`;
      ctx.fillText('↑  아래 버튼으로 추가', W / 2, y + imageH / 2 + 60);
    }
  }
};

// ──────────────────────────────
// 유틸: 텍스트 줄바꿈 (한글 자모 단위)
// ──────────────────────────────
function wrapText(ctx, text, maxWidth) {
  if (!text) return [];
  const chars = text.split('');
  const lines = [];
  let line = '';

  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line.length > 0) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}
