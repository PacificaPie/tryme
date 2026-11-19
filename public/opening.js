export const OPENING_SEEN_KEY = 'tryme.opening.seen.v1';
export function shouldPlayOpening({ path, authenticated, checked, seen, reduced }) {
  return path === '/feed' && checked && !authenticated && !seen && !reduced;
}

// The small head guard covers auth/loading. Only a confirmed first-time guest
// downloads the film; the same cover stays until a clean WebGL frame is ready.
export function createOpening({ document = globalThis.document, window = globalThis.window } = {}) {
  const shell = document.querySelector('#site-shell'), boot = window.OpeningBoot;
  let resolved = false, finished = false, holding = false, ready = false, frame, overlay, controls;
  let startupTimer, revealTimer, cleanupTimer, animations = [];
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (boot?.active) { shell.inert = true; shell.setAttribute('aria-hidden', 'true'); }
  const seen = () => { try { return window.localStorage.getItem(OPENING_SEEN_KEY) === '1' || window.sessionStorage.getItem(OPENING_SEEN_KEY) === '1'; } catch { return true; } };
  const mark = () => { for (const storage of ['localStorage', 'sessionStorage']) try { window[storage].setItem(OPENING_SEEN_KEY, '1'); } catch {} };
  const send = type => frame?.contentWindow.postMessage({channel:'tryme-opening',type},window.location.origin);
  function cleanup() {
    clearTimeout(startupTimer); clearTimeout(revealTimer); clearTimeout(cleanupTimer);
    window.removeEventListener('message', message); window.removeEventListener('keydown', key);
    window.removeEventListener('pagehide', cancel); media.removeEventListener('change', reduce);
    boot?.release();
    document.body.classList.remove('opening-active', 'opening-entering');
    animations.forEach(animation => animation.cancel()); animations = [];
    frame?.remove(); overlay?.remove(); frame = overlay = controls = null;
    shell.inert = false; shell.removeAttribute('aria-hidden');
  }
  function finish(reason, immediate = false) {
    if (finished || !overlay) return;
    finished = true; clearTimeout(startupTimer); clearTimeout(revealTimer);
    const restoreFocus = overlay.contains(document.activeElement);
    const done = () => { cleanup(); if (restoreFocus) document.querySelector('#main')?.focus({preventScroll:true}); };
    const duration = immediate || media.matches ? 0 : reason === 'explore' ? 900 : 180;
    if (!duration || typeof overlay.animate !== 'function') { done(); return; }
    overlay.style.pointerEvents = 'none';
    if (reason === 'explore') {
      document.body.classList.add('opening-entering');
      const options = {duration,easing:'cubic-bezier(0.65,0,0.25,1)',fill:'forwards'};
      animations = [shell.animate([{transform:'translateY(100dvh)',borderRadius:'26px 26px 0 0'},{transform:'translateY(0)',borderRadius:'0'}], options),overlay.animate([{transform:'translateY(0) scale(1)',opacity:1},{transform:'translateY(-8dvh) scale(.97)',opacity:.72}], options)];
    } else animations = [overlay.animate([{opacity:1},{opacity:0}], {duration,fill:'forwards'})];
    Promise.all(animations.map(animation => animation.finished)).then(done).catch(() => {});
    cleanupTimer = setTimeout(done, duration + 200);
  }
  function message(event) {
    if (finished || event.origin !== window.location.origin || event.source !== frame?.contentWindow || event.data?.channel !== 'tryme-opening') return;
    if (event.data.type === 'ready' && !ready) {
      ready = true; clearTimeout(startupTimer);
      // Keep the brand readable even on fast devices. Prewarming stays covered;
      // the film clock starts only after the cover has fully faded out.
      const wait = Math.max(0, 800 - (window.performance.now() - (boot?.startedAt ?? openedAt)));
      revealTimer = setTimeout(() => {
        overlay?.querySelector('.opening-boot')?.classList.add('opening-boot-ready');
        revealTimer = setTimeout(() => {
          overlay?.querySelector('.opening-boot')?.remove(); send('start');
        }, 320);
      }, wait);
    }
    if (event.data.type === 'complete' && !holding) {
      holding = true; controls.hidden = false;
      overlay.setAttribute('aria-label','TryMe · 作品就是你的名片');
      controls.querySelector('[data-explore]').focus({preventScroll:true});
    }
    if (event.data.type === 'flipped') {
      const flip = controls.querySelector('[data-flip]');
      flip.disabled = false; flip.textContent = event.data.back ? '翻到正面' : '翻到背面';
    }
    if (event.data.type === 'failed') finish('failed', true);
  }
  function key(event) {
    if (finished || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    // Native buttons handle Enter/Space at the end; don't dismiss while flipping.
    if (event.key === 'Escape' || (!holding && ['Enter',' '].includes(event.key))) { event.preventDefault(); finish('skipped'); }
    if (event.key === 'Tab') {
      const buttons = holding ? [...controls.querySelectorAll('button:not(:disabled)')] : [];
      if (!buttons.length) { event.preventDefault(); overlay.focus({preventScroll:true}); return; }
      const index = buttons.indexOf(document.activeElement);
      if (index < 0 || (!event.shiftKey && index === buttons.length-1) || (event.shiftKey && index === 0)) {
        event.preventDefault(); buttons[event.shiftKey ? buttons.length-1 : 0].focus({preventScroll:true});
      }
    }
  }
  function cancel() { finished = true; cleanup(); resolved = true; }
  function reduce() { if (media.matches) finish('reduced', true); }
  let openedAt = 0;
  function resolve({path,authenticated,checked}) {
    if (resolved) return;
    resolved = true;
    if (boot?.expired || !shouldPlayOpening({path,authenticated,checked,seen:seen(),reduced:media.matches})) {
      if (authenticated || (path === '/feed' && media.matches)) mark();
      boot?.release();
      return;
    }
    mark(); // Refreshing during playback must not replay the first visit.
    openedAt = window.performance.now();
    overlay = document.createElement('section'); overlay.id = 'site-opening'; overlay.tabIndex = -1;
    overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true'); overlay.setAttribute('aria-label','TryMe');
    overlay.innerHTML = '<div class="opening-boot" aria-hidden="true">TryMe</div><div class="opening-actions" hidden><button type="button" class="opening-explore" data-explore>探索作品 <span aria-hidden="true">↗</span></button><button type="button" class="opening-flip" data-flip>翻到正面</button></div>';
    controls = overlay.querySelector('.opening-actions');
    controls.querySelector('[data-explore]').addEventListener('click', event => { event.stopPropagation(); finish('explore'); });
    controls.querySelector('[data-flip]').addEventListener('click', event => { event.stopPropagation(); event.currentTarget.disabled = true; send('flip'); });
    frame = document.createElement('iframe'); frame.src = '/opening/index.html'; frame.title = 'TryMe';
    frame.tabIndex = -1; frame.setAttribute('aria-hidden','true'); overlay.append(frame);
    overlay.addEventListener('click', event => { if (!holding) { event.preventDefault(); event.stopPropagation(); finish('skipped'); } });
    document.body.append(overlay);
    boot?.release(); // An opaque, identically styled overlay already covers it.
    overlay.focus({preventScroll:true}); shell.inert = true; shell.setAttribute('aria-hidden','true');
    document.body.classList.add('opening-active');
    window.addEventListener('message',message); window.addEventListener('keydown',key); window.addEventListener('pagehide',cancel);
    media.addEventListener('change',reduce);
    startupTimer = setTimeout(() => finish('timeout', true), 12000);
  }
  return {resolve,cancel};
}
