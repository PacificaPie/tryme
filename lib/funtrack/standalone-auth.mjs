import {createWechatAuth} from './wechat-auth.mjs';
import {activeProfile, verifiedAddress, profileName} from './identity-profile.mjs';
import {withVerifiedIdentity} from './identity-context.mjs';
import {publicCardReadRoute} from './public-sharing-routes.mjs';
import {avatarReadRoute} from './avatar-rules.mjs';
import {publicFeedReadRoute} from './public-feed-routes.mjs';

// The standalone Worker is the only caller of this adapter. Sites keeps its own
// trusted Dispatch boundary; requests from the public internet never inherit it.
const SIGN_IN_PATH = '/auth/sign-in.html';
const SIGN_OUT_PATH = '/auth/sign-out.html';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const CONFIGURATION_MESSAGE = '登录暂不可用，请稍后再试或联系站点管理员。';

function problem(code, message, status = 503) {
  return { code, message, status };
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  } });
}

function failure(error, clerkHeaders) {
  return withCookies(json({ error: { code: error.code, message: error.message } }, error.status), clerkHeaders);
}

function withCookies(response, clerkHeaders) {
  if (!clerkHeaders?.has('set-cookie')) return response;
  const headers = new Headers(response.headers);
  // Both workerd and current Node expose getSetCookie; never split on commas
  // because an individual cookie's Expires attribute can contain one.
  const cookies = clerkHeaders.getSetCookie?.() ?? [clerkHeaders.get('set-cookie')];
  for (const cookie of cookies) if (cookie) headers.append('Set-Cookie', cookie);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function frontendOrigin(publishableKey) {
  const match = /^pk_(live|test)_([A-Za-z0-9_+/-]+={0,2})$/.exec(publishableKey);
  if (!match) return null;
  try {
    const encoded = match[2].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='));
    if (!decoded.endsWith('$')) return null;
    const hostname = decoded.slice(0, -1);
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname) || !hostname.includes('.')) return null;
    const url = new URL(`https://${hostname}`);
    return url.hostname === hostname ? url.origin : null;
  } catch { return null; }
}

export function standaloneAuthConfig(env = {}) {
  const originValue = typeof env.APP_ORIGIN === 'string' ? env.APP_ORIGIN : '';
  const publishableKey = typeof env.CLERK_PUBLISHABLE_KEY === 'string' ? env.CLERK_PUBLISHABLE_KEY : '';
  const secretKey = typeof env.CLERK_SECRET_KEY === 'string' ? env.CLERK_SECRET_KEY : '';
  const testMode = env.CLERK_TEST_MODE === '1';
  let origin;
  try {
    const url = new URL(originValue);
    if (originValue !== url.origin || !['http:', 'https:'].includes(url.protocol) ||
        (url.protocol !== 'https:' && !LOOPBACK.has(url.hostname))) throw new Error('origin');
    origin = url.origin;
  } catch {
    return { configured: false, environment: testMode ? 'test' : 'production', error: problem('AUTH_NOT_CONFIGURED', CONFIGURATION_MESSAGE) };
  }
  const keyMode = /^pk_(live|test)_/.exec(publishableKey)?.[1];
  const secretMode = /^sk_(live|test)_[A-Za-z0-9_-]+$/.exec(secretKey)?.[1];
  const clerkOrigin = frontendOrigin(publishableKey);
  const environment = testMode || keyMode === 'test' ? 'test' : 'production';
  if (!clerkOrigin || !secretMode || keyMode !== secretMode) {
    return { configured: false, environment, error: problem('AUTH_NOT_CONFIGURED', CONFIGURATION_MESSAGE) };
  }
  if (keyMode === 'test' && !testMode && !LOOPBACK.has(new URL(origin).hostname)) {
    return { configured: false, environment, error: problem('AUTH_NOT_CONFIGURED', CONFIGURATION_MESSAGE) };
  }
  return { configured: true, origin, publishableKey, secretKey, clerkOrigin, environment };
}

function publicConfig(config) {
  return {
    provider: 'clerk', configured: config.configured,
    publishableKey: config.configured ? config.publishableKey : null,
    signInPath: SIGN_IN_PATH, signOutPath: SIGN_OUT_PATH,
    environment: config.environment,
    ...(config.error ? { error: { code: config.error.code, message: config.error.message } } : {}),
  };
}

function withoutUntrustedIdentity(request) {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.startsWith('oai-authenticated-') || name.startsWith('x-clerk-') ||
        name === 'forwarded' || name.startsWith('x-forwarded-')) headers.delete(name);
  }
  return new Request(request, { headers });
}

function isProtected(pathname) {
  return /^\/(?:api|game|media)(?:\/|$)/.test(pathname);
}

function handshakeResponse(request, state, config) {
  const location = state.headers?.get('location');
  if (!location && state.status !== 'handshake') return null;
  // API fetches must obtain a refreshed token from ClerkJS. Redirecting an API
  // upload to FAPI could forward its body, and never establishes user identity.
  if (request.method !== 'GET' || new URL(request.url).pathname.startsWith('/api/')) {
    return failure(problem('AUTH_SESSION_REFRESH_REQUIRED', '登录会话需要刷新，请重新登录后重试。', 401), state.headers);
  }
  try {
    const target = new URL(location);
    if (!location || ![config.origin, config.clerkOrigin].includes(target.origin) || target.username || target.password) throw new Error('redirect');
    const headers = new Headers({ Location: target.href, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
    return withCookies(new Response(null, { status: 307, headers }), state.headers);
  } catch {
    return failure(problem('AUTH_UNAVAILABLE', '登录验证暂不可用，请稍后重试。'), state.headers);
  }
}

async function verifiedProfile(profile, subject, wechat) {
  if (!activeProfile(profile, subject)) return { error: problem('AUTH_REQUIRED', '请先登录后继续。', 401) };
  const address = verifiedAddress(profile);
  if (!address && !await wechat.hasIdentity(subject)) return { error: problem('EMAIL_VERIFICATION_REQUIRED', '请验证邮箱或使用已验证的微信账号登录。', 403) };
  return { id: `clerk:${subject}`, email: address?.emailAddress ?? null, name: profileName(profile) };
}

/** Dependency injection is for unit tests, never selected by a request/header. */
export function createStandaloneHandler({ fetch: applicationFetch, createClerkClient }) {
  return async function handle(request, env, ctx) {
    const clean = withoutUntrustedIdentity(request);
    const url = new URL(clean.url);
    const wechat = createWechatAuth({env, config: () => standaloneAuthConfig(env), createClerkClient});
    if (url.pathname === '/api/auth/config') {
      if (clean.method !== 'GET') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: '请使用 GET 查询登录配置。' } }, 405);
      return json({...publicConfig(standaloneAuthConfig(env)), wechat: await wechat.publicConfig()});
    }
    const wechatResponse = await wechat.handlePublic(clean);
    if (wechatResponse) return wechatResponse;
    // Build runners already have their own constant-time secret authentication.
    // Static assets/sign-in pages stay available even before keys are configured.
    if (!isProtected(url.pathname) || publicCardReadRoute(clean) || publicFeedReadRoute(clean) || avatarReadRoute(clean) || url.pathname.startsWith('/api/build-worker/')) return applicationFetch(clean, env, ctx);
    const config = standaloneAuthConfig(env);
    if (!config.configured) return failure(config.error);
    if (url.origin !== config.origin) return failure(problem('AUTH_ORIGIN_MISMATCH', '请从配置的站点地址访问。', 403));
    let state, client;
    try {
      client = createClerkClient({ publishableKey: config.publishableKey, secretKey: config.secretKey });
      state = await client.authenticateRequest(clean, {
        authorizedParties: [config.origin], acceptsToken: 'session_token',
        signInUrl: config.origin + SIGN_IN_PATH,
        signUpUrl: config.origin + SIGN_IN_PATH,
      });
    } catch {
      return failure(problem('AUTH_UNAVAILABLE', '登录验证暂不可用，请稍后重试。'));
    }
    if (!state || typeof state.toAuth !== 'function') return failure(problem('AUTH_UNAVAILABLE', '登录验证暂不可用，请稍后重试。'));
    const handshake = handshakeResponse(clean, state, config);
    if (handshake) return handshake;
    if (state.status !== 'signed-in' || state.isAuthenticated !== true || state.tokenType !== 'session_token') {
      return failure(problem('AUTH_REQUIRED', '请先登录后继续。', 401), state.headers);
    }
    let auth, profile;
    try {
      auth = state.toAuth({ treatPendingAsSignedOut: true });
      if (!auth?.sessionId || typeof auth.userId !== 'string' || !/^user_[A-Za-z0-9_-]{1,230}$/.test(auth.userId)) {
        return failure(problem('AUTH_REQUIRED', '请先登录后继续。', 401), state.headers);
      }
      profile = await client.users.getUser(auth.userId);
    } catch {
      return failure(problem('AUTH_UNAVAILABLE', '登录验证暂不可用，请稍后重试。'), state.headers);
    }
    let user;
    try { user = await verifiedProfile(profile, auth.userId, wechat); }
    catch { return failure(problem('AUTH_UNAVAILABLE', '登录验证暂不可用，请稍后重试。'), state.headers); }
    if (user.error) return failure(user.error, state.headers);
    const fva = auth.sessionClaims?.fva;
    const accountResponse = await wechat.handleAccount(clean, {clerkUserId: auth.userId, sessionId: auth.sessionId, profile, claims: auth.sessionClaims, impersonating: !!auth.actor, recentVerification: Array.isArray(fva) && fva[0] >= 0 && fva[0] <= 5});
    if (accountResponse) return withCookies(accountResponse, state.headers);
    // Only this private, request-scoped clone receives legacy identity headers.
    // Never return them or mutate the original request. Email is not an ID map.
    const headers = new Headers(clean.headers);
    headers.set('oai-authenticated-user-id', user.id);
    if (user.email) headers.set('oai-authenticated-user-email', user.email);
    headers.set('oai-authenticated-user-full-name', encodeURIComponent(user.name));
    headers.set('oai-authenticated-user-full-name-encoding', 'percent-encoded-utf-8');
    const response = await withVerifiedIdentity(user, () => applicationFetch(new Request(clean, { headers }), env, ctx));
    return withCookies(response, state.headers);
  };
}
