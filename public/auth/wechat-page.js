import { ensureAuth, getAuthConfig, getClerk, authURL, safeAuthReturnTo } from '../auth-client.js';
import { t } from '../i18n.js';
import { createWechatClient, createAuthTasks, activateWechatTicket, verifiedEmail, WECHAT_FINISH } from './wechat-client.js';
import { esc, button, link, loading, errorText, updatePageLocale, wireLocale } from './wechat-ui.js';

const main = document.querySelector('#auth-main');
const client = createWechatClient(), tasks = createAuthTasks();
const params = new URLSearchParams(location.search);
const mode = params.get('mode');
let disposed = false, busy = false, snapshot = null, mountedNode = null;
let returnTo = client.currentFlow()?.returnTo || '/site.html#/feed';
let state = 'loading', failure = null, status = null;
const error = code => Object.assign(new Error(code), { code });
const safeReturn = value => safeAuthReturnTo(value, location.origin);

function unmount() {
  if (mountedNode) { getClerk()?.unmountSignIn(mountedNode); mountedNode = null; }
}
function panel(title, text, actions, extra = '') {
  main.innerHTML = `<section class="auth-panel"><h1>${esc(t(title))}</h1>${text ? `<p>${esc(text)}</p>` : ''}${extra}<div class="auth-actions">${actions}</div><p class="auth-error" data-error role="alert"></p></section>`;
}
function render() {
  if (disposed) return;
  updatePageLocale('微信');
  if (mountedNode) return;
  if (state === 'loading') { main.innerHTML = loading(mode === 'sign-in' ? '正在登录…' : undefined); return; }
  if (state === 'success') { panel('微信绑定成功', '', link('完成', returnTo)); return; }
  if (state === 'sign-up') {
    panel('微信注册', t('微信验证已完成，可直接创建账号。邮箱为选填。已有账号请返回并登录后绑定。'), button('创建账号并继续', 'register') + button('取消', 'cancel', true));
  } else if (state === 'mismatch') {
    panel('暂时无法继续', t('当前登录的账号与微信绑定的账号不同。'), button('退出当前账号并继续', 'verify') + button('取消', 'cancel', true));
  } else if (state === 'email') {
    panel('额外验证', t('请使用账号已有的登录方式完成额外验证；无可用方式时联系支持。'), button('其他登录方式', 'email') + link('返回', returnTo, true));
  } else if (state === 'error') {
    const retry = getAuthConfig().wechat?.enabled ? button('重新扫码', 'restart') : '';
    panel('暂时无法继续', errorText(failure), retry + link('使用邮箱登录', authURL('sign-in', returnTo), Boolean(retry)) + link('返回', returnTo, true));
  } else if (state === 'bind') {
    const email = verifiedEmail(getClerk());
    if (status.expectedUserId !== getClerk()?.user?.id) { showError(error('WECHAT_ACCOUNT_CHANGED')); return; }
    const reverification = status.needsReverification || failure?.code === 'WECHAT_REVERIFICATION_REQUIRED';
    const displayName = typeof snapshot.displayName === 'string' && !['微信账号', 'WeChat account'].includes(snapshot.displayName.trim()) ? snapshot.displayName : '';
    panel('绑定微信', t(reverification ? '请重新登录，确认这是你的账号。' : '将微信绑定到以下账号'),
      button(reverification ? '重新登录验证' : '确认绑定微信', reverification ? 'verify' : 'confirm') + button('取消', 'cancel', true),
      `<div class="auth-account-identity"><span>${esc(email || getClerk()?.user?.fullName || getClerk()?.user?.id)}</span>${displayName ? `<small>${esc(t('微信'))} · ${esc(displayName)}</small>` : ''}</div>`);
  }
  main.querySelectorAll('[data-action]').forEach(node => node.addEventListener('click', () => act(node.dataset.action)));
}
function showError(value) {
  failure = value; state = 'error'; unmount(); render();
}
function mountEmail(target, introductory = false) {
  unmount(); state = 'email-form';
  main.innerHTML = `<section class="auth-component">${introductory ? `<div class="auth-intro"><h1>${esc(t('验证邮箱'))}</h1><p>${esc(t('请登录要关联的已有账号，再确认绑定微信。'))}</p></div>` : ''}<div id="clerk-sign-in"></div>${snapshot ? button('取消', 'cancel', true) : `<a class="auth-back" href="${esc(returnTo)}">${esc(t('返回'))}</a>`}<p class="auth-inline-status" data-error role="alert"></p></section>`;
  const node = main.querySelector('#clerk-sign-in');
  try {
    // This fixed callback is internal, never derived from return_to or a provider URL.
    getClerk().mountSignIn(node, { routing: 'hash', withSignUp: false, forceRedirectUrl: target, signUpForceRedirectUrl: target, appearance: { variables: { borderRadius: '0.75rem' } } });
    mountedNode = node;
  } catch { showError(error('AUTH_UNAVAILABLE')); }
  main.querySelector('[data-action="cancel"]')?.addEventListener('click', () => act('cancel'));
}
async function act(action) {
  if (busy || disposed) return;
  busy = true;
  main.querySelectorAll('button').forEach(node => { node.disabled = true; });
  const alert = main.querySelector('[data-error]');
  if (alert) alert.textContent = '';
  try {
    if (action === 'register') {
      await finishSignIn(getClerk());
    } else if (action === 'restart') {
      const url = await client.start(returnTo, mode === 'bind');
      if (!disposed) location.assign(url);
    } else if (action === 'cancel') {
      const result = await client.cancel(snapshot, Boolean(getClerk()?.isSignedIn));
      if (!disposed) { client.forget(snapshot.flowId); location.replace(safeReturn(result.returnTo || returnTo)); }
    } else if (action === 'confirm') {
      // Both ids belong to the account/flow the user actually saw, not a new fetch on click.
      const result = await client.confirm({ flowId: snapshot.flowId, expectedUserId: status.expectedUserId });
      if (!disposed) {
        if (result.linked !== true) throw error('AUTH_UNAVAILABLE');
        client.forget(snapshot.flowId); returnTo = safeReturn(result.returnTo || returnTo); state = 'success'; render();
      }
    } else if (action === 'verify') {
      const clerk = getClerk();
      const target = mode === 'bind' ? WECHAT_FINISH : '/auth/wechat.html?mode=' + mode;
      if (clerk.session) await tasks.run(signal => {
        if (signal.aborted) throw error('AUTH_CANCELLED');
        return clerk.signOut({ sessionId: clerk.session.id, redirectUrl: target });
      });
      else if (!disposed) mountEmail(target, mode === 'bind');
    } else if (action === 'email') {
      const clerk = getClerk();
      // A real, user-triggered email sign-in is required; an existing session is not verification.
      if (clerk.session) await tasks.run(() => clerk.signOut({ sessionId: clerk.session.id, redirectUrl: authURL('sign-in', returnTo) }));
      else if (!disposed) mountEmail(returnTo);
    }
  } catch (value) {
    if (disposed || value.code === 'AUTH_CANCELLED') return;
    if (value.code === 'WECHAT_ADDITIONAL_VERIFICATION_REQUIRED') { state = 'email'; failure = value; render(); }
    else if (action === 'confirm' && value.code === 'WECHAT_REVERIFICATION_REQUIRED') { failure = value; render(); }
    else if (['WECHAT_FLOW_EXPIRED', 'WECHAT_FLOW_CHANGED', 'WECHAT_ACCOUNT_CHANGED', 'WECHAT_ACCOUNT_MISMATCH'].includes(value.code)) showError(value);
    else { const node = main.querySelector('[data-error]'); if (node) node.textContent = errorText(value); }
  } finally {
    busy = false;
    if (!disposed) main.querySelectorAll('button').forEach(node => { node.disabled = false; });
  }
}

async function initialize() {
  await tasks.run(() => ensureAuth());
  if (disposed) return;
  if (!getAuthConfig().wechat?.enabled) throw error('WECHAT_DISABLED');
  if (mode === 'error') throw error(params.get('error'));
  if (!['bind', 'sign-in', 'sign-up'].includes(mode)) throw error('WECHAT_FLOW_EXPIRED');
  snapshot = await client.pending();
  if (disposed) return;
  if (!snapshot.pending || snapshot.mode !== mode) throw error('WECHAT_FLOW_EXPIRED');
  client.assertFlow(snapshot);
  returnTo = safeReturn(snapshot.returnTo);
  const clerk = getClerk();
  if (mode === 'bind') {
    if (!clerk.isSignedIn) { mountEmail(WECHAT_FINISH, true); return; }
    status = await client.account();
    if (disposed) return;
    client.assertFlow(status);
    if (!status.pending || status.flowId !== snapshot.flowId) throw error('WECHAT_FLOW_CHANGED');
    state = 'bind'; render(); return;
  }
  if (mode === 'sign-up') {
    state = clerk.user?.id ? 'mismatch' : 'sign-up'; render(); return;
  }
  if (!snapshot.mappedUserId) throw error('WECHAT_ADDITIONAL_VERIFICATION_REQUIRED');
  if (clerk.user?.id && clerk.user.id !== snapshot.mappedUserId) { state = 'mismatch'; render(); return; }
  await finishSignIn(clerk);
}

async function finishSignIn(clerk) {
  const result = await client.exchange(snapshot);
  const expectedUserId = snapshot.mappedUserId || result.mappedUserId;
  if (disposed) return;
  await tasks.run(signal => activateWechatTicket(clerk, result.ticket, expectedUserId, { signal }));
  if (disposed) return;
  const profile = await client.me();
  if (disposed) return;
  if (!clerk.isSignedIn || clerk.user?.id !== expectedUserId || profile.user?.id !== `clerk:${expectedUserId}`) throw error('WECHAT_ACCOUNT_MISMATCH');
  client.forget(snapshot.flowId);
  location.replace(safeReturn(result.returnTo || returnTo));
}

wireLocale(() => { if (mountedNode) location.reload(); else render(); });
window.addEventListener('pagehide', () => { disposed = true; tasks.dispose(); client.dispose(); unmount(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
render();
try { await initialize(); }
catch (value) {
  if (!disposed) {
    if (value.code === 'WECHAT_ADDITIONAL_VERIFICATION_REQUIRED') { state = 'email'; failure = value; render(); }
    else if (getAuthConfig().provider === 'unknown') {
      main.innerHTML = `<section class="auth-panel"><h1>${esc(t('暂时无法继续'))}</h1><p role="alert">${esc(errorText(value))}</p><div class="auth-actions">${button('重试', 'reload')}${link('返回', returnTo, true)}</div></section>`;
      main.querySelector('[data-action="reload"]').onclick = () => location.reload();
    } else showError(value);
  }
}
