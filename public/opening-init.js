// Runs in <head>, before the Feed can paint. No film or auth work happens here.
(() => {
  const root = document.documentElement;
  let active = false;
  try {
    const path = (location.hash.slice(1).split('?')[0] || '/');
    active = ['/', '/feed', '/discover'].includes(path)
      && localStorage.getItem('tryme.opening.seen.v1') !== '1'
      && sessionStorage.getItem('tryme.opening.seen.v1') !== '1'
      && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { /* Storage denied: show the site normally. */ }
  const boot = window.OpeningBoot = {
    active, expired: false, startedAt: performance.now(),
    release() {
      clearTimeout(timer);
      boot.active = false;
      root.classList.remove('opening-pending');
      const shell = document.getElementById('site-shell');
      if (shell) { shell.inert = false; shell.removeAttribute('aria-hidden'); }
    }
  };
  const timer = active ? setTimeout(() => { boot.expired = true; boot.release(); }, 12000) : null;
  if (active) root.classList.add('opening-pending');
})();
