// A card owns its layout and selected work versions; its creator owns identity.
// Only project onto this user's card, never onto a card being viewed or remixed.
export function withCardIdentity(card, user) {
  if (!card || typeof user?.id !== 'string' || !user.id || card.authorId !== user.id) return card;
  const text = key => typeof user[key] === 'string' ? user[key] : '';
  return {
    ...card,
    name: text('name'), bio: text('bio'), headline: text('headline'),
    website: text('website'), avatarUrl: text('avatarUrl'),
    works: (card.works || []).map(work => work.authorId === user.id
      ? { ...work, authorName: text('name'), authorAvatarUrl: text('avatarUrl') }
      : work),
  };
}

export function cardPreviewFingerprint(card) {
  return JSON.stringify({
    name: card.name, bio: card.bio, headline: card.headline || '',
    website: card.website || '', avatarUrl: card.avatarUrl || '',
    signature: card.signature || '', backStyle: card.backStyle || 'ink',
    template: card.template, works: card.works,
  });
}
