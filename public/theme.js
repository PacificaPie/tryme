import { t, registerMessages } from './i18n.js';

export const THEME_STORAGE_KEY = 'funtrack.theme';
export const THEME_CHANGE_EVENT = 'funtrack:themechange';
export const normalizeTheme = value => value === 'light' || value === 'dark' ? value : 'system';
export const resolveTheme = (preference, systemDark) => normalizeTheme(preference) === 'system' ? (systemDark ? 'dark' : 'light') : preference;

// No app state or authentication participates in a visual preference.
export function createThemeController({
  root = globalThis.document?.documentElement,
  storage = () => globalThis.localStorage,
  events = globalThis.window,
  media = globalThis.matchMedia?.('(prefers-color-scheme: dark)'),
} = {}) {
  let preference = 'system', current = '', disposed = false;
  try { preference = normalizeTheme(storage()?.getItem(THEME_STORAGE_KEY)); } catch { /* Storage is optional. */ }
  const getState = () => ({ preference, theme: current });
  const apply = () => {
    if (disposed) return getState();
    current = resolveTheme(preference, Boolean(media?.matches));
    if (root) {
      root.dataset.theme = current;
      root.dataset.themePreference = preference;
      root.style.colorScheme = current;
    }
    events?.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: getState() }));
    return getState();
  };
  const setPreference = next => {
    if (!['light', 'dark', 'system'].includes(next) || disposed) return getState();
    preference = next;
    try { storage()?.setItem(THEME_STORAGE_KEY, preference); } catch { /* Apply for this page anyway. */ }
    return apply();
  };
  const onSystemChange = () => { if (preference === 'system') apply(); };
  const onStorageChange = event => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    if (event.storageArea) {
      try { if (event.storageArea !== storage()) return; } catch { return; }
    }
    // A clear/reset returns the whole site to its system default.
    preference = normalizeTheme(event.newValue);
    apply();
  };
  media?.addEventListener('change', onSystemChange);
  events?.addEventListener('storage', onStorageChange);
  apply();
  return {
    getState, setPreference,
    dispose() { disposed = true; media?.removeEventListener('change', onSystemChange); events?.removeEventListener('storage', onStorageChange); },
  };
}

registerMessages({
  '外观': 'Appearance', '浅色': 'Light', '深色': 'Dark', '跟随系统': 'System',
  '外观：{mode}': 'Appearance: {mode}',
});

const icons = {
  light: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  dark: '<path d="M20 14.3A8.4 8.4 0 0 1 9.7 4 8.5 8.5 0 1 0 20 14.3Z"/>',
  system: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
};
const icon = mode => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[mode]}</svg>`;
const modes = [['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']];

function mountThemeControl(host, controller) {
  host.innerHTML = `<details class="appearance-menu"><summary></summary><div class="appearance-options" role="group"></div></details>`;
  const menu = host.querySelector('details'), summary = host.querySelector('summary'), options = host.querySelector('.appearance-options');
  const render = () => {
    const { preference } = controller.getState();
    const label = t(modes.find(([mode]) => mode === preference)[1]);
    summary.innerHTML = icon(preference);
    summary.setAttribute('aria-label', t('外观：{mode}', { mode: label }));
    summary.title = t('外观：{mode}', { mode: label });
    options.setAttribute('aria-label', t('外观'));
    options.innerHTML = modes.map(([mode, name]) => `<button type="button" data-appearance="${mode}" aria-pressed="${preference === mode}">${icon(mode)}<span>${t(name)}</span><span class="appearance-check" aria-hidden="true">${preference === mode ? '✓' : ''}</span></button>`).join('');
  };
  options.addEventListener('click', event => {
    const button = event.target.closest('[data-appearance]');
    if (!button) return;
    controller.setPreference(button.dataset.appearance);
    menu.open = false;
    summary.focus({ preventScroll: true });
  });
  document.addEventListener('pointerdown', event => { if (menu.open && !menu.contains(event.target)) menu.open = false; });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) { menu.open = false; summary.focus({ preventScroll: true }); event.preventDefault(); }
  });
  window.addEventListener(THEME_CHANGE_EVENT, render);
  window.addEventListener('funtrack:localechange', render);
  render();
}

if (typeof document !== 'undefined') {
  const controller = createThemeController();
  document.querySelectorAll('[data-theme-control]').forEach(host => mountThemeControl(host, controller));
}
