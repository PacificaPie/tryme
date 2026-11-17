import { HTML_MAX_BYTES } from './limits.mjs';
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
export const fail=(status,code,message)=>{throw new ApiError(status,code,message);};
export function requiredText(value,name,max,min=1) {
  if(typeof value!=='string')fail(422,'INVALID_FIELD',`${name}必须是文字`);
  const result=value.trim(); if(result.length<min||result.length>max)fail(422,'INVALID_FIELD',`${name}长度须为 ${min}–${max}`);return result;
}
export function eventId(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(value))fail(422,'INVALID_ID','标识必须为 8–128 位字母、数字、下划线或短横线');return value;}
export function safeURL(value){let u;try{u=new URL(requiredText(value,'链接',2000));}catch{fail(422,'INVALID_URL','填写有效的 HTTP(S) 链接');}if(!['https:','http:'].includes(u.protocol)||u.username||u.password)fail(422,'INVALID_URL','只允许无账号密码的 HTTP(S) 链接');return u.href;}
export function likedState(value){if(typeof value!=='boolean')fail(422,'INVALID_LIKED','liked 必须明确为 true 或 false');return value;}
export function discoverQuery(params){
  const q=(params.get('q')||'').trim(),source=params.get('source')||'all',sort=params.get('sort')||'newest',author=(params.get('author')||'').trim()||null;
  if(q.length>100)fail(422,'INVALID_QUERY','搜索内容最多 100 字');
  if(!['all','html','url'].includes(source))fail(422,'INVALID_SOURCE','作品类型无效');
  if(!['recommended','newest','likes','comments'].includes(sort))fail(422,'INVALID_SORT','作品排序无效');
  if(author&&author.length>256)fail(422,'INVALID_AUTHOR','作者标识无效');
  const limit=params.has('limit')?Number(params.get('limit')):12;
  if(!Number.isInteger(limit)||limit<1||limit>48)fail(422,'INVALID_LIMIT','每页数量须为 1–48');
  return {q,source,sort,author,limit};
}
export function encodeDiscoverCursor(value){return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export function decodeDiscoverCursor(value,query,now=Date.now()){
  if(value===null||value===undefined||value==='')return null;
  try{
    if(typeof value!=='string'||value.length>4096||!/^[A-Za-z0-9_-]+$/.test(value))throw new Error();
    const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'));
    const cursor=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(raw,c=>c.charCodeAt(0))));
    if(cursor.v!==1||!cursor.filters||['q','source','sort','author'].some(k=>cursor.filters[k]!==query[k]))throw new Error();
    if(query.sort==='recommended'&&(!cursor.snapshot||['works','events','impressions','credits'].some(k=>!Number.isSafeInteger(cursor.snapshot[k])||cursor.snapshot[k]<0)))throw new Error();
    if(typeof cursor.asOf!=='string'||new Date(cursor.asOf).toISOString()!==cursor.asOf||Date.parse(cursor.asOf)>now)throw new Error();
    const last=cursor.last;
    if(!last||!Number.isSafeInteger(last.rank)||last.rank<0||typeof last.id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(last.id))throw new Error();
    if(typeof last.createdAt!=='string'||new Date(last.createdAt).toISOString()!==last.createdAt||last.createdAt>cursor.asOf)throw new Error();
    return cursor;
  }catch{fail(400,'INVALID_CURSOR','发现页游标与当前筛选不符或已无效，请重新加载');}
}
export function cardTemplate(value){if(!['fold','wall','collection','editorial','filmstrip'].includes(value))fail(422,'INVALID_TEMPLATE','请选择现有模板');return value;}
export function commentInput(value){return {body:requiredText(value.body,'评论',1000),parentId:value.parentId===undefined||value.parentId===null?null:eventId(value.parentId),versionId:value.versionId===undefined||value.versionId===null?null:eventId(value.versionId)};}
export function validateCommentParent(parent,workId){
  if(!parent)fail(404,'COMMENT_NOT_FOUND','被回复的评论不存在');
  if(parent.work_id!==workId||parent.parent_id!==null)fail(422,'INVALID_COMMENT_PARENT','只能回复当前作品的根评论');
}
export function commentPageLimit(value,defaultValue=20,max=50){
  const limit=value===null||value===undefined?defaultValue:Number(value);
  if(!Number.isInteger(limit)||limit<1||limit>max)fail(422,'INVALID_LIMIT',`每页数量须为 1–${max}`);
  return limit;
}
export function encodeCommentCursor(seq,scope){return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({v:1,seq,scope})))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export function decodeCommentCursor(value,scope){
  if(value===null||value===undefined||value==='')return null;
  try{
    if(typeof value!=='string'||value.length>1024||!/^[A-Za-z0-9_-]+$/.test(value))throw new Error();
    const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'));
    const cursor=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(raw,c=>c.charCodeAt(0))));
    if(cursor.v!==1||cursor.scope!==scope||!Number.isSafeInteger(cursor.seq)||cursor.seq<1)throw new Error();
    return cursor.seq;
  }catch{fail(400,'INVALID_CURSOR','评论分页游标无效，请刷新后重试');}
}
export function cardDetails(value){
  const signature=requiredText(value.signature===undefined?'':value.signature,'签名',80,0);
  const headline=requiredText(value.headline===undefined?'':value.headline,'名片短标题',120,0);
  const rawWebsite=requiredText(value.website===undefined?'':value.website,'网站',2000,0);
  const website=rawWebsite?safeURL(rawWebsite):'';
  const backStyle=value.backStyle===undefined?'ink':value.backStyle;
  if(!['ink','ivory','cobalt'].includes(backStyle))fail(422,'INVALID_BACK_STYLE','请选择现有名片背面样式');
  return {signature,headline,website,backStyle};
}
export function cardSnapshot(value){return {...value,signature:value.signature??'',headline:value.headline??'',website:value.website??'',backStyle:value.backStyle??'ink'};}
export function authenticate(headers){
  const id=headers.get('oai-authenticated-user-id'),email=headers.get('oai-authenticated-user-email');
  if(!id||!email||id.length>256||email.length>320)fail(401,'AUTH_REQUIRED','请先通过站点登录');
  let name=headers.get('oai-authenticated-user-full-name')||'';
  if(headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8'){try{name=decodeURIComponent(name);}catch{name='';}}
  return {id,name:name.trim().slice(0,80)||email.split('@')[0].slice(0,80)||'创作者',email};
}
export function verifyWrite(request){
  if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('origin')==='null'||request.headers.get('x-funtrack-csrf')!=='1')fail(403,'CSRF_REJECTED','写入请求须来自本站页面');
}
export function coverType(bytes,mime){
  const b=bytes;let detected='';
  if(b.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v))detected='image/png';
  else if(b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255)detected='image/jpeg';
  else if(b.length>=12&&String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP')detected='image/webp';
  if(!detected||detected!==mime)fail(415,'INVALID_COVER','封面内容与 PNG/JPEG/WebP 类型不匹配');return detected;
}
export function htmlSource(bytes,mime,name){
  if(mime!=='text/html'||!/\.html?$/i.test(name))fail(415,'INVALID_HTML','请选择 text/html 类型的 HTML 文件');
  if(!bytes.length||bytes.length>HTML_MAX_BYTES)fail(413,'HTML_TOO_LARGE','HTML 文件必须在 8 MiB 以内');
  let html;try{html=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail(422,'INVALID_HTML','HTML 必须使用 UTF-8 编码');}
  if(!/^\s*(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/i.test(html))fail(422,'INVALID_HTML','请上传完整、自包含的 HTML 文档');return html;
}
export function cleanResult(value){
  if(value===undefined||value===null)return null;
  if(typeof value!=='object'||Array.isArray(value))fail(422,'INVALID_RESULT','结果格式无效');
  const result={};
  if(value.score!==undefined){if(typeof value.score!=='number'||!Number.isFinite(value.score)||Math.abs(value.score)>1e12)fail(422,'INVALID_RESULT','分数无效');result.score=value.score;}
  if(value.label!==undefined)result.label=requiredText(value.label,'结果说明',120,0);
  return result;
}
export function sessionEvents(value){
  if(!Array.isArray(value)||!value.length||value.length>20)fail(422,'INVALID_EVENTS','每批须有 1–20 条事件');
  const ids=new Set(),seqs=new Set();
  return value.map(v=>{
    if(!v||typeof v!=='object'||!['play_start','game_complete','session_end'].includes(v.type))fail(422,'INVALID_EVENT','事件类型无效');
    const id=eventId(v.id);if(!Number.isInteger(v.seq)||v.seq<1||v.seq>10000)fail(422,'INVALID_SEQUENCE','事件序号无效');
    if(ids.has(id)||seqs.has(v.seq))fail(422,'DUPLICATE_BATCH_EVENT','同一批不能重复事件标识或序号');ids.add(id);seqs.add(v.seq);
    if(v.elapsedMs!==undefined&&(!Number.isInteger(v.elapsedMs)||v.elapsedMs<0||v.elapsedMs>3600000))fail(422,'INVALID_ELAPSED','会话时长无效');
    let result=v.type==='game_complete'?cleanResult(v.result):null;
    if(v.type==='session_end'&&v.result?.timingVersion!==undefined){
      if(v.result.timingVersion!==1||!Number.isInteger(v.result.activeMs)||v.result.activeMs<0||v.result.activeMs>3600000||!Number.isInteger(v.elapsedMs)||v.result.activeMs>v.elapsedMs)fail(422,'INVALID_PLAY_TIME','试玩时长无效');
      result={timingVersion:1,activeMs:v.result.activeMs};
    }
    return {id,type:v.type,seq:v.seq,elapsedMs:v.elapsedMs??null,result};
  }).sort((a,b)=>a.seq-b.seq);
}
export const GAME_CSP="sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'none'; child-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";
export function gameDocument(html,parentOrigin){
  const origin=JSON.stringify(parentOrigin).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const sdk=`(function(){'use strict';var o=${origin},b=new URLSearchParams(location.hash.slice(1)).get('bridge')||'',started=false,done=false;function send(t,r){if(parent===window||!b||b.length>160)return;var m={channel:'funtrack-game',version:1,bridge:b,type:t};if(r)m.result=r;parent.postMessage(m,o);}function input(e){if(!e.isTrusted||started)return;started=true;send('input');}['pointerdown','keydown','touchstart'].forEach(function(t){document.addEventListener(t,input,{capture:true,passive:true});});var api=Object.freeze({complete:function(value){if(done)return;var r={};if(value&&typeof value.score==='number'&&Number.isFinite(value.score)&&Math.abs(value.score)<=1e12)r.score=value.score;if(value&&typeof value.label==='string')r.label=value.label.slice(0,120);done=true;send('complete',r);}});Object.defineProperty(window,'funtrack',{value:api,writable:false,configurable:false});if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){send('ready');},{once:true});else send('ready');})();`;
  return '<!doctype html><meta charset="utf-8"><script>'+sdk+'</script>\n'+html;
}
