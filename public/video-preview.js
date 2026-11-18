import { t, registerMessages } from './i18n.js';
import { createAutoCoverController } from './auto-cover.js';

registerMessages({
  '播放预览':'Play preview','暂停预览':'Pause preview','视频暂不可用':'Preview unavailable',
  '自动视频预览':'Automatic video preview','生成视频预览':'Generate video preview',
  '正在检查视频预览…':'Checking video preview…','视频正在排队，作品已可试玩。':'Preview queued. Your work is ready to play.',
  '正在录制作品开场，作品已可试玩。':'Recording the opening scene. Your work is ready to play.',
  '预览已生成，公开展示时会出现在 Feed。':'Preview ready. It appears in the Feed when the work is listed.',
  '本次录制失败，仍显示原封面。':'Recording failed. Your original cover is still shown.',
  '自动录制暂不可用，仍显示原封面。':'Recording is unavailable. Your original cover is still shown.',
  '此作品暂不支持自动录制。':'Automatic recording is not available for this work.',
  '录制额度已用完，任务保留并等待下一周期。':'Recording allowance reached. This task remains queued until the next period.',
  '重新录制':'Retry recording','刷新预览状态':'Refresh preview status','尚未确认录制状态，请刷新查看。':'Recording status could not be confirmed. Refresh to check.',
  '发布后自动录制约 8 秒静音预览，不影响发布与试玩。':'An approximately 8-second silent preview is recorded after publishing, without delaying publication or play.',
  '自动录制开场；识别到开始按钮时会进入作品，不计入试玩数据。':'Records the opening scene and enters the work when a Start button is recognized. It does not count as a play.',
});

export function safePreviewURL(value) {
  return typeof value === 'string' && /^\/api\/(?:public\/)?works\/[A-Za-z0-9_-]{8,128}\/preview\/[A-Za-z0-9_-]{8,128}$/.test(value) ? value : '';
}
export function previewMarkup(preview) {
  const url = safePreviewURL(preview?.url);
  return url ? `<video class="work-preview" data-preview-src="${url}" muted playsinline preload="none" aria-hidden="true" tabindex="-1"></video>` : '';
}
export function previewButton(preview) {
  return safePreviewURL(preview?.url) ? `<button class="preview-toggle" type="button" data-preview-toggle aria-pressed="false" aria-label="${t('播放预览')}">▷ ${t('播放预览')}</button>` : '';
}
export function automaticPreviewAllowed({ reducedMotion = false, saveData = false, hover = false } = {}) { return hover && !reducedMotion && !saveData; }

// One active recording per Feed; never creates a play session or requests game
// HTML. The video has no src until hover or an explicit keyboard/touch action.
export function mountVideoPreviews(root, { timers = globalThis } = {}) {
  let active = null, hoverTimer, stopTimer, serial = 0, disposed = false;
  const cleanups = [];
  const on = (target, type, listener, options) => { target.addEventListener(type, listener, options); cleanups.push(() => target.removeEventListener(type, listener, options)); };
  const motion = matchMedia('(prefers-reduced-motion: reduce)'), hover = matchMedia('(hover: hover) and (pointer: fine)');
  const allowed = () => automaticPreviewAllowed({ reducedMotion: motion.matches, saveData: navigator.connection?.saveData === true, hover: hover.matches });
  const tileFor = target => target.closest?.('.work-tile');
  const buttonFor = tile => tile?.querySelector('[data-preview-toggle]');
  function stop() {
    serial++; timers.clearTimeout(hoverTimer); timers.clearTimeout(stopTimer);
    if (!active) return;
    const { tile, video } = active; active = null;
    video.pause(); video.removeAttribute('src'); video.load(); tile.classList.remove('preview-playing');
    const button = buttonFor(tile); if (button) { button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-label', t('播放预览')); button.textContent = '▷ ' + t('播放预览'); }
  }
  async function play(tile) {
    if (disposed || document.hidden || !root.contains(tile)) return;
    const video = tile.querySelector('video[data-preview-src]'), url = safePreviewURL(video?.dataset.previewSrc);
    if (!video || !url || tile.dataset.previewFailed) return;
    stop(); const request = ++serial; active = { tile, video }; video.muted = true; video.src = url;
    // Includes stalled network time. No late play promise may resurrect a
    // stopped/removed tile or overlap another preview.
    stopTimer = timers.setTimeout(stop, 12000);
    try {
      await video.play();
      if (disposed || request !== serial || !root.contains(tile)) { if (active?.video !== video) video.pause(); return; }
      tile.classList.add('preview-playing'); const button = buttonFor(tile);
      if (button) { button.setAttribute('aria-pressed', 'true'); button.setAttribute('aria-label', t('暂停预览')); button.textContent = 'Ⅱ ' + t('暂停预览'); }
      timers.clearTimeout(stopTimer); stopTimer = timers.setTimeout(stop, 9000);
    } catch { if (request === serial) stop(); }
  }
  on(root, 'pointerover', event => { const tile = tileFor(event.target); if (!tile || tile.contains(event.relatedTarget) || event.pointerType !== 'mouse' || !allowed()) return; timers.clearTimeout(hoverTimer); hoverTimer = timers.setTimeout(() => play(tile), 450); });
  on(root, 'pointerout', event => { const tile = tileFor(event.target); if (tile && !tile.contains(event.relatedTarget)) { timers.clearTimeout(hoverTimer); if (active?.tile === tile) stop(); } });
  on(root, 'click', event => { const button = event.target.closest('[data-preview-toggle]'); if (!button) return; event.preventDefault(); const tile = tileFor(button); if (active?.tile === tile) stop(); else void play(tile); });
  on(root, 'ended', event => { if (active?.video === event.target) stop(); }, true);
  on(root, 'error', event => { const video = event.target; if (!video.matches?.('video[data-preview-src]') || !video.getAttribute('src')) return; const tile = tileFor(video); if (active?.video === video) stop(); tile.dataset.previewFailed = '1'; const button = buttonFor(tile); if (button) { button.disabled = true; button.textContent = t('视频暂不可用'); button.setAttribute('aria-label', t('视频暂不可用')); } }, true);
  on(document, 'visibilitychange', () => { if (document.hidden) stop(); });
  on(window, 'pagehide', stop); on(motion, 'change', stop);
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { for (const entry of entries) if (!entry.isIntersecting && active?.tile === entry.target) stop(); }) : null;
  const refresh = () => { if (active && !root.contains(active.tile)) stop(); observer?.disconnect(); root.querySelectorAll('.work-tile').forEach(tile => observer?.observe(tile)); };
  refresh();
  return { refresh, dispose() { disposed = true; stop(); observer?.disconnect(); cleanups.forEach(remove => remove()); } };
}

export function previewStatusView(state = {}) {
  if (state.status === 'queued' && ['DAILY_BUDGET', 'MONTHLY_BUDGET'].includes(state.reason)) return { message: '录制额度已用完，任务保留并等待下一周期。', action: 'refresh', label: '刷新预览状态' };
  if (state.status === 'none') return { message: '发布后自动录制约 8 秒静音预览，不影响发布与试玩。', action: 'generate', label: '生成视频预览' };
  if (state.status === 'ready') return { message: '预览已生成，公开展示时会出现在 Feed。' };
  if (['queued', 'running'].includes(state.status)) return { message: state.status === 'queued' ? '视频正在排队，作品已可试玩。' : '正在录制作品开场，作品已可试玩。', ...(state.paused ? { action: 'refresh', label: '刷新预览状态' } : {}) };
  if (['failed', 'skipped', 'unavailable'].includes(state.status)) return { message: state.status === 'failed' ? '本次录制失败，仍显示原封面。' : state.status === 'skipped' ? '此作品暂不支持自动录制。' : '自动录制暂不可用，仍显示原封面。', ...(state.retryable ? { action: 'retry', label: '重新录制' } : { action: 'refresh', label: '刷新预览状态' }) };
  if (state.status === 'checking') return { message: '正在检查视频预览…' };
  return { message: '尚未确认录制状态，请刷新查看。', action: 'refresh', label: '刷新预览状态' };
}
export function mountAutoPreview(root, { work, owner, api, onReady = () => {} }) {
  if (!root || work.authorId !== owner || work.source !== 'html' || work.archivedAt) return { dispose() {} };
  let controller;
  const render = () => {
    const state = controller?.state || { status: 'checking' }, view = previewStatusView(state), url = safePreviewURL(state.preview?.url);
    root.className = 'auto-preview-panel';
    root.innerHTML = `<h2>${t('自动视频预览')}</h2><p role="status" aria-live="polite">${t(view.message)}</p>${state.status === 'ready' && url ? `<video controls muted playsinline preload="none" src="${url}" aria-label="${t('自动视频预览')}"></video><p class="muted">${t('自动录制开场；识别到开始按钮时会进入作品，不计入试玩数据。')}</p>` : ''}${view.action ? `<button type="button" class="button quiet small" data-auto-preview="${view.action}" ${state.pending ? 'disabled' : ''}>${t(view.label)}</button>` : ''}`;
  };
  controller = createAutoCoverController({ api, work, resource: 'auto-preview', onChange: render, onReady });
  const click = event => { const button = event.target.closest('[data-auto-preview]'); if (!button || button.disabled) return; if (button.dataset.autoPreview === 'refresh') controller.refresh(); else controller.generate(button.dataset.autoPreview); };
  root.addEventListener('click', click); render(); controller.refresh();
  return { dispose() { controller.dispose(); root.removeEventListener('click', click); root.querySelector('video')?.pause(); } };
}
