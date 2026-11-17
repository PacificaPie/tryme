// Keep fast navigation immediate; only show a skeleton when the request lasts.
// One disposable owner per route prevents old timers changing a newer page.
export function beginRouteLoading(root, { html, slowText, retryText, timers = globalThis, delay = 160, slowDelay = 6500 }) {
  let done = false;
  root.inert = true;
  root.setAttribute('aria-busy', 'true');
  root.classList.add('route-pending');
  const show = timers.setTimeout(() => {
    if (done) return;
    root.innerHTML = html;
    root.inert = false;
  }, delay);
  const slow = timers.setTimeout(() => {
    if (done) return;
    const status = root.querySelector('.loading-status');
    const retry = root.querySelector('[data-loading-retry]');
    if (status) status.textContent = slowText;
    if (retry) { retry.textContent = retryText; retry.hidden = false; }
  }, slowDelay);
  return () => {
    if (done) return;
    done = true;
    timers.clearTimeout(show); timers.clearTimeout(slow);
    root.inert = false;
    root.removeAttribute('aria-busy');
    root.classList.remove('route-pending');
  };
}

export function mountMenus(doc = document) {
  const selector = '.account-menu[open],.work-row-more[open],.version-row-more[open],.archive-navigation[open]';
  doc.addEventListener('pointerdown', event => {
    doc.querySelectorAll(selector).forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
  });
  doc.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || doc.querySelector('dialog[open]')) return;
    const open = [...doc.querySelectorAll(selector)];
    const focused = open.find(menu => menu.contains(doc.activeElement));
    open.forEach(menu => { menu.open = false; });
    if (focused) { event.preventDefault(); focused.querySelector('summary')?.focus(); }
  });
}
