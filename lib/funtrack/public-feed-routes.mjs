// Anonymous discovery reads include listed works and explicitly selected cards.
// Card covers recheck Feed eligibility separately from link-sharing covers.
// Keep this allowlist shared by the standalone boundary and application router.
export function publicFeedReadRoute(request) {
  if (!['GET', 'HEAD'].includes(request.method)) return null;
  const path = new URL(request.url).pathname;
  if (path === '/api/public/discover') return { kind: 'discover' };
  const cardCover = /^\/api\/public\/discover\/cards\/([A-Za-z0-9_-]{8,128})\/works\/([A-Za-z0-9_-]{8,128})\/cover$/.exec(path);
  if (cardCover) return { kind: 'cardCover', cardId: cardCover[1], workId: cardCover[2] };
  const preview = /^\/api\/public\/works\/([A-Za-z0-9_-]{8,128})\/preview\/([A-Za-z0-9_-]{8,128})$/.exec(path);
  if (preview) return { kind: 'preview', workId: preview[1], previewId: preview[2] };
  const match = /^\/api\/public\/works\/([A-Za-z0-9_-]{8,128})\/cover$/.exec(path);
  return match ? { kind: 'cover', workId: match[1] } : null;
}
