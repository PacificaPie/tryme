import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthClient, safeAuthReturnTo } from '../public/auth-client.js';
import { createWechatClient, createAuthTasks, safeWechatAuthorizationURL, activateWechatTicket, verifiedEmail, WECHAT_FINISH, ACCOUNT_FINISH } from '../public/auth/wechat-client.js';

const origin = 'https://funtrack.example';
const flowId = 'flow-id-example';
const url = 'https://open.weixin.qq.com/connect/qrconnect?appid=example&scope=snsapi_login&response_type=code&state=random#wechat_redirect';
const ok = data => ({ ok: true, json: async () => data });
const storage = () => { const values = new Map(); return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; };
function clientWith(fetchImpl, options = {}) {
  const saved = storage();
  return createWechatClient({ fetchImpl, storage: () => saved, origin: () => origin, headers: async () => ({ Authorization: 'Bearer test' }), ...options });
}
const config = overrides => ({ provider: 'clerk', configured: true, environment: 'test', publishableKey: `pk_test_${Buffer.from('demo.clerk.accounts.dev$').toString('base64')}`, ...overrides });

test('WeChat entry is enabled only by a configured Clerk boolean flag', async () => {
  for (const [value, expected] of [[undefined, false], [{ enabled: false }, false], [{ enabled: 'true' }, false], [{ enabled: true }, true]]) {
    const client = createAuthClient({ fetchImpl: async () => ok(config({ wechat: value })), loadClerk: async () => ({ signOut() {} }) });
    assert.equal((await client.ensureAuth()).wechat.enabled, expected);
  }
  const sites = createAuthClient({ fetchImpl: async () => ok({ provider: 'sites', configured: true, wechat: { enabled: true } }) });
  assert.equal((await sites.ensureAuth()).wechat.enabled, false);
});

test('provider navigation accepts only official website WeChat authorization', () => {
  assert.equal(safeWechatAuthorizationURL(url), url);
  for (const bad of [url.replace('https:', 'http:'), url.replace('open.weixin.qq.com', 'open.weixin.qq.com.evil.example'), url.replace('/connect/qrconnect', '/connect/oauth2/authorize'), url.replace('snsapi_login', 'snsapi_userinfo'), url.replace('response_type=code', 'response_type=token'), url.replace('https://', 'https://user:pass@'), 'javascript:alert(1)']) assert.throws(() => safeWechatAuthorizationURL(bad), { code: 'WECHAT_PROVIDER_UNAVAILABLE' });
  assert.equal(safeAuthReturnTo(WECHAT_FINISH, origin), '/site.html#/feed');
  assert.equal(safeAuthReturnTo(ACCOUNT_FINISH, origin), '/site.html#/feed');
});

test('flow is correlated with this tab, and explicit confirmation freezes the displayed account id', async () => {
  const requests = [];
  const client = clientWith(async (path, options) => {
    requests.push({ path, ...options });
    if (path.endsWith('/start')) return ok({ authorizationUrl: url, flowId });
    if (path.endsWith('/pending')) return ok({ pending: true, flowId, mode: 'bind' });
    if (path.endsWith('/confirm')) return ok({ linked: true });
    return ok({ cancelled: true });
  });
  assert.equal(await client.start('/site.html#/studio/works', true), url);
  assert.deepEqual(client.currentFlow(), { flowId, returnTo: '/site.html#/studio/works' });
  await client.pending();
  assert.equal(requests.some(request => request.path.endsWith('/confirm')), false, 'fetching state never binds');
  await client.confirm({ flowId, expectedUserId: 'user_seen' });
  const confirm = requests.at(-1);
  assert.deepEqual(JSON.parse(confirm.body), { confirm: true, flowId, expectedUserId: 'user_seen' });
  assert.equal(confirm.headers['X-Funtrack-CSRF'], '1');
  assert.equal(confirm.headers['Content-Type'], 'application/json');
  assert.equal(confirm.headers.Authorization, 'Bearer test');
  assert.equal(confirm.credentials, 'same-origin'); assert.equal(confirm.redirect, 'error');
  assert.throws(() => client.confirm({ flowId: 'other-tab-flow', expectedUserId: 'user_seen' }), { code: 'WECHAT_FLOW_CHANGED' });
  assert.throws(() => client.confirm({ flowId }), { code: 'WECHAT_ACCOUNT_CHANGED' });
  await client.cancel({ flowId });
  assert.equal(requests.at(-1).path, '/api/auth/wechat/cancel');
  assert.equal(requests.at(-1).headers.Authorization, undefined);
  client.forget('other-flow-id'); assert.equal(client.currentFlow().flowId, flowId);
  client.forget(flowId); assert.equal(client.currentFlow(), null);
});

test('exchange keeps the short ticket in memory and sends only the tab correlation id', async () => {
  const saved = storage(); let exchange;
  const client = clientWith(async (path, options) => {
    if (path.endsWith('/start')) return ok({ authorizationUrl: url, flowId });
    exchange = options; return ok({ ticket: 'secret-one-time-ticket', returnTo: '/site.html#/feed' });
  }, { storage: () => saved });
  await client.start('/site.html#/feed');
  const result = await client.exchange({ flowId });
  assert.equal(result.ticket, 'secret-one-time-ticket');
  assert.deepEqual(JSON.parse(exchange.body), { flowId });
  assert.equal(saved.getItem('funtrack.wechat.flow').includes('ticket'), false);
});

test('timeouts release pending work and abort ignored fetches without applying late responses', async () => {
  let expire, resolveFetch, signal;
  const tasks = createAuthTasks({ setTimer: callback => { expire = callback; return 1; }, clearTimer() {} });
  const client = clientWith((_path, options) => { signal = options.signal; return new Promise(resolve => { resolveFetch = resolve; }); }, { tasks });
  let applied = false;
  const promise = client.pending().then(() => { applied = true; });
  await Promise.resolve(); await Promise.resolve();
  expire();
  await assert.rejects(promise, { code: 'AUTH_TIMEOUT' });
  assert.equal(signal.aborted, true);
  resolveFetch(ok({ pending: true })); await Promise.resolve(); await Promise.resolve();
  assert.equal(applied, false);
  const next = tasks.run(async () => 'recovered');
  assert.equal(await next, 'recovered');
});

test('page disposal aborts pending token lookup before any authenticated request', async () => {
  let releaseToken, requested = false;
  const tasks = createAuthTasks();
  const client = clientWith(async () => { requested = true; return ok({}); }, { tasks, headers: () => new Promise(resolve => { releaseToken = resolve; }) });
  const pending = client.account(); await Promise.resolve(); await Promise.resolve();
  client.dispose(); await assert.rejects(pending, { code: 'AUTH_CANCELLED' });
  releaseToken({ Authorization: 'Bearer stale' }); await Promise.resolve(); await Promise.resolve();
  assert.equal(requested, false);
  await assert.rejects(client.account(), { code: 'AUTH_CANCELLED' });
});

function clerkFor({ resultStatus = 'complete', sessionStatus = 'active', currentTask = null, tasks = [], userId = 'user_expected' } = {}) {
  let activated = 0;
  const session = { id: 'session_new', status: sessionStatus, currentTask, tasks, user: { id: userId } };
  const clerk = { client: { sessions: [session], signIn: { create: async () => ({ status: resultStatus, createdSessionId: session.id }) } },
    async setActive({ session: id }) { activated++; assert.equal(id, session.id); clerk.session = session; clerk.user = session.user; clerk.isSignedIn = true; } };
  return { clerk, activated: () => activated };
}
test('ticket activates only the expected complete active session without pending tasks', async () => {
  const valid = clerkFor();
  assert.equal(await activateWechatTicket(valid.clerk, 'ticket', 'user_expected'), 'user_expected');
  assert.equal(valid.activated(), 1);
  for (const args of [{ resultStatus: 'needs_second_factor' }, { sessionStatus: 'pending' }, { currentTask: { key: 'choose-organization' } }, { tasks: [{ key: 'setup-mfa' }] }, { userId: 'other-user' }]) {
    const fixture = clerkFor(args);
    await assert.rejects(activateWechatTicket(fixture.clerk, 'ticket', 'user_expected'), { code: 'WECHAT_ADDITIONAL_VERIFICATION_REQUIRED' });
    assert.equal(fixture.activated(), 0);
  }
});

test('account switches and a late SDK result cannot activate a different or disposed page session', async () => {
  const fixture = clerkFor(); fixture.clerk.user = { id: 'another-user' };
  await assert.rejects(activateWechatTicket(fixture.clerk, 'ticket', 'user_expected'), { code: 'WECHAT_ACCOUNT_MISMATCH' });
  assert.equal(fixture.activated(), 0);
  const controller = new AbortController(); let resolveSDK;
  const late = clerkFor();
  late.clerk.client.signIn.create = () => new Promise(resolve => { resolveSDK = resolve; });
  const promise = activateWechatTicket(late.clerk, 'ticket', 'user_expected', { signal: controller.signal });
  controller.abort(); resolveSDK({ status: 'complete', createdSessionId: 'session_new' });
  await assert.rejects(promise, { code: 'AUTH_CANCELLED' }); assert.equal(late.activated(), 0);
  const noActivation = clerkFor(); noActivation.clerk.setActive = async () => {};
  await assert.rejects(activateWechatTicket(noActivation.clerk, 'ticket', 'user_expected'), { code: 'WECHAT_ADDITIONAL_VERIFICATION_REQUIRED' });
});

test('displayed email comes only from a verified Clerk address', () => {
  assert.equal(verifiedEmail({ user: { primaryEmailAddress: { emailAddress: 'unverified@example.com', verification: { status: 'unverified' } }, emailAddresses: [{ emailAddress: 'verified@example.com', verification: { status: 'verified' } }] } }), 'verified@example.com');
  assert.equal(verifiedEmail({ user: { emailAddresses: [{ emailAddress: 'unverified@example.com' }] } }), '');
});
