// Keep the unauthenticated boundary explicit and shared by the Worker and API.
// Public Feed reads have a separate allowlist; identity, game, session and
// mutation routes are never made public by this card-sharing boundary.
export const PUBLIC_CARD_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function publicCardReadRoute(request){
  if(!['GET','HEAD'].includes(request.method))return null;
  const parts=new URL(request.url).pathname.split('/');
  if(parts[0]!==''||parts[1]!=='api'||parts[2]!=='public'||parts[3]!=='cards'||!PUBLIC_CARD_ID.test(parts[4]||''))return null;
  if(parts.length===5)return {kind:'card',cardId:parts[4].toLowerCase()};
  if(parts.length===8&&parts[5]==='works'&&/^[A-Za-z0-9_-]{8,128}$/.test(parts[6])&&parts[7]==='cover')return {kind:'cover',cardId:parts[4].toLowerCase(),workId:parts[6]};
  return null;
}
