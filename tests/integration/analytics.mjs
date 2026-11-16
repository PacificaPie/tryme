// HTTP checks against one real local D1/R2 Worker. No server startup, SQL seeds,
// synthetic historical dates, or production writes are performed by this file.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { versions } from './fixtures/version-games.mjs';

const base = new URL(process.env.FUNTRACK_TEST_URL || 'http://127.0.0.1:8767');
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Analytics fixtures only run on loopback.');
assert(!base.username && !base.password && base.pathname === '/', 'Use a bare local origin.');
const run = randomUUID(), owner = `analytics_owner_${run}`, readerA = `analytics_reader_a_${run}`, readerB = `analytics_reader_b_${run}`, emptyOwner = `analytics_empty_${run}`;
const today = new Date().toISOString().slice(0, 10);
const dateShift = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const monday = date => { const day = new Date(date + 'T00:00:00Z').getUTCDay(); return dateShift(date, -(day + 6) % 7); };
const report = { run, base: base.origin, owner, readers: [readerA, readerB], today, checks: [], ids: {}, startedAt: new Date().toISOString() };
async function request(path, { method = 'GET', user = owner, json, form, headers = {} } = {}) {
  const response = await fetch(new URL(path, base), {
    method, redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { ...(user ? { 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@sites.test` } : {}), ...(method === 'POST' ? { Origin: base.origin, 'X-Funtrack-CSRF': '1' } : {}), ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: form || (json !== undefined ? JSON.stringify(json) : undefined),
  });
  const raw = await response.text(); let body = raw; try { body = JSON.parse(raw); } catch {}
  return { status: response.status, body };
}
function ok(response, status = 200) { assert.equal(response.status, status, `Expected ${status}, got ${response.status}: ${JSON.stringify(response.body).slice(0, 1200)}`); return response.body; }
function rejected(response, statuses) { assert(statuses.includes(response.status), `Expected ${statuses}, got ${response.status}: ${JSON.stringify(response.body).slice(0, 1200)}`); }
async function check(name, fn) {
  try { await fn(); report.checks.push(name); console.log(`PASS ${name}`); }
  catch (error) { report.failure = { check: name, message: error.message }; throw error; }
}
const analytics = async (params = {}, user = owner) => ok(await request('/api/analytics?' + new URLSearchParams(params), { user }));
const post = (path, json, user = owner, headers = {}) => request(path, { method: 'POST', json, user, headers });
async function createWork(name, source = 'html', user = owner) {
  const form = new FormData(); form.set('name', name); form.set('desc', 'Local analytics contract verification.'); form.set('source', source);
  if (source === 'html') form.set('file', new File([versions[0].html], 'fixture.html', { type: 'text/html' })); else form.set('url', 'https://example.com/analytics-fixture');
  return ok(await request('/api/works', { method: 'POST', user, form, headers: { 'Idempotency-Key': randomUUID() } }), 201).work;
}
function expectMetrics(actual, expected, label = 'metrics') {
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === 'number' && !Number.isInteger(value)) assert(Math.abs(actual[key] - value) < 1e-8, `${label}.${key}: expected ${value}, got ${actual[key]}`);
    else assert.equal(actual[key], value, `${label}.${key}`);
  }
}
function invariant(data) {
  assert(data.funnel.started <= data.funnel.opened && data.funnel.opened <= data.funnel.visitors, 'Funnel must remain nested.');
  assert.equal(data.meta.timezone, 'UTC');
  if (data.summary.starts !== null) {
    assert.equal(data.coverage.durationSamples + data.coverage.unknownDurationEnds, data.coverage.endedStarts);
    assert.equal(data.coverage.endedStarts + data.coverage.unendedStarts, data.summary.starts);
  }
  for (const metrics of [data.summary, data.previous, ...data.series, ...data.byWork]) {
    if (metrics.durationSamples === 0 || metrics.durationSamples === null) { assert.equal(metrics.totalActiveMs, null); assert.equal(metrics.avgActiveMs, null); }
    else assert.equal(metrics.avgActiveMs, metrics.totalActiveMs / metrics.durationSamples);
  }
}
async function emit(type, work, user, id = randomUUID()) {
  const body = { eventId: id, type, workId: work.id, versionId: work.versionId };
  return { body, response: ok(await post('/api/events', body, user)) };
}
async function play(work, user, { started = true, complete = false, activeMs, legacy = false, openOnly = false } = {}) {
  const session = ok(await post('/api/sessions', { workId: work.id, versionId: work.versionId }, user), 201);
  const events = []; let seq = 0;
  if (started) events.push({ id: randomUUID(), type: 'play_start', seq: ++seq, elapsedMs: 1000 });
  if (complete) events.push({ id: randomUUID(), type: 'game_complete', seq: ++seq, elapsedMs: 9000, result: { score: -3, label: 'Reported complete; this does not mean winning.' } });
  if (!openOnly) events.push({ id: randomUUID(), type: 'session_end', seq: ++seq, elapsedMs: 12000, ...(legacy || activeMs === undefined ? {} : { result: { timingVersion: 1, activeMs } }) });
  const payload = { token: session.token, events };
  if (events.length) { const accepted = ok(await post(`/api/sessions/${session.id}/events`, payload, user)); assert.equal(accepted.accepted.length, events.length); }
  return { id: session.id, user, payload, workId: work.id, versionId: work.versionId };
}
const allExpected = { pv: 6, uv: 3, opens: 6, players: 3, starts: 5, completions: 2, totalActiveMs: 8000, avgActiveMs: 8000 / 3, durationSamples: 3, endedStarts: 4, comments: 3, likes: 3, outboundClicks: 2, returningPlayers: 0, views: 6, feedback: 2, ends: 5, cardViews: 2 };
const excludedExpected = { pv: 5, uv: 2, opens: 4, players: 2, starts: 4, completions: 1, totalActiveMs: 6000, avgActiveMs: 3000, durationSamples: 2, endedStarts: 3, comments: 2, likes: 2, outboundClicks: 1, returningPlayers: 0, feedback: 1, ends: 3, cardViews: 1 };
let a, b, external, foreign, aV2, measured, legacy, card, eventRetry;

try {
  await check('local identity headers survive and unauthenticated analytics is rejected', async () => {
    rejected(await request('/api/analytics', { user: null }), [401]);
    assert.equal(ok(await request('/api/me')).user.id, owner, 'Use a compiled local Worker; dev mock auth can replace test identities.');
    a = await createWork(`Analytics A ${run}`); b = await createWork(`Analytics B ${run}`); external = await createWork(`Analytics external ${run}`, 'url'); foreign = await createWork(`Foreign analytics ${run}`, 'html', readerB);
    Object.assign(report.ids, { workA: a.id, workB: b.id, external: external.id, foreign: foreign.id, aV1: a.versionId });
    assert.equal(ok(await request('/api/works?mine=1')).works.length, 3);
  });
  await check('empty scopes keep unknown duration null and retain zero-activity works', async () => {
    const empty = await analytics({}, emptyOwner); invariant(empty);
    expectMetrics(empty.summary, { pv: 0, uv: 0, starts: 0, completions: 0, totalActiveMs: null, avgActiveMs: null, durationSamples: 0 }); assert.deepEqual(empty.byWork, []); assert.deepEqual(empty.versions, []); assert.equal(empty.coverage.durationCoverage, null);
    const mine = await analytics(); invariant(mine); assert.equal(mine.byWork.length, 3); assert(mine.byWork.every(work => work.pv === 0)); assert.equal(mine.summary.totalActiveMs, null);
  });
  await check('real views, sessions, timed ends, legacy ends and owner activity persist', async () => {
    eventRetry = await emit('work_view', a, readerA); await emit('work_view', a, readerA); await emit('work_view', b, readerA); await emit('work_view', b, readerB); await emit('work_view', a, owner); await emit('work_view', external, readerB);
    const duplicate = ok(await post('/api/events', eventRetry.body, readerA)); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.receipt.id, eventRetry.response.receipt.id);
    measured = await play(a, readerA, { complete: true, activeMs: 6000 }); legacy = await play(a, readerB, { legacy: true }); await play(b, readerA, { openOnly: true }); await play(a, owner, { complete: true, activeMs: 2000 }); await play(b, owner, { started: false, legacy: true });
    const form = new FormData(); form.set('expectedRevision', String(a.revision)); form.set('releaseNotes', 'Analytics second version.'); form.set('file', new File([versions[1].html], 'fixture.html', { type: 'text/html' }));
    const published = ok(await request(`/api/works/${a.id}/versions`, { method: 'POST', form, headers: { 'Idempotency-Key': randomUUID() } }), 201); aV2 = { ...a, versionId: published.version.id }; report.ids.aV2 = aV2.versionId;
    await play(aV2, readerB, { activeMs: 0 });
    Object.assign(report.ids, { measuredSession: measured.id, legacySession: legacy.id });
  });
  await check('social, feedback, outbound and card activity have identifiable actors', async () => {
    for (const [work, user] of [[a, owner], [a, readerA], [external, readerB]]) ok(await post(`/api/works/${work.id}/like`, { liked: true }, user));
    const comment = ok(await post(`/api/works/${a.id}/comments`, { body: 'Reader root.' }, readerA, { 'Idempotency-Key': randomUUID() }), 201).comment;
    ok(await post(`/api/works/${a.id}/comments`, { body: 'Creator reply.', parentId: comment.id }, owner, { 'Idempotency-Key': randomUUID() }), 201);
    ok(await post(`/api/works/${b.id}/comments`, { body: 'Second reader root.' }, readerB, { 'Idempotency-Key': randomUUID() }), 201);
    ok(await post('/api/feedback', { workId: a.id, versionId: a.versionId, eventId: randomUUID(), type: '建议', text: 'Reader feedback.' }, readerB), 201);
    ok(await post('/api/feedback', { workId: a.id, versionId: aV2.versionId, eventId: randomUUID(), type: '建议', text: 'Creator testing feedback.' }), 201);
    await emit('outbound_click', external, readerB); await emit('outbound_click', external, owner);
    card = ok(await post('/api/cards', { workIds: [a.id, b.id], name: 'Analytics fixture creator', bio: '', template: 'fold' }), 201).card;
    for (const user of [owner, readerA]) ok(await post('/api/events', { eventId: randomUUID(), type: 'card_view', cardId: card.id }, user));
  });
  await check('all-work aggregates deduplicate people, count reported completion and measure only valid timed ends', async () => {
    const data = await analytics(); invariant(data); expectMetrics(data.summary, allExpected, 'all summary');
    assert.equal(data.meta.scope, 'all_works'); assert.equal(data.meta.excludeSelf, false); assert.equal(data.meta.partialToday, true); assert.deepEqual(data.versions, []);
    assert.deepEqual(data.funnel, { visitors: 3, opened: 2, started: 2, supported: true }); assert.equal(data.coverage.funnelHostedOnly, true);
    expectMetrics(data.coverage, { endedStarts: 4, durationSamples: 3, unknownDurationEnds: 1, unendedStarts: 1, durationCoverage: 0.75, versionSocialMetricsAvailable: true });
    assert.equal(data.byWork.reduce((sum, work) => sum + work.uv, 0), 5); assert.equal(data.summary.uv, 3, 'Actor seen on A and B is one overall visitor.');
    assert.equal(data.summary.completions, 2, 'A reported completion with a negative score still counts; no win inference.');
    assert(data.receipts.length <= 30); assert(data.receipts.every(receipt => !receipt.workId || [a.id, b.id, external.id].includes(receipt.workId)));
    assert(data.receipts.some(receipt => receipt.type === 'session_end' && receipt.versionId === a.versionId));
    report.all = data;
  });
  await check('excludeSelf consistently removes creator events, sessions, comments, likes, feedback and card views', async () => {
    const data = await analytics({ excludeSelf: '1' }); invariant(data); expectMetrics(data.summary, excludedExpected, 'excludeSelf summary'); assert.equal(data.meta.excludeSelf, true);
    assert.deepEqual(data.funnel, { visitors: 2, opened: 1, started: 1, supported: true }); expectMetrics(data.coverage, { endedStarts: 3, durationSamples: 2, unknownDurationEnds: 1, unendedStarts: 1, durationCoverage: 2 / 3 }); report.excluded = data;
  });
  await check('single-work scopes preserve missing duration and external gameplay semantics', async () => {
    const one = await analytics({ work: a.id }); invariant(one); assert.equal(one.meta.scope, 'work'); assert.equal(one.byWork.length, 1); assert.equal(one.byWork[0].workId, a.id); assert.equal(one.byWork[0].currentVersionId, aV2.versionId);
    expectMetrics(one.summary, { pv: 3, uv: 2, opens: 4, players: 3, starts: 4, completions: 2, totalActiveMs: 8000, avgActiveMs: 8000 / 3, durationSamples: 3, endedStarts: 4, comments: 2, likes: 2, feedback: 2, cardViews: 0 });
    assert.deepEqual(one.versions.map(version => version.id), [aV2.versionId, a.versionId]); assert.equal(one.versions[0].isCurrent, true);
    const two = await analytics({ work: b.id }); invariant(two); expectMetrics(two.summary, { pv: 2, uv: 2, opens: 2, players: 1, starts: 1, completions: 0, totalActiveMs: null, avgActiveMs: null, durationSamples: 0, endedStarts: 0, ends: 1 }); assert.equal(two.coverage.durationCoverage, null); assert.equal(two.coverage.unendedStarts, 1); assert.deepEqual(two.funnel, { visitors: 2, opened: 1, started: 1, supported: true });
    const link = await analytics({ work: external.id }); invariant(link); expectMetrics(link.summary, { pv: 1, uv: 1, opens: null, players: null, starts: null, completions: null, totalActiveMs: null, avgActiveMs: null, durationSamples: null, endedStarts: null, returningPlayers: null, outboundClicks: 2 }); assert.deepEqual(link.funnel, { visitors: 0, opened: 0, started: 0, supported: false });
  });
  await check('version filters use actual historical IDs and do not attribute work-level social activity to a version', async () => {
    const old = await analytics({ work: a.id, version: a.versionId }); invariant(old); assert.equal(old.meta.scope, 'version');
    expectMetrics(old.summary, { pv: 3, uv: 2, opens: 3, starts: 3, players: 3, completions: 2, totalActiveMs: 8000, avgActiveMs: 4000, durationSamples: 2, endedStarts: 3, likes: null, comments: null, feedback: 1 }); assert.equal(old.coverage.versionSocialMetricsAvailable, false);
    assert(old.receipts.filter(receipt => receipt.workId).every(receipt => receipt.versionId === a.versionId));
    const fresh = await analytics({ work: a.id, version: aV2.versionId }); invariant(fresh); expectMetrics(fresh.summary, { pv: 0, uv: 0, opens: 1, starts: 1, players: 1, completions: 0, totalActiveMs: 0, avgActiveMs: 0, durationSamples: 1, endedStarts: 1, likes: null, comments: null, feedback: 1 });
    assert.deepEqual(fresh.funnel, { visitors: 0, opened: 0, started: 0, supported: true }); assert.equal(fresh.coverage.durationCoverage, 1);
    const excluded = await analytics({ work: a.id, version: a.versionId, excludeSelf: '1' }); invariant(excluded); expectMetrics(excluded.summary, { pv: 2, uv: 1, opens: 2, players: 2, starts: 2, completions: 1, totalActiveMs: 6000, avgActiveMs: 6000, durationSamples: 1, endedStarts: 2, likes: null, comments: null });
  });
  await check('replaying measured end events does not double counts or duration and cannot change accepted time', async () => {
    const before = await analytics();
    const retry = ok(await post(`/api/sessions/${measured.id}/events`, measured.payload, measured.user)); assert.equal(retry.accepted.length, 0); assert.equal(retry.duplicates.length, measured.payload.events.length);
    const changed = structuredClone(measured.payload); changed.events.at(-1).result.activeMs = 5000;
    rejected(await post(`/api/sessions/${measured.id}/events`, changed, measured.user), [409]);
    const legacyRetry = ok(await post(`/api/sessions/${legacy.id}/events`, legacy.payload, legacy.user)); assert.equal(legacyRetry.accepted.length, 0);
    const after = await analytics(); assert.deepEqual(after.summary, before.summary); assert.deepEqual(after.coverage, before.coverage);
  });
  await check('custom UTC ranges and equal-length previous periods retain correct totals and zero-filled buckets', async () => {
    const exact = await analytics({ from: today, to: today }); invariant(exact); expectMetrics(exact.summary, allExpected);
    assert.equal(exact.meta.from, today); assert.equal(exact.meta.to, today); assert.equal(exact.meta.previousFrom, dateShift(today, -1)); assert.equal(exact.meta.previousTo, dateShift(today, -1)); assert.equal(exact.series.length, 1); assert.equal(exact.series[0].date, today); expectMetrics(exact.series[0], { pv: 6, uv: 3, starts: 5, totalActiveMs: 8000, durationSamples: 3 });
    expectMetrics(exact.previous, { pv: 0, uv: 0, opens: 0, starts: 0, completions: 0, totalActiveMs: null, avgActiveMs: null, durationSamples: 0 });
    const previousOnly = await analytics({ from: dateShift(today, -2), to: dateShift(today, -1) }); invariant(previousOnly); assert.equal(previousOnly.meta.partialToday, false); assert.equal(previousOnly.series.length, 2); assert(previousOnly.series.every(bucket => bucket.pv === 0 && bucket.totalActiveMs === null));
    const wide = await analytics({ days: '90' }); invariant(wide); assert.equal(wide.series.length, 90); assert.equal(wide.meta.from, dateShift(today, -89)); expectMetrics(wide.summary, allExpected);
    const legacyDay = await analytics({ days: '1' }); assert.equal(legacyDay.series.length, 1); expectMetrics(legacyDay.summary, allExpected); assert.equal(legacyDay.scope, 'work_period');
  });
  await check('weekly buckets start Monday and calculate distinct people without summing work counts', async () => {
    const data = await analytics({ from: dateShift(today, -6), to: today, granularity: 'week' }); invariant(data); assert.equal(data.meta.granularity, 'week'); expectMetrics(data.summary, allExpected);
    const expectedDates = []; for (let date = monday(dateShift(today, -6)); date <= monday(today); date = dateShift(date, 7)) expectedDates.push(date);
    assert.deepEqual(data.series.map(bucket => bucket.date), expectedDates); const active = data.series.find(bucket => bucket.date === monday(today)); expectMetrics(active, { pv: 6, uv: 3, opens: 6, players: 3, starts: 5, totalActiveMs: 8000, durationSamples: 3 });
    assert.equal(data.summary.returningPlayers, 0, 'Repeat same-day sessions and different works are not multi-day returning players.');
  });
  await check('invalid date/filter combinations and foreign work/version access fail', async () => {
    for (const params of [{ from: today }, { to: today }, { from: today, to: today, days: '7' }, { from: today, to: dateShift(today, -1) }, { from: today, to: dateShift(today, 1) }, { from: dateShift(today, -90), to: today }, { from: '2026-02-30', to: '2026-03-01' }, { days: '0' }, { days: '91' }, { granularity: 'month' }, { excludeSelf: 'yes' }, { version: a.versionId }]) rejected(await request('/api/analytics?' + new URLSearchParams(params)), [400, 422]);
    rejected(await request('/api/analytics?' + new URLSearchParams({ work: foreign.id })), [403, 404]);
    rejected(await request('/api/analytics?' + new URLSearchParams({ work: a.id }), { user: readerA }), [403, 404]);
    rejected(await request('/api/analytics?' + new URLSearchParams({ work: a.id, version: b.versionId })), [404, 422]);
    rejected(await request('/api/analytics?' + new URLSearchParams({ work: a.id, version: foreign.versionId })), [404, 422]);
    rejected(await request('/api/analytics?' + new URLSearchParams({ work: a.id, version: randomUUID() })), [404, 422]);
    const scoped = await analytics({}, readerB); assert.equal(scoped.byWork.length, 1); assert.equal(scoped.byWork[0].workId, foreign.id); expectMetrics(scoped.summary, { pv: 0, starts: 0, totalActiveMs: null, avgActiveMs: null });
  });
  assert.equal(new Date().toISOString().slice(0, 10), today, 'UTC day changed during fixtures; rerun once with a fresh identity.');
  report.completedAt = new Date().toISOString();
} finally {
  await mkdir('.preview', { recursive: true }); await writeFile('.preview/local-analytics-integration.json', JSON.stringify(report, null, 2));
  console.log(`Completed ${report.checks.length} analytics checks. Evidence: .preview/local-analytics-integration.json`);
}
