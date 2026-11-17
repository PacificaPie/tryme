// Real D1/R2 HTTP integration checks. Start one local Worker separately; this
// harness never starts a server, migrates/seeds SQLite, or writes to production.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gameHTML, versions } from './fixtures/version-games.mjs';
import { createDiscoveryReviewer } from './fixtures/discovery-review.mjs';

const base = new URL(process.env.FUNTRACK_TEST_URL || 'http://127.0.0.1:8767');
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Version fixtures only run on loopback.');
assert(!base.username && !base.password && base.pathname === '/', 'Use a bare local origin.');
const buildFixture = process.env.FUNTRACK_TEST_BUILD_FIXTURE ? JSON.parse(await readFile(process.env.FUNTRACK_TEST_BUILD_FIXTURE, 'utf8')) : null;
const run = buildFixture?.run || randomUUID(), owner = `versions_owner_${run}`, reader = `versions_reader_${run}`;
if (buildFixture) assert.equal(buildFixture.owner, owner, 'Build fixture owner must match this local run.');
const report = { run, base: base.origin, owner, reader, checks: [], skipped: [], ids: {}, startedAt: new Date().toISOString() };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = user => ({ 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@sites.test` });
async function request(path, { method = 'GET', user = owner, json, form, headers = {}, binary = false } = {}) {
  const response = await fetch(new URL(path, base), {
    method, redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { ...(user ? identity(user) : {}), ...(method === 'POST' ? { Origin: base.origin, 'X-Funtrack-CSRF': '1' } : {}), ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: form || (json !== undefined ? JSON.stringify(json) : undefined),
  });
  const raw = binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
  let body = raw; if (!binary) { try { body = JSON.parse(raw); } catch {} }
  return { status: response.status, body, headers: response.headers };
}
function ok(response, status = 200) {
  assert.equal(response.status, status, `Expected ${status}, got ${response.status}: ${JSON.stringify(response.body).slice(0, 1200)}`);
  return response.body;
}
const approveFixture=createDiscoveryReviewer({request,ok});
function rejected(response, statuses, code) {
  assert(statuses.includes(response.status), `Expected ${statuses}, got ${response.status}: ${JSON.stringify(response.body).slice(0, 1200)}`);
  if (code) assert.equal(response.body.error?.code, code);
  return response.body;
}
async function check(name, fn) {
  try { await fn(); report.checks.push(name); console.log(`PASS ${name}`); }
  catch (error) { report.failure = { check: name, message: error.message }; throw error; }
}
function newWorkForm(name, fixture = versions[0]) {
  const form = new FormData(); form.set('name', name); form.set('desc', 'Local immutable version integration fixture.'); form.set('source', 'html');
  form.set('file', new File([fixture.html], 'fixture.html', { type: 'text/html' }));
  form.set('cover', new File([fixture.cover], 'fixture.png', { type: 'image/png' })); return form;
}
async function createWork(name, user = owner, key = randomUUID(), fixture = versions[0]) {
  return ok(await request('/api/works', { method: 'POST', user, form: newWorkForm(name,fixture), headers: { 'Idempotency-Key': key } }), 201).work;
}
function updateForm(expectedRevision, { html = versions[1].html, releaseNotes = 'fixture: second version', cover, buildId } = {}) {
  const form = new FormData(); form.set('expectedRevision', String(expectedRevision)); form.set('releaseNotes', releaseNotes);
  if (buildId) form.set('buildId', buildId); else form.set('file', new File([html], 'fixture.html', { type: 'text/html' }));
  if (cover) form.set('cover', new File([cover], 'fixture.png', { type: 'image/png' })); return form;
}
const publish = (id, revision, input = {}, key = randomUUID(), options = {}) => request(`/api/works/${id}/versions`, { method: 'POST', form: updateForm(revision, input), headers: { 'Idempotency-Key': key }, ...options });
const activate = (id, versionId, expectedRevision, key = randomUUID(), options = {}) => request(`/api/works/${id}/activate`, { method: 'POST', json: { versionId, expectedRevision }, headers: { 'Idempotency-Key': key }, ...options });
const current = async id => ok(await request(`/api/works/${id}`)).work;
const history = async (id, suffix = '') => ok(await request(`/api/works/${id}/versions${suffix}`));
async function game(versionId, marker) {
  const response = await request(`/game/${versionId}`); ok(response);
  assert.match(response.headers.get('content-security-policy') || '', /sandbox allow-scripts/);
  assert(!(response.headers.get('content-security-policy') || '').includes('allow-same-origin'));
  assert.match(response.headers.get('content-security-policy') || '', /connect-src 'none'/);
  assert(response.body.includes(marker), `Missing game marker ${marker}`); return response.body;
}
async function image(url) { return ok(await request(url, { binary: true })); }
const keyInitial = randomUUID(), keyV2 = randomUUID(), workName = `Version fixture ${run}`;
let v1, v2, v3, second, foreign, initialGame, initialImage, cardV1, sessionV1, viewFirst, feedbackFirst, comment;
const viewPayload = { eventId: randomUUID(), type: 'work_view' };
const feedbackPayload = { eventId: randomUUID(), type: '建议', text: 'The first version has one-point steps.' };
const v2Input = { html: versions[1].html, cover: versions[1].cover, releaseNotes: 'fixture: two-point blue version' };

try {
  await check('v1 starts with stable identity, ordinal and immutable resources', async () => {
    v1 = await createWork(workName, owner, keyInitial); second = await createWork(`Second ${run}`,owner,randomUUID(),{...versions[0],html:versions[0].html+`\n<!-- distinct second work ${run} -->`}); foreign = await createWork(`Foreign ${run}`, reader);
    Object.assign(report.ids, { work: v1.id, v1: v1.versionId, secondWork: second.id, foreignWork: foreign.id });
    assert.equal(v1.revision, 1); assert.equal(v1.version, 'v1'); assert(v1.updatedAt);
    const listing = await history(v1.id); assert.equal(listing.revision, 1); assert.equal(listing.currentVersionId, v1.versionId); assert.equal(listing.versions.length, 1);
    assert.equal(listing.versions[0].ordinal, 1); assert.equal(listing.versions[0].id, v1.versionId);
    initialGame = await game(v1.versionId, versions[0].marker); initialImage = await image(v1.coverUrl); assert.equal(digest(initialImage), digest(versions[0].cover));
  });
  await check('history, uploads and activation retain authentication, ownership and CSRF', async () => {
    rejected(await request(`/api/works/${v1.id}/versions`, { user: null }), [401]);
    rejected(await request(`/api/works/${v1.id}/versions`, { user: reader }), [403, 404]);
    rejected(await publish(v1.id, 1, {}, randomUUID(), { user: reader }), [403, 404]);
    rejected(await activate(v1.id, v1.versionId, 1, randomUUID(), { user: reader }), [403, 404]);
    rejected(await publish(v1.id, 1, {}, randomUUID(), { headers: { Origin: 'null', 'Idempotency-Key': randomUUID() } }), [403]);
    rejected(await activate(v1.id, second.versionId, 1), [404, 422]);
    rejected(await request(`/api/works/${v1.id}/versions/${second.versionId}`), [404]);
    rejected(await request(`/api/works/${v1.id}/versions/${v1.versionId}`, { user: reader }), [403, 404]);
    assert.equal((await current(v1.id)).revision, 1);
  });
  await check('publication requires an explicit key, integer revision and one valid artifact source', async () => {
    rejected(await request(`/api/works/${v1.id}/versions`, { method: 'POST', form: updateForm(1) }), [422]);
    for (const value of ['', '-1', '1.5', 'not-a-revision']) {
      const form = updateForm(1); form.set('expectedRevision', value);
      rejected(await request(`/api/works/${v1.id}/versions`, { method: 'POST', form, headers: { 'Idempotency-Key': randomUUID() } }), [422]);
    }
    const missing = updateForm(1); missing.delete('file');
    rejected(await request(`/api/works/${v1.id}/versions`, { method: 'POST', form: missing, headers: { 'Idempotency-Key': randomUUID() } }), [422]);
    const ambiguous = updateForm(1); ambiguous.set('buildId', randomUUID());
    rejected(await request(`/api/works/${v1.id}/versions`, { method: 'POST', form: ambiguous, headers: { 'Idempotency-Key': randomUUID() } }), [422]);
    rejected(await activate(v1.id, v1.versionId, 1, randomUUID(), { headers: { 'Idempotency-Key': randomUUID(), 'X-Funtrack-CSRF': '' } }), [403]);
    assert.equal((await history(v1.id)).versions.length, 1); assert.equal((await current(v1.id)).revision, 1);
  });
  await check('v1 card, in-progress session, events, feedback and social records are saved', async () => {
    cardV1 = ok(await request('/api/cards', { method: 'POST', json: { name: 'Version fixture creator', bio: '', template: 'fold', workIds: [v1.id], workRefs: [{ workId: v1.id, versionId: v1.versionId }] } }), 201).card;
    assert.equal(cardV1.works[0].versionId, v1.versionId); report.ids.cardV1 = cardV1.id;
    sessionV1 = ok(await request('/api/sessions', { method: 'POST', user: reader, json: { workId: v1.id, versionId: v1.versionId } }), 201); report.ids.sessionV1 = sessionV1.id;
    const started = ok(await request(`/api/sessions/${sessionV1.id}/events`, { method: 'POST', user: reader, json: { token: sessionV1.token, events: [{ id: randomUUID(), type: 'play_start', seq: 1 }] } }));
    assert.equal(started.accepted[0].versionId, v1.versionId);
    viewPayload.workId = v1.id; feedbackPayload.workId = v1.id;
    viewFirst = ok(await request('/api/events', { method: 'POST', user: reader, json: viewPayload })); assert.equal(viewFirst.receipt.versionId, v1.versionId);
    feedbackFirst = ok(await request('/api/feedback', { method: 'POST', user: reader, json: feedbackPayload }), 201).feedback; assert.equal(feedbackFirst.versionId, v1.versionId);
    ok(await request(`/api/works/${v1.id}/like`, { method: 'POST', user: reader, json: { liked: true } }));
    comment = ok(await request(`/api/works/${v1.id}/comments`, { method: 'POST', user: reader, json: { body: 'Keep this discussion on the same work.' }, headers: { 'Idempotency-Key': randomUUID() } }), 201).comment;
  });
  await check('new version changes actual game and cover while work count, URL and old bytes stay fixed', async () => {
    const before = ok(await request('/api/works?mine=1')).works.length;
    v2 = ok(await publish(v1.id, 1, v2Input, keyV2), 201); report.ids.v2 = v2.version.id;
    assert.equal(v2.version.workId, v1.id); assert.equal(v2.version.version, 'v2'); assert.equal(v2.version.ordinal, 2); assert.equal(v2.version.contentHash, digest(versions[1].html));
    assert.equal(v2.operation.fromVersionId, v1.versionId); assert.equal(v2.operation.toVersionId, v2.version.id); assert.equal(v2.operation.previousRevision, 1); assert.equal(v2.operation.revision, 2); assert.equal(v2.operation.changed, true);
    const latest = await current(v1.id); assert.equal(latest.id, v1.id); assert.equal(latest.versionId, v2.version.id); assert.equal(latest.revision, 2); assert.equal(latest.createdAt, v1.createdAt); assert.equal(latest.name, v1.name);
    assert.equal(ok(await request('/api/works?mine=1')).works.length, before);
    assert.notEqual(await game(v2.version.id, versions[1].marker), initialGame); assert.equal(await game(v1.versionId, versions[0].marker), initialGame);
    assert.equal(digest(await image(v1.coverUrl)), digest(initialImage)); assert.equal(digest(await image(latest.coverUrl)), digest(versions[1].cover));
    assert(!ok(await request('/api/discover?q=' + encodeURIComponent(workName))).works.some(item=>item.id===v1.id),'An unreviewed version must not enter Feed.');
    await approveFixture(v1.id,owner);
    const discovered = ok(await request('/api/discover?q=' + encodeURIComponent(workName))).works.find(item => item.id === v1.id); assert.equal(discovered.versionId, v2.version.id); assert.equal(discovered.createdAt, v1.createdAt);
  });
  await check('same publish retries freeze the original operation; changed requests conflict', async () => {
    const replay = ok(await publish(v1.id, 1, v2Input, keyV2)); assert.deepEqual(replay.version, v2.version); assert.deepEqual(replay.operation, v2.operation);
    rejected(await publish(v1.id, 1, { ...v2Input, releaseNotes: 'changed' }, keyV2), [409], 'IDEMPOTENCY_CONFLICT');
    rejected(await publish(v1.id, 1, { ...v2Input, html: versions[2].html }, keyV2), [409], 'IDEMPOTENCY_CONFLICT');
    rejected(await publish(v1.id, 1, { ...v2Input, cover: versions[0].cover }, keyV2), [409], 'IDEMPOTENCY_CONFLICT');
    assert.equal((await history(v1.id)).versions.length, 2);
  });
  await check('old sessions and version-omitting event/feedback retries remain bound to v1', async () => {
    const viewRetry = ok(await request('/api/events', { method: 'POST', user: reader, json: viewPayload })); assert.equal(viewRetry.duplicate, true); assert.deepEqual(viewRetry.receipt, viewFirst.receipt);
    const feedbackRetry = ok(await request('/api/feedback', { method: 'POST', user: reader, json: feedbackPayload })).feedback; assert.deepEqual(feedbackRetry, feedbackFirst);
    rejected(await request('/api/events', { method: 'POST', user: reader, json: { ...viewPayload, versionId: v2.version.id } }), [409]);
    rejected(await request('/api/feedback', { method: 'POST', user: reader, json: { ...feedbackPayload, versionId: v2.version.id } }), [409]);
    const events = [{ id: randomUUID(), type: 'game_complete', seq: 2, result: { score: 7, label: 'v1 completion' } }, { id: randomUUID(), type: 'session_end', seq: 3, elapsedMs: 15000 }];
    const finished = ok(await request(`/api/sessions/${sessionV1.id}/events`, { method: 'POST', user: reader, json: { token: sessionV1.token, events } })); assert.equal(finished.accepted.length, 2); finished.accepted.forEach(item => assert.equal(item.versionId, v1.versionId));
    assert.equal(ok(await request(`/api/sessions/${sessionV1.id}/events`, { method: 'POST', user: reader, json: { token: sessionV1.token, events } })).accepted.length, 0);
    const staleStart = ok(await request('/api/sessions', { method: 'POST', json: { workId: v1.id, versionId: v1.versionId } }), 201); assert.equal(staleStart.gameUrl, `/game/${v1.versionId}`);
    const newStart = ok(await request('/api/sessions', { method: 'POST', json: { workId: v1.id, versionId: v2.version.id } }), 201); assert.equal(newStart.gameUrl, `/game/${v2.version.id}`);
  });
  await check('card preview references freeze v1 across update; legacy saves adopt the current version', async () => {
    assert.deepEqual(ok(await request('/api/cards/' + cardV1.id)).card, cardV1);
    const cardInput = { name: 'Version fixture creator', bio: '', template: 'fold', workIds: [v1.id], workRefs: [{ workId: v1.id, versionId: v1.versionId }] }, key = randomUUID();
    const saved = ok(await request('/api/cards', { method: 'POST', json: cardInput, headers: { 'Idempotency-Key': key } }), 201).card;
    assert.equal(saved.works[0].versionId, v1.versionId); assert.equal(digest(await image(saved.works[0].coverUrl)), digest(initialImage));
    assert.deepEqual(ok(await request('/api/cards', { method: 'POST', json: cardInput, headers: { 'Idempotency-Key': key } })).card, saved);
    rejected(await request('/api/cards', { method: 'POST', json: { ...cardInput, workRefs: [{ workId: v1.id, versionId: v2.version.id }] }, headers: { 'Idempotency-Key': key } }), [409]);
    rejected(await request('/api/cards', { method: 'POST', json: { ...cardInput, workRefs: [{ workId: v1.id, versionId: second.versionId }] } }), [404, 422]);
    rejected(await request('/api/cards', { method: 'POST', user: reader, json: cardInput }), [403, 404]);
    const { workRefs, ...legacy } = cardInput; const currentCard = ok(await request('/api/cards', { method: 'POST', json: legacy }), 201).card; assert.equal(currentCard.works[0].versionId, v2.version.id);
  });
  await check('rollback restores real v1 game/cover, increments revision and rejects stale ABA writes', async () => {
    const rollback = ok(await activate(v1.id, v1.versionId, 2)); assert.equal(rollback.operation.changed, true); assert.equal(rollback.operation.revision, 3);
    const rolled = await current(v1.id); assert.equal(rolled.versionId, v1.versionId); assert.equal(rolled.revision, 3); assert.equal(rolled.createdAt, v1.createdAt);
    assert.equal(await game(rolled.versionId, versions[0].marker), initialGame); assert.equal(digest(await image(rolled.coverUrl)), digest(initialImage));
    const conflict = rejected(await publish(v1.id, 1, { html: gameHTML('STALE_ABA') }), [409], 'VERSION_CONFLICT'); assert.deepEqual(conflict.error.current, { versionId: v1.versionId, revision: 3, metadataId: rolled.metadataId });
    rejected(await activate(v1.id, v2.version.id, 1), [409], 'VERSION_CONFLICT');
    const replay = ok(await publish(v1.id, 1, v2Input, keyV2)); assert.deepEqual(replay.operation, v2.operation); assert.deepEqual(replay.version, v2.version); assert.equal((await current(v1.id)).versionId, v1.versionId);
    assert.equal((await history(v1.id)).versions.length, 2);
  });
  await check('no-op activation has no revision bump and its retry cannot undo a later release', async () => {
    const key = randomUUID(), noop = ok(await activate(v1.id, v1.versionId, 3, key)); assert.equal(noop.operation.changed, false); assert.equal(noop.operation.revision, 3);
    v3 = ok(await publish(v1.id, 3, { html: versions[2].html, releaseNotes: 'fixture: third version inherits cover' }), 201); report.ids.v3 = v3.version.id;
    assert.equal(v3.version.version, 'v3'); assert.equal(v3.version.ordinal, 3); assert.equal(v3.operation.revision, 4);
    assert.equal(digest(await image(v3.version.coverUrl)), digest(initialImage)); await game(v3.version.id, versions[2].marker);
    const retry = ok(await activate(v1.id, v1.versionId, 3, key)); assert.deepEqual(retry.operation, noop.operation); assert.equal((await current(v1.id)).versionId, v3.version.id);
    const original = ok(await request('/api/works', { method: 'POST', form: newWorkForm(workName), headers: { 'Idempotency-Key': keyInitial } })); assert.equal(original.work.id, v1.id); assert.equal(original.work.versionId, v1.versionId); assert.equal(original.work.version, 'v1');
    const oldPublish = ok(await publish(v1.id, 1, v2Input, keyV2)); assert.deepEqual(oldPublish.version, v2.version); assert.equal((await current(v1.id)).versionId, v3.version.id);
  });
  await check('bounded history pagination has stable immutable metadata and rejects cross-work cursors', async () => {
    const page = await history(v1.id, '?limit=1'); assert.equal(page.versions.length, 1); assert(page.nextCursor); assert.equal(page.versions[0].id, v3.version.id);
    const next = await history(v1.id, '?limit=1&cursor=' + encodeURIComponent(page.nextCursor)); assert.equal(next.versions[0].id, v2.version.id); assert(next.nextCursor);
    const last = await history(v1.id, '?limit=1&cursor=' + encodeURIComponent(next.nextCursor)); assert.equal(last.versions[0].id, v1.versionId); assert.equal(last.nextCursor, null);
    assert.equal(new Set([page, next, last].flatMap(item => item.versions.map(v => v.id))).size, 3);
    rejected(await request(`/api/works/${second.id}/versions?cursor=` + encodeURIComponent(page.nextCursor)), [400, 422]);
    rejected(await request(`/api/works/${v1.id}/versions?limit=9999`), [422]);
    const detail = ok(await request(`/api/works/${v1.id}/versions/${v2.version.id}`)); assert.equal(detail.version.contentHash, digest(versions[1].html)); assert.equal(detail.current.versionId, v3.version.id);
  });
  await check('two concurrent uploads commit exactly one version and one revision change', async () => {
    const before = await current(second.id), keys = [randomUUID(), randomUUID()];
    const results = await Promise.all(keys.map((key, index) => publish(second.id, before.revision, { html: gameHTML(`CONCURRENT_${index}`), releaseNotes: `fixture: competing ${index}` }, key)));
    assert.deepEqual(results.map(item => item.status).sort(), [201, 409]);
    const win = results.find(item => item.status === 201).body; const lose = results.find(item => item.status === 409); assert.equal(lose.body.error.code, 'VERSION_CONFLICT');
    const now = await current(second.id); assert.equal(now.versionId, win.version.id); assert.equal(now.revision, before.revision + 1); assert.equal((await history(second.id)).versions.length, 2);
  });
  await check('concurrent duplicate uploads share one frozen result without duplicate rows', async () => {
    const before = await current(second.id), key = randomUUID(), input = { html: gameHTML('SAME_KEY_CONCURRENT'), releaseNotes: 'fixture: exact concurrent retry' };
    const results = await Promise.all([publish(second.id, before.revision, input, key), publish(second.id, before.revision, input, key)]);
    results.forEach(item => assert([200, 201].includes(item.status), JSON.stringify(item.body))); assert.equal(results.filter(item => item.status === 201).length, 1);
    assert.deepEqual(results[0].body.version, results[1].body.version); assert.deepEqual(results[0].body.operation, results[1].body.operation);
    assert.equal((await current(second.id)).revision, before.revision + 1); assert.equal((await history(second.id)).versions.length, 3);
  });
  await check('upload and rollback racing at the same revision cannot both commit', async () => {
    const before = await current(second.id), count = (await history(second.id)).versions.length;
    const results = await Promise.all([publish(second.id, before.revision, { html: gameHTML('UPLOAD_VS_ROLLBACK'), releaseNotes: 'fixture: upload versus rollback' }), activate(second.id, second.versionId, before.revision)]);
    assert.equal(results.filter(item => item.status < 300).length, 1); assert.equal(results.filter(item => item.status === 409).length, 1);
    const winner = results.find(item => item.status < 300).body; assert.equal((await current(second.id)).versionId, winner.operation.toVersionId); assert.equal((await current(second.id)).revision, before.revision + 1);
    assert.equal((await history(second.id)).versions.length, count + (results[0].status === 201 ? 1 : 0));
  });
  await check('concurrent reuse of a key with different content cannot silently replay or publish twice', async () => {
    const before = await current(second.id), count = (await history(second.id)).versions.length, key = randomUUID();
    const results = await Promise.all([0, 1].map(index => publish(second.id, before.revision, { html: gameHTML(`KEY_COLLISION_${index}`), releaseNotes: `fixture: conflicting key ${index}` }, key)));
    assert.deepEqual(results.map(item => item.status).sort(), [201, 409]);
    assert.equal(results.find(item => item.status === 409).body.error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await current(second.id)).versionId, results.find(item => item.status === 201).body.version.id);
    assert.equal((await current(second.id)).revision, before.revision + 1); assert.equal((await history(second.id)).versions.length, count + 1);
  });
  await check('invalid files, unsupported sources and inaccessible builds leave the current version playable', async () => {
    const before = await current(v1.id), count = (await history(v1.id)).versions.length;
    rejected(await publish(v1.id, before.revision, { html: 'not HTML' }), [415, 422]);
    rejected(await publish(v1.id, before.revision, { cover: Buffer.from('not PNG') }), [415, 422]);
    rejected(await publish(v1.id, before.revision, { buildId: randomUUID() }), [404]);
    const externalForm = new FormData(); externalForm.set('name', 'External version fixture'); externalForm.set('desc', 'Unsupported source fixture.'); externalForm.set('source', 'url'); externalForm.set('url', 'https://example.com/');
    const external = ok(await request('/api/works', { method: 'POST', form: externalForm, headers: { 'Idempotency-Key': randomUUID() } }), 201).work;
    rejected(await publish(external.id, external.revision), [409, 422]);
    assert.equal((await current(v1.id)).versionId, before.versionId); assert.equal((await current(v1.id)).revision, before.revision); assert.equal((await history(v1.id)).versions.length, count); await game(before.versionId, versions[2].marker);
  });
  if (buildFixture) await check('ready build artifacts publish as versions; foreign, queued and failed builds cannot switch them', async () => {
    const token = process.env.FUNTRACK_BUILD_RUNNER_TOKEN;
    assert(token && token.length >= 32, 'A local fixture runner token is required. Never use a production token.');
    async function finish(build, marker) {
      const form = new FormData(); form.set('leaseId', build.leaseId); form.set('file', new File([gameHTML(marker)], 'index.html', { type: 'text/html' })); form.set('metadata', JSON.stringify({ framework: 'integration-fixture', source: 'deterministic test artifact, not an npm build' }));
      return ok(await request(`/api/build-worker/${build.id}/complete`, { method: 'POST', user: null, form, headers: { Authorization: `Bearer ${token}` } })).build;
    }
    const ready = await finish(buildFixture.builds.ready, 'BUILD_VERSION_FIXTURE'); await finish(buildFixture.builds.otherReady, 'OTHER_OWNER_BUILD_FIXTURE');
    const before = await current(second.id), count = (await history(second.id)).versions.length;
    rejected(await publish(second.id, before.revision, { buildId: buildFixture.builds.otherReady.id }), [404]);
    rejected(await publish(second.id, before.revision, { buildId: buildFixture.builds.queued.id }), [409]);
    rejected(await publish(second.id, before.revision, { buildId: buildFixture.builds.failed.id }), [409]);
    assert.equal((await current(second.id)).versionId, before.versionId); assert.equal((await history(second.id)).versions.length, count);
    const key = randomUUID(), input = { buildId: ready.id, releaseNotes: 'fixture: immutable build artifact' };
    const built = ok(await publish(second.id, before.revision, input, key), 201); assert.equal(built.version.build.buildId, ready.id); assert.equal(built.version.build.commitSha, ready.commitSha); assert.equal(built.version.contentHash, ready.artifactHash);
    assert.equal((await current(second.id)).build.buildId, ready.id); await game(built.version.id, 'BUILD_VERSION_FIXTURE');
    const retry = ok(await publish(second.id, before.revision, input, key)); assert.deepEqual(retry.version, built.version); assert.deepEqual(retry.operation, built.operation);
    report.ids.buildVersion = built.version.id;
  });
  else report.skipped.push('Build-version fixtures: prepare and apply the local SQL before startup, then set FUNTRACK_TEST_BUILD_FIXTURE and the local runner token.');
  if (process.env.FUNTRACK_TEST_D1_FAILURES === '1') await check('real D1 abort rolls back all version rows and pointer changes; a later valid request recovers', async () => {
    const before = await current(second.id), count = (await history(second.id)).versions.length, key = randomUUID();
    const failed = await publish(second.id, before.revision, { html: gameHTML('FAILED_DB_COMMIT'), releaseNotes: 'fixture: reject D1 version commit' }, key); rejected(failed, [500, 503]);
    assert.equal((await current(second.id)).versionId, before.versionId); assert.equal((await current(second.id)).revision, before.revision); assert.equal((await history(second.id)).versions.length, count);
    const previousGame = await request('/game/' + before.versionId); ok(previousGame);
    const recovered = ok(await publish(second.id, before.revision, { html: gameHTML('RECOVERED_DB_COMMIT'), releaseNotes: 'fixture: recovered D1 commit' }, key), 201);
    assert.equal(recovered.version.ordinal, count + 1); assert.equal(recovered.operation.revision, before.revision + 1); await game(recovered.version.id, 'RECOVERED_DB_COMMIT');
  });
  else report.skipped.push('Real D1 injected failure: apply fixtures/version-failure-trigger.sql locally before startup and set FUNTRACK_TEST_D1_FAILURES=1.');
  await check('likes, discussion, private feedback and analytics keep their work and version attribution', async () => {
    const work = await current(v1.id); assert.equal(work.likesCount, 1); assert.equal(work.commentsCount, 1);
    assert.equal(ok(await request(`/api/works/${v1.id}/comments`)).comments[0].id, comment.id);
    const feedback = ok(await request(`/api/feedback?work=${v1.id}`)).feedback; assert.equal(feedback.length, 1); assert.equal(feedback[0].id, feedbackFirst.id); assert.equal(feedback[0].versionId, v1.versionId);
    const stats = ok(await request(`/api/analytics?work=${v1.id}`)); assert.equal(stats.scope, 'work_period'); assert.equal(stats.byWork[0].currentVersionId, v3.version.id); assert(!('versionId' in stats.byWork[0]));
    assert.equal(stats.summary.views, 1); assert.equal(stats.summary.starts, 1); assert.equal(stats.summary.ends, 1); assert.equal(stats.summary.feedback, 1); assert.equal(stats.summary.comments, 1);
    for (const receipt of stats.receipts.filter(item => ['work_view', 'play_start', 'game_complete', 'session_end', 'feedback'].includes(item.type))) assert.equal(receipt.versionId, v1.versionId);
    assert.deepEqual(ok(await request('/api/cards/' + cardV1.id)).card, cardV1); report.analytics = stats;
  });
  report.completedAt = new Date().toISOString();
} finally {
  await mkdir('.preview', { recursive: true }); await writeFile('.preview/local-versions-integration.json', JSON.stringify(report, null, 2));
  console.log(`Completed ${report.checks.length} version checks; ${report.skipped.length} explicitly skipped. Evidence: .preview/local-versions-integration.json`);
}
