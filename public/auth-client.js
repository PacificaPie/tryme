import { getLocale, registerMessages } from './i18n.js';

const DEFAULT_RETURN = '/site.html#/feed';
const DEFAULT_CONFIG = Object.freeze({ provider: 'unknown', configured: false, environment: 'production' });
const UNAVAILABLE = '登录暂不可用，请稍后再试。';
const SESSION_CHANGED = '登录状态已变化，请重新登录后重试。';
registerMessages({
  [UNAVAILABLE]: 'Sign-in is temporarily unavailable. Please try again later.',
  [SESSION_CHANGED]: 'Your sign-in status has changed. Sign in again and retry.',
  '无法连接登录服务，请检查网络后重试。': 'Could not connect to sign-in. Check your connection and retry.',
});

function authError(code, message = UNAVAILABLE, status = 503) {
  return Object.assign(new Error(message), { code, status });
}

/** Return a local path only. Both URL query redirects and hash routes are retained. */
export function safeAuthReturnTo(value, origin = globalThis.location?.origin) {
  if (typeof value !== 'string' || !value || value.length > 4096 || !origin) return DEFAULT_RETURN;
  try {
    let decoded = value;
    for (let n = 0; n < 3; n++) {
      if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//')) return DEFAULT_RETURN;
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//') || value.trim() !== value) return DEFAULT_RETURN;
    const url = new URL(value.startsWith('#') ? `/site.html${value}` : value, origin);
    if (url.origin !== origin || url.username || url.password || !['https:', 'http:'].includes(url.protocol)) return DEFAULT_RETURN;
    let decodedPath = url.pathname;
    for (let n = 0; n < 3; n++) decodedPath = decodeURIComponent(decodedPath);
    if (decodedPath.startsWith('//')) return DEFAULT_RETURN;
    const path = new URL(decodedPath, origin).pathname.replace(/\/+$/, '').toLowerCase();
    if (/^\/(?:auth|api\/auth)(?:\/|$)/.test(path) || /^\/(?:signin|signout)-with-chatgpt(?:\/|$)/.test(path)) return DEFAULT_RETURN;
    return url.pathname + url.search + url.hash;
  } catch { return DEFAULT_RETURN; }
}

/** Publishable keys contain a DNS hostname, never an arbitrary script URL. */
export function parsePublishableKey(value) {
  if (typeof value !== 'string' || value.length > 1024) throw authError('AUTH_NOT_CONFIGURED');
  const match = /^pk_(test|live)_([A-Za-z0-9_+/-]+={0,2})$/.exec(value);
  if (!match) throw authError('AUTH_NOT_CONFIGURED');
  try {
    const encoded = match[2].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='));
    if (!decoded.endsWith('$')) throw new Error('hostname');
    const hostname = decoded.slice(0, -1);
    const labels = hostname.split('.');
    if (hostname.length > 253 || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
        !/[a-z]/.test(labels.at(-1)) || labels.at(-1) === 'localhost') throw new Error('hostname');
    const url = new URL(`https://${hostname}`);
    if (url.hostname !== hostname) throw new Error('hostname');
    return { origin: url.origin, environment: match[1] === 'test' ? 'test' : 'production' };
  } catch { throw authError('AUTH_NOT_CONFIGURED'); }
}

const scriptLoads = new Map();
function loadScript(document, src, publishableKey) {
  if (scriptLoads.has(src)) return scriptLoads.get(src);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.src = src;
    if (publishableKey) script.setAttribute('data-clerk-publishable-key', publishableKey);
    const timer = setTimeout(() => finish(authError('AUTH_LOAD_FAILED')), 15000);
    function finish(error) {
      clearTimeout(timer); script.onload = null; script.onerror = null;
      if (error) { script.remove(); reject(error); } else resolve();
    }
    script.onload = () => finish();
    script.onerror = () => finish(authError('AUTH_LOAD_FAILED'));
    document.head.append(script);
  }).catch(error => { scriptLoads.delete(src); throw error; });
  scriptLoads.set(src, promise);
  return promise;
}

async function loadBrowserClerk(config) {
  const { origin } = parsePublishableKey(config.publishableKey);
  await loadScript(document, `${origin}/npm/@clerk/ui@1/dist/ui.browser.js`);
  await loadScript(document, `${origin}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, config.publishableKey);
  const clerk = window.Clerk;
  if (!clerk || typeof clerk.load !== 'function' || !window.__internal_ClerkUICtor || clerk.publishableKey !== config.publishableKey) throw authError('AUTH_LOAD_FAILED');
  const localization = getLocale() === 'zh-CN' ? (await import('./auth/clerk-zh-CN.js')).zhCN : undefined;
  await clerk.load({
    ui: { ClerkUI: window.__internal_ClerkUICtor },
    ...(localization ? { localization } : {}),
    signInUrl: '/auth/sign-in.html',
    signUpUrl: '/auth/sign-in.html',
  });
  if (clerk.loaded !== true) throw authError('AUTH_LOAD_FAILED');
  return clerk;
}

// The factory supplies test seams without any alternate browser auth identity.
export function createAuthClient({
  fetchImpl = (...args) => globalThis.fetch(...args),
  location = () => globalThis.location,
  loadClerk = loadBrowserClerk,
} = {}) {
  let config = DEFAULT_CONFIG, ready, clerk;
  const getAuthConfig = () => config;
  const getClerk = () => clerk ?? null;
  function ensureAuth() {
    if (!ready) ready = initialize().catch(error => { ready = null; throw error; });
    return ready;
  }
  async function initialize() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let data;
    try {
      const response = await fetchImpl('/api/auth/config', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (!response.ok) throw new Error('config');
      data = await response.json();
    } catch { throw authError('AUTH_CONFIG_UNAVAILABLE', '无法连接登录服务，请检查网络后重试。'); }
    finally { clearTimeout(timer); }
    if (!data || !['sites', 'clerk'].includes(data.provider) || typeof data.configured !== 'boolean') throw authError('AUTH_NOT_CONFIGURED');
    config = Object.freeze({
      provider: data.provider, configured: data.configured,
      environment: data.environment === 'test' ? 'test' : 'production',
      wechat: Object.freeze({ enabled: data.provider === 'clerk' && data.configured && data.wechat?.enabled === true }),
      ...(data.provider === 'clerk' ? { publishableKey: data.publishableKey, signInPath: '/auth/sign-in.html', signOutPath: '/auth/sign-out.html' } : {}),
    });
    if (!config.configured) throw authError('AUTH_NOT_CONFIGURED');
    if (config.provider === 'clerk') {
      if (parsePublishableKey(config.publishableKey).environment === 'test' && config.environment !== 'test') throw authError('AUTH_NOT_CONFIGURED');
      try { clerk = await loadClerk(config); }
      catch { throw authError('AUTH_LOAD_FAILED'); }
      if (!clerk || typeof clerk.signOut !== 'function') throw authError('AUTH_LOAD_FAILED');
    }
    return config;
  }
  async function authHeaders({ skipCache = false } = {}) {
    await ensureAuth();
    if (config.provider === 'sites' || !clerk.session) return {};
    const session = clerk.session;
    let token;
    try { token = await session.getToken(...(skipCache ? [{ skipCache: true }] : [])); }
    catch { throw authError('AUTH_TOKEN_UNAVAILABLE', '无法连接登录服务，请检查网络后重试。'); }
    if (!clerk.session || (session.id ? clerk.session.id !== session.id : clerk.session !== session)) throw authError('AUTH_SESSION_CHANGED', SESSION_CHANGED, 401);
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw authError('AUTH_REQUIRED', SESSION_CHANGED, 401);
    return { Authorization: `Bearer ${token}` };
  }
  function authURL(action, returnTo) {
    if (!['sign-in', 'sign-out'].includes(action)) throw new TypeError('Unknown authentication action.');
    if (config.provider === 'unknown') throw authError('AUTH_CONFIG_UNAVAILABLE', '无法连接登录服务，请检查网络后重试。');
    const target = safeAuthReturnTo(returnTo, location()?.origin);
    const path = config.provider === 'clerk' ? (action === 'sign-in' ? config.signInPath : config.signOutPath) : (action === 'sign-in' ? '/signin-with-chatgpt' : '/signout-with-chatgpt');
    return `${path}?return_to=${encodeURIComponent(target)}`;
  }
  async function signOut({ returnTo } = {}) {
    await ensureAuth();
    const target = safeAuthReturnTo(returnTo, location()?.origin);
    if (config.provider === 'sites') { location().assign(authURL('sign-out', target)); return; }
    try { await clerk.signOut({ redirectUrl: target }); }
    catch { throw authError('AUTH_SIGN_OUT_FAILED', '无法连接登录服务，请检查网络后重试。'); }
  }
  return { ensureAuth, getAuthConfig, getClerk, authHeaders, authURL, signOut };
}

const client = createAuthClient();
export const { ensureAuth, getAuthConfig, getClerk, authHeaders, authURL, signOut } = client;
