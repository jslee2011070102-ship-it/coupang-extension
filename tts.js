/**
 * tts.js
 * 역할: Google Translate TTS (비공식 API)로 실제 한국어 음성 생성
 *
 * 인터페이스:
 *   window.TTS.generate(text)
 *   → Promise<{ audioBlob: Blob, timings: Array<{start:number, end:number}> }>
 *
 * 동작 방식:
 *   1. 대본을 줄바꿈 단위 문장으로 분할
 *   2. 각 문장(≤190자)을 Google Translate TTS로 fetch → MP3 Blob
 *   3. AudioContext.decodeAudioData()로 각 MP3를 AudioBuffer 변환
 *   4. 모든 AudioBuffer를 시간순으로 이어 붙여 WAV Blob 반환
 *   5. 실패 시 순수 MP3 연결로 폴백
 */

window.TTS = {
  async generate(text) {
    const sentences = text.split('\n').map(s => s.trim()).filter(Boolean);
    if (!sentences.length) throw new Error('변환할 텍스트가 없습니다.');

    // ── 문장별 타이밍 추정 ──
    // 한국어 평균 발화 속도 ≈ 4~5자/초 (ttsspeed=0.9 기준)
    const timings = [];
    let cursor = 0;
    for (const sentence of sentences) {
      const duration = Math.max(1200, Math.ceil(sentence.length / 4.5 * 1000));
      timings.push({ start: cursor, end: cursor + duration });
      cursor += duration + 250; // 문장 사이 여백 250ms
    }

    // ── Google TTS 청크 fetch ──
    const mp3Blobs = [];
    for (const sentence of sentences) {
      const chunks = splitByLength(sentence, 190);
      for (const chunk of chunks) {
        const blob = await fetchGoogleTTS(chunk);
        if (blob) mp3Blobs.push(blob);
      }
    }

    if (mp3Blobs.length === 0) {
      throw new Error('TTS 생성에 실패했습니다.\n네트워크 연결을 확인하거나 잠시 후 다시 시도해주세요.');
    }

    // ── AudioBuffer 병합 → WAV Blob ──
    let audioBlob;
    try {
      audioBlob = await mergeMP3sToWav(mp3Blobs);
    } catch (e) {
      console.warn('[TTS] WAV 병합 실패, MP3 연결로 폴백:', e);
      audioBlob = new Blob(mp3Blobs, { type: 'audio/mpeg' });
    }

    return { audioBlob, timings };
  }
};

// ──────────────────────────────────────────────────
// Google Translate TTS fetch
// ──────────────────────────────────────────────────

async function fetchGoogleTTS(text) {
  if (!text || !text.trim()) return null;

  // 한국어 음성, 0.9 속도 (너무 빠르지 않게)
  const url =
    `https://translate.google.com/translate_tts` +
    `?ie=UTF-8` +
    `&q=${encodeURIComponent(text.trim())}` +
    `&tl=ko` +
    `&client=gtx` +
    `&ttsspeed=0.9`;

  try {
    const res = await fetch(url, {
      headers: {
        // Google TTS는 브라우저 UA가 있어야 응답
        'User-Agent': 'Mozilla/5.0'
      }
    });
    if (!res.ok) {
      console.warn(`[TTS] HTTP ${res.status} for chunk: "${text.substring(0, 30)}..."`);
      return null;
    }
    const blob = await res.blob();
    // 정상 MP3 blob 확인 (최소 100 bytes)
    if (blob.size < 100) return null;
    return blob;
  } catch (e) {
    console.warn('[TTS] fetch 실패:', e.message);
    return null;
  }
}

// ──────────────────────────────────────────────────
// 텍스트를 maxLen 이하 청크로 분할
// 쉼표/공백 경계를 우선으로 자름
// ──────────────────────────────────────────────────

function splitByLength(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const result = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxLen, text.length);
    if (end < text.length) {
      // 쉼표 > 공백 > 강제 자름 순으로 경계 탐색
      const sub = text.slice(start, end);
      const commaIdx = sub.lastIndexOf(',');
      const spaceIdx = sub.lastIndexOf(' ');
      const splitAt = commaIdx > maxLen * 0.5 ? commaIdx
        : spaceIdx > maxLen * 0.5 ? spaceIdx
        : -1;
      if (splitAt > 0) end = start + splitAt + 1;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk) result.push(chunk);
    start = end;
  }
  return result.filter(Boolean);
}

// ──────────────────────────────────────────────────
// 여러 MP3 Blob → 하나의 WAV Blob (AudioContext 병합)
// ──────────────────────────────────────────────────

async function mergeMP3sToWav(blobs) {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // 각 MP3를 ArrayBuffer로 변환 후 decode
  const arrayBuffers = await Promise.all(blobs.map(b => b.arrayBuffer()));
  const audioBuffers = await Promise.all(
    arrayBuffers.map(ab =>
      audioCtx.decodeAudioData(ab.slice(0)).catch(e => {
        console.warn('[TTS] decodeAudioData 실패:', e);
        return null;
      })
    )
  );
  const valid = audioBuffers.filter(Boolean);
  if (!valid.length) throw new Error('디코딩 가능한 오디오 없음');

  // 전체 길이 계산 (샘플 단위) + 병합
  const sampleRate = valid[0].sampleRate;
  const totalSamples = valid.reduce((s, b) => s + b.length, 0);
  const merged = audioCtx.createBuffer(1, totalSamples, sampleRate);
  let offset = 0;
  for (const buf of valid) {
    merged.copyToChannel(buf.getChannelData(0), 0, offset);
    offset += buf.length;
  }

  audioCtx.close();
  return audioBufferToWav(merged);
}

// ──────────────────────────────────────────────────
// AudioBuffer → WAV Blob 인코더
// ──────────────────────────────────────────────────

function audioBufferToWav(buffer) {
  const sampleRate = buffer.sampleRate;
  const samples = buffer.getChannelData(0);
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;

  const wav = new ArrayBuffer(44 + dataSize);
  const v = new DataView(wav);

  function str(off, s) {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  }

  // RIFF 헤더
  str(0,  'RIFF');  v.setUint32(4,  36 + dataSize, true);
  str(8,  'WAVE');
  str(12, 'fmt ');  v.setUint32(16, 16, true);
  v.setUint16(20, 1,           true);  // PCM
  v.setUint16(22, 1,           true);  // mono
  v.setUint32(24, sampleRate,  true);
  v.setUint32(28, sampleRate * bytesPerSample, true);
  v.setUint16(32, bytesPerSample, true);
  v.setUint16(34, 16,          true);  // 16-bit
  str(36, 'data');  v.setUint32(40, dataSize, true);

  // PCM 샘플 인코딩
  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    off += 2;
  }

  return new Blob([wav], { type: 'audio/wav' });
}
