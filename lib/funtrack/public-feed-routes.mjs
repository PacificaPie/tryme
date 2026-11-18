// Only discovery metadata and the currently public work's cover are anonymous.
// Keep this allowlist shared by the standalone boundary and application router.
export function publicFeedReadRoute(request) {
  if (!['GET', 'HEAD'].includes(request.method)) return null;
  const path = new URL(request.url).pathname;
  if (path === '/api/public/discover') return { kind: 'discover' };
  const preview = /^\/api\/public\/works\/([A-Za-z0-9_-]{8,128})\/preview\/([A-Za-z0-9_-]{8,128})$/.exec(path);
  if (preview) return { kind: 'preview', workId: preview[1], previewId: preview[2] };
  const match = /^\/api\/public\/works\/([A-Za-z0-9_-]{8,128})\/cover$/.exec(path);
  return match ? { kind: 'cover', workId: match[1] } : null;
}
