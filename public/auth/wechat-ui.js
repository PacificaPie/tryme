import { t, getLocale, setLocale, registerMessages } from '../i18n.js';

registerMessages({
  '账号设置': 'Account settings', '微信': 'WeChat', '微信扫码登录': 'Sign in with WeChat',
  '绑定微信': 'Link WeChat', '已绑定微信': 'WeChat linked', '尚未绑定': 'Not linked',
  '确认绑定微信': 'Confirm linking WeChat', '将微信绑定到以下账号': 'Link WeChat to this account',
  '验证邮箱': 'Verify your email', '登录或注册后，再确认绑定微信。': 'Sign in or sign up, then confirm linking WeChat.',
  '邮箱与账号': 'Email and account', '管理账号': 'Manage account', '关闭': 'Close',
  '重新登录验证': 'Sign in again to verify', '请重新登录，确认这是你的账号。': 'Sign in again to confirm this is your account.',
  '继续绑定': 'Continue linking', '已绑定': 'Linked', '完成': 'Done',
  '取消': 'Cancel', '返回': 'Back', '重试': 'Retry', '正在加载…': 'Loading…',
  '正在前往微信…': 'Opening WeChat…', '正在确认…': 'Confirming…', '正在登录…': 'Signing in…',
  '暂时无法继续': 'Unable to continue', '重新扫码': 'Scan again', '使用邮箱继续': 'Continue with email',
  '使用邮箱登录': 'Sign in with email', '登录状态已变化，请刷新后重试。': 'Your sign-in changed. Refresh and try again.',
  '当前登录的账号与微信绑定的账号不同。': 'You are signed in to a different account from the one linked to WeChat.',
  '退出当前账号并继续': 'Sign out and continue', '请在发起扫码的标签页继续。': 'Continue in the tab where you started the scan.',
  '本次扫码已过期，请重新开始。': 'This scan has expired. Please start again.',
  '你已取消微信授权。': 'You cancelled WeChat authorization.',
  '微信登录暂不可用，可以使用邮箱登录。': 'WeChat sign-in is unavailable. You can use email instead.',
  '连接超时，请重试。': 'The connection timed out. Please try again.',
  '连接暂时中断，请重试。': 'The connection was interrupted. Please try again.',
  '请使用已验证的邮箱继续。': 'Continue with a verified email address.',
  '这个微信已绑定其他账号。': 'This WeChat account is already linked to another account.',
  '此账号已绑定另一个微信。': 'This account is already linked to another WeChat account.',
  '微信或当前账号已有其他绑定，请使用原账号登录。': 'WeChat or this account is already linked elsewhere. Sign in with the original account.',
  '请用邮箱完成登录验证。': 'Complete sign-in verification with your email.',
  '请求过于频繁，请稍后再试。': 'Too many attempts. Please try again shortly.',
  '微信绑定成功': 'WeChat linked successfully', '正在取消…': 'Cancelling…',
});

export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export const button = (label, action, secondary = false, disabled = false) => `<button type="button" class="auth-button${secondary ? ' secondary' : ''}" data-action="${esc(action)}"${disabled ? ' disabled aria-busy="true"' : ''}>${esc(t(label))}</button>`;
export const link = (label, href, secondary = false) => `<a class="auth-button${secondary ? ' secondary' : ''}" href="${esc(href)}">${esc(t(label))}</a>`;
export const loading = label => `<div class="auth-loading" role="status">${esc(t(label || '正在加载…'))}</div>`;
export function errorText(error) {
  const messages = {
    AUTH_TIMEOUT: '连接超时，请重试。', AUTH_REQUIRED: '登录状态已变化，请刷新后重试。',
    AUTH_SESSION_CHANGED: '登录状态已变化，请刷新后重试。', WECHAT_ACCOUNT_CHANGED: '登录状态已变化，请刷新后重试。',
    WECHAT_FLOW_CHANGED: '请在发起扫码的标签页继续。', WECHAT_FLOW_EXPIRED: '本次扫码已过期，请重新开始。',
    WECHAT_DENIED: '你已取消微信授权。', WECHAT_DISABLED: '微信登录暂不可用，可以使用邮箱登录。',
    WECHAT_PROVIDER_UNAVAILABLE: '微信登录暂不可用，可以使用邮箱登录。',
    WECHAT_REVERIFICATION_REQUIRED: '请重新登录，确认这是你的账号。',
    WECHAT_ACCOUNT_MISMATCH: '当前登录的账号与微信绑定的账号不同。',
    WECHAT_EMAIL_SIGN_IN_REQUIRED: '请用邮箱完成登录验证。',
    WECHAT_EMAIL_REQUIRED: '请使用已验证的邮箱继续。', EMAIL_NOT_VERIFIED: '请使用已验证的邮箱继续。',
    WECHAT_ALREADY_LINKED: '这个微信已绑定其他账号。', WECHAT_USER_ALREADY_LINKED: '此账号已绑定另一个微信。',
    WECHAT_BIND_CONFLICT: '微信或当前账号已有其他绑定，请使用原账号登录。',
    WECHAT_RATE_LIMITED: '请求过于频繁，请稍后再试。',
  };
  return t(messages[error?.code] || '连接暂时中断，请重试。');
}

export function updatePageLocale(title) {
  document.documentElement.lang = getLocale();
  document.title = `${t(title)} · Funtrack`;
  const node = document.querySelector('#auth-locale');
  node.textContent = getLocale() === 'en' ? '中文' : 'EN';
  node.setAttribute('aria-label', getLocale() === 'en' ? '切换到中文' : 'Switch to English');
}
export function wireLocale(onChange) {
  document.querySelector('#auth-locale').onclick = () => {
    setLocale(getLocale() === 'en' ? 'zh-CN' : 'en'); onChange();
  };
}
