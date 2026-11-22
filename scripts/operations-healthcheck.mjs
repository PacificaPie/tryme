// Read-only synthetic checks. Emits bounded diagnostics; never logs response
// bodies, credentials or signed URLs, and never sends a notification itself.
import {pathToFileURL} from 'node:url';
export async function checkOperations(origin,{fetchImpl=fetch,timeoutMs=10000}={}){
 const url=new URL(origin);
 if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('Use a bare HTTPS origin or loopback test origin.');
 const checks=[['site','/site',200,'html'],['discover','/api/public/discover?limit=1',200,'feed'],['auth_config','/api/auth/config',200,'auth'],['anonymous_boundary','/api/me',401,'denied']];
 const results=await Promise.all(checks.map(async([name,path,status,kind])=>{
  const started=Date.now(),signal=AbortSignal.timeout(timeoutMs);
  try{
   const response=await fetchImpl(new URL(path,url),{signal,redirect:'error',headers:{Accept:kind==='html'?'text/html':'application/json'}});
   if(response.status!==status){void response.body?.cancel().catch(()=>{});return {name,ok:false,status:response.status,reason:'HTTP_STATUS',elapsedMs:Date.now()-started};}
   let valid;
   if(kind==='html')valid=/\bTryMe\b/.test(await response.text());
   else{const data=await response.json();valid=kind==='feed'?Array.isArray(data.works)||Array.isArray(data.items):kind==='auth'?data.provider==='clerk'&&data.configured===true:Boolean(data.error?.code);}
   return {name,ok:valid,status:response.status,...valid?{}:{reason:'INVALID_RESPONSE'},elapsedMs:Date.now()-started};
  }catch{return {name,ok:false,reason:signal.aborted?'TIMEOUT':'UNREACHABLE',elapsedMs:Date.now()-started};}
 }));
 return {checkedAt:new Date().toISOString(),origin:url.origin,ok:results.every(r=>r.ok),checks:results};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==4||process.argv[2]!=='--origin')throw Error('Usage: node scripts/operations-healthcheck.mjs --origin https://trymecard.com');
 const result=await checkOperations(process.argv[3]);console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
}
