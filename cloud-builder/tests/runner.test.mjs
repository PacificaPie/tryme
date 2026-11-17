import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { childEnvironment, validatePrepareInput, verifyBuildNetwork, BuildEngine } from '../runner/build.mjs';
import { createBuildServer } from '../runner/server.mjs';

const sha = '1f76427453c48f6f0a02d09a12e0469451c0d1e3';
const token = 'a'.repeat(64);

test('repository input is fixed SHA only and cannot inject URLs or workspace paths', () => {
  assert.deepEqual(validatePrepareInput({ repository: 'yuss-raa/Snake-Game', commitSha: sha }), { repository: 'yuss-raa/Snake-Game', commitSha: sha });
  for (const input of [null, [], { repository: 'https://github.com/yuss-raa/Snake-Game', commitSha: sha }, { repository: 'owner/../repo', commitSha: sha }, { repository: 'owner/repo', commitSha: 'main' }, { repository: 'owner/repo', commitSha: sha, directory: '/app' }]) assert.throws(() => validatePrepareInput(input));
});

test('child environment is an explicit allowlist and never inherits platform/control secrets', () => {
  const env = childEnvironment(true);
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'LANG', 'NODE_EXTRA_CA_CERTS', 'PATH', 'TMPDIR', 'npm_config_cache', 'npm_config_update_notifier'].sort());
  for (const key of ['FUNTRACK_CONTAINER_CONTROL_TOKEN', 'FUNTRACK_BUILD_RUNNER_TOKEN', 'CLERK_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED']) assert.equal(env[key], undefined);
  assert.equal(env.NODE_EXTRA_CA_CERTS, '/etc/cloudflare/certs/cloudflare-containers-ca.crt');
  assert.equal(childEnvironment(false).NODE_EXTRA_CA_CERTS, undefined);
});

test('build cannot skip preparation or consume another job', async () => {
  const engine = new BuildEngine();
  await assert.rejects(engine.build(), { code: 'BUILD_STATE_CHANGED' });
  await assert.rejects(engine.prepare({ repository: '../bad', commitSha: sha }), { code: 'INVALID_REPOSITORY' });
  assert.equal(engine.phase, 'idle');
  engine.phase = 'prepared';
  await assert.rejects(engine.prepare({ repository: 'owner/repo', commitSha: sha }), { code: 'BUILD_STATE_CHANGED' });
});

test('network guard requires the trusted deny marker or reports an unreachable network', async () => {
  const job = { repository: 'owner/repo', commitSha: sha };
  const denied = await verifyBuildNetwork(job, { fetchImpl: async () => new Response('denied', { status: 403, headers: { 'X-Funtrack-Egress': 'denied' } }) });
  assert.deepEqual(denied.map(value => value.evidence), ['cloudflare-deny', 'cloudflare-deny']);
  const unreachable = await verifyBuildNetwork(job, { fetchImpl: async () => { throw Error('network unavailable'); } });
  assert.deepEqual(unreachable.map(value => value.evidence), ['network-unreachable', 'network-unreachable']);
  for (const status of [200, 302, 403, 404, 500]) await assert.rejects(verifyBuildNetwork(job, { fetchImpl: async () => new Response('', { status }) }), { code: 'ISOLATION_FAILED' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(verifyBuildNetwork(job, { signal: controller.signal, fetchImpl: async () => { throw Error('cancelled'); } }), { code: 'BUILD_TIMEOUT' });
});

test('control endpoints require the per-container token and expose no token in health/errors', async t => {
  let calls = 0;
  const engine = { phase: 'idle', prepare: async () => { calls++; return { prepared: true }; }, build: async () => { calls++; return { metadata: {} }; } };
  const { server } = createBuildServer({ token, engine });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(origin + '/health'); assert.equal(health.status, 200); assert.ok(!(await health.text()).includes(token));
  for (const route of ['/prepare', '/build', '/artifact']) {
    const response = await fetch(origin + route, { method: route === '/artifact' ? 'GET' : 'POST', headers: { Authorization: 'Bearer wrong', 'Content-Type': 'application/json' }, ...(route === '/artifact' ? {} : { body: '{}' }) });
    assert.equal(response.status, 401);
  }
  assert.equal(calls, 0);
  const artifact = await fetch(origin + '/artifact', { headers: { Authorization: 'Bearer ' + token } }); assert.equal(artifact.status, 409);
  const valid = await fetch(origin + '/prepare', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ repository: 'owner/repo', commitSha: sha }) });
  assert.equal(valid.status, 200); assert.equal(calls, 1);
});

test('control bodies are bounded, JSON-only, and build accepts no arbitrary commands', async t => {
  let calls = 0;
  const engine = { phase: 'prepared', build: async () => { calls++; return {}; } };
  const { server } = createBuildServer({ token, engine }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  for (const [body, status] of [['{"command":"id"}', 422], ['null', 422], ['[]', 422], ['{', 400], [JSON.stringify({ padding: 'x'.repeat(17000) }), 413]]) {
    const response = await fetch(origin + '/build', { method: 'POST', headers, body }); assert.equal(response.status, status);
  }
  const wrongType = await fetch(origin + '/build', { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' }); assert.equal(wrongType.status, 415);
  assert.equal(calls, 0);
});
