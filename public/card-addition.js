import { CARD_TEMPLATES } from './card-templates.js';

export function hasCardDraft(draft, preview, savedCard = null) {
  const content = value => JSON.stringify({ ids: value?.ids || value?.workIds || [], template: value?.template || 'wall', signature: value?.signature || '', backStyle: value?.backStyle || 'ink' });
  const references = value => JSON.stringify((value?.works || []).map(work => [work.id, work.versionId, work.metadataId, work.coverUrl]));
  if (savedCard && content(draft) === content(savedCard) && (!preview || references(preview) === references(savedCard))) return false;
  return Boolean(draft?.ids?.length || draft?.signature || (draft?.template && draft.template !== 'wall') || (draft?.backStyle && draft.backStyle !== 'ink') || preview);
}

// A saved card is an immutable starting point, not an update target. Resolve
// current works again when generating a preview; the server validates at save.
export function planCardAddition({ workId, works, ownerId, draft, card, source = 'draft' }) {
  const available = new Set(works.filter(work => work.authorId === ownerId && !work.archivedAt).map(work => work.id));
  if (!ownerId || (workId && !available.has(workId))) return { error: 'WORK_UNAVAILABLE' };
  let base;
  if (source === 'card') {
    if (!card || card.authorId !== ownerId) return { error: 'CARD_UNAVAILABLE' };
    base = { ids: card.workIds || card.works?.map(work => work.id) || [], template: card.template, signature: card.signature, backStyle: card.backStyle };
  } else if (source === 'new') {
    base = { ids: [], template: 'wall', signature: '', backStyle: 'ink' };
  } else if (source === 'draft') {
    base = draft || { ids: [], template: 'wall', signature: '', backStyle: 'ink' };
  } else return { error: 'INVALID_SOURCE' };
  const original = Array.isArray(base.ids) ? [...new Set(base.ids)] : [];
  const ids = original.filter(id => available.has(id));
  if (workId && !ids.includes(workId)) ids.push(workId);
  if (ids.length > 30) return { error: 'CARD_FULL' };
  return { removedCount: original.filter(id => !available.has(id)).length, draft: {
    ids, template: CARD_TEMPLATES.some(item => item.id === base.template) ? base.template : 'wall',
    signature: typeof base.signature === 'string' ? base.signature : '',
    backStyle: ['ink', 'ivory', 'cobalt'].includes(base.backStyle) ? base.backStyle : 'ink',
  } };
}
