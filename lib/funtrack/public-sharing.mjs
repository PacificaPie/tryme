import {ApiError,fail} from './rules.mjs';
import {PUBLIC_CARD_ID,publicCardReadRoute} from './public-sharing-routes.mjs';
import {safeAvatarURL} from './avatar-rules.mjs';
import {cardIdentity} from './card-identity.mjs';

const text=(value,max)=>typeof value==='string'?value.slice(0,max):'';
const escaped=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const templates=new Set(['wall','fold','collection','city','editorial','filmstrip']);
const safeWebsite=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}};
const headers=(type,cache='no-store')=>({'Content-Type':type,'Cache-Control':cache,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
const response=(request,body,init)=>new Response(request.method==='HEAD'?null:body,init);

export function createPublicSharingService({db,bucket,origin=()=>''}){
  const first=(query,...values)=>db().prepare(query).bind(...values).first();
  async function snapshot(id){
    if(!PUBLIC_CARD_ID.test(id||''))fail(404,'CARD_NOT_FOUND','名片不存在');
    const row=await first('SELECT id,author_id,snapshot_json FROM ft_cards WHERE id=? AND deleted_at IS NULL',id.toLowerCase());
    if(!row)fail(404,'CARD_NOT_FOUND','名片不存在');
    let card;try{card=JSON.parse(row.snapshot_json);}catch{fail(404,'CARD_NOT_FOUND','名片暂时无法打开');}
    if(!card||!Array.isArray(card.works)||card.works.length>30)fail(404,'CARD_NOT_FOUND','名片暂时无法打开');
    return cardIdentity(db(),{...card,id:row.id},row.author_id);
  }
  function coverReference(work){
    // An absent saved cover stays absent. Never substitute the live work cover.
    if(typeof work.coverUrl!=='string')return null;
    const match=/^\/(?:api\/)?media\/([A-Za-z0-9_-]{8,128})$/.exec(work.coverUrl);
    if(!match)return null;
    if(work.metadataId&&match[1]===work.metadataId)return {kind:'metadata',id:match[1]};
    if(match[1]===work.versionId)return {kind:'version',id:match[1]};
    return null;
  }
  function project(card){
    return {id:card.id,template:templates.has(card.template)?card.template:'wall',name:text(card.name,80),bio:text(card.bio,500),avatarUrl:safeAvatarURL(card.avatarUrl),
      headline:text(card.headline,120),signature:text(card.signature,80),website:safeWebsite(card.website),backStyle:['ink','ivory','cobalt'].includes(card.backStyle)?card.backStyle:'ink',createdAt:text(card.createdAt,32),
      works:card.works.filter(w=>w&&/^[A-Za-z0-9_-]{8,128}$/.test(w.id||'')).map(w=>({id:w.id,name:text(w.name,80),desc:text(w.desc,500),authorName:text(w.authorName??card.name,80),authorAvatarUrl:safeAvatarURL(w.authorAvatarUrl),
        source:w.source==='url'?'url':'html',version:text(w.version,80),versionId:text(w.versionId,128),
        coverUrl:coverReference(w)?`/api/public/cards/${card.id}/works/${encodeURIComponent(w.id)}/cover`:''}))};
  }
  async function cover(request,card,workId){
    const work=card.works.find(w=>w?.id===workId),ref=work&&coverReference(work);
    if(!ref)fail(404,'MEDIA_NOT_FOUND','封面不存在');
    // A saved ID is not sufficient: the immutable row must belong to the work
    // actually selected in the card. Both old version and new metadata covers work.
    const row=await first(ref.kind==='metadata'?'SELECT cover_key,cover_mime FROM ft_work_metadata WHERE id=? AND work_id=?':'SELECT cover_key,cover_mime FROM ft_work_versions WHERE id=? AND work_id=?',ref.id,work.id);
    if(!row?.cover_key||!['image/png','image/jpeg','image/webp'].includes(row.cover_mime))fail(404,'MEDIA_NOT_FOUND','封面不存在');
    const object=await bucket().get(row.cover_key);if(!object)fail(404,'MEDIA_NOT_FOUND','封面文件不存在');
    return response(request,object.body,{headers:headers(row.cover_mime)});
  }
  async function api(request){
    const route=publicCardReadRoute(request);if(!route)return null;
    const card=await snapshot(route.cardId);
    if(route.kind==='cover')return cover(request,card,route.workId);
    return response(request,JSON.stringify({card:project(card)}),{headers:headers('application/json; charset=utf-8')});
  }
  function canonicalOrigin(request){
    try{const configured=new URL(origin());if(['https:','http:'].includes(configured.protocol)&&!configured.username&&!configured.password)return configured.origin;}catch{/* Sites has no independent APP_ORIGIN. */}
    return new URL(request.url).origin;
  }
  function shell({card,canonical='',status=200}){
    const name=card?card.name:'名片不存在',title=card?`${name} · TryMe`:'名片不存在 · TryMe',description=card?(card.bio||card.headline||card.works.map(w=>w.name).filter(Boolean).join(' · ')||'TryMe 创作者名片'):'这张名片暂时无法打开。';
    const cover=card?.works.find(w=>w.coverUrl)?.coverUrl,og=canonical?`<link rel="canonical" href="${escaped(canonical)}"><meta property="og:type" content="profile"><meta property="og:url" content="${escaped(canonical)}"><meta property="og:title" content="${escaped(title)}"><meta property="og:description" content="${escaped(description)}"><meta property="og:site_name" content="TryMe">${cover?`<meta property="og:image" content="${escaped(new URL(cover,canonical).href)}"><meta property="og:image:alt" content="${escaped(name)}">`:''}`:'';
    const summary=card?`<article><h1>${escaped(name)}</h1>${card.headline?`<p>${escaped(card.headline)}</p>`:''}<p>${escaped(card.bio)}</p><ul>${card.works.map(w=>`<li><h2>${escaped(w.name)}</h2><p>${escaped(w.desc)}</p></li>`).join('')}</ul><a href="/site.html#/cards">加入 TryMe</a></article>`:`<h1>名片不存在</h1><p>${escaped(description)}</p><a href="/site.html#/cards">TryMe</a>`;
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escaped(title)}</title><link rel="icon" href="/assets/tryme-icon.svg" type="image/svg+xml"><meta name="description" content="${escaped(description)}">${og}<script src="/theme-init.js"></script>${['site','surface','cards-flow','theme','public-card'].map(file=>`<link rel="stylesheet" href="/${file}.css">`).join('')}</head><body class="public-card-page"><header class="public-card-toolbar"><span class="public-card-wordmark">TryMe</span><div class="public-card-tools"><div data-theme-control></div><button id="public-card-locale" type="button" aria-label="Switch to English">EN</button></div></header><main id="public-card-root">${status===200?'<div class="public-card-loading" role="status">正在加载名片…</div>':summary}</main><noscript>${summary}</noscript><script src="/gallery/config.js"></script><script type="module" src="/theme.js"></script>${status===200?'<script type="module" src="/public-card.js"></script>':''}</body></html>`;
  }
  async function page(request,id){
    if(!['GET','HEAD'].includes(request.method))return response(request,'Method not allowed',{status:405,headers:{...headers('text/plain; charset=utf-8','no-store'),Allow:'GET, HEAD'}});
    try{const card=project(await snapshot(id)),canonical=canonicalOrigin(request)+'/c/'+card.id;return response(request,shell({card,canonical}),{headers:headers('text/html; charset=utf-8')});}
    catch(error){if(!(error instanceof ApiError)||error.status!==404)throw error;return response(request,shell({status:404}),{status:404,headers:headers('text/html; charset=utf-8','no-store')});}
  }
  return {api,page};
}
