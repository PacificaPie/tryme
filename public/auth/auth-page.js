import { ensureAuth, getAuthConfig, getClerk, authURL, signOut, safeAuthReturnTo } from '../auth-client.js';
import { t, getLocale, setLocale, registerMessages } from '../i18n.js';
import { publicCardBackPath } from '../public-card-links.js';
import { createWechatClient } from './wechat-client.js';
import { errorText } from './wechat-ui.js';

registerMessages({
  '登录': 'Sign in', '退出登录': 'Sign out', '返回': 'Back', '继续': 'Continue',
  '正在加载…': 'Loading…', '正在退出…': 'Signing out…', '重试': 'Retry',
  '登录暂不可用': 'Sign-in is unavailable', '已登录': 'You are signed in', '已退出登录': 'You are signed out',
  '测试环境': 'Test environment', '退出当前账号': 'Sign out of your account',
  '登录后可继续发布和试玩。': 'Sign in to continue publishing and playing.',
  '退出后需要重新登录才能继续。': 'You will need to sign in again to continue.',
});

const main = document.querySelector('#auth-main');
const localeButton = document.querySelector('#auth-locale');
const action = document.body.dataset.authAction;
const returnTo = safeAuthReturnTo(new URLSearchParams(location.search).get('return_to'), location.origin);
const backTo = action === 'sign-in' ? publicCardBackPath(returnTo) || returnTo : returnTo;
let loading = true, failure = null, signingOut = false, mountedNode = null;
const wechat = createWechatClient();
let disposed = false, wechatPending = false;
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const button = (label, attributes = '', secondary = false) => `<button type="button" class="auth-button${secondary ? ' secondary' : ''}" ${attributes}>${esc(t(label))}</button>`;
const link = (label, href, secondary = false) => `<a class="auth-button${secondary ? ' secondary' : ''}" href="${esc(href)}">${esc(t(label))}</a>`;

function render() {
  const english = getLocale() === 'en';
  document.documentElement.lang = getLocale();
  document.title = `${t(action === 'sign-out' ? '退出登录' : '登录')} · Funtrack`;
  localeButton.textContent = english ? '中文' : 'EN';
  localeButton.setAttribute('aria-label', english ? '切换到中文' : 'Switch to English');
  localeButton.disabled = signingOut;
  if (mountedNode) return;
  if (loading) { main.innerHTML = `<div class="auth-loading" role="status">${esc(t('正在加载…'))}</div>`; return; }
  const config = getAuthConfig();
  const badge = config.provider === 'clerk' && config.environment === 'test' && config.configured ? `<span class="auth-badge">${esc(t('测试环境'))}</span>` : '';
  if (failure) {
    main.innerHTML = `<section class="auth-panel">${badge}<h1>${esc(t('登录暂不可用'))}</h1><p role="alert">${esc(t(failure.message))}</p><div class="auth-actions">${button('重试', 'data-retry')}${link('返回', backTo, true)}</div></section>`;
    main.querySelector('[data-retry]').onclick = () => location.reload();
    return;
  }
  if (action === 'sign-out') {
    const signedOut = config.provider === 'clerk' && !getClerk().session;
    main.innerHTML = `<section class="auth-panel">${badge}<h1>${esc(t(signedOut ? '已退出登录' : '退出当前账号'))}</h1>${signedOut ? '' : `<p>${esc(t('退出后需要重新登录才能继续。'))}</p>`}<div class="auth-actions">${signedOut ? link('返回', returnTo) : button(signingOut ? '正在退出…' : '退出登录', `data-sign-out ${signingOut ? 'disabled aria-busy="true"' : ''}`)}${signedOut ? '' : link('返回', returnTo, true)}</div><p id="auth-error" role="alert" class="auth-error"></p></section>`;
    main.querySelector('[data-sign-out]')?.addEventListener('click', async () => {
      if (signingOut) return;
      signingOut = true; render();
      try { await signOut({ returnTo }); }
      catch (error) {
        signingOut = false; render();
        main.querySelector('#auth-error').textContent = t(error.message);
      }
    });
    return;
  }
  if (config.provider === 'sites') {
    main.innerHTML = `<section class="auth-panel"><h1>${esc(t('登录'))}</h1><p>${esc(t('登录后可继续发布和试玩。'))}</p><div class="auth-actions">${link('登录', authURL('sign-in', returnTo))}${link('返回', backTo, true)}</div></section>`;
    return;
  }
  const clerk = getClerk();
  if (clerk.isSignedIn) {
    main.innerHTML = `<section class="auth-panel">${badge}<h1>${esc(t('已登录'))}</h1><div class="auth-actions">${link('继续', returnTo)}</div></section>`;
    return;
  }
  main.innerHTML = `<section class="auth-component">${badge}<div id="clerk-sign-in"></div>${config.wechat?.enabled ? `<div class="auth-wechat-entry">${button('微信扫码登录', 'data-wechat', true)}<p class="auth-inline-status" data-wechat-status role="status"></p></div>` : ''}<a class="auth-back" href="${esc(backTo)}">${esc(t('返回'))}</a></section>`;
  main.querySelector('[data-wechat]')?.addEventListener('click', async event => {
    if (wechatPending) return;
    wechatPending = true;
    const node = event.currentTarget, status = main.querySelector('[data-wechat-status]');
    node.disabled = true; node.setAttribute('aria-busy', 'true');
    status.textContent = t('正在前往微信…');
    try { const url = await wechat.start(returnTo); if (!disposed) location.assign(url); }
    catch (error) { if (!disposed) status.textContent = errorText(error); }
    finally { if (!disposed) { wechatPending = false; node.disabled = false; node.removeAttribute('aria-busy'); } }
  });
  const node = main.querySelector('#clerk-sign-in');
  try {
    clerk.mountSignIn(node, {
      routing: 'hash', withSignUp: true,
      forceRedirectUrl: returnTo, signUpForceRedirectUrl: returnTo,
      // Theme CSS variables follow the site without remounting the form.
      appearance: { variables: { borderRadius: '0.75rem' } },
    });
    mountedNode = node;
  } catch {
    failure = new Error('登录暂不可用，请稍后再试。'); render();
  }
}

localeButton.addEventListener('click', () => {
  setLocale(getLocale() === 'en' ? 'zh-CN' : 'en');
  // Clerk's public JS API sets locale at load. Reload this auth page instead of
  // reaching into its private updateProps API; the safe return route is retained.
  if (mountedNode) location.reload();
  else render();
});
window.addEventListener('pagehide', () => {
  disposed = true; wechat.dispose();
  if (mountedNode) { getClerk()?.unmountSignIn(mountedNode); mountedNode = null; }
});
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
render();
try { await ensureAuth(); } catch (error) { failure = error; }
loading = false;
render();
