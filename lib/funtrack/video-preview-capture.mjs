import { captureDocument } from './auto-cover-capture.mjs';
import { HTML_MAX_BYTES } from './limits.mjs';

export const VIDEO_PREVIEW = Object.freeze({ width: 960, height: 600, durationMs: 8000, maxBytes: 2 * 1024 * 1024, timeoutMs: 30000 });
const fail = code => Object.assign(new Error(code), { code });

// This is product-side rendering in a disposable cloud browser, never a user's
// browser/session. The uploaded document cannot reach the trusted parent or the
// network. Only screenshot pixels cross into the parent's silent MP4 recorder.
export async function captureVideoPreview(binding, html, { launch, timers = globalThis, timeoutMs = VIDEO_PREVIEW.timeoutMs } = {}) {
  if (!binding || typeof binding.fetch !== 'function') throw fail('BROWSER_UNAVAILABLE');
  if (typeof html !== 'string' || !html.length || new TextEncoder().encode(html).length > HTML_MAX_BYTES) throw fail('INVALID_CAPTURE_HTML');
  let browser, expired = false, deadline, session, pending = Promise.resolve(), recording = false, busy = false, accepted = 0;
  const close = async () => { try { await browser?.close(); } catch {} };
  const timeout = new Promise((_, reject) => { deadline = timers.setTimeout(() => { expired = true; void close(); reject(fail('CAPTURE_TIMEOUT')); }, timeoutMs); });
  const work = (async () => {
    const open = launch || (await import('@cloudflare/puppeteer')).default.launch;
    browser = await open(binding, { guardrails: { allowedDomains: [] } });
    if (expired) { await close(); throw fail('CAPTURE_TIMEOUT'); }
    const page = await browser.newPage();
    await page.setViewport({ width: VIDEO_PREVIEW.width, height: VIDEO_PREVIEW.height, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => {
      for (const key of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection', 'WebTransport']) Object.defineProperty(globalThis, key, { value: undefined, writable: false, configurable: false });
    });
    await page.setRequestInterception(true);
    page.on('request', request => { void (/^(?:data:|blob:|about:)/i.test(request.url()) ? request.continue() : request.abort()).catch(() => {}); });
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
    await page.setContent(captureDocument(html), { waitUntil: 'load', timeout: 8000 });
    await new Promise(resolve => timers.setTimeout(resolve, 500));
    const initial = await page.screenshot({ type: 'jpeg', quality: 75, encoding: 'base64', fullPage: false, captureBeyondViewport: false });
    await page.evaluate(async ({ initial, width, height, maxBytes }) => {
      const mime = 'video/mp4;codecs=avc1.42E01E';
      if (!MediaRecorder.isTypeSupported(mime)) throw new Error('ENCODER_UNAVAILABLE');
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      let lastImage;
      const draw = async data => { const image = new Image(); image.src = 'data:image/jpeg;base64,' + data; await image.decode(); lastImage = image; context.drawImage(image, 0, 0, width, height); };
      await draw(initial);
      const stream = canvas.captureStream(0), recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1000000 });
      const state = { draw, recorder, stream, chunks: [], size: 0, error: null, frames: 0 };
      recorder.ondataavailable = event => { state.size += event.data.size; if (state.size > maxBytes) { state.error = 'CAPTURE_TOO_LARGE'; if (recorder.state !== 'inactive') recorder.stop(); } else state.chunks.push(event.data); };
      recorder.onerror = () => { state.error = 'ENCODING_FAILED'; };
      globalThis.__trymeRecorder = state;
      // A static opening screen is still an eight-second recording. Drawing at
      // a fixed rate also keeps MP4 duration independent of CDP frame delivery.
      state.tick = setInterval(() => { context.drawImage(lastImage, 0, 0, width, height); stream.getVideoTracks()[0].requestFrame(); }, 80);
      recorder.start(250);
      state.stop = new Promise(resolve => { recorder.onstop = resolve; });
      state.stopTimer = setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 8000);
    }, { initial, ...VIDEO_PREVIEW });
    session = await page.createCDPSession(); recording = true;
    session.on('Page.screencastFrame', event => {
      void session.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
      if (!recording || busy || expired || typeof event.data !== 'string' || event.data.length > 2 * 1024 * 1024) return;
      busy = true;
      pending = page.evaluate(async data => { const state = globalThis.__trymeRecorder; if (!state.error) { await state.draw(data); state.frames++; } }, event.data)
        .then(() => { accepted++; }).catch(() => {}).finally(() => { busy = false; });
    });
    await session.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: VIDEO_PREVIEW.width, maxHeight: VIDEO_PREVIEW.height, everyNthFrame: 5 });
    await new Promise(resolve => timers.setTimeout(resolve, 1000));
    const frame = page.frames().find(item => item.parentFrame());
    const started = frame ? await frame.evaluate(() => {
      // No coordinates, guessed links, arbitrary clicking or external actions.
      // One exact, visible Start control inside the opaque game is permitted.
      const allowed = /^(开始|开始游戏|开始体验|进入游戏|start|start game|play|play game)$/i;
      const button = [...document.querySelectorAll('button, [role="button"]')].find(element => {
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
        return allowed.test(element.textContent.trim()) && !element.disabled && element.getAttribute('aria-disabled') !== 'true' && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && style.visibility === 'visible' && style.display !== 'none';
      });
      button?.click(); return Boolean(button);
    }) : false;
    await new Promise(resolve => timers.setTimeout(resolve, VIDEO_PREVIEW.durationMs - 1000));
    recording = false;
    await session.send('Page.stopScreencast'); await pending;
    const result = await page.evaluate(async maxBytes => {
      const state = globalThis.__trymeRecorder; clearInterval(state.tick); clearTimeout(state.stopTimer);
      if (state.recorder.state !== 'inactive') state.recorder.stop();
      await state.stop;
      state.stream.getTracks().forEach(track => track.stop());
      if (state.error) throw new Error(state.error);
      const blob = new Blob(state.chunks, { type: 'video/mp4' });
      if (!blob.size || blob.size > maxBytes) throw new Error('CAPTURE_TOO_LARGE');
      const video = document.createElement('video'), objectURL = URL.createObjectURL(blob);
      let durationMs;
      try {
        await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; video.preload = 'metadata'; video.src = objectURL; });
        durationMs = Math.round(video.duration * 1000);
        if (!Number.isFinite(durationMs) || durationMs < 6000 || durationMs > 10000) throw new Error('INVALID_DURATION');
      } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(objectURL); }
      const encoded = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
      return { base64: encoded.split(',')[1], durationMs };
    }, VIDEO_PREVIEW.maxBytes);
    const bytes = Uint8Array.from(atob(result.base64), char => char.charCodeAt(0));
    validatePreview(bytes);
    return { bytes, mime: 'video/mp4', durationMs: result.durationMs, width: VIDEO_PREVIEW.width, height: VIDEO_PREVIEW.height, frames: accepted, interaction: started ? 'start-button' : 'opening' };
  })();
  try { return await Promise.race([work, timeout]); }
  finally { expired = true; recording = false; timers.clearTimeout(deadline); let timer; try { await Promise.race([close(), new Promise(resolve => { timer = timers.setTimeout(resolve, 1000); })]); } finally { timers.clearTimeout(timer); } }
}

export function validatePreview(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 32 || bytes.length > VIDEO_PREVIEW.maxBytes || new TextDecoder().decode(bytes.slice(4, 8)) !== 'ftyp') throw fail('INVALID_PREVIEW');
  return bytes;
}
