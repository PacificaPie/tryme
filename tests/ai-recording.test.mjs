import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash, validateManifest, validateAction, validateResponse, validatePlan, cacheKey, quality } from '../experiments/ai-recording/contract.mjs';
import { Budget } from '../experiments/ai-recording/budget.mjs';
import { fileStore } from '../experiments/ai-recording/store.mjs';
import { explore } from '../experiments/ai-recording/runner.mjs';

const html = '<button type="button" id="start">Start</button>';
const manifest = { kind: 'dom', contentHash: hash(html), targets: [
  { id: 'start', selector: '#start', kind: 'button', keys: [] },
  { id: 'board', selector: '#board', kind: 'canvas', keys: ['ArrowRight'] },
] };
const click = { type: 'click', target: 'start', settleMs: 500 };
test('only the reviewed bytes can receive an action manifest', () => {
  assert.equal(validateManifest(manifest, html).contentHash, hash(html));
  assert.throws(() => validateManifest(manifest, html + ' '), /UNREVIEWED_CONTENT/);
  assert.throws(() => validateManifest({ ...manifest, targets: [{ ...manifest.targets[0], selector: 'button' }] }, html), /INVALID_MANIFEST/);
});
test('model cannot inject selectors, code, URLs, text, or extra action fields', () => {
  for (const payload of [
    { type: 'evaluate', code: 'fetch(...)' }, { type: 'navigate', url: 'https://example.com' },
    { type: 'type', target: 'start', text: 'password' }, { ...click, selector: '#pay' },
    { ...click, code: 'alert(1)' }, { ...click, target: 'unlisted' },
  ]) assert.throws(() => validateAction(payload, manifest));
});
test('coordinates, timing, and keys are bounded and fail closed', () => {
  const tap = { type: 'tap', target: 'board', x: 0.5, y: 0.5, settleMs: 500 };
  assert.deepEqual(validateAction(tap, manifest), tap);
  for (const x of [NaN, Infinity, -1, 1, '0.5']) assert.throws(() => validateAction({ ...tap, x }, manifest));
  for (const settleMs of [-1, 0, 1001, Infinity]) assert.throws(() => validateAction({ ...click, settleMs }, manifest));
  for (const key of ['Enter', 'Tab', 'Control+A', 'ArrowLeft']) assert.throws(() => validateAction({ type: 'key', target: 'board', key, settleMs: 500 }, manifest));
  assert.equal(validateAction({ type: 'key', target: 'board', key: 'ArrowRight', settleMs: 500 }, manifest).key, 'ArrowRight');
});
test('response rejects markdown, oversize JSON and model-asserted success', () => {
  for (const raw of ['```json\n{}\n```', ' '.repeat(4097), '{"done":true,"success":true}', '{"done":false}', '{"actions":[]}'])
    assert.throws(() => validateResponse(raw, manifest));
  assert.equal(validateResponse('{"done":true}', manifest), null);
  assert.deepEqual(validateResponse(JSON.stringify({ action: click }), manifest), click);
});
test('sixth action cannot be executed', () => {
  assert.equal(validatePlan(Array(5).fill(click), manifest).length, 5);
  assert.throws(() => validatePlan(Array(6).fill(click), manifest), /ACTION_LIMIT/);
});
test('policy, viewport, reviewed controls and content all invalidate cache reuse', () => {
  const viewport = { width: 960, height: 600 }, key = cacheKey(manifest, viewport);
  assert.notEqual(key, cacheKey(manifest, { width: 390, height: 844 }));
  assert.notEqual(key, cacheKey({ ...manifest, contentHash: hash('other') }, viewport));
  assert.notEqual(key, cacheKey({ ...manifest, targets: [] }, viewport));
});
test('motion alone, incomplete interactions, missing review and >8s all fall back', () => {
  const evidence = { kind: 'dom', completed: 3, actions: 3, changed: true, verified: true, durationMs: 7600, frames: 20 };
  assert.equal(quality(evidence).accepted, true);
  for (const change of [{ kind: 'opening' }, { completed: 2 }, { changed: false }, { verified: false }, { durationMs: 8001 }, { frames: 0 }])
    assert.equal(quality({ ...evidence, ...change }).accepted, false);
});
test('reservation precedes dispatch and cannot be recovered after timeout', () => {
  const budget = new Budget({ mode: 'paid', capUsd: 0.004, price: { input: 0.3, output: 2.5 } });
  const event = budget.reserve({ inputTokens: 4000, outputTokens: 512 });
  assert.equal(event.actualUsd, null);
  assert.throws(() => budget.reserve({ inputTokens: 4000, outputTokens: 512 }), /BUDGET_LIMIT/);
  assert.throws(() => budget.finish(event, null), /USAGE_UNKNOWN/);
  assert.ok(budget.reservedUsd > 0);
});
test('cost log records excess usage and stops rather than undercounting', () => {
  const budget = new Budget({ mode: 'paid', capUsd: 0.1, price: { input: 0.3, output: 2.5 } });
  const event = budget.reserve({ inputTokens: 100, outputTokens: 20 });
  assert.throws(() => budget.finish(event, { inputTokens: 101, outputTokens: 20 }), /USAGE_LIMIT/);
  assert.equal(event.status, 'over-reservation'); assert.ok(event.estimatedUsd > event.reservedUsd);
});
test('unapproved provider is refused before touching the browser', async () => {
  await assert.rejects(explore({ planner: { mode: 'paid' } }), /PAID_PROVIDER_DISABLED/);
});
test('attempt claims persist across restarts and reject concurrent duplicate exploration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tryme-store-'));
  try {
    const key = hash('content'), a = fileStore(directory), b = fileStore(directory);
    const results = await Promise.allSettled([a.claim(key, { status: 'attempted' }), b.claim(key, { status: 'attempted' })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await fileStore(directory).get(key)).status, 'attempted');
    await a.set(key, { status: 'verified', plan: [click] });
    assert.deepEqual((await b.get(key)).plan, [click]);
    await assert.rejects(a.get('../secrets'), /INVALID_CACHE_KEY/);
  } finally { await rm(directory, { recursive: true }); }
});
