import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthClient, safeAuthReturnTo, parsePublishableKey } from '../public/auth-client.js';

const origin = 'https://funtrack.example';
const location = () => ({ origin });
const key = (domain = 'demo.clerk.accounts.dev', mode = 'test') => `pk_${mode}_${Buffer.from(domain + '$').toString('base64')}`;
const config = overrides => ({ provider: 'clerk', configured: true, environment: 'test', publishableKey: key(), ...overrides });
const response = value => ({ ok: true, json: async () => value });
const clientFor = (value, clerk, extra = {}) => createAuthClient({ location, fetchImpl: async () => response(value), loadClerk: async () => clerk, ...extra });

test('unknown configuration cannot generate a login or logout URL before loading or after a network failure', async () => {
  const client = createAuthClient({ location, fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(client.getAuthConfig(), { provider: 'unknown', configured: false, environment: 'production' });
  for (const action of ['sign-in', 'sign-out']) assert.throws(() => client.authURL(action, '/site.html#/studio/works'), { code: 'AUTH_CONFIG_UNAVAILABLE', status: 503 });
  await assert.rejects(client.ensureAuth(), { code: 'AUTH_CONFIG_UNAVAILABLE' });
  assert.equal(client.getAuthConfig().provider, 'unknown');
  for (const action of ['sign-in', 'sign-out']) assert.throws(() => client.authURL(action, '/site.html#/feed'), { code: 'AUTH_CONFIG_UNAVAILABLE' });
});

test('return paths retain local hash/query state but reject external URLs, auth loops and encoded redirects', () => {
  for (const good of ['/site.html#/studio/works/a/update', '/site.html?search=small%20game#/feed', 'https://funtrack.example/site.html#/cards']) {
    assert.equal(safeAuthReturnTo(good, origin), good.replace(origin, ''));
  }
  assert.equal(safeAuthReturnTo('#/studio/cards', origin), '/site.html#/studio/cards');
  for (const bad of [null, '//evil.example', 'https://evil.example', 'javascript:alert(1)', '/\\evil.example', '/%5cevil.example', '/%255cevil.example', '\n//evil.example', 'https://user:pass@funtrack.example/site.html', '/auth/sign-in.html', '/auth/sign-out.html', '/api/auth/config', '/signin-with-chatgpt', '/signout-with-chatgpt', '/%61uth/sign-in.html', '/%2561uth/sign-in.html', '/x/%252e%252e/auth/sign-in.html']) {
    assert.equal(safeAuthReturnTo(bad, origin), '/site.html#/feed', String(bad));
  }
});

test('publishable keys resolve a validated HTTPS hostname only', () => {
  assert.deepEqual(parsePublishableKey(key()), { origin: 'https://demo.clerk.accounts.dev', environment: 'test' });
  assert.equal(parsePublishableKey(key('accounts.funtrack.example', 'live')).environment, 'production');
  for (const domain of ['evil.example/path', 'evil.example:443', 'a@evil.example', 'evil.example?x', 'evil.example#x', 'localhost', '127.0.0.1', 'evil..example', '-evil.example', 'evil.example\\x', 'evil.example\n']) assert.throws(() => parsePublishableKey(key(domain)), { code: 'AUTH_NOT_CONFIGURED' });
  assert.throws(() => parsePublishableKey('pk_test_invalid'), { code: 'AUTH_NOT_CONFIGURED' });
});

test('Sites keeps its own URLs and does not load Clerk or issue a session token', async () => {
  let loaded = 0;
  const client = clientFor({ provider: 'sites', configured: true }, null, { loadClerk: async () => { loaded++; } });
  await client.ensureAuth();
  assert.deepEqual(await client.authHeaders(), {});
  assert.equal(client.authURL('sign-in', '/site.html#/studio/works'), '/signin-with-chatgpt?return_to=%2Fsite.html%23%2Fstudio%2Fworks');
  assert.equal(loaded, 0);
});

test('concurrent initialization is deduplicated; each API request asks the current session for its token', async () => {
  let requests = 0, loads = 0, tokens = 0;
  const clerk = { signOut: async () => {}, session: { id: 'session-a', getToken: async () => `header.payload.signature${++tokens}` } };
  const client = clientFor(config(), clerk, { fetchImpl: async (_url, options) => {
    requests++; assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error'); return response(config());
  }, loadClerk: async () => { loads++; return clerk; } });
  await Promise.all([client.ensureAuth(), client.ensureAuth(), client.authHeaders()]);
  assert.equal(requests, 1); assert.equal(loads, 1); assert.equal(tokens, 1);
  assert.deepEqual(await client.authHeaders(), { Authorization: 'Bearer header.payload.signature2' });
  assert.equal(client.authURL('sign-out', '//evil.example'), '/auth/sign-out.html?return_to=%2Fsite.html%23%2Ffeed');
  clerk.session = null;
  assert.deepEqual(await client.authHeaders(), {});
});

test('configuration and SDK failures fail closed without Sites fallback, and config can be retried', async () => {
  let loads = 0;
  const missing = clientFor(config({ configured: false, publishableKey: null }), null, { loadClerk: async () => { loads++; } });
  await assert.rejects(missing.authHeaders(), { code: 'AUTH_NOT_CONFIGURED' });
  assert.equal(missing.getAuthConfig().provider, 'clerk'); assert.equal(loads, 0);
  await assert.rejects(clientFor(config(), null, { loadClerk: async () => { throw new Error('sdk'); } }).authHeaders(), { code: 'AUTH_LOAD_FAILED' });
  let calls = 0;
  const retried = createAuthClient({ location, fetchImpl: async () => { if (++calls === 1) throw new Error('offline'); return response({ provider: 'sites', configured: true }); } });
  await assert.rejects(retried.ensureAuth(), { code: 'AUTH_CONFIG_UNAVAILABLE' });
  await retried.ensureAuth(); assert.equal(calls, 2); assert.deepEqual(await retried.authHeaders(), {});
});

test('test keys cannot be labelled production; live keys can be exercised in a labelled test deployment', async () => {
  await assert.rejects(clientFor(config({ environment: 'production' }), {}).ensureAuth(), { code: 'AUTH_NOT_CONFIGURED' });
  const live = clientFor(config({ publishableKey: key('accounts.funtrack.example', 'live') }), { signOut: async () => {} });
  assert.equal((await live.ensureAuth()).environment, 'test');
});

test('a token resolving after account change is never attached to the next request', async () => {
  let resolveToken;
  const clerk = { signOut: async () => {}, session: { id: 'first', getToken: () => new Promise(resolve => { resolveToken = resolve; }) } };
  const client = clientFor(config(), clerk);
  await client.ensureAuth();
  const request = client.authHeaders(); await Promise.resolve();
  clerk.session = { id: 'second' }; resolveToken('header.payload.signature');
  await assert.rejects(request, { code: 'AUTH_SESSION_CHANGED', status: 401 });
});

test('initialization never signs out; explicit signOut uses only a safe local redirect', async () => {
  const calls = [];
  const client = clientFor(config(), { signOut: async options => calls.push(options) });
  await client.ensureAuth(); assert.equal(calls.length, 0);
  await client.signOut({ returnTo: 'https://evil.example' });
  assert.deepEqual(calls, [{ redirectUrl: '/site.html#/feed' }]);
});
