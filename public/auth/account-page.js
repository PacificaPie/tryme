import { ensureAuth, getAuthConfig, getClerk, safeAuthReturnTo } from '../auth-client.js';
import { t } from '../i18n.js';
import { createWechatClient, createAuthTasks, verifiedEmail, ACCOUNT_FINISH, WECHAT_FINISH } from './wechat-client.js';
import { esc, button, link, loading, errorText, updatePageLocale, wireLocale } from './wechat-ui.js';

const main = document.querySelector('#auth-main');
const returnTo = safeAuthReturnTo(new URLSearchParams(location.search).get('return_to'), location.origin);
const client = createWechatClient();
const tasks = createAuthTasks();
let disposed = false, busy = false, status = null, failure = null, ready = false;
let signInNode = null, profileNode = null, profileDialog = null;
function unmountProfile() {
  if (profileNode) { getClerk()?.unmountUserProfile(profileNode); profileNode = null; }
  profileDialog?.remove(); profileDialog = null;
}
function render() {
  if (disposed || signInNode) return;
  updatePageLocale('账号设置');
  if (!ready) { main.innerHTML = loading(); return; }
  if (failure) {
    main.innerHTML = `<section class="auth-panel"><h1>${esc(t('账号设置'))}</h1><p role="alert">${esc(errorText(failure))}</p><div class="auth-actions">${button('重试', 'retry')}${link('返回', returnTo, true)}</div></section>`;
  } else {
    const email = verifiedEmail(getClerk());
    const pendingHere = status?.pending && status.mode === 'bind' && status.flowId === client.currentFlow()?.flowId;
    main.innerHTML = `<section class="auth-panel"><h1>${esc(t('账号设置'))}</h1><div class="account-section"><h2>${esc(t('登录与账号'))}</h2>${email ? `<p class="account-email">${esc(email)}</p>` : ''}${button('管理账号', 'profile', true)}</div>${getAuthConfig().wechat?.enabled && status?.enabled ? `<div class="account-section"><div class="account-section-heading"><h2>${esc(t('微信'))}</h2><span class="account-status${status.linked ? ' linked' : ''}">${esc(t(status.linked ? '已绑定' : '尚未绑定'))}</span></div>${status.linked ? (status.displayName ? `<p>${esc(status.displayName)}</p>` : '') : (pendingHere ? link('继续绑定', WECHAT_FINISH) : button('绑定微信', 'start', true))}</div>` : ''}<p class="auth-error" data-error role="alert"></p><a class="auth-back" href="${esc(returnTo)}">${esc(t('返回'))}</a></section>`;
  }
  main.querySelectorAll('[data-action]').forEach(node => node.addEventListener('click', () => act(node.dataset.action)));
}
function mountProfile() {
  if (profileDialog) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'auth-profile-dialog';
  dialog.setAttribute('aria-label', t('管理账号'));
  dialog.innerHTML = `<div class="auth-profile-toolbar"><button type="button" class="auth-profile-close">${esc(t('关闭'))}</button></div><div class="auth-profile-content auth-component"></div>`;
  document.body.append(dialog); profileDialog = dialog;
  dialog.querySelector('button').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { unmountProfile(); main.querySelector('[data-action="profile"]')?.focus(); });
  dialog.showModal();
  const node = dialog.querySelector('.auth-profile-content');
  try {
    getClerk().mountUserProfile(node, { routing: 'hash', appearance: { variables: { borderRadius: '0.75rem' } } });
    profileNode = node;
  } catch { unmountProfile(); main.querySelector('[data-error]').textContent = errorText({}); }
}
async function act(action) {
  if (busy || disposed) return;
  if (action === 'profile') { mountProfile(); return; }
  if (action === 'retry') { location.reload(); return; }
  busy = true;
  const node = main.querySelector('[data-action="start"]');
  if (node) { node.disabled = true; node.setAttribute('aria-busy', 'true'); node.textContent = t('正在前往微信…'); }
  try {
    const url = await client.start(returnTo, true);
    if (!disposed) location.assign(url);
  } catch (error) { if (!disposed) main.querySelector('[data-error]').textContent = errorText(error); }
  finally {
    busy = false;
    if (!disposed && node) { node.disabled = false; node.removeAttribute('aria-busy'); node.textContent = t('绑定微信'); }
  }
}
async function initialize() {
  await tasks.run(() => ensureAuth());
  if (disposed) return;
  if (getAuthConfig().provider !== 'clerk') { location.replace(returnTo); return; }
  const clerk = getClerk();
  if (!clerk.isSignedIn) {
    updatePageLocale('账号设置');
    main.innerHTML = `<section class="auth-component"><div id="clerk-sign-in"></div><a class="auth-back" href="${esc(returnTo)}">${esc(t('返回'))}</a></section>`;
    const node = main.querySelector('#clerk-sign-in');
    clerk.mountSignIn(node, { routing: 'hash', withSignUp: true, forceRedirectUrl: ACCOUNT_FINISH, signUpForceRedirectUrl: ACCOUNT_FINISH, appearance: { variables: { borderRadius: '0.75rem' } } });
    signInNode = node; return;
  }
  if (getAuthConfig().wechat?.enabled) status = await client.account();
  if (!disposed) { ready = true; render(); }
}

wireLocale(() => { if (signInNode || profileNode) location.reload(); else render(); });
window.addEventListener('pagehide', () => { disposed = true; tasks.dispose(); client.dispose(); unmountProfile(); if (signInNode) getClerk()?.unmountSignIn(signInNode); signInNode = null; });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
render();
try { await initialize(); }
catch (error) { if (!disposed) { failure = error; ready = true; render(); } }
