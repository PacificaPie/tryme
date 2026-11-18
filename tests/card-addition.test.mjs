import test from 'node:test';
import assert from 'node:assert/strict';
import { planCardAddition } from '../public/card-addition.js';

const works = ['old', 'new'].map(id => ({ id, authorId: 'owner' }));
test('adding a publication requires an explicit source and preserves saved cards/drafts', () => {
  const draft = { ids: ['old'], template: 'fold', signature: 'My work', backStyle: 'ivory' };
  const card = { authorId: 'owner', workIds: ['old'], template: 'editorial', works: [{ id: 'old', versionId: 'pinned-v1' }] };
  const before = structuredClone({ draft, card });
  const result = planCardAddition({ workId: 'new', works, ownerId: 'owner', draft, card, source: 'card' });
  assert.deepEqual(result.draft.ids, ['old', 'new']);
  assert.equal(result.draft.template, 'editorial');
  assert.deepEqual({ draft, card }, before);
  assert.equal(card.works[0].versionId, 'pinned-v1');
  const merged = planCardAddition({ workId: 'new', works, ownerId: 'owner', draft, source: 'draft' });
  assert.deepEqual(merged.draft, { ...draft, ids: ['old', 'new'] });
});
test('duplicate work is not added twice and full drafts are never silently truncated', () => {
  const all = Array.from({ length: 31 }, (_, i) => ({ id: String(i), authorId: 'owner' }));
  const draft = { ids: all.slice(0, 30).map(work => work.id) };
  assert.equal(planCardAddition({ workId: '30', works: all, ownerId: 'owner', draft }).error, 'CARD_FULL');
  assert.deepEqual(planCardAddition({ workId: '0', works: all, ownerId: 'owner', draft }).draft.ids, draft.ids);
});
test('ownership and archived works are checked, and foreign cards cannot seed a draft', () => {
  assert.equal(planCardAddition({ workId: 'foreign', works: [{ id: 'foreign', authorId: 'other' }], ownerId: 'owner' }).error, 'WORK_UNAVAILABLE');
  assert.equal(planCardAddition({ workId: 'old', works: [{ ...works[0], archivedAt: '2026-11-18' }], ownerId: 'owner' }).error, 'WORK_UNAVAILABLE');
  assert.equal(planCardAddition({ workId: 'new', works, ownerId: 'owner', card: { authorId: 'other' }, source: 'card' }).error, 'CARD_UNAVAILABLE');
  assert.deepEqual(planCardAddition({ workId: 'new', works, ownerId: 'owner', draft: { ids: ['old'], signature: 'old' }, source: 'new' }).draft,
    { ids: ['new'], template: 'wall', signature: '', backStyle: 'ink' });
});
