import { HTML_MAX_BYTES, COVER_MAX_BYTES, PUBLICATION_MAX_BYTES } from './limits.mjs';
import { ApiError, fail, eventId, requiredText } from './rules.mjs';

export const BUILD_MAX_BYTES=HTML_MAX_BYTES;
export const BUILD_METADATA_MAX_BYTES=65536;
export const BUILD_LOG_MAX_CHARS=65536;
export const BUILD_ACTIVE=['queued','fetching','installing','building','packaging'];
export const BUILD_RUNNING=['fetching','installing','building','packaging'];
export const BUILD_LEASE_MS=10*60*1000;
export const BUILD_HEARTBEAT_MS=90*1000;

export const buildWorkerId=value=>eventId(value);
export function buildProgress(current,next){
  if(!BUILD_RUNNING.includes(next))fail(422,'INVALID_BUILD_STATUS','构建阶段无效');
  if(!BUILD_RUNNING.includes(current)||BUILD_RUNNING.indexOf(next)<BUILD_RUNNING.indexOf(current))fail(409,'BUILD_STATE_CHANGED','构建阶段不能倒退，请重新读取任务');
  return next;
}
export function buildLog(previous,chunk,secret=''){
  if(typeof chunk!=='string'||chunk.length>16384)fail(422,'INVALID_BUILD_LOG','单次构建日志最多 16384 字');
  let cleaned=chunk.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');
  if(secret)cleaned=cleaned.split(secret).join('[redacted]');
  cleaned=cleaned.replace(/Bearer\s+[A-Za-z0-9._~+\/-]{16,}/gi,'Bearer [redacted]');
  return (String(previous||'')+(previous&&cleaned?'\n':'')+cleaned).slice(-BUILD_LOG_MAX_CHARS);
}
export function buildError(value,secret=''){
  const text=requiredText(value,'构建错误',2000);
  return buildLog('',text,secret);
}
export function builtHTML(bytes,mime,name){
  if(mime!=='text/html'||typeof name!=='string'||!/\.html?$/i.test(name))fail(415,'INVALID_BUILD_ARTIFACT','构建产物必须为 HTML 文件');
  if(!bytes.length||bytes.length>BUILD_MAX_BYTES)fail(413,'BUILD_ARTIFACT_TOO_LARGE','构建产物必须在 8 MiB 以内');
  let html;try{html=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail(422,'INVALID_BUILD_ARTIFACT','构建产物必须使用 UTF-8 编码');}
  if(!/^\s*(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/i.test(html))fail(422,'INVALID_BUILD_ARTIFACT','构建产物必须是完整 HTML 文档');
  return html;
}
export function buildMetadata(value){
  let result;try{result=typeof value==='string'?JSON.parse(value):value;}catch{throw new ApiError(422,'INVALID_BUILD_METADATA','构建元数据不是有效 JSON');}
  if(!result||typeof result!=='object'||Array.isArray(result))fail(422,'INVALID_BUILD_METADATA','构建元数据必须为 JSON 对象');
  let serialized;try{serialized=JSON.stringify(result);}catch{throw new ApiError(422,'INVALID_BUILD_METADATA','构建元数据不能序列化');}
  if(new TextEncoder().encode(serialized).length>BUILD_METADATA_MAX_BYTES)fail(413,'BUILD_METADATA_TOO_LARGE','构建元数据不能超过 64 KiB');
  return JSON.parse(serialized);
}
export async function verifyBuildWorker(headers,expected){
  if(typeof expected!=='string'||expected.length<32)fail(503,'BUILD_RUNNER_UNCONFIGURED','构建服务尚未配置');
  const actual=headers.get('authorization')||'';
  if(actual.length>2048||!actual.startsWith('Bearer '))fail(401,'BUILD_RUNNER_AUTH_REQUIRED','构建器身份无效');
  const digest=async value=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  const [left,right]=await Promise.all([digest(actual.slice(7)),digest(expected)]);let mismatch=0;
  for(let i=0;i<left.length;i++)mismatch|=left[i]^right[i];
  if(mismatch)fail(401,'BUILD_RUNNER_AUTH_REQUIRED','构建器身份无效');
}

// Capability responses contain no worker IDs, credentials, or per-owner jobs.
export function buildCapabilities({configured=false,lastHeartbeatAt=null,now=Date.now()}={}){
  configured=configured===true;
  const seen=typeof lastHeartbeatAt==='string'?Date.parse(lastHeartbeatAt):NaN;
  const known=configured&&Number.isFinite(seen);
  const online=known&&seen<=now&&seen>now-BUILD_HEARTBEAT_MS;
  return {online,configured,status:!configured?'unconfigured':online?'online':'offline',heartbeatTtlSeconds:BUILD_HEARTBEAT_MS/1000,
    lastHeartbeatAt:known?lastHeartbeatAt:null,
    limits:{htmlBytes:HTML_MAX_BYTES,coverBytes:COVER_MAX_BYTES,publicationBytes:PUBLICATION_MAX_BYTES},
    imports:{html:true,repository:online},repositoryRequirements:['public','vite','npm-lockfile','root-license']};
}
const BUILD_FAILURE_CODES=new Set([
  'UNSUPPORTED_PROJECT','UNSUPPORTED_LOCKFILE','UNSUPPORTED_DEPENDENCY','LICENSE_REQUIRED','EXTERNAL_ASSET',
  'OUTPUT_TOO_LARGE','ARCHIVE_TOO_LARGE','FETCH_FAILED','INVALID_ARCHIVE','UNSAFE_ARCHIVE','UNSAFE_OUTPUT',
  'BUILD_TOOL_UNAVAILABLE','BUILD_COMMAND_FAILED','OUTPUT_TIMEOUT','OUTPUT_REQUIRED','ISOLATION_FAILED',
  'BUILD_TIMEOUT','BUILD_QUEUE_TIMEOUT','BUILD_CANCELLED','BUILD_LOG_LIMIT','INVALID_REPOSITORY','BUILD_FAILED',
]);
export const buildFailureCode=value=>BUILD_FAILURE_CODES.has(value)?value:'BUILD_FAILED';
