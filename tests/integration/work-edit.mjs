// Real local D1/R2 checks for work metadata editing. The harness never starts
// a server, changes SQL directly, or runs against a non-loopback deployment.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { versions } from './fixtures/version-games.mjs';
import { createDiscoveryReviewer } from './fixtures/discovery-review.mjs';

const base = new URL(process.env.FUNTRACK_TEST_URL || 'http://127.0.0.1:8767');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Work edit fixtures only run on loopback.');
assert(!base.username && !base.password && base.pathname === '/', 'Use a bare local origin.');
const run = randomUUID(), owner = `work_edit_owner_${run}`, reader = `work_edit_reader_${run}`;
const report = { run, base: base.origin, owner, reader, transport: { connection: 'close', multipart: 'buffered with Content-Length', automaticRetries: false }, startedAt: new Date().toISOString(), checks: [], ids: {} };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function request(path, { method = 'GET', user = owner, form, json, headers = {}, binary = false } = {}) {
  const url = new URL(path, base); assert.equal(url.origin, base.origin, 'Never send fixture identities outside the local Worker.');
  const encoded = form ? new Response(form) : null;
  const bodyBytes = encoded ? Buffer.from(await encoded.arrayBuffer()) : undefined;
  const response = await fetch(url, {
    method, redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: {
      // Local workerd may close a connection after rejecting an unread multipart
      // body. Keep this HTTP fixture independent of pooled-connection reuse.
      Connection: 'close',
      ...(user ? { 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@sites.test` } : {}),
      ...(!['GET', 'HEAD'].includes(method) ? { Origin: base.origin, 'X-Funtrack-CSRF': '1' } : {}),
      ...(encoded ? { 'Content-Type': encoded.headers.get('content-type'), 'Content-Length': String(bodyBytes.length) } : {}),
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers,
    },
    body: bodyBytes || (json !== undefined ? JSON.stringify(json) : undefined),
  });
  const raw = binary ? Buffer.from(await response.arrayBuffer()) : await response.text();
  let body = raw; if (!binary) { try { body = JSON.parse(raw); } catch {} }
  return { status: response.status, body, headers: response.headers };
}
function ok(response, status = 200) {
  assert.equal(response.status, status, `Expected ${status}, got ${response.status}: ${JSON.stringify(response.body).slice(0, 1600)}`);
  return response.body;
}
const approveFixture=createDiscoveryReviewer({request,ok});
function rejected(response, statuses, code) {
  assert(statuses.includes(response.status), `Expected ${statuses}, got ${response.status}: ${JSON.stringify(response.body).slice(0, 1600)}`);
  if (code) assert.equal(response.body.error?.code, code); return response.body;
}
async function check(name, fn) {
  try { await fn(); report.checks.push(name); console.log(`PASS ${name}`); }
  catch (error) { report.failure = { check: name, message: error.message }; throw error; }
}
function publicationForm(name, { desc = 'Original work description.', source = 'html', html=versions[0].html } = {}) {
  const form = new FormData(); form.set('name', name); form.set('desc', desc); form.set('source', source);
  if (source === 'html') form.set('file', new File([html], 'game.html', { type: 'text/html' }));
  else form.set('url', 'https://example.com/work-edit-fixture');
  form.set('cover', new File([versions[0].cover], 'cover.png', { type: 'image/png' })); return form;
}
async function createWork(name, options = {}, key = randomUUID(), user = owner) {
  return ok(await request('/api/works', { method: 'POST', user, form: publicationForm(name, options), headers: { 'Idempotency-Key': key } }), 201).work;
}
function editForm(expectedRevision, { name, desc, cover } = {}) {
  const form = new FormData(); form.set('expectedRevision', String(expectedRevision));
  if (name !== undefined) form.set('name', name); if (desc !== undefined) form.set('desc', desc);
  if (cover !== undefined) form.set('cover', new File([cover], 'cover.png', { type: 'image/png' })); return form;
}
const edit = (id, revision, input, key = randomUUID(), options = {}) => request(`/api/works/${id}`, {
  method: 'PATCH', form: editForm(revision, input), headers: { 'Idempotency-Key': key }, ...options,
});
function versionForm(expectedRevision, fixture = versions[1], cover = undefined) {
  const form = new FormData(); form.set('expectedRevision', String(expectedRevision)); form.set('releaseNotes', 'Metadata integration game release.');
  form.set('file', new File([fixture.html], 'game.html', { type: 'text/html' }));
  if (cover !== undefined) form.set('cover', new File([cover], 'cover.png', { type: 'image/png' })); return form;
}
const publishVersion = (id, revision, fixture = versions[1], cover, key = randomUUID()) => request(`/api/works/${id}/versions`, {
  method: 'POST', form: versionForm(revision, fixture, cover), headers: { 'Idempotency-Key': key },
});
const activate = (id, versionId, expectedRevision, key = randomUUID()) => request(`/api/works/${id}/activate`, {
  method: 'POST', json: { versionId, expectedRevision }, headers: { 'Idempotency-Key': key },
});
const current = async id => ok(await request(`/api/works/${id}`)).work;
const history = async id => ok(await request(`/api/works/${id}/versions`));
const image = async url => ok(await request(url, { binary: true }));
const analytics = async (id, versionId) => ok(await request('/api/analytics?' + new URLSearchParams({ days: '1', work: id, ...(versionId ? { version: versionId } : {}) })));
const versionContent = list => list.map(({ isCurrent, ...version }) => version).sort((a, b) => a.ordinal - b.ordinal);
const publicMetadata = work => ({ name: work.name, desc: work.desc, coverUrl: work.coverUrl });

const originalName = `Original edit fixture ${run}`, publishKey = randomUUID(), textKey = randomUUID(), coverKey = randomUUID(), noopKey = randomUUID();
const textInput = { name: `Renamed game ${run}`, desc: 'Updated description — 用户内容不翻译 <script>literal</script>.' };
const coverInput = { ...textInput, cover: versions[1].cover };
let original, foreign, external, firstHistory, firstGame, firstCover, firstCard, session, viewPayload, feedbackPayload, viewReceipt, feedbackReceipt;
let baselineStats, baselineVersionStats, textEdit, coverEdit, latest, released, editedCard, noopEdit;

try {
  await check('local identities remain isolated and the original HTML, cover and version are recorded', async () => {
    assert.equal(ok(await request('/api/me')).user.id, owner, 'Use a compiled Worker; the dev server replaces fixture identities.');
    original = await createWork(originalName, {}, publishKey); foreign = await createWork(`Foreign ${run}`, {}, randomUUID(), reader); external = await createWork(`External ${run}`, { source: 'url' });
    Object.assign(report.ids, { work: original.id, v1: original.versionId, foreign: foreign.id, external: external.id });
    assert.equal(original.revision, 1); assert.equal(original.version, 'v1');
    firstHistory = versionContent((await history(original.id)).versions); assert.equal(firstHistory.length, 1); assert.equal(firstHistory[0].contentHash, digest(versions[0].html));
    firstGame = ok(await request(`/game/${original.versionId}`)); assert(firstGame.includes(versions[0].marker));
    firstCover = await image(original.coverUrl); assert.equal(digest(firstCover), digest(versions[0].cover));
  });
  await check('a saved card and existing gameplay, feedback and social activity establish an immutable baseline', async () => {
    firstCard = ok(await request('/api/cards', { method: 'POST', json: { name: 'Metadata fixture creator', bio: '', template: 'fold', workIds: [original.id], workRefs: [{ workId: original.id, versionId: original.versionId }] } }), 201).card;
    assert.equal(firstCard.works[0].name, original.name); assert.equal(digest(await image(firstCard.works[0].coverUrl)), digest(firstCover)); report.ids.card = firstCard.id;
    session = ok(await request('/api/sessions', { method: 'POST', user: reader, json: { workId: original.id, versionId: original.versionId } }), 201); report.ids.session = session.id;
    const events = [
      { id: randomUUID(), type: 'play_start', seq: 1, elapsedMs: 500 },
      { id: randomUUID(), type: 'game_complete', seq: 2, elapsedMs: 7000, result: { score: 2, label: 'Original game result.' } },
      { id: randomUUID(), type: 'session_end', seq: 3, elapsedMs: 9000, result: { timingVersion: 1, activeMs: 6000 } },
    ];
    session.payload = { token: session.token, events };
    assert.equal(ok(await request(`/api/sessions/${session.id}/events`, { method: 'POST', user: reader, json: session.payload })).accepted.length, 3);
    viewPayload = { eventId: randomUUID(), type: 'work_view', workId: original.id };
    viewReceipt = ok(await request('/api/events', { method: 'POST', user: reader, json: viewPayload })).receipt;
    feedbackPayload = { eventId: randomUUID(), type: '建议', text: 'Feedback on the original game.', workId: original.id };
    feedbackReceipt = ok(await request('/api/feedback', { method: 'POST', user: reader, json: feedbackPayload }), 201).feedback;
    ok(await request(`/api/works/${original.id}/like`, { method: 'POST', user: reader, json: { liked: true } }));
    ok(await request(`/api/works/${original.id}/comments`, { method: 'POST', user: reader, json: { body: 'Keep this comment on the same work.' }, headers: { 'Idempotency-Key': randomUUID() } }), 201);
    baselineStats = await analytics(original.id); baselineVersionStats = await analytics(original.id, original.versionId);
    assert.equal(baselineStats.summary.starts, 1); assert.equal(baselineStats.summary.totalActiveMs, 6000); assert.equal(baselineStats.summary.likes, 1); assert.equal(baselineStats.summary.comments, 1); assert.equal(baselineStats.summary.feedback, 1);
  });
  await check('metadata PATCH enforces authentication, ownership and CSRF without changing the work', async () => {
    const before = await current(original.id);
    rejected(await edit(original.id, 1, textInput, randomUUID(), { user: null }), [401]);
    rejected(await edit(original.id, 1, textInput, randomUUID(), { user: reader }), [403], 'NOT_OWNER');
    rejected(await edit(original.id, 1, textInput, randomUUID(), { headers: { 'Idempotency-Key': randomUUID(), Origin: 'https://foreign.example' } }), [403]);
    rejected(await edit(original.id, 1, textInput, randomUUID(), { headers: { 'Idempotency-Key': randomUUID(), Origin: 'null' } }), [403]);
    rejected(await edit(original.id, 1, textInput, randomUUID(), { headers: { 'Idempotency-Key': randomUUID(), 'X-Funtrack-CSRF': '' } }), [403]);
    rejected(await edit(randomUUID(), 1, textInput), [404]);
    assert.deepEqual(await current(original.id), before); assert.deepEqual(versionContent((await history(original.id)).versions), firstHistory);
  });
  await check('renaming and editing the description preserve the game version, content hash and cover bytes', async () => {
    textEdit = ok(await edit(original.id, 1, textInput, textKey)); latest = await current(original.id);
    assert.equal(textEdit.work.id, original.id); assert.equal(latest.name, textInput.name); assert.equal(latest.desc, textInput.desc);
    assert.equal(latest.versionId, original.versionId); assert.equal(latest.version, 'v1'); assert.equal(latest.revision, 2); assert.equal(latest.createdAt, original.createdAt);
    assert(latest.metadataId); assert.equal(textEdit.current.metadataId, latest.metadataId);
    assert.equal(digest(await image(latest.coverUrl)), digest(firstCover)); assert.equal(ok(await request(`/game/${latest.versionId}`)), firstGame);
    assert.deepEqual(versionContent((await history(original.id)).versions), firstHistory);
  });
  await check('saving unchanged metadata records a no-op without creating a version or advancing revision', async () => {
    const before = await current(original.id); noopEdit = ok(await edit(original.id, before.revision, textInput, noopKey));
    assert.equal(noopEdit.operation.action, 'edit'); assert.equal(noopEdit.operation.changed, false); assert.equal(noopEdit.operation.previousRevision, before.revision); assert.equal(noopEdit.operation.revision, before.revision);
    assert.equal(noopEdit.current.metadataId, before.metadataId); assert.equal(noopEdit.work.updatedAt, before.updatedAt);
    assert.deepEqual(await current(original.id), before); assert.deepEqual(versionContent((await history(original.id)).versions), firstHistory);
  });
  await check('cover replacement creates a new immutable resource while old media and card remain intact', async () => {
    coverEdit = ok(await edit(original.id, latest.revision, coverInput, coverKey)); latest = await current(original.id);
    assert.equal(latest.revision, 3); assert.equal(latest.versionId, original.versionId); assert.notEqual(latest.metadataId, textEdit.work.metadataId);
    assert.notEqual(latest.coverUrl, original.coverUrl); assert.equal(digest(await image(latest.coverUrl)), digest(versions[1].cover));
    assert.equal(digest(await image(original.coverUrl)), digest(firstCover)); assert.equal(digest(await image(textEdit.work.coverUrl)), digest(firstCover));
    assert.deepEqual(ok(await request(`/api/cards/${firstCard.id}`)).card, firstCard);
    assert.deepEqual(versionContent((await history(original.id)).versions), firstHistory);
    Object.assign(report.ids, { textMetadata: textEdit.work.metadataId, coverMetadata: latest.metadataId, editedCover: latest.coverUrl });
  });
  await check('detail, creator listing and discover expose the edited metadata without adding a work', async () => {
    assert.equal(ok(await request('/api/discover?' + new URLSearchParams({ q: textInput.name, author: owner }))).works.length,0,'Unreviewed metadata must not enter Feed.');
    latest=await approveFixture(original.id,owner);
    const mine = ok(await request('/api/works?mine=1')).works; assert.equal(mine.length, 2);
    assert.deepEqual(publicMetadata(mine.find(work => work.id === original.id)), publicMetadata(latest));
    const discovered = ok(await request('/api/discover?' + new URLSearchParams({ q: textInput.name, author: owner }))).works;
    assert.equal(discovered.length, 1); assert.equal(discovered[0].id, original.id); assert.deepEqual(publicMetadata(discovered[0]), publicMetadata(latest));
    const detail = ok(await request(`/api/works/${original.id}/versions/${original.versionId}`));
    assert.deepEqual(detail.version, firstHistory[0]); assert.deepEqual(publicMetadata(detail.work), publicMetadata(latest));
  });
  await check('completed edit retries freeze their original result and never undo a later edit', async () => {
    const frozen = ok(await edit(original.id, 1, textInput, textKey));
    assert.deepEqual(frozen.work, textEdit.work); assert.deepEqual(frozen.operation, textEdit.operation); assert.equal(frozen.current.revision, latest.revision); assert.equal(frozen.current.metadataId, latest.metadataId);
    const coverReplay = ok(await edit(original.id, 2, coverInput, coverKey)); assert.deepEqual(coverReplay.work, coverEdit.work); assert.deepEqual(coverReplay.operation, coverEdit.operation);
    const noopReplay = ok(await edit(original.id, 2, textInput, noopKey)); assert.deepEqual(noopReplay.work, noopEdit.work); assert.deepEqual(noopReplay.operation, noopEdit.operation); assert.equal(noopReplay.current.metadataId, latest.metadataId);
    rejected(await edit(original.id, 1, { ...textInput, name: 'Different request under the old key.' }, textKey), [409], 'IDEMPOTENCY_CONFLICT');
    rejected(await edit(original.id, 2, { ...coverInput, cover: versions[2].cover }, coverKey), [409], 'IDEMPOTENCY_CONFLICT');
    assert.deepEqual(await current(original.id), latest);
    const initial = ok(await request('/api/works', { method: 'POST', form: publicationForm(originalName), headers: { 'Idempotency-Key': publishKey } }));
    assert.equal(initial.work.name, original.name); assert.equal(initial.work.desc, original.desc); assert.equal(initial.work.versionId, original.versionId); assert.equal(initial.work.coverUrl, original.coverUrl);
    assert.equal(initial.current.revision, latest.revision);
  });
  await check('stale revisions, malformed metadata and invalid covers cannot change any published state', async () => {
    const before = await current(original.id);
    const conflict = rejected(await edit(original.id, 1, textInput), [409], 'WORK_CONFLICT');
    assert.equal(conflict.error.current.revision, latest.revision); assert.equal(conflict.error.current.versionId, original.versionId);
    rejected(await edit(original.id, latest.revision, textInput, randomUUID(), { headers: {} }), [422]);
    for (const invalid of [{ name: '', desc: 'Valid description.' }, { name: 'x'.repeat(81), desc: 'Valid description.' }, { name: 'Valid name', desc: '' }, { name: 'Valid name', desc: 'x'.repeat(501) }]) rejected(await edit(original.id, latest.revision, invalid), [422]);
    for (const revision of ['', -1, 1.5, 'invalid']) rejected(await edit(original.id, revision, textInput), [422]);
    for (const [field, value] of [['source', 'url'], ['url', 'https://example.com/replacement'], ['file', new File([versions[2].html], 'replacement.html', { type: 'text/html' })]]) {
      const form = editForm(latest.revision, textInput); form.set(field, value);
      rejected(await request(`/api/works/${original.id}`, { method: 'PATCH', form, headers: { 'Idempotency-Key': randomUUID() } }), [422], 'INVALID_WORK_FIELDS');
    }
    const duplicate = editForm(latest.revision, textInput); duplicate.append('name', 'Ambiguous duplicate name');
    rejected(await request(`/api/works/${original.id}`, { method: 'PATCH', form: duplicate, headers: { 'Idempotency-Key': randomUUID() } }), [422], 'INVALID_WORK_FIELDS');
    rejected(await edit(original.id, latest.revision, { ...textInput, cover: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>') }), [415, 422]);
    rejected(await edit(original.id, latest.revision, { ...textInput, cover: Buffer.alloc(2 * 1024 * 1024 + 1) }), [413]);
    assert.deepEqual(await current(original.id), before); assert.deepEqual(versionContent((await history(original.id)).versions), firstHistory);
  });

  await check('card preview references preserve the selected metadata snapshot after subsequent edits', async () => {
    const input = { name: 'Metadata fixture creator', bio: '', template: 'fold', workIds: [original.id], workRefs: [{ workId: original.id, versionId: original.versionId, metadataId: textEdit.work.metadataId }] };
    const oldTextCard = ok(await request('/api/cards', { method: 'POST', json: input }), 201).card;
    assert.equal(oldTextCard.works[0].name, textEdit.work.name); assert.equal(oldTextCard.works[0].desc, textEdit.work.desc);
    assert.equal(oldTextCard.works[0].coverUrl, textEdit.work.coverUrl); assert.equal(digest(await image(oldTextCard.works[0].coverUrl)), digest(firstCover));
    const key = randomUUID(), coverCardInput = { ...input, workRefs: [{ workId: original.id, versionId: original.versionId, metadataId: coverEdit.work.metadataId }] };
    editedCard = ok(await request('/api/cards', { method: 'POST', json: coverCardInput, headers: { 'Idempotency-Key': key } }), 201).card;
    assert.equal(editedCard.works[0].coverUrl, coverEdit.work.coverUrl); report.ids.editedCard = editedCard.id;
    assert.deepEqual(ok(await request('/api/cards', { method: 'POST', json: coverCardInput, headers: { 'Idempotency-Key': key } })).card, editedCard);
    rejected(await request('/api/cards', { method: 'POST', json: input, headers: { 'Idempotency-Key': key } }), [409], 'IDEMPOTENCY_CONFLICT');
    for (const metadataId of [foreign.metadataId, randomUUID()]) {
      assert(metadataId, 'New publications must return an immutable metadata ID.');
      rejected(await request('/api/cards', { method: 'POST', json: { ...input, workRefs: [{ workId: original.id, versionId: original.versionId, metadataId }] } }), [422], 'INVALID_METADATA');
    }
    assert.deepEqual(ok(await request(`/api/cards/${firstCard.id}`)).card, firstCard);
  });
  await check('card previews without a metadata ID use their expected revision to reject stale displayed content', async () => {
    const input = { name: 'Metadata fixture creator', bio: '', template: 'fold', workIds: [original.id], workRefs: [{ workId: original.id, versionId: original.versionId, expectedRevision: original.revision }] };
    rejected(await request('/api/cards', { method: 'POST', json: input }), [409], 'WORK_CONFLICT');
    const freshInput = { ...input, workRefs: [{ workId: original.id, versionId: original.versionId, expectedRevision: latest.revision }] };
    const saved = ok(await request('/api/cards', { method: 'POST', json: freshInput }), 201).card;
    assert.equal(saved.works[0].name, latest.name); assert.equal(saved.works[0].desc, latest.desc); assert.equal(saved.works[0].versionId, original.versionId);
    assert.deepEqual(await current(original.id), latest);
  });
  await check('two simultaneous edits of one revision commit exactly one metadata change', async () => {
    const before = await current(original.id), inputs = [
      { name: `Concurrent edit A ${run}`, desc: 'Winning metadata A, if selected.', cover: versions[2].cover },
      { name: `Concurrent edit B ${run}`, desc: 'Winning metadata B, if selected.', cover: versions[0].cover },
    ];
    const results = await Promise.all(inputs.map(input => edit(original.id, before.revision, input)));
    assert.equal(results.filter(result => result.status === 200).length, 1, JSON.stringify(results.map(result => result.body)));
    assert.equal(results.filter(result => result.status === 409).length, 1, JSON.stringify(results.map(result => result.body)));
    const winner = results.findIndex(result => result.status === 200), loser = results.find(result => result.status === 409);
    rejected(loser, [409], 'WORK_CONFLICT'); latest = await current(original.id);
    assert.equal(latest.revision, before.revision + 1); assert.equal(latest.versionId, original.versionId); assert.equal(latest.name, inputs[winner].name); assert.equal(latest.desc, inputs[winner].desc);
    assert.equal(digest(await image(latest.coverUrl)), digest(inputs[winner].cover));
    assert.deepEqual(versionContent((await history(original.id)).versions), firstHistory);
    assert.deepEqual(ok(await request(`/api/cards/${editedCard.id}`)).card, editedCard);
    assert.equal(digest(await image(editedCard.works[0].coverUrl)), digest(versions[1].cover));
  });
  await check('a new game version inherits the edited cover while keeping the latest name and description', async () => {
    const before = await current(original.id), inheritedCover = digest(await image(before.coverUrl));
    released = ok(await publishVersion(original.id, before.revision), 201); report.ids.v2 = released.version.id;
    latest = await current(original.id); assert.equal(latest.versionId, released.version.id); assert.equal(latest.version, 'v2'); assert.equal(latest.revision, before.revision + 1);
    assert.equal(latest.name, before.name); assert.equal(latest.desc, before.desc); assert.equal(latest.createdAt, original.createdAt);
    assert.equal(digest(await image(latest.coverUrl)), inheritedCover); assert.equal(digest(await image(released.version.coverUrl)), inheritedCover);
    assert.equal(released.version.contentHash, digest(versions[1].html)); assert(ok(await request(`/game/${latest.versionId}`)).includes(versions[1].marker));
    assert.equal((await history(original.id)).versions.length, 2); assert.equal(ok(await request(`/game/${original.versionId}`)), firstGame);
    const frozen = ok(await edit(original.id, 1, textInput, textKey)); assert.deepEqual(frozen.work, textEdit.work); assert.equal(frozen.current.versionId, released.version.id); assert.equal((await current(original.id)).versionId, released.version.id);
  });
  await check('rollback restores the selected game and its original cover, retaining edited name and description', async () => {
    const before = await current(original.id), rollback = ok(await activate(original.id, original.versionId, before.revision));
    latest = await current(original.id); assert.equal(rollback.operation.changed, true); assert.equal(latest.revision, before.revision + 1);
    assert.equal(latest.versionId, original.versionId); assert.equal(latest.name, before.name); assert.equal(latest.desc, before.desc);
    assert.equal(digest(await image(latest.coverUrl)), digest(firstCover)); assert.equal(ok(await request(`/game/${latest.versionId}`)), firstGame);
    assert.equal((await history(original.id)).versions.length, 2);
    rejected(await edit(original.id, 3, textInput), [409], 'WORK_CONFLICT');
    const retry = ok(await edit(original.id, 2, coverInput, coverKey)); assert.deepEqual(retry.work, coverEdit.work); assert.deepEqual(retry.operation, coverEdit.operation);
    assert.equal(retry.current.revision, latest.revision); assert.equal(retry.current.versionId, original.versionId); assert.equal(retry.current.metadataId, latest.metadataId);
    assert.deepEqual(await current(original.id), latest); assert.equal(digest(await image(coverEdit.work.coverUrl)), digest(versions[1].cover));
  });
  await check('metadata changes and version switches leave old event receipts, hashes, cards and statistics unchanged', async () => {
    const replayView = ok(await request('/api/events', { method: 'POST', user: reader, json: viewPayload })); assert.equal(replayView.duplicate, true); assert.deepEqual(replayView.receipt, viewReceipt);
    const replayFeedback = ok(await request('/api/feedback', { method: 'POST', user: reader, json: feedbackPayload }));
    // The displayed work name is a live join. The accepted feedback record and
    // version attribution remain fixed even when the work is renamed.
    const { workName: oldDisplayName, ...acceptedFeedback } = feedbackReceipt;
    const { workName: currentDisplayName, ...replayedFeedback } = replayFeedback.feedback;
    assert.equal(currentDisplayName, latest.name); assert.deepEqual(replayedFeedback, acceptedFeedback);
    const replaySession = ok(await request(`/api/sessions/${session.id}/events`, { method: 'POST', user: reader, json: session.payload })); assert.equal(replaySession.accepted.length, 0); assert.equal(replaySession.duplicates.length, session.payload.events.length);
    const finalStats = await analytics(original.id), finalVersionStats = await analytics(original.id, original.versionId);
    assert.deepEqual(finalStats.summary, baselineStats.summary); assert.deepEqual(finalStats.coverage, baselineStats.coverage); assert.deepEqual(finalStats.funnel, baselineStats.funnel);
    assert.deepEqual(finalVersionStats.summary, baselineVersionStats.summary); assert.deepEqual(finalVersionStats.receipts, baselineVersionStats.receipts);
    assert.deepEqual(finalStats.receipts, baselineStats.receipts); report.statistics = finalStats.summary;
    const entries = versionContent((await history(original.id)).versions); assert.equal(entries.length, 2); assert.deepEqual(entries[0], firstHistory[0]); assert.deepEqual(entries[1], released.version);
    assert.deepEqual(ok(await request(`/api/cards/${firstCard.id}`)).card, firstCard); assert.deepEqual(ok(await request(`/api/cards/${editedCard.id}`)).card, editedCard);
    assert.equal(ok(await request(`/game/${original.versionId}`)), firstGame); assert.equal(digest(await image(original.coverUrl)), digest(firstCover));
  });
  await check('external works can edit display metadata without replacing their URL or creating a game version', async () => {
    const input = { name: `Edited external ${run}`, desc: 'Updated external description.', cover: versions[2].cover };
    const result = ok(await edit(external.id, external.revision, input)), saved = await current(external.id);
    assert.equal(saved.name, input.name); assert.equal(saved.desc, input.desc); assert.equal(saved.source, 'url'); assert.equal(saved.url, external.url);
    assert.equal(saved.versionId, external.versionId); assert.equal(saved.version, 'v1'); assert.equal(saved.revision, external.revision + 1); assert.equal(result.work.id, external.id);
    assert.equal(digest(await image(saved.coverUrl)), digest(versions[2].cover)); assert.equal(digest(await image(external.coverUrl)), digest(versions[0].cover));
  });
  await check('a simultaneous metadata edit and game upload share one CAS boundary and cannot overwrite each other', async () => {
    const target = await createWork(`Edit versus release ${run}`, {html:versions[0].html+`\n<!-- distinct edit race ${run} -->`}), input = { name: `Edit won ${run}`, desc: 'Metadata wins only if the revision still matches.', cover: versions[2].cover };
    const raceVersion={...versions[1],html:versions[1].html+`\n<!-- distinct release race ${run} -->`};
    const [edited, published] = await Promise.all([edit(target.id, target.revision, input), publishVersion(target.id, target.revision, raceVersion, versions[1].cover)]);
    assert.equal([edited, published].filter(result => result.status === 200 || result.status === 201).length, 1, JSON.stringify([edited.body, published.body]));
    assert.equal([edited, published].filter(result => result.status === 409).length, 1, JSON.stringify([edited.body, published.body]));
    const saved = await current(target.id), entries = versionContent((await history(target.id)).versions); assert.equal(saved.revision, target.revision + 1);
    if (edited.status === 200) {
      rejected(published, [409], 'VERSION_CONFLICT'); assert.equal(saved.versionId, target.versionId); assert.equal(entries.length, 1); assert.equal(saved.name, input.name); assert.equal(saved.desc, input.desc); assert.equal(digest(await image(saved.coverUrl)), digest(versions[2].cover));
    } else {
      rejected(edited, [409], 'WORK_CONFLICT'); const result = ok(published, 201); assert.equal(saved.versionId, result.version.id); assert.equal(entries.length, 2); assert.equal(saved.name, target.name); assert.equal(saved.desc, target.desc); assert.equal(digest(await image(saved.coverUrl)), digest(versions[1].cover));
    }
    assert.equal(digest(await image(target.coverUrl)), digest(versions[0].cover)); report.ids.raceWork = target.id;
  });
  report.completedAt = new Date().toISOString();
} finally {
  await mkdir('.preview', { recursive: true }); await writeFile('.preview/local-work-edit-integration.json', JSON.stringify(report, null, 2));
  console.log(`Completed ${report.checks.length} work edit checks. Evidence: .preview/local-work-edit-integration.json`);
}
