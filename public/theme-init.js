// Run before styles paint; keep in step with the controller's safe defaults.
(() => {
  let preference = 'system';
  try {
    const saved = localStorage.getItem('funtrack.theme');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch { /* Private browsing may deny storage; system mode still works. */ }
  const dark = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
})();
