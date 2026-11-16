import { env } from 'cloudflare:workers';
import { ApiError, fail, eventId, requiredText, GAME_CSP, gameDocument } from './rules.mjs';
import { resolveGithubRepository } from './github-repository.mjs';
import { BUILD_MAX_BYTES, BUILD_METADATA_MAX_BYTES, BUILD_LEASE_MS, BUILD_HEARTBEAT_MS, buildWorkerId, buildProgress, buildLog, buildError, builtHTML, buildMetadata, verifyBuildWorker } from './build-rules.mjs';

type Row=Record<string,any>;
type User={id:string};
const iso=()=>new Date().toISOString();
const runtime=()=>env as unknown as {DB?:D1Database;BUCKET?:R2Bucket;FUNTRACK_BUILD_RUNNER_TOKEN?:string};
function db(){const value=runtime().DB;if(!value)throw new ApiError(503,'STORAGE_UNAVAILABLE','数据库暂不可用');return value;}
function bucket(){const value=runtime().BUCKET;if(!value)throw new ApiError(503,'STORAGE_UNAVAILABLE','文件存储暂不可用');return value;}
const sql=(query:string,...values:any[])=>db().prepare(query).bind(...values);
const first=(query:string,...values:any[])=>sql(query,...values).first<Row>();
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const RUNNING="('fetching','installing','building','packaging')";
const ACTIVE="('queued','fetching','installing','building','packaging')";
const digest=async(bytes:Uint8Array|string)=>{const data=typeof bytes==='string'?new TextEncoder().encode(bytes):bytes;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data as BufferSource)),b=>b.toString(16).padStart(2,'0')).join('');};
async function readBody(request:Request,max:number){
  if(Number(request.headers.get('content-length')||0)>max)fail(413,'BODY_TOO_LARGE','请求内容过大');
  const reader=request.body?.getReader();if(!reader)return new Uint8Array();
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();fail(413,'BODY_TOO_LARGE','请求内容过大');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
}
async function inputJSON(request:Request){
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))fail(415,'JSON_REQUIRED','请使用 JSON 请求');
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBody(request,65536)));}catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,'INVALID_JSON','JSON 格式无效');}
  if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'INVALID_JSON','JSON 必须是对象');return value;
}
function buildJSON(row:Row){
  return {id:row.id,url:row.source_url,repository:row.repository,commitSha:row.commit_sha,status:row.status,logs:row.logs||'',...(row.error?{error:row.error}:{}),...(row.artifact_bytes!==null?{artifactBytes:row.artifact_bytes}:{}),...(row.artifact_hash?{artifactHash:row.artifact_hash}:{}),...(row.metadata_json?{metadata:JSON.parse(row.metadata_json)}:{}),createdAt:row.created_at,updatedAt:row.updated_at};
}
async function expireBuilds(){
  const now=iso(),queuedBefore=new Date(Date.now()-BUILD_LEASE_MS).toISOString();
  await db().batch([
    sql(`UPDATE ft_build_jobs SET status='failed',error='构建超时，请重新导入',updated_at=? WHERE status IN ${RUNNING} AND lease_expires_at<=?`,now,now),
    sql("UPDATE ft_build_jobs SET status='failed',error='等待构建器超时，请重新导入',updated_at=? WHERE status='queued' AND created_at<=?",now,queuedBefore),
  ]);
}
async function online(){
  if(!runtime().FUNTRACK_BUILD_RUNNER_TOKEN||runtime().FUNTRACK_BUILD_RUNNER_TOKEN!.length<32)return false;
  return Boolean(await first('SELECT id FROM ft_build_workers WHERE last_seen_at>? LIMIT 1',new Date(Date.now()-BUILD_HEARTBEAT_MS).toISOString()));
}
async function ownBuild(id:string,owner:string){
  eventId(id);const row=await first('SELECT * FROM ft_build_jobs WHERE id=? AND owner_id=?',id,owner);
  if(!row)throw new ApiError(404,'BUILD_NOT_FOUND','构建任务不存在');return row;
}
async function createBuild(request:Request,user:User){
  const key=eventId(request.headers.get('idempotency-key')),input=await inputJSON(request),url=requiredText(input.url,'GitHub 链接',4096),requestHash=await digest(url);
  const prior=await first('SELECT * FROM ft_build_jobs WHERE owner_id=? AND idempotency_key=?',user.id,key);
  if(prior){if(prior.request_hash!==requestHash)fail(409,'IDEMPOTENCY_CONFLICT','同一次导入的仓库链接已变化');return json({build:buildJSON(prior)});}
  await expireBuilds();if(!await online())throw new ApiError(503,'BUILD_RUNNER_OFFLINE','构建器暂未在线，请稍后再试');
  const counts=await first(`SELECT COUNT(*) hourly,SUM(CASE WHEN status IN ${ACTIVE} THEN 1 ELSE 0 END) active FROM ft_build_jobs WHERE owner_id=? AND (created_at>? OR status IN ${ACTIVE})`,user.id,new Date(Date.now()-3600000).toISOString());
  if(Number(counts?.active)>=2||Number(counts?.hourly)>=10)throw new ApiError(429,'BUILD_LIMIT_REACHED','每次最多同时构建 2 个项目，每小时最多导入 10 次');
  const source=await resolveGithubRepository(url),id=crypto.randomUUID(),now=iso(),hourBefore=new Date(Date.now()-3600000).toISOString(),heartbeatAfter=new Date(Date.now()-BUILD_HEARTBEAT_MS).toISOString();
  const metadata=JSON.stringify({defaultBranch:source.defaultBranch,description:source.description||'',license:source.license||null});
  try{
    const result=await sql(`INSERT INTO ft_build_jobs (id,owner_id,idempotency_key,request_hash,source_url,repository,commit_sha,status,logs,metadata_json,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,'queued','',?,?,? WHERE
      (SELECT COUNT(*) FROM ft_build_jobs WHERE owner_id=? AND status IN ${ACTIVE})<2 AND
      (SELECT COUNT(*) FROM ft_build_jobs WHERE owner_id=? AND created_at>?)<10 AND
      EXISTS(SELECT 1 FROM ft_build_workers WHERE last_seen_at>?)`,id,user.id,key,requestHash,source.url,source.repository,source.commitSha,metadata,now,now,user.id,user.id,hourBefore,heartbeatAfter).run();
    if(!result.meta.changes){if(!await online())fail(503,'BUILD_RUNNER_OFFLINE','构建器暂未在线，请稍后再试');fail(429,'BUILD_LIMIT_REACHED','每次最多同时构建 2 个项目，每小时最多导入 10 次');}
  }catch(error){const replay=await first('SELECT * FROM ft_build_jobs WHERE owner_id=? AND idempotency_key=?',user.id,key);if(replay){if(replay.request_hash!==requestHash)fail(409,'IDEMPOTENCY_CONFLICT','同一次导入的仓库链接已变化');return json({build:buildJSON(replay)});}throw error;}
  return json({build:buildJSON(await ownBuild(id,user.id))},201);
}
export async function handleBuildAPI(request:Request,user:User):Promise<Response|null>{
  const parts=new URL(request.url).pathname.split('/').filter(Boolean);if(parts[0]!=='api'||parts[1]!=='builds')return null;
  await expireBuilds();
  if(request.method==='GET'&&parts.length===3&&parts[2]==='availability')return json({online:await online()});
  if(request.method==='POST'&&parts.length===2)return createBuild(request,user);
  if(parts.length<3)return json({error:{code:'NOT_FOUND',message:'接口不存在'}},404);
  const row=await ownBuild(parts[2],user.id);
  if(request.method==='GET'&&parts.length===3)return json({build:buildJSON(row)});
  if(request.method==='POST'&&parts.length===4&&parts[3]==='cancel'){
    await sql(`UPDATE ft_build_jobs SET status='cancelled',updated_at=?,error=NULL WHERE id=? AND owner_id=? AND status IN ${ACTIVE}`,iso(),row.id,user.id).run();
    return json({build:buildJSON(await ownBuild(row.id,user.id))});
  }
  if(request.method==='GET'&&parts.length===4&&parts[3]==='preview'){
    const {bytes}=await getBuildArtifact(row.id,user.id);
    return new Response(gameDocument(new TextDecoder().decode(bytes),new URL(request.url).origin),{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':GAME_CSP,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
  }
  return json({error:{code:'NOT_FOUND',message:'接口不存在'}},404);
}
async function leasedBuild(id:string,leaseId:unknown){
  eventId(id);eventId(leaseId);const row=await first('SELECT * FROM ft_build_jobs WHERE id=? AND lease_id=?',id,leaseId);
  if(!row||!['fetching','installing','building','packaging','ready'].includes(row.status)||row.lease_expires_at<=iso())fail(409,'BUILD_LEASE_INVALID','任务已取消、完成或租约过期');return row!;
}
async function completeBuild(request:Request,id:string){
  const contentType=request.headers.get('content-type')||'';if(!contentType.startsWith('multipart/form-data;'))fail(415,'FORM_REQUIRED','请上传构建产物');
  let form:FormData;try{form=await new Response(await readBody(request,BUILD_MAX_BYTES+BUILD_METADATA_MAX_BYTES+65536),{headers:{'Content-Type':contentType}}).formData();}catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,'INVALID_FORM','构建产物表单无效');}
  const leaseId=eventId(form.get('leaseId')),row=await leasedBuild(id,leaseId),file=form.get('file');
  if(!file||typeof file==='string')fail(422,'FILE_REQUIRED','请选择构建产物文件');
  const upload=file as File,bytes=new Uint8Array(await upload.arrayBuffer());builtHTML(bytes,upload.type,upload.name);
  const metadata=buildMetadata(form.get('metadata')||'{}'),artifactHash=await digest(bytes);
  if(row.status==='ready'){
    if(row.artifact_hash!==artifactHash||JSON.stringify(JSON.parse(row.metadata_json||'{}').build||{})!==JSON.stringify(metadata))fail(409,'BUILD_ARTIFACT_CONFLICT','构建任务已有不同的产物');
    return json({build:buildJSON(row)});
  }
  if(row.status!=='packaging')fail(409,'BUILD_STATE_CHANGED','请先进入打包阶段');
  const artifactKey=`builds/${id}/${crypto.randomUUID()}.html`,metadataJSON=JSON.stringify({...JSON.parse(row.metadata_json||'{}'),build:metadata});
  await bucket().put(artifactKey,bytes,{httpMetadata:{contentType:'text/html'}});
  try{
    const result=await sql(`UPDATE ft_build_jobs SET status='ready',artifact_key=?,artifact_bytes=?,artifact_hash=?,metadata_json=?,error=NULL,updated_at=? WHERE id=? AND lease_id=? AND status='packaging' AND lease_expires_at>?`,artifactKey,bytes.byteLength,artifactHash,metadataJSON,iso(),id,leaseId,iso()).run();
    if(result.meta.changes)return json({build:buildJSON(await first('SELECT * FROM ft_build_jobs WHERE id=?',id) as Row)});
  }catch(error){
    const committed=await first('SELECT * FROM ft_build_jobs WHERE id=?',id);
    if(committed?.status==='ready'&&committed.artifact_key===artifactKey)return json({build:buildJSON(committed)});
    // A failed state read above intentionally leaves an unreachable object.
    try{await bucket().delete(artifactKey);}catch{}throw error;
  }
  await bucket().delete(artifactKey);
  const latest=await first('SELECT * FROM ft_build_jobs WHERE id=?',id);
  if(latest?.status==='ready'&&latest.lease_id===leaseId&&latest.artifact_hash===artifactHash&&JSON.stringify(JSON.parse(latest.metadata_json||'{}').build||{})===JSON.stringify(metadata))return json({build:buildJSON(latest)});
  throw new ApiError(409,'BUILD_LEASE_INVALID','任务已取消或租约过期，产物未发布');
}
export async function handleBuildWorker(request:Request):Promise<Response|null>{
  const parts=new URL(request.url).pathname.split('/').filter(Boolean);if(parts[0]!=='api'||parts[1]!=='build-worker')return null;
  await verifyBuildWorker(request.headers,runtime().FUNTRACK_BUILD_RUNNER_TOKEN);
  if(request.method!=='POST')return json({error:{code:'METHOD_NOT_ALLOWED',message:'只支持 POST'}},405);
  await expireBuilds();
  if(parts.length===3&&parts[2]==='heartbeat'){
    const input=await inputJSON(request),workerId=buildWorkerId(input.workerId);
    await sql('INSERT INTO ft_build_workers (id,last_seen_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at',workerId,iso()).run();return json({online:true});
  }
  if(parts.length===3&&parts[2]==='claim'){
    const workerId=buildWorkerId((await inputJSON(request)).workerId),now=iso(),leaseId=crypto.randomUUID(),expiresAt=new Date(Date.now()+BUILD_LEASE_MS).toISOString();
    await sql('INSERT INTO ft_build_workers (id,last_seen_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at',workerId,now).run();
    const row=await first(`UPDATE ft_build_jobs SET status='fetching',worker_id=?,lease_id=?,lease_expires_at=?,updated_at=? WHERE id=(SELECT id FROM ft_build_jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1) AND status='queued' AND NOT EXISTS(SELECT 1 FROM ft_build_jobs WHERE worker_id=? AND status IN ${RUNNING} AND lease_expires_at>?) RETURNING *`,workerId,leaseId,expiresAt,now,workerId,now);
    return json({build:row?{...buildJSON(row),leaseId:row.lease_id,leaseExpiresAt:row.lease_expires_at}:null});
  }
  if(parts.length===4&&parts[3]==='complete')return completeBuild(request,parts[2]);
  if(parts.length===4&&['progress','fail'].includes(parts[3])){
    const input=await inputJSON(request),row=await leasedBuild(parts[2],input.leaseId);
    if(row.status==='ready')fail(409,'BUILD_STATE_CHANGED','构建产物已完成，不能修改');
    if(parts[3]==='progress'){
      const status=buildProgress(row.status,input.status),chunk=buildLog('',input.log??'',runtime().FUNTRACK_BUILD_RUNNER_TOKEN);
      const result=await sql(`UPDATE ft_build_jobs SET status=?,logs=substr(logs||CASE WHEN logs<>'' AND ?<>'' THEN char(10) ELSE '' END||?,-65536),updated_at=? WHERE id=? AND lease_id=? AND status=? AND lease_expires_at>?`,status,chunk,chunk,iso(),row.id,row.lease_id,row.status,iso()).run();
      if(!result.meta.changes)fail(409,'BUILD_LEASE_INVALID','任务状态已变化或租约过期');
    }else{
      const error=buildError(input.error,runtime().FUNTRACK_BUILD_RUNNER_TOKEN);
      const result=await sql(`UPDATE ft_build_jobs SET status='failed',error=?,updated_at=? WHERE id=? AND lease_id=? AND status IN ${RUNNING} AND lease_expires_at>?`,error,iso(),row.id,row.lease_id,iso()).run();
      if(!result.meta.changes)fail(409,'BUILD_LEASE_INVALID','任务状态已变化或租约过期');
    }
    return json({build:buildJSON(await first('SELECT * FROM ft_build_jobs WHERE id=?',row.id) as Row)});
  }
  return json({error:{code:'NOT_FOUND',message:'构建器接口不存在'}},404);
}
export async function getBuildArtifact(id:string,owner:string){
  await expireBuilds();const row=await ownBuild(id,owner);
  if(row.status!=='ready'||!row.artifact_key||!row.artifact_hash)fail(409,'BUILD_NOT_READY','构建尚未成功，请等待构建完成');
  const object=await bucket().get(row.artifact_key);if(!object)fail(404,'BUILD_ARTIFACT_MISSING','构建产物不存在，请重新导入');
  if(object!.size>BUILD_MAX_BYTES)fail(413,'BUILD_ARTIFACT_TOO_LARGE','构建产物过大');
  const bytes=new Uint8Array(await object!.arrayBuffer());builtHTML(bytes,'text/html','index.html');
  if(await digest(bytes)!==row.artifact_hash)fail(409,'BUILD_ARTIFACT_CORRUPT','构建产物校验失败，请重新导入');
  return {bytes,provenance:{buildId:row.id,repository:row.repository,commitSha:row.commit_sha,url:row.source_url,artifactHash:row.artifact_hash,artifactBytes:row.artifact_bytes,metadata:JSON.parse(row.metadata_json||'{}')}};
}
