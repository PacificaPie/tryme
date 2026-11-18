import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { createClerkClient } from '@clerk/backend';
import { createStandaloneHandler, standaloneAuthConfig } from '../lib/funtrack/standalone-auth.mjs';

const origin = 'https://funtrack.example';
const frontend = 'https://clerk.funtrack.example';
const key = (mode = 'live') => `pk_${mode}_${Buffer.from('clerk.funtrack.example$').toString('base64')}`;
const env = { APP_ORIGIN: origin, CLERK_PUBLISHABLE_KEY: key(), CLERK_SECRET_KEY: 'sk_live_unit_test_not_a_credential' };
const verifiedEmail = { id: 'email_1', emailAddress: 'creator@example.com', verification: { status: 'verified' } };
const profile = { id: 'user_one', primaryEmailAddressId: 'email_1', emailAddresses: [verifiedEmail], firstName: '测试', lastName: '作者' };
const signedIn = () => ({ status: 'signed-in', isAuthenticated: true, tokenType: 'session_token', headers: new Headers(), toAuth: () => ({ userId: 'user_one', sessionId: 'sess_one' }) });
const signedOut = () => ({ status: 'signed-out', isAuthenticated: false, tokenType: 'session_token', headers: new Headers(), toAuth: () => null });
const request = (path = '/api/me', init = {}) => new Request(origin + path, init);
function fixture({ state = signedIn(), user = profile, authError, profileError } = {}) {
  const calls = { app: [], auth: [], profile: [], client: [] };
  const handler = createStandaloneHandler({
    fetch: async (req, bindings, ctx) => { calls.app.push({ request: req, bindings, ctx }); return new Response('application'); },
    createClerkClient(options) {
      calls.client.push(options);
      return {
        async authenticateRequest(req, options) { calls.auth.push({ request: req, options }); if (authError) throw authError; return state; },
        users: { async getUser(id) { calls.profile.push(id); if (profileError) throw profileError; return user; } },
      };
    },
  });
  return { handler, calls };
}
async function errorCode(response, expectedStatus, expectedCode) {
  assert.equal(response.status, expectedStatus);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal((await response.json()).error.code, expectedCode);
}

test('configuration fails closed for missing/mismatched keys and unsafe origin; remote test mode is explicit', () => {
  assert.equal(standaloneAuthConfig({}).configured, false);
  for (const APP_ORIGIN of ['https://funtrack.example/path', origin + '/', 'http://funtrack.example', 'https://user:password@funtrack.example', '*', 'null']) {
    assert.equal(standaloneAuthConfig({ ...env, APP_ORIGIN }).configured, false);
  }
  assert.equal(standaloneAuthConfig({ ...env, CLERK_PUBLISHABLE_KEY: 'pk_live_nonsense' }).configured, false);
  assert.equal(standaloneAuthConfig({ ...env, CLERK_SECRET_KEY: 'sk_test_fixture' }).configured, false);
  const testKeys = { ...env, CLERK_PUBLISHABLE_KEY: key('test'), CLERK_SECRET_KEY: 'sk_test_fixture' };
  assert.equal(standaloneAuthConfig(testKeys).configured, false);
  assert.equal(standaloneAuthConfig({ ...testKeys, CLERK_TEST_MODE: 'true' }).configured, false);
  assert.equal(standaloneAuthConfig({ ...testKeys, CLERK_TEST_MODE: '1' }).environment, 'test');
  assert.equal(standaloneAuthConfig({ ...testKeys, CLERK_TEST_MODE: '1' }).configured, true);
  assert.equal(standaloneAuthConfig({ ...testKeys, APP_ORIGIN: 'http://localhost:8766' }).configured, true);
  assert.equal(standaloneAuthConfig({ ...testKeys, APP_ORIGIN: 'http://[::1]:8766' }).configured, true);
  assert.equal(standaloneAuthConfig(env).environment, 'production');
});

test('anonymous config is no-store, contains only public settings, and does not create a Clerk client', async () => {
  const { handler, calls } = fixture();
  const configured = await handler(request('/api/auth/config'), env);
  assert.equal(configured.status, 200);assert.match(configured.headers.get('cache-control'), /no-store/);
  assert.deepEqual(await configured.json(), { provider: 'clerk', configured: true, publishableKey: key(), signInPath: '/auth/sign-in.html', signOutPath: '/auth/sign-out.html', environment: 'production', wechat: { enabled: false } });
  const unconfigured = await (await handler(request('/api/auth/config'), {})).json();
  assert.equal(unconfigured.configured, false);assert.equal(unconfigured.publishableKey, null);assert.equal(unconfigured.error.code, 'AUTH_NOT_CONFIGURED');
  assert.equal(unconfigured.error.message, '登录暂不可用，请稍后再试或联系站点管理员。');
  assert(!JSON.stringify(unconfigured).includes('APP_ORIGIN'));
  assert(!JSON.stringify(unconfigured).includes('CLERK_SECRET_KEY'));
  assert(!JSON.stringify(unconfigured).includes('sk_'));
  assert.equal(calls.client.length, 0);assert.equal(calls.app.length, 0);
  await errorCode(await handler(request('/api/auth/config', { method: 'POST' }), env), 405, 'METHOD_NOT_ALLOWED');
});

test('forged Sites/Clerk identity headers never authenticate an unsigned request', async () => {
  const { handler, calls } = fixture({ state: signedOut() });
  const req = request('/api/me', { headers: {
    'OAI-Authenticated-User-ID': 'owner', 'oai-authenticated-user-email': 'owner@example.com',
    'oai-authenticated-other': 'forged', 'x-clerk-auth-user-id': 'user_owner',
    'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https', forwarded: 'host=evil.example',
  } });
  await errorCode(await handler(req, env), 401, 'AUTH_REQUIRED');
  assert.equal(calls.app.length, 0);assert.equal(calls.profile.length, 0);
  assert.equal(req.headers.get('oai-authenticated-user-id'), 'owner');
  for (const name of calls.auth[0].request.headers.keys()) assert(!/^(?:oai-authenticated-|x-clerk-|x-forwarded-|forwarded$)/.test(name));
});

test('missing configuration and wrong request origin cannot fall back to injected Sites identity', async () => {
  const { handler, calls } = fixture();
  for (const path of ['/api/me', '/api/works', '/game/version', '/media/cover']) {
    await errorCode(await handler(request(path, { headers: { 'oai-authenticated-user-id': 'owner', 'oai-authenticated-user-email': 'owner@example.com' } }), {}), 503, 'AUTH_NOT_CONFIGURED');
  }
  await errorCode(await handler(new Request('https://other.example/api/me'), env), 403, 'AUTH_ORIGIN_MISMATCH');
  assert.equal(calls.client.length, 0);assert.equal(calls.app.length, 0);
});

test('static pages and independently authenticated build-worker routes pass through with spoofed headers removed', async () => {
  const { handler, calls } = fixture();
  for (const path of ['/site.html', '/auth/sign-in.html', '/site.js', '/api/build-worker/heartbeat']) {
    const req = request(path, { headers: { 'oai-authenticated-user-id': 'owner', Authorization: 'Bearer worker-fixture' } });
    assert.equal((await handler(req, {})).status, 200);
    const passed = calls.app.at(-1).request;
    assert.equal(passed.headers.get('oai-authenticated-user-id'), null);
    assert.equal(passed.headers.get('authorization'), 'Bearer worker-fixture');
  }
  assert.equal(calls.client.length, 0);
});

test('public card allowlist bypasses Clerk only for scoped read routes and still strips forged identities',async()=>{
  const {handler,calls}=fixture({state:signedOut()}),id='00000000-0000-4000-8000-000000000001';
  for(const path of ['/c/'+id,'/api/public/cards/'+id,'/api/public/cards/'+id+'/works/work-1234/cover'])for(const method of ['GET','HEAD']){
    const res=await handler(request(path,{method,headers:{'oai-authenticated-user-id':'forged-owner','oai-authenticated-user-email':'secret@example.test','x-clerk-auth-user-id':'user_forged'}}),{});
    assert.equal(res.status,200,path);const passed=calls.app.at(-1).request;
    assert.equal(passed.headers.get('oai-authenticated-user-id'),null);assert.equal(passed.headers.get('x-clerk-auth-user-id'),null);
  }
  assert.equal(calls.client.length,0);
  for(const path of ['/api/public/cards','/api/public/cards/me','/api/public/cards/'+id+'/works/work-1234/game','/api/public/cards/'+id+'/sessions','/api/public/cards/'+id+'/events','/api/public/cards/'+id+'/works/work-1234/cover/extra','/api/analytics','/api/cards/me','/game/version'])await errorCode(await handler(request(path),env),401,'AUTH_REQUIRED');
  for(const method of ['POST','PATCH','DELETE'])await errorCode(await handler(request('/api/public/cards/'+id,{method}),env),401,'AUTH_REQUIRED');
});

test('public avatar allowlist exposes only immutable image GET/HEAD and strips identity headers',async()=>{
  const {handler,calls}=fixture({state:signedOut()}),path='/api/public/avatars/00000000-0000-4000-8000-000000000001';
  for(const method of ['GET','HEAD']){
    assert.equal((await handler(request(path,{method,headers:{'oai-authenticated-user-id':'forged-owner'}}),{})).status,200);
    assert.equal(calls.app.at(-1).request.headers.get('oai-authenticated-user-id'),null);
  }
  assert.equal(calls.client.length,0);
  for(const path of ['/api/public/avatars','/api/public/avatars/me','/api/public/avatars/00000000-0000-4000-8000-000000000001/extra'])await errorCode(await handler(request(path),env),401,'AUTH_REQUIRED');
  for(const method of ['POST','PATCH','DELETE'])await errorCode(await handler(request(path,{method}),env),401,'AUTH_REQUIRED');
});

test('verified cookie or Bearer identities are subject-prefixed, request-scoped, and preserve upload bodies', async () => {
  for (const headers of [{ Authorization: 'Bearer session-fixture' }, { Cookie: '__session=session-fixture; __client_uat=1' }]) {
    const { handler, calls } = fixture();
    const req = request('/api/works', { method: 'POST', headers: { ...headers, 'oai-authenticated-user-id': 'other-owner', 'oai-authenticated-user-email': 'wrong@example.com' }, body: 'multipart-placeholder' });
    assert.equal((await handler(req, env, { waitUntil() {} })).status, 200);
    assert.deepEqual(calls.auth[0].options.authorizedParties, [origin]);assert.equal(calls.auth[0].options.acceptsToken, 'session_token');
    assert.deepEqual(calls.profile, ['user_one']);
    const passed = calls.app[0].request;
    assert.equal(passed.headers.get('oai-authenticated-user-id'), 'clerk:user_one');
    assert.equal(passed.headers.get('oai-authenticated-user-email'), 'creator@example.com');
    assert.equal(decodeURIComponent(passed.headers.get('oai-authenticated-user-full-name')), '测试 作者');
    assert.equal(passed.headers.get('oai-authenticated-user-full-name-encoding'), 'percent-encoded-utf-8');
    assert.equal(await passed.text(), 'multipart-placeholder');
    assert.equal(req.headers.get('oai-authenticated-user-id'), 'other-owner');
  }
});

test('an email match never aliases a new Clerk subject to an old Sites owner', async () => {
  const state = signedIn();state.toAuth = () => ({ userId: 'user_two', sessionId: 'sess_two' });
  const { handler, calls } = fixture({ state, user: { ...profile, id: 'user_two' } });
  await handler(request(), env);
  assert.equal(calls.app[0].request.headers.get('oai-authenticated-user-id'), 'clerk:user_two');
});

test('multipart HTML uploads survive the authentication boundary byte-for-byte', async () => {
  const { handler, calls } = fixture();
  const html = new TextEncoder().encode('<!doctype html><html>测试游戏</html>');
  const form = new FormData();form.set('name', '测试');form.set('file', new File([html], 'game.html', { type: 'text/html' }));
  const req = request('/api/works', { method: 'POST', headers: { Authorization: 'Bearer session-fixture', Origin: origin, 'X-Funtrack-CSRF': '1', 'Idempotency-Key': 'upload-1' }, body: form });
  await handler(req, env);
  const passed = calls.app[0].request;
  assert.equal(passed.headers.get('idempotency-key'), 'upload-1');assert.equal(passed.headers.get('origin'), origin);
  const received = await passed.formData();assert.equal(received.get('name'), '测试');
  assert.deepEqual(new Uint8Array(await received.get('file').arrayBuffer()), html);
});

test('pending sessions, machine tokens, mismatched users and disabled profiles cannot reach application', async () => {
  const pending = signedIn();pending.toAuth = () => ({ userId: null, sessionId: null });
  for (const item of [
    { state: pending }, { state: { ...signedIn(), tokenType: 'api_key' } },
    { user: { ...profile, id: 'user_other' } }, { user: { ...profile, banned: true } },
    { user: { ...profile, locked: true } }, { user: { ...profile, deprovisioned: true } },
  ]) {
    const { handler, calls } = fixture(item);
    await errorCode(await handler(request(), env), 401, 'AUTH_REQUIRED');assert.equal(calls.app.length, 0);
  }
});

test('unverified email cannot become trusted identity; verified secondary email is accepted', async () => {
  const unverified = { ...verifiedEmail, verification: { status: 'unverified' } };
  const denied = fixture({ user: { ...profile, emailAddresses: [unverified] } });
  await errorCode(await denied.handler(request(), env), 403, 'EMAIL_VERIFICATION_REQUIRED');assert.equal(denied.calls.app.length, 0);
  const allowed = fixture({ user: { ...profile, emailAddresses: [unverified, { ...verifiedEmail, id: 'email_2', emailAddress: 'verified@example.com' }] } });
  await allowed.handler(request(), env);
  assert.equal(allowed.calls.app[0].request.headers.get('oai-authenticated-user-email'), 'verified@example.com');
});

test('upstream authentication/profile failures remain closed and never expose provider details', async () => {
  for (const item of [{ authError: new Error('sensitive provider detail') }, { profileError: new Error('sensitive provider detail') }]) {
    const { handler, calls } = fixture(item);
    const response = await handler(request(), env);assert.equal(response.status, 503);
    const body = await response.text();assert(body.includes('AUTH_UNAVAILABLE'));assert(!body.includes('sensitive'));
    assert.equal(calls.app.length, 0);
  }
});

test('game document handshake redirects without authentication, and API requests never redirect uploads', async () => {
  const state = { ...signedOut(), status: 'handshake', headers: new Headers({ Location: frontend + '/v1/client/handshake?redirect_url=' + encodeURIComponent(origin + '/game/v1') }) };
  state.headers.append('Set-Cookie', '__clerk_handshake_nonce=fixture; Secure; HttpOnly');
  const { handler, calls } = fixture({ state });
  const game = await handler(request('/game/v1', { headers: { 'Sec-Fetch-Dest': 'iframe' } }), env);
  assert.equal(game.status, 307);assert(game.headers.get('location').startsWith(frontend));assert(game.headers.get('set-cookie').includes('__clerk_handshake_nonce'));
  await errorCode(await handler(request('/api/works', { method: 'POST', body: 'private upload' }), env), 401, 'AUTH_SESSION_REFRESH_REQUIRED');
  await errorCode(await handler(request('/api/me'), env), 401, 'AUTH_SESSION_REFRESH_REQUIRED');
  assert.equal(calls.app.length, 0);assert.equal(calls.profile.length, 0);
});

test('handshake only allows configured Clerk/app origins and preserves separate cookies on return', async () => {
  for (const location of [undefined, 'https://evil.example/steal', 'javascript:alert(1)']) {
    const state = { ...signedOut(), status: 'handshake', headers: new Headers(location ? { Location: location } : {}) };
    const { handler, calls } = fixture({ state });
    await errorCode(await handler(request('/game/v1'), env), 503, 'AUTH_UNAVAILABLE');assert.equal(calls.app.length, 0);
  }
  const state = signedIn();state.headers.append('Set-Cookie', '__session=new; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Secure');state.headers.append('Set-Cookie', '__clerk_handshake=; Max-Age=0; Secure');
  const { handler } = fixture({ state });const response = await handler(request('/media/v1'), env);
  assert.equal(response.status, 200);assert.equal(response.headers.getSetCookie().length, 2);assert.match(response.headers.get('cache-control'), /no-store/);
  const cleanup = { ...state, headers: new Headers({ Location: origin + '/game/v1' }) };
  assert.equal((await fixture({ state: cleanup }).handler(request('/game/v1?__clerk_handshake_nonce=fixture'), env)).status, 307);
});

// Exercise the actual installed Clerk verifier without a Clerk account/network:
// an ephemeral RSA key verifies local session JWTs; only profile lookup is stubbed.
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwtKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
function jwt(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'unit', cat: 'cl_B7d4PD111AAA' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: 'user_one', sid: 'sess_one', iss: frontend, azp: origin, iat: now - 5, nbf: now - 5, exp: now + 60, ...overrides })).toString('base64url');
  const input = head + '.' + payload;
  return input + '.' + createSign('RSA-SHA256').update(input).sign(pair.privateKey).toString('base64url');
}
test('actual Clerk verification accepts a signed session but rejects expired, future and wrong-party tokens', async () => {
  let applications = 0, profiles = 0, verification;
  const handler = createStandaloneHandler({
    fetch: async req => { applications++;assert.equal(req.headers.get('oai-authenticated-user-id'), 'clerk:user_one');return new Response('ok'); },
    createClerkClient(options) {
      const sdk = createClerkClient({ ...options, jwtKey });
      return { authenticateRequest: async (...args) => { const state = await sdk.authenticateRequest(...args);verification = { status: state.status, reason: state.reason, message: state.message };return state; }, users: { getUser: async () => { profiles++;return profile; } } };
    },
  });
  assert.equal((await handler(request('/api/me', { headers: { Authorization: 'Bearer ' + jwt() } }), env)).status, 200, JSON.stringify(verification));
  const cookie = `__session=${jwt()}; __client_uat=${Math.floor(Date.now() / 1000) - 60}`;
  assert.equal((await handler(request('/media/cover', { headers: { Cookie: cookie } }), env)).status, 200, JSON.stringify(verification));
  for (const claims of [{ exp: Math.floor(Date.now() / 1000) - 60 }, { nbf: Math.floor(Date.now() / 1000) + 60 }, { azp: 'https://evil.example' }]) {
    await errorCode(await handler(request('/api/me', { headers: { Authorization: 'Bearer ' + jwt(claims), 'oai-authenticated-user-id': 'owner' } }), env), 401, 'AUTH_REQUIRED');
  }
  const token = jwt(), parts = token.split('.');parts[1] = Buffer.from(JSON.stringify({ sub: 'user_owner', exp: 9999999999 })).toString('base64url');
  await errorCode(await handler(request('/api/me', { headers: { Authorization: 'Bearer ' + parts.join('.') } }), env), 401, 'AUTH_REQUIRED');
  assert.equal(applications, 2);assert.equal(profiles, 2);
});
