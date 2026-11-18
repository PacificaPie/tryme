// Loaded only by the local fixture server for an explicit ?logo= review.
// No production page imports this file.
(() => {
  const choices = [
    ['stack-original', 'A0 原版'], ['stack-edge', 'A1 共边叠卡'],
    ['stack-seam', 'A2 卡缝成 T'], ['stack-hand', 'A3 轻递一张'],
  ];
  const requested = new URL(location.href).searchParams.get('logo');
  if (!choices.some(([id]) => id === requested)) return;
  const brand = document.querySelector('.site-header .brand');
  if (!brand) return;
  document.body.dataset.logoReview = 'true';
  const symbol = document.createElement('img');
  symbol.className = 'brand-review-symbol'; symbol.alt = '';
  symbol.width = 29; symbol.height = 29;
  brand.prepend(symbol);
  const toolbar = document.createElement('div');
  toolbar.className = 'brand-review-toolbar';
  toolbar.innerHTML = `<span>Logo 本地验收 · 主站页面 · 演示数据</span><div role="group" aria-label="Logo 方案">${choices.map(([id,label])=>`<button type="button" data-brand-option="${id}">${label}</button>`).join('')}</div><a href="http://127.0.0.1:8880/?review=stack-4#/logos">返回方案对照 ↗</a>`;
  document.body.prepend(toolbar);
  let favicon = document.querySelector('link[rel="icon"]');
  if (!favicon) { favicon = document.createElement('link'); favicon.rel = 'icon'; document.head.append(favicon); }
  const apply = id => {
    if (!choices.some(([key]) => key === id)) return;
    symbol.src = `/__brand/${id}.svg`;
    favicon.href = `/__brand/${id}-favicon.svg`;
    toolbar.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.brandOption === id)));
    const url = new URL(location.href); url.searchParams.set('logo', id);
    history.replaceState(null, '', url);
    document.title = `TryMe · ${choices.find(([key])=>key===id)[1]} · 本地预览`;
  };
  toolbar.addEventListener('click', event => {
    const button = event.target.closest('[data-brand-option]');
    if (button) apply(button.dataset.brandOption);
  });
  apply(requested);
})();
