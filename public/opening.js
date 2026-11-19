export const OPENING_SEEN_KEY = 'tryme.opening.seen.v1';
export function shouldPlayOpening({ path, authenticated, checked, seen, reduced }) {
  return path === '/feed' && checked && !authenticated && !seen && !reduced;
}

// Lazy-load the film only after real authentication has resolved. Direct links
// and returning accounts never download or instantiate its three WebGL canvases.
export function createOpening({ document = globalThis.document, window = globalThis.window } = {}) {
  const shell = document.querySelector('#site-shell');
  let resolved = false, finished = false, frame, overlay, startupTimer, cleanupTimer, animations = [];
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const seen = () => { try { return window.localStorage.getItem(OPENING_SEEN_KEY) === '1' || window.sessionStorage.getItem(OPENING_SEEN_KEY) === '1'; } catch { return true; } };
  const mark = () => { for (const storage of ['localStorage', 'sessionStorage']) try { window[storage].setItem(OPENING_SEEN_KEY, '1'); } catch {} };
  function cleanup() {
    clearTimeout(startupTimer); clearTimeout(cleanupTimer);
    window.removeEventListener('message', message); window.removeEventListener('keydown', key);
    window.removeEventListener('pagehide', cancel); media.removeEventListener('change', reduce);
    document.body.classList.remove('opening-active', 'opening-entering');
    animations.forEach(animation => animation.cancel()); animations = [];
    frame?.remove(); overlay?.remove(); frame = overlay = null;
    shell.inert = false; shell.removeAttribute('aria-hidden');
  }
  function finish(reason, immediate = false) {
    if (finished || !overlay) return;
    finished = true; clearTimeout(startupTimer);
    const restoreFocus = overlay.contains(document.activeElement);
    const done = () => { cleanup(); if (restoreFocus) document.querySelector('#main')?.focus({preventScroll:true}); };
    const duration = immediate || media.matches ? 0 : reason === 'completed' ? 900 : 180;
    if (!duration || typeof overlay.animate !== 'function') { done(); return; }
    overlay.style.pointerEvents = 'none';
    if (reason === 'completed') {
      document.body.classList.add('opening-entering');
      const options = {duration,easing:'cubic-bezier(0.65,0,0.25,1)',fill:'forwards'};
      animations = [shell.animate([{transform:'translateY(100dvh)',borderRadius:'26px 26px 0 0'},{transform:'translateY(0)',borderRadius:'0'}], options),overlay.animate([{transform:'translateY(0) scale(1)',opacity:1},{transform:'translateY(-8dvh) scale(.97)',opacity:.72}], options)];
    } else animations = [overlay.animate([{opacity:1},{opacity:0}], {duration,fill:'forwards'})];
    Promise.all(animations.map(animation => animation.finished)).then(done).catch(() => {});
    cleanupTimer = setTimeout(done, duration + 200);
  }
  function message(event) {
    if (event.origin !== window.location.origin || event.source !== frame?.contentWindow || event.data?.channel !== 'tryme-opening') return;
    if (event.data.type === 'ready') { clearTimeout(startupTimer); overlay?.querySelector('.opening-boot')?.remove(); }
    if (event.data.type === 'complete') finish('completed');
    if (event.data.type === 'failed') finish('failed', true);
  }
  function key(event) {
    if (!finished && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && ['Escape','Enter',' '].includes(event.key)) { event.preventDefault(); finish('skipped'); }
  }
  function cancel() { if (overlay) { finished = true; cleanup(); } resolved = true; }
  function reduce() { if (media.matches) finish('reduced', true); }
  function resolve({path,authenticated,checked}) {
    if (resolved) return;
    resolved = true;
    if (!shouldPlayOpening({path,authenticated,checked,seen:seen(),reduced:media.matches})) {
      // Also consume the intro for signed-in browsers, including after logout.
      if (authenticated || (path === '/feed' && media.matches)) mark();
      return;
    }
    mark(); // Refreshing during playback must not replay the first visit.
    overlay = document.createElement('section'); overlay.id = 'site-opening'; overlay.tabIndex = -1;
    overlay.setAttribute('aria-label','TryMe');
    overlay.innerHTML = '<div class="opening-boot" aria-hidden="true">TryMe</div>';
    frame = document.createElement('iframe'); frame.src = '/opening/index.html'; frame.title = 'TryMe';
    frame.tabIndex = -1; frame.setAttribute('aria-hidden','true'); overlay.append(frame);
    overlay.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); finish('skipped'); });
    document.body.append(overlay); overlay.focus({preventScroll:true}); shell.inert = true; shell.setAttribute('aria-hidden','true');
    document.body.classList.add('opening-active');
    window.addEventListener('message',message); window.addEventListener('keydown',key); window.addEventListener('pagehide',cancel);
    media.addEventListener('change',reduce);
    startupTimer = setTimeout(() => finish('timeout', true), 12000);
  }
  return {resolve,cancel};
}
