// Host-side queue client. Secrets arrive on stdin and are never forwarded to Docker.
import {randomUUID} from 'node:crypto';
import {buildRepository} from './repo-builder.mjs';
import {pathToFileURL} from 'node:url';
export function validateRunnerConfig(input){
  const config={...input};let url;try{url=new URL(config.siteOrigin);}catch{throw Error('有效的 siteOrigin 为必填项。');}
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.username||url.password||url.origin!==config.siteOrigin||(!local&&url.protocol!=='https:')||(local&&!['https:','http:'].includes(url.protocol)))throw Error('siteOrigin 必须是无路径、无凭据的 HTTPS origin（本地可使用 HTTP）。');
  if(typeof config.runnerToken!=='string'||config.runnerToken.length<32)throw Error('runnerToken 无效。');
  if(config.siteAccessToken!=null&&typeof config.siteAccessToken!=='string')throw Error('siteAccessToken 无效。');
  config.workerId=config.workerId||randomUUID();if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(config.workerId))throw Error('workerId 必须是 UUID。');
  config.once=config.once===true;return config;
}
export function redactLog(message,secrets=[]){let text=String(message||'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');for(const secret of secrets)if(secret)text=text.split(secret).join('[REDACTED]');return text.replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi,'$1[REDACTED]').replace(/\b(?:gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)\b/g,'[REDACTED]').slice(-12000);}
export async function runWorker(input,{fetchImpl=fetch,build=buildRepository,onLog=console.log,signal}={}){
  const config=validateRunnerConfig(input),secrets=[config.runnerToken,config.siteAccessToken],safe=value=>redactLog(value,secrets);let stop=false,heartbeating=false,completed=0;
  signal?.addEventListener('abort',()=>stop=true,{once:true});
  async function request(route,body){
    const url=new URL('/api/build-worker/'+route,config.siteOrigin);if(url.origin!==config.siteOrigin)throw Error('拒绝向其他 origin 发送 runner 凭据。');
    const headers={Authorization:'Bearer '+config.runnerToken};if(config.siteAccessToken)headers['OAI-Sites-Authorization']='Bearer '+config.siteAccessToken;
    const form=body instanceof FormData;if(!form)headers['Content-Type']='application/json';
    const response=await fetchImpl(url.href,{method:'POST',redirect:'manual',headers,body:form?body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
    if(response.status>=300&&response.status<400)throw Error('构建服务发生重定向，已停止发送凭据。');
    let data;try{data=await response.json();}catch{throw Error(`构建服务返回了非 JSON 响应（${response.status}）。`);}
    if(!response.ok)throw Error(data.error?.message||`构建服务请求失败（${response.status}）。`);return data;
  }
  async function heartbeat(){if(heartbeating||stop)return;heartbeating=true;try{await request('heartbeat',{workerId:config.workerId});}catch(error){onLog(safe('Heartbeat: '+error.message));}finally{heartbeating=false;}}
  await request('heartbeat',{workerId:config.workerId});onLog('Funtrack build worker ready: '+config.workerId);const timer=setInterval(heartbeat,30000);
  try{
    while(!stop){const {build:job}=await request('claim',{workerId:config.workerId});
      if(!job){await new Promise(resolve=>{const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',finish);resolve();};const timer=setTimeout(finish,3000);signal?.addEventListener('abort',finish,{once:true});});continue;}
      if(!/^[a-f0-9-]{36}$/i.test(job.id||'')||typeof job.leaseId!=='string')throw Error('构建服务返回的任务身份无效。');
      onLog('Claimed build '+job.id+' from '+safe(job.repository));
      const jobController=new AbortController();const deadline=setTimeout(()=>jobController.abort(),8*60*1000);const jobSignal=signal?AbortSignal.any([signal,jobController.signal]):jobController.signal;
      try{
        const result=await build(job,{signal:jobSignal,onProgress:async(status,log)=>{await request(encodeURIComponent(job.id)+'/progress',{leaseId:job.leaseId,status,log:safe(log)});onLog(status+': '+safe(log));}});
        const form=new FormData();form.set('leaseId',job.leaseId);form.set('file',new File([result.html],result.filename||'index.html',{type:'text/html'}));form.set('metadata',JSON.stringify(result.metadata));
        const outcome=await request(encodeURIComponent(job.id)+'/complete',form);completed++;onLog('Build ready: '+job.id+' ('+Buffer.byteLength(result.html)+' bytes)');
      }catch(error){const message=safe(error.message);await request(encodeURIComponent(job.id)+'/fail',{leaseId:job.leaseId,error:message}).catch(failure=>onLog(safe('Failure report: '+failure.message)));onLog('Build failed: '+message);completed++;}
      finally{clearTimeout(deadline);}
      if(config.once)break;
    }
  }finally{clearInterval(timer);}
  return {completed,workerId:config.workerId};
}
async function readConfig(){
  if(process.stdin.isTTY){process.stdout.write('Ready for build worker JSON on stdin (input is hidden).\n');process.stdin.setRawMode(true);}
  return await new Promise((resolve,reject)=>{let text='';process.stdin.setEncoding('utf8');process.stdin.resume();const done=()=>{process.stdin.off('data',data);process.stdin.off('end',end);if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();try{resolve(JSON.parse(text));}catch{reject(Error('stdin 需要一个有效 JSON 配置对象。'));}};const data=chunk=>{if(chunk.includes('\u0003')){process.exitCode=130;process.exit();}text+=chunk;if(Buffer.byteLength(text)>32768){reject(Error('配置过大。'));process.stdin.pause();return;}if(text.includes('\n')){text=text.slice(0,text.indexOf('\n'));done();}};const end=()=>done();process.stdin.on('data',data);process.stdin.on('end',end);});
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  let config;const controller=new AbortController();process.on('SIGINT',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
  try{config=await readConfig();await runWorker(config,{signal:controller.signal});}catch(error){console.error(redactLog(error.message,[config?.runnerToken,config?.siteAccessToken]));process.exitCode=1;}
}
