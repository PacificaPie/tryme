import {fail, eventId, safeURL, coverType} from './rules.mjs';
import {HTML_MAX_BYTES, COVER_MAX_BYTES} from './limits.mjs';
import {COVER_REVIEW_LIMITS} from './cover-review-service.mjs';
import {PREVIEW_LIMITS} from './video-preview-service.mjs';
import {validatePreview} from './video-preview-capture.mjs';
import {COVER_RESERVATIONS, VIDEO_RESERVATIONS, BROWSER_LEASES} from './media-budget.mjs';

const privateJSON=value=>Response.json(value,{headers:{'Cache-Control':'private, no-store'}});

export const publicationChoices = form => Object.fromEntries(['draftId','coverChoice','coverCaptureId','videoChoice','videoCaptureId'].map(key=>[key,typeof form.get(key)==='string'?form.get(key):'']));
export function createPublishDraftService({db,bucket,readForm,readArtifact,bodyJSON,hash,captureCover,captureVideo,configured=(_kind='')=>false,now=()=>new Date(),coverLimits=COVER_REVIEW_LIMITS,videoLimits=PREVIEW_LIMITS}) {
 const sql=(query,...values)=>db().prepare(query).bind(...values), first=(query,...values)=>sql(query,...values).first(), stamp=()=>now().toISOString();
 const conflict=()=>fail(409,'DRAFT_CHANGED','作品来源已变化，请重新准备预览');
 async function own(id,owner){const row=await first('SELECT * FROM ft_publish_drafts WHERE id=? AND owner_id=?',id,owner);if(!row||row.expires_at<=stamp())fail(404,'DRAFT_EXPIRED','上传草稿已失效，请重新准备预览');return row;}
 const captureDTO=(row,draft)=>row?{id:row.id,kind:row.kind,status:row.status==='running'&&row.lease_until<=stamp()?'failed':row.status,reason:row.reason,...row.status==='ready'?{url:`/api/publish-drafts/${draft.id}/media/${row.id}`,durationMs:row.duration_ms}: {}}:null;
 async function dto(draft){const latest=async kind=>captureDTO(await first('SELECT * FROM ft_publish_captures WHERE draft_id=? AND kind=? ORDER BY created_at DESC,rowid DESC LIMIT 1',draft.id,kind),draft);return {id:draft.id,source:draft.source,contentHash:draft.content_hash,expiresAt:draft.expires_at,cover:await latest('cover'),video:await latest('video')};}
 async function create(request,user){
  const form=await readForm(request),id=eventId(form.get('id')),source=form.get('source');if(!['url','html'].includes(source))fail(422,'INVALID_SOURCE','选择作品来源');
  const url=source==='url'?safeURL(form.get('url')):null,{gameBytes}=await readArtifact(form,source,user.id),digest=await hash(gameBytes||url);
  const previous=await first('SELECT * FROM ft_publish_drafts WHERE id=?',id);
  if(previous){if(previous.owner_id!==user.id||previous.source!==source||previous.content_hash!==digest)conflict();return privateJSON(await dto(await own(id,user.id)));}
  const at=stamp(),key=gameBytes?'publish-drafts/'+id+'/'+crypto.randomUUID()+'.html':null;
  if(Number((await first('SELECT COUNT(*) n FROM ft_publish_drafts WHERE owner_id=? AND created_at>=?',user.id,at.slice(0,10))).n)>=20)fail(429,'DRAFT_LIMIT','今天准备的作品较多，请稍后重试');
  if(key)await bucket().put(key,gameBytes,{httpMetadata:{contentType:'text/html'}});
  let saved;
  try {await sql('INSERT OR IGNORE INTO ft_publish_drafts(id,owner_id,source,url,content_hash,game_key,created_at,expires_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM ft_publish_drafts WHERE owner_id=? AND created_at>=?)<20',id,user.id,source,url,digest,key,at,new Date(now().getTime()+86400000).toISOString(),user.id,at.slice(0,10)).run();}
  finally {saved=await first('SELECT * FROM ft_publish_drafts WHERE id=?',id);if(key&&(!saved||saved.game_key!==key))await bucket().delete(key);}
  if(!saved)fail(429,'DRAFT_LIMIT','今天准备的作品较多，请稍后重试');
  if(saved.owner_id!==user.id||saved.content_hash!==digest||saved.source!==source)conflict();return privateJSON(await dto(saved));
 }
 async function capture(request,user,id){
  const draft=await own(id,user.id),input=await bodyJSON(request)||{},kind=input.kind,attempt=eventId(input.id),waitMs=input.waitMs??5000;
  if(!['cover','video'].includes(kind)||![5000,10000].includes(waitMs)||Object.keys(input).some(key=>!['kind','id','waitMs'].includes(key)))fail(422,'INVALID_CAPTURE_REQUEST','预览请求无效');
  if(kind==='video'&&draft.source!=='html')fail(422,'VIDEO_UNSUPPORTED','外链暂不支持自动视频');
  const existing=await first('SELECT * FROM ft_publish_captures WHERE id=?',attempt);
  if(existing){if(existing.draft_id!==id||existing.kind!==kind||existing.wait_ms!==waitMs)conflict();return privateJSON(captureDTO(existing,draft));}
  if(!configured(kind))fail(503,'BROWSER_UNAVAILABLE','自动预览暂不可用，可重试或主动跳过');
  const limits=kind==='cover'?coverLimits:videoLimits,reservations=kind==='cover'?COVER_RESERVATIONS:VIDEO_RESERVATIONS,at=stamp(),until=new Date(now().getTime()+45000).toISOString();
  const legacyBusy=`EXISTS(SELECT 1 FROM ${BROWSER_LEASES} WHERE status='running' AND lease_until>?)`;
  const busyArgs=[at];
  const inserted=await sql(`INSERT OR IGNORE INTO ft_publish_captures(id,draft_id,kind,status,wait_ms,reserved_seconds,lease_until,created_at)
   SELECT ?,?,?,'running',?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM ft_publish_captures WHERE kind=? AND status='running' AND lease_until>?) AND NOT(${legacyBusy})
   AND (SELECT COUNT(*) FROM ft_publish_captures c JOIN ft_publish_drafts d ON d.id=c.draft_id WHERE d.owner_id=? AND d.content_hash=? AND c.kind=? AND c.created_at>=?)<?
   AND (SELECT COALESCE(SUM(reserved_seconds),0) FROM ${reservations} WHERE created_at>=?)+?<=?
   AND (SELECT COALESCE(SUM(reserved_seconds),0) FROM ${reservations} WHERE created_at>=?)+?<=?`,attempt,id,kind,waitMs,limits.attemptSeconds,until,at,kind,at,...busyArgs,user.id,draft.content_hash,kind,at.slice(0,10),kind==='cover'?3:2,at.slice(0,10),limits.attemptSeconds,limits.dailySeconds,at.slice(0,7),limits.attemptSeconds,limits.monthlySeconds).run();
  let job=await first('SELECT * FROM ft_publish_captures WHERE id=?',attempt);
  if(!job){if(await first(`SELECT 1 WHERE EXISTS(SELECT 1 FROM ft_publish_captures WHERE kind=? AND status='running' AND lease_until>?) OR ${legacyBusy}`,kind,at,...busyArgs))fail(429,'CAPTURE_BUSY','正在处理另一项预览，稍后自动重试');fail(429,'CAPTURE_LIMIT','预览次数暂时用完，可上传封面或主动跳过');}
  if(!inserted.meta?.changes){if(job.draft_id!==id||job.kind!==kind||job.wait_ms!==waitMs)conflict();return privateJSON(captureDTO(job,draft));}
  const start=Date.now(),key='publish-drafts/'+id+'/'+attempt+(kind==='cover'?'.jpg':'.mp4');
  try {
   let content=draft.url;
   if(draft.source==='html'){const object=await bucket().get(draft.game_key);if(!object||object.size>HTML_MAX_BYTES)throw Error('Missing draft');const bytes=new Uint8Array(await object.arrayBuffer());if(await hash(bytes)!==draft.content_hash)throw Error('Changed draft');content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
   const result=kind==='cover'?await captureCover(content,{source:draft.source,waitMs}):await captureVideo(content),bytes=new Uint8Array(result.bytes||[]);
   if(kind==='cover'){if(!bytes.length||bytes.length>COVER_MAX_BYTES||coverType(bytes,result.mime)!=='image/jpeg')throw Error('Invalid cover');}
   else {validatePreview(bytes);if(result.mime!=='video/mp4'||!Number.isInteger(result.durationMs)||result.durationMs<6000||result.durationMs>8000)throw Error('Invalid duration');}
   await bucket().put(key,bytes,{httpMetadata:{contentType:kind==='cover'?'image/jpeg':'video/mp4'}});
   await sql("UPDATE ft_publish_captures SET status='ready',object_key=?,byte_size=?,duration_ms=?,elapsed_ms=? WHERE id=? AND status='running' AND lease_until>?",key,bytes.length,result.durationMs||null,Date.now()-start,attempt,stamp()).run();
   job=await first('SELECT * FROM ft_publish_captures WHERE id=?',attempt);if(job.status!=='ready')throw Error('Capture expired');
  }catch(error){
   job=await first('SELECT * FROM ft_publish_captures WHERE id=?',attempt);
   if(job?.status!=='ready'){try{await bucket().delete(key);}catch{}await sql("UPDATE ft_publish_captures SET status='failed',reason=?,elapsed_ms=? WHERE id=? AND status='running'",['CAPTURE_TIMEOUT','CAPTURE_NOT_READY','DEMO_INCOMPLETE','BROWSER_UNAVAILABLE'].includes(error?.code)?error.code:'CAPTURE_FAILED',Date.now()-start,attempt).run();job=await first('SELECT * FROM ft_publish_captures WHERE id=?',attempt);}
  }
  return privateJSON(captureDTO(job,draft));
 }
 async function media(request,draft,attempt){
  const row=await first("SELECT * FROM ft_publish_captures WHERE id=? AND draft_id=? AND status='ready'",attempt,draft.id);if(!row?.object_key)fail(404,'MEDIA_MISSING','预览不存在');
  const object=await bucket().get(row.object_key);if(!object)fail(404,'MEDIA_MISSING','预览已失效');
  const bytes=new Uint8Array(await object.arrayBuffer()),headers={'Content-Type':row.kind==='cover'?'image/jpeg':'video/mp4','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'};
  const range=request.headers.get('range');if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match||!match[1]&&!match[2])return new Response(null,{status:416,headers:{...headers,'Content-Range':'bytes */'+bytes.length}});const start=match[1]?Number(match[1]):Math.max(0,bytes.length-Number(match[2])),end=match[1]&&match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=bytes.length)return new Response(null,{status:416,headers:{...headers,'Content-Range':'bytes */'+bytes.length}});return new Response(bytes.slice(start,end+1),{status:206,headers:{...headers,'Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${bytes.length}`}});}
  return new Response(bytes,{headers:{...headers,'Content-Length':String(bytes.length)}});
 }
 async function handle(request,user){const match=/^\/api\/publish-drafts(?:\/([\w-]+)(?:\/(capture|media)(?:\/([\w-]+))?)?)?$/.exec(new URL(request.url).pathname);if(!match)return null;
  if(request.method==='POST'&&!match[1])return create(request,user);
  if(request.method==='POST'&&match[2]==='capture'&&!match[3])return capture(request,user,match[1]);
  if(request.method==='GET'&&match[1]){const draft=await own(match[1],user.id);if(match[2]==='media'&&match[3])return media(request,draft,match[3]);if(!match[2])return privateJSON(await dto(draft));}
  fail(405,'METHOD_NOT_ALLOWED','不支持该请求');
 }
 async function prepare(form,user,{source,gameBytes,url,coverBytes,coverMime}){
  const choice=publicationChoices(form),draft=await own(choice.draftId,user.id);
  if(draft.source!==source||draft.content_hash!==await hash(gameBytes||url))conflict();
  if(!['candidate','manual','skip'].includes(choice.coverChoice)||!['candidate','skip'].includes(choice.videoChoice))fail(422,'MEDIA_REVIEW_REQUIRED','请先确认封面和视频，或明确选择跳过');
  async function selected(id,kind){const row=await first("SELECT * FROM ft_publish_captures WHERE id=? AND draft_id=? AND kind=? AND status='ready'",id,draft.id,kind);if(!row?.object_key)conflict();const object=await bucket().get(row.object_key);if(!object||object.size!==row.byte_size)conflict();const bytes=new Uint8Array(await object.arrayBuffer());if(kind==='cover'){if(bytes.length>COVER_MAX_BYTES||coverType(bytes,'image/jpeg')!=='image/jpeg')conflict();}else{validatePreview(bytes);if(row.duration_ms<6000||row.duration_ms>8000)conflict();}return {...row,bytes};}
  if(choice.coverChoice==='candidate'){if(coverBytes)conflict();const cover=await selected(choice.coverCaptureId,'cover');coverBytes=cover.bytes;coverMime='image/jpeg';}
  else if(choice.coverChoice==='manual'){if(!coverBytes)fail(422,'COVER_REQUIRED','请选择封面图片');}
  else if(coverBytes)conflict();
  const video=choice.videoChoice==='candidate'?await selected(choice.videoCaptureId,'video'):null;
  if(video&&source!=='html')conflict();return {coverBytes,coverMime,video};
 }
 async function cleanup(){const expired=(await sql('SELECT id,game_key FROM ft_publish_drafts WHERE expires_at<=? AND (game_key IS NOT NULL OR EXISTS(SELECT 1 FROM ft_publish_captures WHERE draft_id=ft_publish_drafts.id AND object_key IS NOT NULL)) LIMIT 30',stamp()).all()).results;
  for(const draft of expired){const captures=(await sql('SELECT object_key FROM ft_publish_captures WHERE draft_id=? AND object_key IS NOT NULL',draft.id).all()).results;const keys=[draft.game_key,...captures.map(c=>c.object_key)].filter(Boolean);if(keys.length)await bucket().delete(keys);await db().batch([sql('UPDATE ft_publish_drafts SET game_key=NULL WHERE id=?',draft.id),sql('UPDATE ft_publish_captures SET object_key=NULL WHERE draft_id=?',draft.id)]);}
 }
 return {handle,prepare,cleanup};
}
