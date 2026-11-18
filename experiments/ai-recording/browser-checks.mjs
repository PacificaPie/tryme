import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchLocal, openSession, sleep } from './browser.mjs';
import { hash } from './contract.mjs';
import { runExperiment, mockPlanner } from './runner.mjs';
import { fileStore } from './store.mjs';

const local = await launchLocal(), directory = await mkdtemp(join(tmpdir(), 'tryme-security-')), passed = [];
const viewport = { width: 960, height: 600 };
const check = async (name, fn) => { await fn(); passed.push(name); console.log('PASS ' + name); };
const manifestFor = (html, targets = [{ id: 'start', selector: '#start', kind: 'button', keys: [] }]) => ({ kind: 'dom', contentHash: hash(html), targets });
let requests = 0;
const server = createServer((_, res) => { requests++; res.end('should never be reached'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}`;
try {
  await check('form, login, hidden and occluded controls are refused', async () => {
    for (const body of [
      '<form><button type="button" id="start">Play</button></form>',
      '<button type="button" id="start">Login</button>',
      '<button type="button" id="start" style="display:none">Play</button>',
      '<button type="button" id="start">Play</button><div style="position:fixed;inset:0">Overlay</div>',
      '<button type="button" id="start" form="some-form">Play</button>',
    ]) {
      const session = await openSession(local.browser, body, manifestFor(body), viewport);
      try { await assert.rejects(session.execute({ type: 'click', target: 'start', settleMs: 100 }), /TARGET_UNAVAILABLE/); }
      finally { await session.close(); }
    }
  });
  await check('HTTP, form, popup, socket, peer transport and parent access stay blocked', async () => {
    const html = `<button type="button" id="start">Play</button><script>
      start.onclick=()=>{fetch('${endpoint}/fetch').catch(()=>{});new Image().src='${endpoint}/img';
      try{navigator.sendBeacon('${endpoint}/beacon','x')}catch{};try{new WebSocket('ws://127.0.0.1:${server.address().port}/ws')}catch{};
      try{window.open('${endpoint}/popup')}catch{};
      try{parent.document.body.dataset.compromised='yes'}catch{};
      const f=document.createElement('form');f.action='${endpoint}/form';document.body.append(f);try{f.submit()}catch{};};
      </script>`;
    const session = await openSession(local.browser, html, manifestFor(html), viewport);
    try {
      await session.execute({ type: 'click', target: 'start', settleMs: 200 });
      await sleep(300);
      assert.equal(requests, 0);
      assert.equal(await session.page.evaluate(() => document.body.dataset.compromised), undefined);
      assert.equal(await session.frame.evaluate(() => typeof RTCPeerConnection), 'undefined');
      assert.equal(await session.frame.evaluate(() => typeof WebTransport), 'undefined');
      assert.equal(await session.frame.evaluate(() => typeof WebSocket), 'undefined');
      assert.equal(await session.frame.evaluate(() => { try { return localStorage.length; } catch { return 'blocked'; } }), 'blocked');
      assert.equal((await local.browser.pages()).length, 2); // launcher + this session; no popup
    } finally { await session.close(); }
  });
  await check('game monkeypatches cannot redirect the isolated-world selector checks', async () => {
    const html = '<button type="button" id="start">Play</button><script>document.querySelectorAll=()=>{throw Error("forged")};</script>';
    const session = await openSession(local.browser, html, manifestFor(html), viewport);
    try { assert.equal((await session.inspect())[0].available, true); await session.execute({ type: 'click', target: 'start', settleMs: 100 }); }
    finally { await session.close(); }
  });
  await check('navigation to another document ends the session', async () => {
    const html = '<button type="button" id="start">Play</button><script>start.onclick=()=>location.replace("about:blank")</script>';
    const session = await openSession(local.browser, html, manifestFor(html), viewport);
    try { await assert.rejects(session.execute({ type: 'click', target: 'start', settleMs: 200 })); }
    finally { await session.close(); }
  });
  await check('model timeout preserves zero actual charges and cannot retry this content', async () => {
    const html = '<button type="button" id="start">Play</button>', manifest = manifestFor(html), store = fileStore(directory);
    const args = { browser: local.browser, html, manifest, viewport, store, planner: mockPlanner([], { delayMs: 5000 }) };
    const result = await runExperiment(args);
    assert.equal(result.reason, 'MODEL_TIMEOUT'); assert.equal(result.ledger.calls.length, 1);
    assert.equal(result.ledger.modelUsdActual, 0); assert.equal(result.ledger.calls[0].status, 'failed-or-timeout');
    assert.equal((await runExperiment(args)).reason, 'EXPLORATION_ALREADY_ATTEMPTED');
  });
  await check('model code injection becomes fallback without action execution', async () => {
    const html = '<button type="button" id="start">Play now</button>';
    const result = await runExperiment({ browser: local.browser, html, manifest: manifestFor(html), viewport, store: fileStore(directory),
      planner: { mode: 'mock', next: async () => ({ text: '{"action":{"type":"evaluate","code":"fetch(...)"}}', usage: { inputTokens: 0, outputTokens: 0 } }) } });
    assert.equal(result.status, 'fallback'); assert.equal(result.reason, 'TARGET_NOT_ALLOWED');
  });
  await check('allowlisted game keys focus only the reviewed canvas', async () => {
    const html = await readFile('experiments/ai-recording/fixtures/canvas.html', 'utf8');
    const manifest = JSON.parse(await readFile('experiments/ai-recording/fixtures/canvas.json', 'utf8'));
    const session = await openSession(local.browser, html, manifest, viewport);
    try {
      await session.execute({ type: 'click', target: 'start', settleMs: 100 });
      await session.execute({ type: 'key', target: 'board', key: 'ArrowRight', settleMs: 100 });
      assert.equal(await session.evaluate(() => document.activeElement.id), 'board');
      await assert.rejects(session.execute({ type: 'key', target: 'board', key: 'Enter', settleMs: 100 }), /KEY_NOT_ALLOWED/);
    } finally { await session.close(); }
  });
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await local.close(); await rm(directory, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed, networkRequestsReceived: requests, modelCalls: 0 }));
