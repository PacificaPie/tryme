// Layout follows the server's order. Every next item uses the shortest column;
// ties go left to right, so DOM, keyboard and top-to-bottom visual order agree.
const imageRatios = new Map();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function hash(value) { let result = 2166136261; for (const character of String(value)) result = Math.imul(result ^ character.codePointAt(0), 16777619); return result >>> 0; }

export function feedColumns(width) {
  const gap = width < 600 ? 12 : 20;
  const columns = width < 320 ? 1 : width < 600 ? 2 : clamp(Math.floor((width + gap) / 250), 2, 5);
  return { columns, gap, rowGap: width < 600 ? 20 : 25, columnWidth: Math.max(0, (width - gap * (columns - 1)) / columns) };
}
export function feedCoverRatio(id, naturalRatio = null) {
  const variation = hash(id) % 3;
  if (typeof naturalRatio !== 'number' || !Number.isFinite(naturalRatio) || naturalRatio <= 0) return [1.08, 1.3, 1.55][variation];
  // Portrait/square art keeps its composition. Landscape images get modest,
  // stable framing; object-fit:contain keeps the complete game image visible.
  if (naturalRatio <= 1.25) return clamp(naturalRatio, 0.55, 2.1);
  return Math.min(clamp(naturalRatio, 0.55, 2.1), [1.1, 1.34, 1.58][variation]);
}
export function shortestColumnLayout(heights, width, options = feedColumns(width)) {
  const { columns, gap, rowGap, columnWidth } = options, bottoms = Array(columns).fill(0);
  const items = heights.map(height => {
    let column = 0;
    for (let i = 1; i < columns; i++) if (bottoms[i] < bottoms[column]) column = i;
    const item = { x: column * (columnWidth + gap), y: bottoms[column], width: columnWidth, column };
    bottoms[column] += Math.max(0, Number(height) || 0) + rowGap;
    return item;
  });
  return { items, height: heights.length ? Math.max(...bottoms) - rowGap : 0, columns, columnWidth };
}
export function mountFeedLayout(grid, { host = grid } = {}) {
  let stopped = false, frame = null, lastWidth = 0, measuring = false;
  const observed = new Set(), imageListeners = new Map(), measured = new WeakMap();
  const alive = () => !stopped && grid.isConnected;
  function rememberRatio(image) {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      imageRatios.set(image.currentSrc || image.src, image.naturalWidth / image.naturalHeight);
      while (imageRatios.size > 600) imageRatios.delete(imageRatios.keys().next().value);
    }
  }
  function setCover(item) {
    const cover = item.querySelector('.cover'), image = cover?.querySelector('img'); if (!cover) return;
    if (image?.complete) rememberRatio(image);
    const ratio = image ? imageRatios.get(image.currentSrc || image.src) : null;
    cover.style.setProperty('--feed-ratio', feedCoverRatio(item.dataset.workId, ratio));
    item.style.setProperty('--feed-paper', ['#f0f1ed', '#edf1f3', '#f3efeb', '#eeefee'][hash(item.dataset.workId) % 4]);
    if (image && !imageListeners.has(image)) {
      const load = () => { rememberRatio(image); setCover(item); schedule(); };
      const error = () => {
        image.hidden = true; cover.classList.add('empty-cover');
        if (!cover.querySelector('.feed-cover-fallback')) { const fallback = document.createElement('span'); fallback.className = 'feed-cover-fallback'; fallback.textContent = item.querySelector('.tile-title')?.textContent || image.alt; cover.append(fallback); }
        schedule();
      };
      image.addEventListener('load', load); image.addEventListener('error', error); imageListeners.set(image, { load, error });
      if (image.complete && !image.naturalWidth) error();
    }
  }
  function anchor() {
    if (window.scrollY < 20) return null;
    const top = document.querySelector('.site-header')?.getBoundingClientRect().bottom || 0;
    for (const item of grid.children) { const bounds = item.getBoundingClientRect(); if (bounds.bottom > top && bounds.top < window.innerHeight) return { item, top: bounds.top }; }
    return null;
  }
  function refresh() {
    if (!alive()) { dispose(); return; }
    if (measuring) return; measuring = true;
    if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
    const width = grid.clientWidth;
    if (!width) { measuring = false; return; }
    const before = grid.dataset.feedLayout === 'ready' ? anchor() : null;
    const options = feedColumns(width), items = [...grid.children]; lastWidth = width;
    grid.dataset.feedLayout = 'ready';
    for (const item of items) {
      setCover(item); item.style.width = `${options.columnWidth}px`;
      if (!observed.has(item)) { resizeObserver?.observe(item); observed.add(item); }
    }
    const heights = items.map(item => { const height = item.getBoundingClientRect().height; measured.set(item, height); return height; });
    const layout = shortestColumnLayout(heights, width, options);
    items.forEach((item, index) => { const position = layout.items[index]; item.style.left = `${position.x}px`; item.style.top = `${position.y}px`; });
    grid.style.height = `${Math.ceil(layout.height)}px`;
    for (const item of observed) if (!grid.contains(item)) { resizeObserver?.unobserve(item); observed.delete(item); }
    for (const [image, listener] of imageListeners) if (!grid.contains(image)) { image.removeEventListener('load', listener.load); image.removeEventListener('error', listener.error); imageListeners.delete(image); }
    if (before?.item.isConnected) { const difference = before.item.getBoundingClientRect().top - before.top; if (Math.abs(difference) > 0.5) window.scrollBy({ top: difference, behavior: 'instant' }); }
    measuring = false;
  }
  function schedule() { if (!alive()) { dispose(); return; } if (frame === null) frame = requestAnimationFrame(refresh); }
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
    if (!alive()) { dispose(); return; }
    if (entries.some(entry => entry.target === grid ? Math.abs(entry.contentRect.width - lastWidth) > 0.5 : Math.abs(entry.target.getBoundingClientRect().height - (measured.get(entry.target) || 0)) > 0.5)) schedule();
  });
  const detachObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => { if (!host.isConnected) dispose(); });
  function dispose() {
    if (stopped) return; stopped = true;
    if (frame !== null) cancelAnimationFrame(frame);
    resizeObserver?.disconnect(); detachObserver?.disconnect(); window.removeEventListener('resize', schedule);
    for (const [image, listener] of imageListeners) { image.removeEventListener('load', listener.load); image.removeEventListener('error', listener.error); }
    imageListeners.clear(); observed.clear();
  }
  resizeObserver?.observe(grid); if (host.parentNode) detachObserver?.observe(host.parentNode, { childList: true });
  if (!resizeObserver) window.addEventListener('resize', schedule, { passive: true });
  refresh(); return { refresh, dispose };
}
