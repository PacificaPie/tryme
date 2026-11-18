// The same preference and resolution as public/theme.js. Local preview only.
(() => {
  const key = 'funtrack.theme';
  const root = document.documentElement;
  const media = matchMedia('(prefers-color-scheme: dark)');
  const normalize = value => ['light', 'dark'].includes(value) ? value : 'system';
  let preference = 'system';
  try { preference = normalize(localStorage.getItem(key)); } catch { /* Optional storage. */ }
  function apply() {
    root.dataset.themePreference = preference;
    root.dataset.theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    root.style.colorScheme = root.dataset.theme;
    document.querySelectorAll('[data-review-theme]').forEach(select => { select.value = preference; });
  }
  document.addEventListener('change', event => {
    if (!event.target.matches('[data-review-theme]')) return;
    preference = normalize(event.target.value);
    try { localStorage.setItem(key, preference); } catch { /* Apply without persistence. */ }
    apply();
  });
  media.addEventListener('change', () => { if (preference === 'system') apply(); });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      preference = normalize(event.newValue);
      apply();
    }
  });
  apply();
})();
