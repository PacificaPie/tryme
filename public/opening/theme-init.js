(() => {
  const theme = document.documentElement.dataset.theme;
  document.documentElement.dataset.cardMaterial = theme;
  window.OpeningTheme = {theme,card:theme};
})();
