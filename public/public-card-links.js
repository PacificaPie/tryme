const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isCardId = value => typeof value === 'string' && UUID.test(value);
export const isPublicWorkId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
export function publicCardPath(id) { return isCardId(id) ? '/c/' + encodeURIComponent(id.toLowerCase()) : null; }
export function legacyPublicCardPath(hash) {
  const match = typeof hash === 'string' && /^#\/card\/([^/?#]+)(?:\?[^#]*)?$/.exec(hash);
  return match ? publicCardPath(match[1]) : null;
}
export function publicCardId(pathname) {
  const match = typeof pathname === 'string' && /^\/c\/([^/]+)\/?$/.exec(pathname);
  return match && isCardId(match[1]) ? match[1].toLowerCase() : null;
}
export function snapshotPlayPath(cardId, workId) {
  if (!isCardId(cardId) || !isPublicWorkId(workId)) return null;
  const params = new URLSearchParams({from:'/card/' + cardId, card:cardId, play:'1'});
  return '/site.html#/work/' + encodeURIComponent(workId) + '?' + params;
}
export function publicPlaySignInPath(cardId, workId) {
  const target = snapshotPlayPath(cardId, workId);
  return target ? '/auth/sign-in.html?return_to=' + encodeURIComponent(target) : null;
}
export function publicCardRemixSignInPath(cardId) {
  if (!isCardId(cardId)) return null;
  return '/auth/sign-in.html?return_to=' + encodeURIComponent('/site.html#/cards/me?templateFrom=' + cardId.toLowerCase());
}
export function publicCardBackPath(returnTo) {
  const remix=typeof returnTo==='string'&&/^\/site(?:\.html)?#\/cards\/me\?([^#]*)$/.exec(returnTo);
  if(remix){const id=new URLSearchParams(remix[1]).get('templateFrom');return publicCardPath(id);}
  const match=typeof returnTo==='string'&&/^\/site(?:\.html)?#\/work\/([^/?#]+)\?([^#]*)$/.exec(returnTo);
  if(!match||!isPublicWorkId(match[1]))return null;
  const params=new URLSearchParams(match[2]),cardId=params.get('card');
  return isCardId(cardId)&&params.get('from')==='/card/'+cardId?publicCardPath(cardId):null;
}
export function publicCoverPath(value, cardId, workId, origin = globalThis.location?.origin) {
  if (!value || !isCardId(cardId) || !isPublicWorkId(workId) || !origin) return '';
  const expected = `/api/public/cards/${encodeURIComponent(cardId)}/works/${encodeURIComponent(workId)}/cover`;
  try {
    const url = new URL(value, origin);
    return url.origin === origin && url.pathname === expected && !url.search && !url.hash ? expected : '';
  } catch { return ''; }
}
