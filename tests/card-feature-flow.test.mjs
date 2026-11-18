import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, OWNER, OTHER, handleAPI } from './helpers/router-fixture.mjs';
import { CARD_TEMPLATES } from '../public/card-templates.js';
import { planCardAddition, hasCardDraft } from '../public/card-addition.js';
import { renderCardDraftStart } from '../public/card-draft-flow.js';
import { withCardIdentity, cardPreviewFingerprint } from '../public/card-identity.js';
import { prepareCardPreview, previewReferences } from '../public/versioning-state.js';

const save = (f, draft, works, user, key = randomUUID()) => {
  const selected = draft.ids.map(id => works.find(work => work.id === id));
  const card = withCardIdentity({ authorId: OWNER, ...draft, workIds: draft.ids, works: selected }, user);
  const preview = prepareCardPreview(null, { ...card, fingerprint: cardPreviewFingerprint(card) }, key);
  return f.api('/api/cards', { method: 'POST', key, body: { ...preview, workRefs: previewReferences(preview) } });
};
const publicRead = async id => (await handleAPI(new Request('https://site.test/api/public/cards/' + id))).json();

for (const { id: template } of CARD_TEMPLATES) test(`${template}: new card preserves previous link and snapshot while both project live identity`, async t => {
  const f = fixture(t);
  await f.api('/api/me/profile', { method: 'POST', body: { name: 'Before', bio: 'A maker', avatarPreset: 'sun' } });
  const user = (await f.api('/api/me')).user;
  const { work: oldWork } = await f.publish({ cover: true });
  const first = await save(f, { ids: [oldWork.id], template, signature: 'First', backStyle: 'cobalt' }, [oldWork], user);
  assert.equal(first.status, 201);
  const stored = f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(first.card.id).snapshot_json;
  const oldPublic = (await publicRead(first.card.id)).card;
  await f.version(oldWork.id);
  const current = (await f.get(oldWork.id)).work;
  const { work: newWork } = await f.publish({ name: 'New creation', bytes: '<html><body>New creation</body></html>' });
  const original = structuredClone(first.card);
  const planned = planCardAddition({ workId: newWork.id, works: [current, newWork], ownerId: OWNER, card: first.card, source: 'card' });
  assert.deepEqual(first.card, original);
  // Session serialization, navigation away and recovery keep the candidate order/style.
  const restored = JSON.parse(JSON.stringify(planned.draft));
  const key = randomUUID(), next = await save(f, restored, [current, newWork], user, key);
  assert.equal(next.status, 201); assert.notEqual(next.card.id, first.card.id);
  assert.equal(next.card.template, template); assert.equal(next.card.works[0].versionId, current.versionId);
  assert.deepEqual(next.card.workIds, [oldWork.id, newWork.id]);
  const replay = await save(f, restored, [current, newWork], user, key);
  assert.equal(replay.card.id, next.card.id); assert.equal(f.count('ft_cards'), 2);
  await f.api('/api/me/profile', { method: 'POST', body: { name: 'Current identity', bio: 'Updated profile', avatarPreset: 'moon' } });
  for (const id of [first.card.id, next.card.id]) {
    const card = (await publicRead(id)).card;
    assert.equal(card.name, 'Current identity'); assert.equal(card.avatarUrl, '/avatars/moon.svg');
    for (const forbidden of ['authorId', 'game_key', 'metadataId', 'gameUrl', 'email', OWNER]) assert(!JSON.stringify(card).includes(forbidden));
  }
  const kept = (await publicRead(first.card.id)).card;
  assert.equal(kept.works[0].versionId, oldPublic.works[0].versionId);
  assert.equal(kept.works[0].coverUrl, oldPublic.works[0].coverUrl);
  assert.equal(kept.works[0].desc, oldPublic.works[0].desc);
  assert.equal(f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(first.card.id).snapshot_json, stored);
});

test('stale or foreign selection cannot save; unavailable items are disclosed when seeding a new draft', async t => {
  const f = fixture(t), { work } = await f.publish(), { work: foreign } = await f.publish({ owner: OTHER });
  const user = (await f.api('/api/me')).user;
  const selected = { ids: [work.id], template: 'city', signature: '', backStyle: 'ivory' };
  const first = await save(f, selected, [work], user);
  const archive = await f.api('/api/works/' + work.id + '/archive', { method: 'POST', body: { action: 'archive', expectedRevision: work.revision } });
  assert.equal(archive.status, 200);
  const planned = planCardAddition({ works: [], ownerId: OWNER, card: first.card, source: 'card' });
  assert.equal(planned.removedCount, 1); assert.deepEqual(planned.draft.ids, []);
  assert.equal((await save(f, selected, [work], user)).status, 409);
  const denied = await save(f, { ...selected, ids: [foreign.id] }, [foreign], user);
  assert.equal(denied.status, 403); assert.equal(f.count('ft_cards'), 1);
  assert.equal((await publicRead(first.card.id)).card.works.length, 1);
});

test('draft presence includes a template or back style before any work is selected', () => {
  assert(hasCardDraft({ template: 'city' })); assert(hasCardDraft({ backStyle: 'ivory' }));
  assert(!hasCardDraft({ ids: [], template: 'wall', signature: '', backStyle: 'ink' }));
});

test('start route is read-only until confirmation and ignores callbacks after account/route changes', async t => {
  const oldDocument = globalThis.document; t.after(() => { globalThis.document = oldDocument; });
  for (const stale of [false, true]) {
    let active = true, commits = [], html = '', handler;
    const card = { id: randomUUID(), authorId: OWNER, workIds: ['work-old'], template: 'city' };
    const draft = { ids: ['work-old'], template: 'wall' }, preview = { saveKey: 'old-preview' };
    const before = structuredClone({ card, draft, preview });
    globalThis.document = { querySelectorAll: () => [{ dataset: { addSource: 'card' }, addEventListener: (_, callback) => { handler = callback; } }] };
    await renderCardDraftStart({ params: new URLSearchParams({ addWork: 'work-new' }) }, {
      api: async () => ({ card }), readMine: async () => ['work-old', 'work-new'].map(id => ({ id, authorId: OWNER })), owner: OWNER,
      current: () => active, getDraft: () => draft, getPreview: () => preview, commit: value => commits.push(value),
      render: value => { html = value; return true; }, esc: String, notify() {}, go() {},
    });
    assert.equal(commits.length, 0); assert.deepEqual({ card, draft, preview }, before);
    assert.match(html, /保存会生成新链接/); assert.match(html, /选择其他起点会替换当前未保存草稿/);
    if (stale) active = false; handler();
    assert.equal(commits.length, stale ? 0 : 1);
    if (!stale) assert.deepEqual(commits[0].ids, ['work-old', 'work-new']);
  }
});

test('a draft matching the saved card is not offered as unfinished, while newer preview versions are retained', () => {
  const draft = { ids: ['work-one'], template: 'city', signature: '', backStyle: 'ink' };
  const card = { ...draft, ids: undefined, workIds: draft.ids, works: [{ id: 'work-one', versionId: 'v1', metadataId: 'm1' }] };
  assert.equal(hasCardDraft(draft, { works: card.works }, card), false);
  assert.equal(hasCardDraft(draft, { works: [{ ...card.works[0], versionId: 'v2' }] }, card), true);
  assert.equal(hasCardDraft({ ...draft, signature: 'New signature' }, null, card), true);
});

test('empty or ambiguous start parameters fail before data loading or draft mutation', async () => {
  for (const query of ['addWork=', 'editCard=', 'addWork=work-new&editCard=71160f2c-1946-4d96-a85c-bfdaf5940fe8']) {
    await assert.rejects(renderCardDraftStart({ params: new URLSearchParams(query) }, { api() { throw Error('must not load'); } }), error => error.status === 404);
  }
});
