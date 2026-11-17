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

const dismissals = new WeakMap();
export function closeDialog(dialog) {
  if (dismissals.has(dialog)) return dismissals.get(dialog);
  if (!dialog.open) return Promise.resolve();
  if (!dialog.animate || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    dialog.close(); return Promise.resolve();
  }
  const animation = dialog.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(4px) scale(.985)' }], { duration: 120, easing: 'ease-in', fill: 'forwards' });
  const done = animation.finished.catch(() => {}).then(() => { dialog.close(); animation.cancel(); dismissals.delete(dialog); });
  dismissals.set(dialog, done); return done;
}

export function mountMenus(doc = document) {
  const menus = '[data-action-menu],.account-menu,.appearance-menu';
  const opened = () => [...doc.querySelectorAll(menus)].filter(menu => menu.open);
  function position(menu) {
    const panel = menu.querySelector('.action-menu-panel');
    if (!panel) return;
    const trigger = menu.querySelector('summary').getBoundingClientRect();
    const view = doc.defaultView, gap = 8, edge = 12;
    const below = view.innerHeight - trigger.bottom - gap - edge, above = trigger.top - gap - edge;
    panel.style.maxHeight = Math.max(80, Math.max(below, above)) + 'px';
    const b = { width: panel.offsetWidth, height: panel.offsetHeight };
    const up = b.height > below && above > below;
    panel.style.left = Math.max(edge, Math.min(trigger.right - b.width, view.innerWidth - b.width - edge)) + 'px';
    panel.style.top = Math.max(edge, up ? trigger.top - gap - b.height : trigger.bottom + gap) + 'px';
    panel.style.transformOrigin = up ? 'bottom right' : 'top right';
  }
  doc.addEventListener('toggle', event => {
    const menu = event.target;
    if (!menu.matches?.(menus) || !menu.open) return;
    opened().forEach(other => { if (other !== menu) other.open = false; });
    position(menu);
  }, true);
  doc.addEventListener('pointerdown', event => {
    opened().forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
  });
  doc.addEventListener('focusin', event => {
    opened().forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
  });
  // Close before action handlers create a modal, so it can return focus to the
  // visible trigger rather than a now-hidden command.
  doc.addEventListener('click', event => {
    const action = event.target.closest?.('a,button'), menu = action?.closest(menus);
    if (menu?.open) { menu.open = false; menu.querySelector('summary')?.focus({ preventScroll: true }); }
  }, true);
  doc.defaultView?.addEventListener('resize', () => opened().forEach(position), { passive: true });
  doc.addEventListener('scroll', event => {
    opened().forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
  }, { capture: true, passive: true });
  doc.addEventListener('keydown', event => {
    const menu = event.target.closest?.('[data-action-menu]');
    if (!menu || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); menu.open = true; position(menu);
    const items = [...menu.querySelectorAll('.action-menu-panel a,.action-menu-panel button:not(:disabled)')];
    const current = items.indexOf(doc.activeElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (current + 1) % items.length : (current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length);
    items[index]?.focus({ preventScroll: true });
  });
  doc.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || doc.querySelector('dialog[open]')) return;
    const open = opened();
    const focused = open.find(menu => menu.contains(doc.activeElement));
    open.forEach(menu => { menu.open = false; });
    if (focused) { event.preventDefault(); focused.querySelector('summary')?.focus(); }
  });
}
