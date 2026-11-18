import { COVER_RESERVATIONS, BROWSER_LEASES } from './media-budget.mjs';
import { fail, coverType } from './rules.mjs';
import { externalURL } from './external-cover-network.mjs';
import { COVER_REVIEW_LIMITS } from './cover-review-service.mjs';
import { COVER_MAX_BYTES } from './limits.mjs';

export function createCoverDraftService({db,bucket,configured,capture,bodyJSON,now=()=>new Date(),limits=COVER_REVIEW_LIMITS}) {
 const sql=(query,...values)=>db().prepare(query).bind(...values),first=(query,...values)=>sql(query,...values).first();
 const stamp=()=>now().toISOString();
 const dto=row=>({id:row.id,url:row.url,status:row.status==='running'&&row.lease_until<=stamp()?'failed':row.status,reason:row.reason,
  ...(row.status==='candidate'?{imageUrl:'/api/cover-drafts/'+row.id+'/image'}:{})});
 async function own(id,owner){
  const row=await first('SELECT * FROM ft_cover_drafts WHERE id=? AND owner_id=?',id,owner);
  if(!row||row.expires_at<=stamp())fail(404,'COVER_DRAFT_EXPIRED','候选截图已失效，请重新截图');return row;
 }
 async function handle(request,user){
  const match=/^\/api\/cover-drafts(?:\/([a-f0-9-]{36})(\/image)?)?$/.exec(new URL(request.url).pathname);if(!match)return null;
  if(request.method==='GET'&&match[1]){
   const row=await own(match[1],user.id);
   if(!match[2])return Response.json(dto(row),{headers:{'Cache-Control':'no-store'}});
   if(row.status!=='candidate'||!row.object_key)fail(404,'COVER_MISSING','候选截图尚未生成');
   const object=await bucket().get(row.object_key);if(!object)fail(404,'COVER_MISSING','候选截图已失效');
   return new Response(object.body,{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(request.method!=='POST'||match[1])fail(405,'METHOD_NOT_ALLOWED','不支持该请求方法');
  if(!configured())fail(503,'BROWSER_UNAVAILABLE','自动截图暂不可用，可以上传封面');
  const input=await bodyJSON(request);
  if(!input||typeof input.id!=='string'||!/^[a-f0-9-]{36}$/.test(input.id)||typeof input.url!=='string'||input.url.length>2048||![5000,10000].includes(input.waitMs)||Object.keys(input).some(k=>!['id','url','waitMs'].includes(k)))fail(422,'INVALID_COVER_REQUEST','截图请求无效');
  let url;try{url=externalURL(input.url).href;}catch{fail(422,'UNSUPPORTED_CAPTURE_URL','自动截图仅支持公开 HTTPS 网站，请手动上传封面');}
  const previous=await first('SELECT * FROM ft_cover_drafts WHERE id=?',input.id);
  if(previous){if(previous.owner_id!==user.id||previous.url!==url||previous.wait_ms!==input.waitMs)fail(409,'COVER_CONFLICT','截图请求已变化，请重新截图');return Response.json(dto(await own(input.id,user.id)),{headers:{'Cache-Control':'no-store'}});}
  const at=stamp(),lease=new Date(now().getTime()+45000).toISOString(),expires=new Date(now().getTime()+86400000).toISOString();
  // One atomic reservation: concurrent requests share the existing day/month cap.
  const inserted=await sql(`INSERT OR IGNORE INTO ft_cover_drafts(id,owner_id,url,wait_ms,status,reserved_seconds,created_at,expires_at,lease_until)
   SELECT ?,?,?,?,'running',?,?,?,?
   WHERE NOT EXISTS(SELECT 1 FROM ${BROWSER_LEASES} WHERE status='running' AND lease_until>?)
    AND NOT EXISTS(SELECT 1 FROM ft_cover_review_jobs WHERE status='running' AND lease_until>?)
    AND NOT EXISTS(SELECT 1 FROM ft_publish_captures WHERE kind='cover' AND status='running' AND lease_until>?)
    AND (SELECT COUNT(*) FROM ft_cover_drafts WHERE owner_id=? AND url=? AND created_at>=?)<3
    AND (SELECT COALESCE(SUM(reserved_seconds),0) FROM ${COVER_RESERVATIONS} WHERE created_at>=?)+?<=?
    AND (SELECT COALESCE(SUM(reserved_seconds),0) FROM ${COVER_RESERVATIONS} WHERE created_at>=?)+?<=?`,
   input.id,user.id,url,input.waitMs,limits.attemptSeconds,at,expires,lease,at,at,at,user.id,url,at.slice(0,10),at.slice(0,10),limits.attemptSeconds,limits.dailySeconds,at.slice(0,7),limits.attemptSeconds,limits.monthlySeconds).run();
  const job=await first('SELECT * FROM ft_cover_drafts WHERE id=?',input.id);
  if(job&&!inserted.meta?.changes){if(job.owner_id!==user.id||job.url!==url||job.wait_ms!==input.waitMs)fail(409,'COVER_CONFLICT','截图请求已变化，请重新截图');return Response.json(dto(job),{headers:{'Cache-Control':'no-store'}});}
  if(!job){
   if(await first(`SELECT 1 FROM ${BROWSER_LEASES} WHERE status='running' AND lease_until>? LIMIT 1`,at))fail(429,'CAPTURE_BUSY','正在处理另一张截图，稍后自动重试');
   fail(429,'CAPTURE_LIMIT','截图次数暂时用完，可以上传封面或稍后重试');
  }
  const start=Date.now(),key='cover-drafts/'+input.id;
  try{
   const result=await capture(url,{waitMs:input.waitMs}),bytes=new Uint8Array(result.bytes||[]);
   if(!bytes.length||bytes.length>COVER_MAX_BYTES||coverType(bytes,result.mime)!=='image/jpeg')throw new Error('Invalid capture');
   await bucket().put(key,bytes,{httpMetadata:{contentType:'image/jpeg'}});
   await sql("UPDATE ft_cover_drafts SET status='candidate',object_key=?,elapsed_ms=? WHERE id=? AND status='running' AND lease_until>?",key,Date.now()-start,input.id,stamp()).run();
   const saved=await own(input.id,user.id);if(saved.status!=='candidate'){await bucket().delete(key);throw new Error('Expired capture');}
   return Response.json(dto(saved),{headers:{'Cache-Control':'no-store'}});
  }catch(error){
   // A lost database response must not delete a committed candidate.
   const saved=await first('SELECT * FROM ft_cover_drafts WHERE id=?',input.id);if(saved?.status==='candidate')return Response.json(dto(saved),{headers:{'Cache-Control':'no-store'}});
   try{await bucket().delete(key);}catch{}
   const reason=['CAPTURE_TIMEOUT','CAPTURE_NOT_READY','UNSAFE_URL','RESOURCE_LIMIT'].includes(error?.code)?error.code:'CAPTURE_FAILED';
   await sql("UPDATE ft_cover_drafts SET status='failed',reason=?,elapsed_ms=? WHERE id=? AND status='running'",reason,Date.now()-start,input.id).run();
   return Response.json(dto(await own(input.id,user.id)),{headers:{'Cache-Control':'no-store'}});
  }
 }
 async function cleanup(){
  const expired=(await sql('SELECT id,object_key FROM ft_cover_drafts WHERE expires_at<=? AND object_key IS NOT NULL LIMIT 30',stamp()).all()).results;
  for(const row of expired){await bucket().delete(row.object_key);await sql('UPDATE ft_cover_drafts SET object_key=NULL WHERE id=? AND object_key=?',row.id,row.object_key).run();}
 }
 return {handle,cleanup};
}
