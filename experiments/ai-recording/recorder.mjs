import { LIMITS, fail } from './contract.mjs';
import { bounded, sleep } from './browser.mjs';
import { validatePreview } from '../../lib/funtrack/video-preview-capture.mjs';

// Same pixel-to-trusted-parent MP4 technique as production, with a shorter hard
// stop so measured duration must be <= 8 s. No model work occurs in this phase.
export async function recordReplay(session, plan, viewport) {
  const { page } = session;
  const initial = (await session.screenshot()).toString('base64');
  const canvas = (await session.inspect()).find(target => target.available && target.kind === 'canvas');
  const region = canvas?.rect || { x: 0, y: 0, width: viewport.width, height: viewport.height };
  let cdp, recording = false, busy = false, pending = Promise.resolve(), accepted = 0, completed = 0;
  try {
    await page.evaluate(async ({ initial, width, height, limit, duration }) => {
      const mime = 'video/mp4;codecs=avc1.42E01E';
      if (!MediaRecorder.isTypeSupported(mime)) throw new Error('ENCODER_UNAVAILABLE');
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });
      let image;
      const draw = async data => { const next = new Image(); next.src = 'data:image/jpeg;base64,' + data; await next.decode(); image = next; ctx.drawImage(image, 0, 0, width, height); };
      await draw(initial);
      const stream = canvas.captureStream(0), recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 900000 });
      const state = { recorder, stream, draw, chunks: [], size: 0, error: null };
      state.stopped = new Promise(resolve => { recorder.onstop = resolve; });
      recorder.ondataavailable = event => {
        state.size += event.data.size;
        if (state.size > limit) { state.error = 'VIDEO_LIMIT'; if (recorder.state !== 'inactive') recorder.stop(); }
        else state.chunks.push(event.data);
      };
      recorder.onerror = () => { state.error = 'ENCODING_FAILED'; };
      state.tick = setInterval(() => { ctx.drawImage(image, 0, 0, width, height); stream.getVideoTracks()[0].requestFrame(); }, 80);
      recorder.start(250);
      state.deadline = setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, duration);
      globalThis.__boundedRecorder = state;
    }, { initial, ...viewport, limit: LIMITS.videoBytes, duration: LIMITS.recordMs });
    const started = Date.now();
    cdp = await page.createCDPSession(); recording = true;
    cdp.on('Page.screencastFrame', event => {
      void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
      if (!recording || busy || typeof event.data !== 'string' || event.data.length > LIMITS.screenshotBytes * 2) return;
      busy = true;
      pending = page.evaluate(data => globalThis.__boundedRecorder.draw(data), event.data)
        .then(() => accepted++).catch(() => {}).finally(() => { busy = false; });
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 65, maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 });
    await sleep(250);
    for (const action of plan) {
      if (Date.now() - started > LIMITS.timelineMs) throw fail('REPLAY_TIMEOUT');
      await session.execute(action); completed++;
      // Static DOM scenes may emit very few CDP frames. Explicitly deliver each
      // settled action result so the final game state really enters the MP4.
      await pending;
      busy = true;
      try {
        const snapshot = (await session.screenshot()).toString('base64');
        await page.evaluate(data => globalThis.__boundedRecorder.draw(data), snapshot);
        accepted++;
      } finally { busy = false; }
    }
    await sleep(Math.max(0, LIMITS.recordMs - (Date.now() - started)));
    recording = false; await cdp.send('Page.stopScreencast'); await pending;
    const final = (await session.screenshot()).toString('base64');
    const result = await bounded(page.evaluate(async ({ final, initial, limit, region }) => {
      const state = globalThis.__boundedRecorder;
      clearInterval(state.tick); clearTimeout(state.deadline);
      if (state.recorder.state !== 'inactive') state.recorder.stop();
      await state.stopped; state.stream.getTracks().forEach(track => track.stop());
      if (state.error) throw new Error(state.error);
      const blob = new Blob(state.chunks, { type: 'video/mp4' });
      if (!blob.size || blob.size > limit) throw new Error('VIDEO_LIMIT');
      const video = document.createElement('video'), url = URL.createObjectURL(blob);
      let durationMs;
      try {
        await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; video.preload = 'metadata'; video.src = url; });
        durationMs = Math.round(video.duration * 1000);
      } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
      const thumbnail = async data => {
        const image = new Image(); image.src = 'data:image/jpeg;base64,' + data; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 40;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, 64, 40);
        return ctx.getImageData(0, 0, 64, 40).data;
      };
      const a = await thumbnail(initial), b = await thumbnail(final);
      let delta = 0; for (let i = 0; i < a.length; i++) if (i % 4 !== 3) delta += Math.abs(a[i] - b[i]);
      const difference = delta / (64 * 40 * 3 * 255);
      const encoded = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
      return { base64: encoded.split(',')[1], durationMs, difference };
    }, { initial, final, limit: LIMITS.videoBytes, region }), 5000, 'ENCODING_TIMEOUT');
    if (!Number.isFinite(result.durationMs) || result.durationMs > 8000 || result.durationMs < 6000) throw fail('INVALID_DURATION');
    const bytes = new Uint8Array(Buffer.from(result.base64, 'base64')); validatePreview(bytes);
    return { bytes, durationMs: result.durationMs, difference: result.difference, differenceRegion: canvas?.id || 'viewport', frames: accepted, completed,
      initial: Buffer.from(initial, 'base64'), final: Buffer.from(final, 'base64') };
  } finally {
    recording = false;
    await pending;
    await cdp?.detach().catch(() => {});
    await page.evaluate(() => {
      const s = globalThis.__boundedRecorder;
      if (s) { clearInterval(s.tick); clearTimeout(s.deadline); if (s.recorder.state !== 'inactive') s.recorder.stop(); s.stream.getTracks().forEach(t => t.stop()); }
    }).catch(() => {});
  }
}
