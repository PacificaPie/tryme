import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { fixture, OWNER, OTHER, html } from './helpers/router-fixture.mjs';
import { createAutoCoverService, AUTO_COVER_LIMITS } from '../lib/funtrack/auto-cover-service.mjs';
import { captureDocument, captureHostedHTML } from '../lib/funtrack/auto-cover-capture.mjs';

const jpeg = new Uint8Array([255,216,255,224,1,2,3]);
const captured = () => ({ bytes: jpeg, mime: 'image/jpeg', elapsedMs: 1000 });
const service = (f, options = {}) => createAutoCoverService({ db: () => f.db, bucket: () => f.bucket, configured: () => true, capture: async () => captured(), ...options });
const currentStatus = (f, work) => f.api('/api/works/' + work.id + '/auto-cover');
const generate = (f, work, action = 'generate', extra = {}) => f.api('/api/works/' + work.id + '/auto-cover', { method: 'POST', body: { action, versionId: work.versionId }, ...extra });

test('initial hosted publication queues once; automatic metadata leaves old versions/cards and analytics untouched', async t => {
  const f = fixture(t, { autoCover: true }), key = randomUUID(), { work } = await f.publish({ key });
  const card = await f.api('/api/cards', { method: 'POST', body: { name: 'Creator', bio: '', template: 'wall', workIds: [work.id], workRefs: [{ workId: work.id, versionId: work.versionId, metadataId: work.metadataId }] } }); assert.equal(card.status, 201);
  const oldVersion = f.database.prepare('SELECT * FROM ft_work_versions WHERE id=?').get(work.versionId), oldMetadata = f.database.prepare('SELECT * FROM ft_work_metadata WHERE id=?').get(work.metadataId), oldCard = f.database.prepare('SELECT snapshot_json FROM ft_cards').get();
  assert.equal((await currentStatus(f, work)).status, 'queued'); assert.equal(f.count('ft_auto_cover_jobs'), 1);
  await f.publish({ key }); await generate(f, work); assert.equal(f.count('ft_auto_cover_jobs'), 1);
  let calls = 0; const covers = service(f, { capture: async value => { calls++; assert.equal(value, html('v1')); return captured(); } });
  assert.equal((await covers.processPending()).status, 'ready'); assert.equal(calls, 1);
  const updated = (await f.get(work.id)).work; assert.equal(updated.revision, work.revision + 1); assert.notEqual(updated.metadataId, work.metadataId); assert.match(updated.coverUrl, /^\/media\/metadata-/);
  assert.deepEqual(f.database.prepare('SELECT * FROM ft_work_versions WHERE id=?').get(work.versionId), oldVersion); assert.deepEqual(f.database.prepare('SELECT * FROM ft_work_metadata WHERE id=?').get(work.metadataId), oldMetadata); assert.deepEqual(f.database.prepare('SELECT snapshot_json FROM ft_cards').get(), oldCard);
  for (const table of ['ft_events','ft_play_sessions','ft_feed_impressions']) assert.equal(f.count(table), 0);
  assert.equal((await f.publish({ key })).work.coverUrl, '', 'original receipt remains immutable'); assert.equal(f.count('ft_auto_cover_jobs'), 1);
  assert.equal((await covers.processPending()).processed, false); assert.equal((await currentStatus(f, work)).status, 'ready');
});

test('manual covers/external works never queue and updates retain an existing cover', async t => {
  const f = fixture(t, { autoCover: true }), manual = (await f.publish({ cover: true })).work;
  const external = (await f.publish({ source: 'url', url: 'https://example.test/game' })).work;
  assert.equal((await currentStatus(f, manual)).status, 'ready'); assert.equal((await currentStatus(f, external)).reason, 'EXTERNAL_WORK'); assert.equal(f.count('ft_auto_cover_jobs'), 0);
  const updated = await f.version(manual.id); assert.equal(updated.status, 201); assert.equal(f.count('ft_auto_cover_jobs'), 0); assert.equal((await f.get(manual.id)).work.coverUrl.includes('/media/'), true);
  await generate(f, external); await generate(f, manual); assert.equal(f.count('ft_auto_cover_jobs'), 0);
});

test('existing hosted works can generate explicitly; ownership and current version remain mandatory', async t => {
  const f = fixture(t, { autoCover: true }), legacy = f.seed(), work = (await f.get(legacy.id)).work;
  assert.equal((await currentStatus(f, work)).status, 'none'); assert.equal((await generate(f, work)).status, 'queued');
  const foreign = await generate(f, work, 'generate', { owner: OTHER }); assert.equal(foreign.status, 403);
  const stale = await generate(f, { ...work, versionId: randomUUID() }); assert.equal(stale.status, 409); assert.equal(stale.error.code, 'AUTO_COVER_VERSION_CHANGED');
  const arbitrary = await f.api('/api/works/' + work.id + '/auto-cover', { method: 'POST', body: { action: 'generate', versionId: work.versionId, url: 'https://example.test' } }); assert.equal(arbitrary.status, 422);
  const result = await service(f).processPending(); assert.equal(result.status, 'ready');
});

test('an absent binding and a missing jobs table cannot block publication or version updates', async t => {
  const f = fixture(t), first = await f.publish(); assert.equal(first.status, 201); assert.equal((await currentStatus(f, first.work)).status, 'unavailable'); assert.equal(f.count('ft_auto_cover_jobs'), 0); assert.equal((await f.version(first.work.id)).status, 201);
  const old = fixture(t, { autoCover: true, through: 10 }), published = await old.publish(); assert.equal(published.status, 201); assert.equal((await currentStatus(old, published.work)).reason, 'ENQUEUE_UNAVAILABLE'); assert.equal((await old.version(published.work.id)).status, 201);
});

test('automatic-cover requests enforce a byte limit while streaming even without Content-Length', async t => {
  const f = fixture(t, {autoCover:true}), {work} = await f.publish(); let cancelled = false, pulls = 0;
  const body = new ReadableStream({pull(controller){pulls++;controller.enqueue(new TextEncoder().encode('雨'.repeat(200)));},cancel(){cancelled=true;}});
  const request = new Request('https://site.test/api/works/'+work.id+'/auto-cover',{method:'POST',body,duplex:'half'});
  await assert.rejects(service(f).handle(request,{id:OWNER}),{code:'BODY_TOO_LARGE'}); assert.equal(cancelled,true); assert(pulls<=3); assert.equal(f.count('ft_auto_cover_jobs'),1);
});

test('manual-cover write racing automatic application wins without orphan metadata or snapshot overwrite', async t => {
  const f = fixture(t, { autoCover: true }), { work } = await f.publish(), originalPut = f.bucket.put; let raced = false;
  f.bucket.put = async (key, value, options) => {
    await originalPut(key, value, options); if (raced) return; raced = true;
    const form = new FormData(); form.set('name', 'Author title'); form.set('desc', work.desc); form.set('expectedRevision', String(work.revision)); form.set('cover', new File([jpeg], 'manual.jpg', { type: 'image/jpeg' }));
    assert.equal((await f.api('/api/works/' + work.id, { method: 'PATCH', body: form })).status, 200);
  };
  assert.equal((await service(f).processPending()).status, 'skipped');
  const updated = (await f.get(work.id)).work; assert.equal(updated.name, 'Author title'); assert.equal(updated.revision, 2); assert.equal(f.count('ft_work_metadata'), 2); assert.equal(f.objects.size, 2); assert.equal(f.deleted.length, 1);
});

test('archive or version change during rendering skips automatic application', async t => {
  for (const change of ['archive', 'version']) {
    const f = fixture(t, { autoCover: true }), { work } = await f.publish();
    const covers = service(f, { capture: async () => {
      if (change === 'archive') await f.api('/api/works/' + work.id + '/archive', { method: 'POST', body: { action: 'archive', expectedRevision: work.revision } });
      else await f.version(work.id); return captured();
    } });
    assert.equal((await covers.processPending()).status, 'skipped'); assert.equal((await f.get(work.id)).work.coverUrl, '');
  }
});

test('capture failure is optional and same-version retries are explicit and capped', async t => {
  const f = fixture(t, { autoCover: true }), { work } = await f.publish(); let calls = 0;
  const covers = service(f, { capture: async () => { calls++; throw Object.assign(new Error('timed out'), { code: 'CAPTURE_TIMEOUT' }); } });
  assert.equal((await covers.processPending()).status, 'failed'); assert.equal((await currentStatus(f, work)).retryable, true);
  assert.equal((await generate(f, work)).status, 'failed'); assert.equal((await covers.processPending()).processed, false);
  await generate(f, work, 'retry'); await covers.processPending(); assert.equal(calls, 2);
  assert.equal((await currentStatus(f, work)).retryable, false); await generate(f, work, 'retry'); assert.equal((await covers.processPending()).processed, false); assert.equal(f.count('ft_auto_cover_attempts'), 2); assert.equal((await f.get(work.id)).work.revision, 1);
});

test('restoring a work makes a previously skipped cover explicitly retryable without losing attempt limits', async t => {
  const f = fixture(t, { autoCover: true }), { work } = await f.publish();
  await f.api('/api/works/' + work.id + '/archive', { method: 'POST', body: { action: 'archive', expectedRevision: 1 } });
  const covers = service(f); await covers.processPending(); assert.equal((await currentStatus(f, work)).reason, 'WORK_ARCHIVED');
  await f.api('/api/works/' + work.id + '/archive', { method: 'POST', body: { action: 'restore', expectedRevision: 2 } });
  assert.equal((await currentStatus(f, work)).retryable, true); assert.equal((await generate(f, work)).status, 'failed');
  assert.equal((await generate(f, work, 'retry')).status, 'queued'); await covers.processPending(); assert.equal((await currentStatus(f, work)).status, 'ready'); assert.equal(f.count('ft_auto_cover_attempts'), 1);
});

test('parallel workers cannot double-capture and daily/monthly reservations are hard, including failed attempts', async t => {
  const f = fixture(t, { autoCover: true }); await f.publish(); await f.publish({ bytes: html('other') });
  let calls = 0; const limit = { ...AUTO_COVER_LIMITS, dailySeconds: 90, monthlySeconds: 180 };
  let time = new Date('2026-11-17T01:00:00Z');
  const covers = service(f, { now: () => time, limits: limit, capture: async () => { calls++; return captured(); } });
  await Promise.all([covers.processPending(), covers.processPending()]); assert.equal(calls, 1); assert.equal(f.count('ft_auto_cover_attempts'), 1);
  assert.equal((await covers.processPending()).processed, false); time = new Date('2026-11-18T01:00:00Z'); await covers.processPending(); assert.equal(calls, 2);
  await f.publish({ bytes: html('third') }); time = new Date('2026-11-19T01:00:00Z'); assert.equal((await covers.processPending()).processed, false); assert.equal(calls, 2);
  time = new Date('2026-12-01T01:00:00Z'); await covers.processPending(); assert.equal(calls, 3);
});

test('a lost completion receipt keeps the committed image, while failed writes preserve the work', async t => {
  const f = fixture(t, { autoCover: true }), { work } = await f.publish();
  const covers = service(f, { capture: async () => { f.faults.afterCommit = true; return captured(); } });
  assert.equal((await covers.processPending()).status, 'ready'); assert.equal(f.objects.size, 2); assert.equal(f.deleted.length, 0); assert.equal((await f.get(work.id)).work.revision, 2);
  const another = (await f.publish({ bytes: html('put fails') })).work; f.faults.put = true;
  assert.equal((await service(f).processPending()).status, 'failed'); assert.equal((await f.get(another.id)).work.coverUrl, '');
});

test('cloud capture is opaque, denies network at launch and never drives gameplay', async () => {
  let options, content, closed = 0, preload; const events = new Map();
  const page = { async setViewport() {}, async evaluateOnNewDocument(fn) {preload=fn;}, async setRequestInterception() {}, on: (name, handler) => events.set(name, handler), async setContent(value) { content = value; }, frames: () => [{ parentFrame: () => true, evaluate: async () => true }], screenshot: async () => jpeg };
  const result = await captureHostedHTML({ fetch() {} }, html('opening'), { launch: async (_binding, opts) => { options = opts; return { newPage: async () => page, close: async () => { closed++; } }; } });
  assert.deepEqual(options, { guardrails: { allowedDomains: [] } }); assert.equal(result.mime, 'image/jpeg'); assert.equal(closed, 1);
  assert.match(content, /sandbox="allow-scripts"/); assert.doesNotMatch(content, /allow-same-origin|funtrack-game|bridge=|Clerk|\/api\/sessions/); assert.match(content, /connect-src 'none'/);
  let blocked = 0; await events.get('request')({ url: () => 'https://example.test/steal', abort: async () => { blocked++; }, continue() { assert.fail('network must be blocked'); } }); assert.equal(blocked, 1);
  assert.match(captureDocument('</iframe><script>bad()</script>'), /&lt;\/iframe&gt;/);
  const realm=vm.createContext({RTCPeerConnection:()=>{throw Error('must not call');}});vm.runInContext('('+preload.toString()+')()',realm);
  assert.equal(realm.RTCPeerConnection,undefined);assert.equal(Object.getOwnPropertyDescriptor(realm,'RTCPeerConnection').configurable,false);assert.equal(Object.getOwnPropertyDescriptor(realm,'WebTransport').writable,false);
});

test('cloud browser launch failure is reported as unavailable, not a successful placeholder', async () => {
  await assert.rejects(captureHostedHTML({ fetch() {} }, html('opening'), { launch: async () => { throw new Error('unsupported guardrail'); } }), { code: 'BROWSER_UNAVAILABLE' });
  await assert.rejects(captureHostedHTML(null, html('opening')), { code: 'BROWSER_UNAVAILABLE' });
});

test('a renderer that hangs is bounded and closes its browser', async () => {
  let closed = 0;
  const browser = { close: async () => { closed++; }, newPage: async () => new Promise(() => {}) };
  await assert.rejects(captureHostedHTML({ fetch() {} }, html('opening'), { launch: async () => browser, timeoutMs: 10 }), { code: 'CAPTURE_TIMEOUT' }); assert(closed >= 1);
});

test('script-only, hidden and zero-area documents fail instead of storing an empty success', async () => {
  const style = { display:'block', visibility:'visible', opacity:'1', backgroundColor:'rgba(0, 0, 0, 0)', backgroundImage:'none' };
  const node = (tagName, overrides={}) => ({ tagName, childNodes:[], parentElement:null, getBoundingClientRect:()=>({width:200,height:100,top:0,left:0,bottom:100,right:200}), style, ...overrides });
  for (const elements of [[node('SCRIPT')], [node('CANVAS',{style:{...style,display:'none'}})], [node('DIV',{getBoundingClientRect:()=>({width:0,height:0})})]]) {
    const body = node('BODY', {querySelectorAll:()=>elements}); let closed = 0, screenshots = 0;
    const frame = {parentFrame:()=>true,evaluate:fn=>vm.runInNewContext('('+fn.toString()+')()', {document:{body},requestAnimationFrame:fn=>fn(),innerHeight:750,innerWidth:1200,getComputedStyle:el=>el.style,Node:{TEXT_NODE:3}})};
    const page = {async setViewport(){},async evaluateOnNewDocument(){},async setRequestInterception(){},on(){},async setContent(){},frames:()=>[frame],screenshot:async()=>{screenshots++;return jpeg;}};
    await assert.rejects(captureHostedHTML({fetch(){}},html('ignored'),{launch:async()=>({newPage:async()=>page,close:async()=>{closed++;}})}),{code:'CAPTURE_EMPTY'});
    assert.equal(screenshots,0); assert.equal(closed,1);
  }
});

test('a hanging browser close cannot extend the hard capture deadline', async () => {
  const start = Date.now(); let closes = 0;
  const browser = {newPage:()=>new Promise(()=>{}),close:()=>{closes++;return new Promise(()=>{});}};
  await assert.rejects(captureHostedHTML({fetch(){}},html('opening'),{launch:async()=>browser,timeoutMs:15}),{code:'CAPTURE_TIMEOUT'});
  assert(closes>=1); assert(Date.now()-start<500);
});
