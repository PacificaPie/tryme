// Build a candidate only after the owner explicitly chooses a starting point.
// Published cards and the caller's existing draft are never mutated here.
export function planCardAddition({ workId, works, ownerId, draft, card, source = 'draft' }) {
  const available = new Set(works.filter(work => work.authorId === ownerId && !work.archivedAt).map(work => work.id));
  if (!ownerId || !available.has(workId)) return { error: 'WORK_UNAVAILABLE' };
  let base;
  if (source === 'card') {
    if (!card || card.authorId !== ownerId) return { error: 'CARD_UNAVAILABLE' };
    base = { ids: card.workIds || card.works?.map(work => work.id) || [], template: card.template, signature: card.signature || '', backStyle: card.backStyle || 'ink' };
  } else if (source === 'new') {
    base = { ids: [], template: 'wall', signature: '', backStyle: 'ink' };
  } else if (source === 'draft') {
    base = draft || { ids: [], template: 'wall', signature: '', backStyle: 'ink' };
  } else return { error: 'INVALID_SOURCE' };
  const ids = [...new Set((base.ids || []).filter(id => available.has(id)))];
  if (!ids.includes(workId)) {
    if (ids.length >= 30) return { error: 'CARD_FULL' };
    ids.push(workId);
  }
  return { draft: { ids, template: base.template || 'wall', signature: base.signature || '', backStyle: base.backStyle || 'ink' } };
}
