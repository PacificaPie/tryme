import {workAccessible} from './moderation-service.mjs';
import { COVER_RESERVATIONS, BROWSER_LEASES } from './media-budget.mjs';
import { ApiError, fail, coverType } from './rules.mjs';
import { COVER_MAX_BYTES } from './limits.mjs';
import { metadataId, metadataStatements } from './work-metadata.mjs';
import { externalURL } from './external-cover-network.mjs';

export const COVER_REVIEW_LIMITS = Object.freeze({ attemptSeconds: 100, dailySeconds: 1000, monthlySeconds: 27000, maxAttempts: 3, leaseMs: 120000 });
const WORK = `SELECT (${workAccessible()}) moderation_accessible,w.*,v.game_key,CASE WHEN m.id IS NOT NULL THEN m.cover_key ELSE v.cover_key END cover_key,
 CASE WHEN m.id IS NOT NULL THEN m.cover_mime ELSE v.cover_mime END cover_mime FROM ft_works w
 JOIN ft_work_versions v ON v.id=w.current_version_id LEFT JOIN ft_work_metadata m ON m.id=w.current_metadata_id AND m.work_id=w.id`;
async function inputJSON(request) {
  const reader=request.body?.getReader(); if(!reader) fail(422,'INVALID_COVER_REQUEST','截图请求无效');
  let text='',size=0; const decoder=new TextDecoder();
  try { while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1024){void reader.cancel().catch(()=>{});fail(413,'BODY_TOO_LARGE','截图请求过大');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode(); }
  finally{reader.releaseLock();}
  try{return JSON.parse(text);}catch{fail(422,'INVALID_COVER_REQUEST','截图请求无效');}
}
export function createCoverReviewService({db,bucket,configured,capture,now=()=>new Date(),limits=COVER_REVIEW_LIMITS}) {
  const sql=(query,...values)=>db().prepare(query).bind(...values),first=(query,...values)=>sql(query,...values).first();
  const stamp=()=>now().toISOString(),getWork=id=>first(WORK+' WHERE w.id=?',id);
  const getJob=work=>first('SELECT * FROM ft_cover_review_jobs WHERE work_id=? AND version_id=?',work.id,work.current_version_id);
  const valid=work=>work&&['url','html'].includes(work.source)&&!work.archived_at&&work.moderation_accessible!==0;
  const conflict=()=>{throw new ApiError(409,'COVER_CONFLICT','作品或候选截图已变化，请刷新后重新选择');};
  async function budgetReason(){
    const at=stamp(),used=await first(`SELECT COALESCE(SUM(CASE WHEN created_at>=? THEN reserved_seconds ELSE 0 END),0) daily,COALESCE(SUM(reserved_seconds),0) monthly FROM ${COVER_RESERVATIONS} WHERE created_at>=?`,at.slice(0,10),at.slice(0,7));
    return used.monthly+limits.attemptSeconds>limits.monthlySeconds?'MONTHLY_BUDGET':used.daily+limits.attemptSeconds>limits.dailySeconds?'DAILY_BUDGET':null;
  }
  async function status(work){
    const base={workId:work.id,versionId:work.current_version_id,revision:work.revision,coverUrl:work.cover_key?'/media/'+(work.current_metadata_id||work.current_version_id):'',retryable:false};
    if(!valid(work))return {...base,status:'skipped'};
    if(!configured())return {...base,status:'unavailable'};
    try{
      const job=await getJob(work);if(!job)return {...base,status:'none'};
      const accepted=job.status==='accepted'&&job.metadata_id===work.current_metadata_id;
      const stale=!accepted&&job.base_revision!==work.revision;
      return {...base,status:stale?'stale':job.status,attempts:job.attempts,retryable:job.attempts<limits.maxAttempts,
        reason:job.status==='queued'?await budgetReason():job.reason,
        candidateId:job.candidate_id||null,
        ...(job.candidate_key&&!stale&&job.status==='candidate'?{candidateUrl:`/api/works/${encodeURIComponent(work.id)}/cover-review/image/${job.candidate_id}`} : {}),
        ...(accepted?{metadataId:job.metadata_id}:{})};
    }catch{return {...base,status:'unavailable'};}
  }
  async function enqueue(workId,versionId,ownerId){
    try{
      const work=await getWork(workId);
      if(!valid(work)||work.author_id!==ownerId||work.current_version_id!==versionId||work.cover_key||!configured())return;
      if(work.source==='url'){try{externalURL(work.url);}catch{return;}}
      const at=stamp();await sql("INSERT OR IGNORE INTO ft_cover_review_jobs(id,work_id,version_id,owner_id,base_revision,status,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?)",crypto.randomUUID(),workId,versionId,ownerId,work.revision,at,at).run();
    }catch{/* Optional work never prevents publication. */}
  }
  async function accept(work,job,input){
    if(job?.status==='accepted'&&job.candidate_id===input.candidateId&&job.metadata_id===work.current_metadata_id)return status(work);
    if(!job||job.status!=='candidate'||job.candidate_id!==input.candidateId||job.base_revision!==work.revision||input.expectedRevision!==work.revision)conflict();
    const object=await bucket().get(job.candidate_key);if(!object)fail(409,'COVER_MISSING','候选截图已失效，请重新截图');
    const id=metadataId(),initialId=work.initial_metadata_id||metadataId(),at=stamp();
    try{
      await db().batch([
        ...metadataStatements(sql,work,{id,initialId,expected:work.revision,coverKey:job.candidate_key,coverMime:'image/jpeg',at,actor:work.author_id}),
        sql(`UPDATE ft_works SET current_metadata_id=?,initial_metadata_id=COALESCE(initial_metadata_id,?),revision=revision+1,updated_at=?
          WHERE id=? AND revision=? AND current_version_id=? AND archived_at IS NULL
          AND EXISTS(SELECT 1 FROM ft_cover_review_jobs WHERE id=? AND status='candidate' AND candidate_id=?)`,id,initialId,at,work.id,work.revision,work.current_version_id,job.id,input.candidateId),
        sql("UPDATE ft_cover_review_jobs SET status='accepted',metadata_id=?,updated_at=? WHERE id=? AND candidate_id=? AND EXISTS(SELECT 1 FROM ft_works WHERE id=? AND current_metadata_id=?)",id,at,job.id,input.candidateId,work.id,id),
        // Constraint failure rolls back metadata and work changes when a racing retake wins.
        sql("UPDATE ft_cover_review_jobs SET owner_id=NULL WHERE id=? AND NOT(status='accepted' AND metadata_id=?)",job.id,id),
      ]);
    }catch(error){const saved=await getJob(work);if(saved?.metadata_id!==id)conflict();}
    return status(await getWork(work.id));
  }
  async function handle(request,user){
    const match=/^\/api\/works\/([^/]+)\/cover-review(?:\/image\/([^/]+))?$/.exec(new URL(request.url).pathname);if(!match)return null;
    const work=await getWork(decodeURIComponent(match[1]));if(!work)fail(404,'WORK_NOT_FOUND','作品不存在');if(work.author_id!==user.id)fail(403,'NOT_OWNER','只能管理自己的作品');
    if(match[2]){
      if(request.method!=='GET')fail(405,'METHOD_NOT_ALLOWED','不支持该请求方法');
      const job=await getJob(work);
      if(!valid(work)||!job||job.status!=='candidate'||job.base_revision!==work.revision||job.candidate_id!==match[2])fail(404,'COVER_MISSING','候选截图已失效');
      const object=await bucket().get(job.candidate_key);if(!object)fail(404,'COVER_MISSING','候选截图已失效');
      return new Response(object.body,{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
    }
    if(request.method==='GET')return Response.json(await status(work),{headers:{'Cache-Control':'no-store'}});
    if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED','不支持该请求方法');
    const input=await inputJSON(request);
    if(!input||!['generate','retake','accept'].includes(input.action)||typeof input.versionId!=='string'||!Number.isInteger(input.expectedRevision)||Object.keys(input).some(key=>!['action','versionId','expectedRevision','candidateId','waitMs'].includes(key))||input.waitMs!==undefined&&![5000,10000].includes(input.waitMs)||input.candidateId!=null&&typeof input.candidateId!=='string')fail(422,'INVALID_COVER_REQUEST','截图请求无效');
    if(!valid(work))fail(409,'WORK_UNAVAILABLE','当前作品不能生成截图');
    if(input.versionId!==work.current_version_id)conflict();
    const job=await getJob(work);
    if(input.action==='accept')return Response.json(await accept(work,job,input),{headers:{'Cache-Control':'no-store'}});
    if(input.expectedRevision!==work.revision)conflict();
    if(!configured())fail(503,'BROWSER_UNAVAILABLE','自动截图暂不可用');
    if(work.source==='url'){try{externalURL(work.url);}catch{fail(422,'UNSUPPORTED_CAPTURE_URL','自动截图仅支持公开 HTTPS 网站，请手动上传封面');}}
    if(!job){
      const at=stamp();await sql("INSERT OR IGNORE INTO ft_cover_review_jobs(id,work_id,version_id,owner_id,base_revision,status,wait_ms,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?,?)",crypto.randomUUID(),work.id,work.current_version_id,user.id,work.revision,input.waitMs||5000,at,at).run();
    }else if(input.action==='retake'){
      if((job.candidate_id||null)!==(input.candidateId||null))conflict();
      if(!['queued','running'].includes(job.status)&&job.attempts<limits.maxAttempts)
        await sql("UPDATE ft_cover_review_jobs SET status='queued',reason=NULL,base_revision=?,wait_ms=?,updated_at=? WHERE id=? AND status NOT IN ('queued','running') AND candidate_id IS ? AND attempts<?",work.revision,input.waitMs||5000,stamp(),job.id,input.candidateId||null,limits.maxAttempts).run();
    }
    return Response.json(await status(work),{headers:{'Cache-Control':'no-store'}});
  }
  async function mark(job,state,reason){await sql('UPDATE ft_cover_review_jobs SET status=?,reason=?,lease_id=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_id=?',state,reason||null,stamp(),job.id,job.lease_id).run();}
  async function claim(){
    const at=stamp(),lease=crypto.randomUUID(),until=new Date(now().getTime()+limits.leaseMs).toISOString();
    await sql("UPDATE ft_cover_review_jobs SET status='failed',reason='CAPTURE_INTERRUPTED',lease_id=NULL,lease_until=NULL,updated_at=? WHERE status='running' AND lease_until<=?",at,at).run();
    const job=await first("SELECT * FROM ft_cover_review_jobs WHERE status='queued' AND attempts<? ORDER BY created_at,id LIMIT 1",limits.maxAttempts);if(!job)return null;
    const work=await getWork(job.work_id);if(!valid(work)||work.current_version_id!==job.version_id||work.revision!==job.base_revision){await sql("UPDATE ft_cover_review_jobs SET status='failed',reason='WORK_CHANGED',updated_at=? WHERE id=? AND status='queued'",at,job.id).run();return null;}
    await db().batch([
      sql(`UPDATE ft_cover_review_jobs SET status='running',attempts=attempts+1,lease_id=?,lease_until=?,updated_at=? WHERE id=? AND status='queued' AND attempts<?
        AND NOT EXISTS(SELECT 1 FROM ${BROWSER_LEASES} WHERE status='running' AND lease_until>?)
        AND NOT EXISTS(SELECT 1 FROM ft_cover_drafts WHERE status='running' AND lease_until>?)
        AND NOT EXISTS(SELECT 1 FROM ft_publish_captures WHERE kind='cover' AND status='running' AND lease_until>?)
        AND (SELECT COALESCE(SUM(reserved_seconds),0) FROM ${COVER_RESERVATIONS} WHERE created_at>=?)+?<=?
        AND (SELECT COALESCE(SUM(reserved_seconds),0) FROM ${COVER_RESERVATIONS} WHERE created_at>=?)+?<=?`,lease,until,at,job.id,limits.maxAttempts,at,at,at,at.slice(0,10),limits.attemptSeconds,limits.dailySeconds,at.slice(0,7),limits.attemptSeconds,limits.monthlySeconds),
      sql('INSERT INTO ft_cover_review_attempts(id,job_id,reserved_seconds,created_at) SELECT ?,id,?,? FROM ft_cover_review_jobs WHERE id=? AND lease_id=?',lease,limits.attemptSeconds,at,job.id,lease),
    ]);
    return first('SELECT * FROM ft_cover_review_jobs WHERE id=? AND lease_id=?',job.id,lease);
  }
  async function processPending(){
    if(!configured())return {processed:false};const job=await claim();if(!job)return {processed:false};const start=Date.now();let outcome='failed';
    try{
      const work=await getWork(job.work_id);
      if(!valid(work)||work.current_version_id!==job.version_id||work.revision!==job.base_revision){await mark(job,'failed','WORK_CHANGED');return {processed:true,status:'failed'};}
      const object=work.source==='html'?await bucket().get(work.game_key):null;
      if(work.source==='html'&&(!object||object.size>16*1024*1024))throw new Error('Game unavailable');
      const result=await capture(work.source==='html'?await object.text():work.url,{waitMs:job.wait_ms,source:work.source});
      const bytes=new Uint8Array(result.bytes||[]);if(!bytes.length||bytes.length>COVER_MAX_BYTES||coverType(bytes,result.mime)!=='image/jpeg')throw new Error('Invalid capture');
      const candidate=crypto.randomUUID(),key='covers/review-'+candidate;
      await bucket().put(key,bytes,{httpMetadata:{contentType:'image/jpeg'}});
      await sql(`UPDATE ft_cover_review_jobs SET status='candidate',candidate_key=?,candidate_id=?,metadata_id=NULL,reason=NULL,lease_id=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_id=? AND lease_until>?`,key,candidate,stamp(),job.id,job.lease_id,stamp()).run();
      outcome=(await first('SELECT status FROM ft_cover_review_jobs WHERE id=?',job.id))?.status||'failed';return {processed:true,status:outcome};
    }catch(error){const reason=['CAPTURE_TIMEOUT','CAPTURE_NOT_READY','UNSAFE_URL','CAPTURE_TOO_LARGE','RESOURCE_LIMIT'].includes(error?.code)?error.code:'CAPTURE_FAILED';await mark(job,'failed',reason);return {processed:true,status:'failed',reason};}
    finally{await sql('UPDATE ft_cover_review_attempts SET elapsed_ms=?,outcome=? WHERE id=?',Date.now()-start,outcome,job.lease_id).run();}
  }
  return {enqueue,handle,processPending,status};
}
