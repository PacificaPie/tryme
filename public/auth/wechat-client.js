import { authHeaders, safeAuthReturnTo } from '../auth-client.js';

export const WECHAT_FINISH = '/auth/wechat.html?mode=bind';
export const WECHAT_SIGN_IN_FINISH = '/auth/wechat.html?mode=sign-in';
export const ACCOUNT_FINISH = '/auth/account.html';
const FLOW_KEY = 'funtrack.wechat.flow';
const failure = (code, status = 0) => Object.assign(new Error(code), { code, status });
const flowIdOK = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);

export function safeWechatAuthorizationURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'open.weixin.qq.com' || url.port || url.username || url.password ||
        url.pathname !== '/connect/qrconnect' || url.searchParams.get('scope') !== 'snsapi_login' ||
        url.searchParams.get('response_type') !== 'code') throw new Error();
    return url.href;
  } catch { throw failure('WECHAT_PROVIDER_UNAVAILABLE'); }
}

/** A page-owned deadline also covers SDK/token promises which do not honor abort. */
export function createAuthTasks({ timeoutMs = 15000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let disposed = false;
  const active = new Set();
  return {
    get disposed() { return disposed; },
    async run(operation) {
      if (disposed) throw failure('AUTH_CANCELLED');
      const controller = new AbortController();
      let timer, rejectCancelled;
      const stop = error => { controller.abort(); rejectCancelled(error); };
      const cancelled = new Promise((_, reject) => { rejectCancelled = reject; });
      const entry = () => stop(failure('AUTH_CANCELLED'));
      active.add(entry);
      timer = setTimer(() => stop(failure('AUTH_TIMEOUT')), timeoutMs);
      try {
        return await Promise.race([Promise.resolve().then(() => {
          if (controller.signal.aborted) throw failure('AUTH_CANCELLED');
          return operation(controller.signal);
        }), cancelled]);
      } finally { clearTimer(timer); active.delete(entry); }
    },
    dispose() { disposed = true; for (const cancel of active) cancel(); active.clear(); },
  };
}

/** Only a correlation id is saved in this tab. OAuth credentials and Clerk tickets never are. */
export function createWechatClient({
  fetchImpl = (...args) => globalThis.fetch(...args), headers = authHeaders,
  origin = () => globalThis.location?.origin,
  storage = () => globalThis.sessionStorage,
  tasks = createAuthTasks(),
} = {}) {
  let memoryFlow = null;
  function currentFlow() {
    try {
      const value = JSON.parse(storage()?.getItem(FLOW_KEY) || 'null');
      if (flowIdOK(value?.flowId)) return { flowId: value.flowId, returnTo: safeAuthReturnTo(value.returnTo, origin()) };
    } catch { /* Storage can be blocked; memory still protects this page. */ }
    return memoryFlow;
  }
  function remember(value) {
    memoryFlow = value;
    try { storage()?.setItem(FLOW_KEY, JSON.stringify(value)); } catch { /* Callback will explain expiration if storage is unavailable. */ }
  }
  function forget(flowId) {
    if (currentFlow()?.flowId !== flowId) return;
    memoryFlow = null;
    try { storage()?.removeItem(FLOW_KEY); } catch { /* No credential is stored. */ }
  }
  function assertFlow(value) {
    if (!flowIdOK(value?.flowId) || value.flowId !== currentFlow()?.flowId) throw failure('WECHAT_FLOW_CHANGED', 409);
    return value;
  }
  async function request(path, { authenticated = false, body, signal } = {}) {
    const requestHeaders = authenticated ? await headers({ skipCache: true }) : {};
    if (signal?.aborted) throw failure('AUTH_CANCELLED');
    if (authenticated && !requestHeaders.Authorization) throw failure('AUTH_REQUIRED', 401);
    const response = await fetchImpl(path, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
      headers: { ...requestHeaders, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Funtrack-CSRF': '1' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (signal?.aborted) throw failure('AUTH_CANCELLED');
    if (!response.ok) throw Object.assign(failure(data?.error?.code || 'AUTH_UNAVAILABLE', response.status), { returnTo: safeAuthReturnTo(data?.returnTo, origin()) });
    return data;
  }
  const run = operation => tasks.run(operation);
  return {
    currentFlow, assertFlow, forget,
    dispose: () => tasks.dispose(),
    pending: () => run(signal => request('/api/auth/wechat/pending', { signal })),
    account: () => run(signal => request('/api/account/wechat', { authenticated: true, signal })),
    async start(returnTo, authenticated = false) {
      const safeReturn = safeAuthReturnTo(returnTo, origin());
      const data = await run(signal => request(authenticated ? '/api/account/wechat/start' : '/api/auth/wechat/start', { authenticated, body: { returnTo: safeReturn }, signal }));
      const authorizationUrl = safeWechatAuthorizationURL(data.authorizationUrl);
      if (!flowIdOK(data.flowId)) throw failure('AUTH_UNAVAILABLE');
      remember({ flowId: data.flowId, returnTo: safeReturn });
      return authorizationUrl;
    },
    exchange(snapshot) {
      assertFlow(snapshot);
      return run(signal => request('/api/auth/wechat/exchange', { body: { flowId: snapshot.flowId }, signal }));
    },
    confirm(snapshot) {
      assertFlow(snapshot);
      if (typeof snapshot.expectedUserId !== 'string' || !snapshot.expectedUserId) throw failure('WECHAT_ACCOUNT_CHANGED', 409);
      return run(signal => request('/api/account/wechat/confirm', {
        authenticated: true, body: { confirm: true, flowId: snapshot.flowId, expectedUserId: snapshot.expectedUserId }, signal,
      }));
    },
    cancel(snapshot, authenticated = false) {
      assertFlow(snapshot);
      return run(signal => request(authenticated ? '/api/account/wechat/cancel' : '/api/auth/wechat/cancel', {
        authenticated, body: { flowId: snapshot.flowId }, signal,
      }));
    },
    me: () => run(signal => request('/api/me', { authenticated: true, signal })),
  };
}

export function verifiedEmail(clerk) {
  const user = clerk?.user;
  const emails = [user?.primaryEmailAddress, ...(user?.emailAddresses || [])];
  return emails.find(email => email?.verification?.status === 'verified' && typeof email.emailAddress === 'string')?.emailAddress || '';
}

/** Ticket completion is not enough: MFA, account changes and session tasks fail closed. */
export async function activateWechatTicket(clerk, ticket, expectedUserId, { signal } = {}) {
  const alive = () => { if (signal?.aborted) throw failure('AUTH_CANCELLED'); };
  alive();
  if (!expectedUserId || typeof ticket !== 'string' || !ticket || !clerk?.client?.signIn?.create) throw failure('WECHAT_EMAIL_SIGN_IN_REQUIRED');
  if (clerk.user?.id && clerk.user.id !== expectedUserId) throw failure('WECHAT_ACCOUNT_MISMATCH');
  const result = await clerk.client.signIn.create({ strategy: 'ticket', ticket });
  alive();
  const session = clerk.client.sessions?.find(item => item.id === result.createdSessionId);
  if (result.status !== 'complete' || !result.createdSessionId || !session || session.status !== 'active' ||
      session.currentTask || session.tasks?.length || session.user?.id !== expectedUserId) throw failure('WECHAT_EMAIL_SIGN_IN_REQUIRED');
  if (clerk.user?.id && clerk.user.id !== expectedUserId) throw failure('WECHAT_ACCOUNT_MISMATCH');
  await clerk.setActive({ session: result.createdSessionId });
  alive();
  if (!clerk.isSignedIn || clerk.user?.id !== expectedUserId || clerk.session?.id !== result.createdSessionId ||
      clerk.session.status !== 'active' || clerk.session.currentTask || clerk.session.tasks?.length) throw failure('WECHAT_EMAIL_SIGN_IN_REQUIRED');
  return expectedUserId;
}
