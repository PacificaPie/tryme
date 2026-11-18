import { HTML_MAX_BYTES } from '../../lib/funtrack/limits.mjs';
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { validId, readLimited, json, api, enqueue, safeError, allowOutbound } from './protocol.mjs';

const DEADLINE_MS=8*60*1000;
const HOSTS=['codeload.github.com','registry.npmjs.org'];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');

// Service bindings are the only ingress. No workers.dev, preview URL or route.
export default {
  async fetch(request,env) {
    const path=new URL(request.url).pathname;
    if(request.method==='GET'&&path==='/capabilities') {
      const configured=typeof env.FUNTRACK_BUILD_RUNNER_TOKEN==='string'&&env.FUNTRACK_BUILD_RUNNER_TOKEN.length>=32&&!!env.FUNTRACK_SITE&&!!env.JOBS;
      return json({online:configured,configured,mode:'cloud',maxConcurrent:2},configured?200:503);
    }
    if(request.method==='POST'&&path==='/jobs') {
      let body;try{body=JSON.parse(await readLimited(request,1024));}catch{return json({error:'Invalid job'},422);}
      if(!validId(body?.buildId))return json({error:'Invalid job'},422);
      return enqueue(env,body.buildId);
    }
    const cancel=/^\/jobs\/([^/]+)\/cancel$/.exec(path);
    if(request.method==='POST'&&cancel&&validId(cancel[1]))return env.JOBS.getByName(cancel[1]).fetch('https://job/cancel',{method:'POST'});
    return json({error:'Not found'},404);
  },
  async scheduled(_event,env) {
    // Recover a committed D1 job whose original service-binding dispatch failed.
    const result=await api(env,'queued',{});
    for(const id of result.buildIds||[])if(validId(id))await enqueue(env,id);
  }
};

export class AllowBuildDownloads extends WorkerEntrypoint {
  fetch(request){return allowOutbound(request);}
}
export class DenyBuildNetwork extends WorkerEntrypoint {
  fetch(){return new Response('Build network disabled',{status:403,headers:{'X-Funtrack-Egress':'denied'}});}
}

export class BuildJob extends DurableObject {
  busy=false;
  controller=null;
  cancelRequested=false;
  async fetch(request) {
    const path=new URL(request.url).pathname;
    if(request.method==='POST'&&path==='/enqueue') {
      const {buildId}=await request.json();if(!validId(buildId))return json({error:'Invalid job'},422);
      await this.ctx.blockConcurrencyWhile(async()=>{
        const current=await this.ctx.storage.get('task');
        if(current&&current.buildId!==buildId)throw Error('Job identity conflict');
        if(!current)await this.ctx.storage.put('task',{buildId,workerId:crypto.randomUUID(),phase:'queued',createdAt:Date.now()});
        if(!current||current.phase==='queued')await this.ctx.storage.setAlarm(Date.now()+100);
      });
      return json({accepted:true},202);
    }
    if(request.method==='POST'&&path==='/cancel') {
      this.cancelRequested=true;this.controller?.abort();
      const task=await this.ctx.storage.get('task');
      if(task&&task.phase!=='done')await this.ctx.storage.put('task',{...task,cancelled:true});
      await this.destroy();
      if(!this.busy&&task){await this.ctx.storage.put('task',{...task,phase:'done',outcome:'cancelled'});await this.ctx.storage.deleteAlarm();}
      return json({accepted:true});
    }
    return json({error:'Not found'},404);
  }
  async destroy(){if(this.ctx.container?.running)await this.ctx.container.destroy('Funtrack job finished');}
  async alarm() {
    if(this.busy)return;
    let task=await this.ctx.storage.get('task');
    if(!task||task.phase==='done'){await this.destroy();return;}
    this.busy=true;
    try {
      if(task.cancelled){await this.finish(task,'cancelled');return;}
      if(task.phase==='running') {
        // An alarm resumed after isolate replacement. Never re-execute a build.
        await this.reportFailure(task,Error('构建执行中断，请重新导入。'));
        await this.finish(task,'interrupted');return;
      }
      const claimed=await api(this.env,'claim',{workerId:task.workerId,buildId:task.buildId});
      if(this.cancelRequested||(await this.ctx.storage.get('task'))?.cancelled){await this.finish(task,'cancelled');return;}
      if(!claimed.build) {
        if(claimed.retryable&&Date.now()-task.createdAt<9*60*1000){await this.ctx.storage.setAlarm(Date.now()+10000);return;}
        await this.finish(task,claimed.status||'unavailable');return;
      }
      const job=claimed.build;
      task={...task,phase:'running',leaseId:job.leaseId,startedAt:Date.now()};
      await this.ctx.storage.put('task',task);
      await this.ctx.storage.setAlarm(Date.now()+DEADLINE_MS+30000);
      this.controller=new AbortController();
      const watchdog=setTimeout(()=>{this.controller?.abort();void this.destroy().catch(()=>{});},DEADLINE_MS);
      let checking=false;
      const cancellation=setInterval(async()=>{
        if(checking)return;checking=true;
        try{const status=await api(this.env,`${task.buildId}/status`,{workerId:task.workerId,leaseId:task.leaseId});if(!status.active){this.cancelRequested=true;this.controller?.abort();await this.destroy();}}catch{/* Stage transitions also re-check the D1 lease. */}finally{checking=false;}
      },10000);
      const controlToken=randomToken();
      try {
        if(!this.ctx.container)throw Error('Cloud container is not configured');
        await this.destroy();
        await this.network(this.ctx.exports.AllowBuildDownloads);
        if(this.cancelRequested||this.controller.signal.aborted)throw Object.assign(Error('构建已取消。'),{code:'BUILD_CANCELLED'});
        this.ctx.container.start({enableInternet:false,env:{FUNTRACK_CONTAINER_CONTROL_TOKEN:controlToken,NODE_EXTRA_CA_CERTS:'/etc/cloudflare/certs/cloudflare-containers-ca.crt'}});
        await this.ctx.container.setInactivityTimeout(DEADLINE_MS+30000);
        await this.ready();
        await this.progress(task,'installing','正在读取固定提交：检查已打包 HTML，或准备 Vite 项目的锁定依赖。');
        const prepared=await this.containerJSON('/prepare',{repository:job.repository,commitSha:job.commitSha},controlToken);
        const prebuilt=prepared.metadata?.framework==='prebuilt-html';
        // Replace the exact rules (including existing connections) before any
        // repository build/configuration code is allowed to execute.
        await this.network(this.ctx.exports.DenyBuildNetwork);
        await this.progress(task,'building',prebuilt?'正在导入仓库中的已打包 HTML；未运行项目脚本。':'Cloudflare 云端隔离环境：出网已关闭，正在构建。');
        const result=await this.containerJSON('/build',{},controlToken);
        await this.progress(task,'packaging','正在校验云端产物并保存至 R2。');
        const response=await this.containerFetch('/artifact',null,controlToken);
        const bytes=await readLimited(response,HTML_MAX_BYTES,true,{code:'OUTPUT_TOO_LARGE',label:'最终 HTML'});
        await this.destroy();
        const form=new FormData();form.set('leaseId',task.leaseId);form.set('file',new File([bytes],'index.html',{type:'text/html'}));
        form.set('metadata',JSON.stringify({...result.metadata,execution:{...result.metadata?.execution,provider:'cloudflare-containers',worker:'funtrack-builder-staging',buildId:task.buildId,network:prebuilt?'repository download allowlist; no project code executed':'install allowlist; build denied',schedulingPolicy:'default'}}));
        await api(this.env,`${task.buildId}/complete`,form,{attempts:3});
        await this.finish(task,'ready');
      }catch(error){
        const sanitized=safeError(error,[controlToken,this.env.FUNTRACK_BUILD_RUNNER_TOKEN]);
        await this.reportFailure(task,sanitized);
        await this.finish(task,this.cancelRequested?'cancelled':'failed');
      }finally{clearTimeout(watchdog);clearInterval(cancellation);this.controller=null;await this.destroy();}
    }finally{this.busy=false;}
  }
  async finish(task,outcome){
    await this.destroy();await this.ctx.storage.put('task',{buildId:task.buildId,workerId:task.workerId,phase:'done',outcome,finishedAt:Date.now()});await this.ctx.storage.deleteAlarm();
    console.log(JSON.stringify({event:'cloud-build-finished',buildId:task.buildId,outcome,containerRunning:this.ctx.container?.running===true}));
  }
  async reportFailure(task,error){if(task.leaseId)await api(this.env,`${task.buildId}/fail`,{leaseId:task.leaseId,error:error.message,code:error.code||'BUILD_FAILED'},{attempts:3}).catch(()=>{});}
  async progress(task,status,log){if(this.cancelRequested||this.controller?.signal.aborted)throw Object.assign(Error('构建已取消或超时。'),{code:'BUILD_CANCELLED'});await api(this.env,`${task.buildId}/progress`,{leaseId:task.leaseId,status,log});}
  async network(handler){for(const host of HOSTS){await this.ctx.container.interceptOutboundHttp(host,handler);await this.ctx.container.interceptOutboundHttps(host,handler);}}
  async ready(){
    for(let i=0;i<120;i++){
      if(this.controller.signal.aborted)throw Error('Cloud container startup aborted');
      try{const r=await this.ctx.container.getTcpPort(8080).fetch('http://container/health',{signal:AbortSignal.timeout(2000)});if(r.ok)return;}catch{}
      await sleep(500);
    }throw Object.assign(Error('云端构建环境启动超时，请重试。'),{code:'BUILD_TIMEOUT'});
  }
  async containerFetch(path,body,token){
    const response=await this.ctx.container.getTcpPort(8080).fetch(`http://container${path}`,{method:body===null?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===null?{}:{body:JSON.stringify(body)}),signal:this.controller.signal});
    if(!response.ok){let value;try{value=JSON.parse(await readLimited(response,65536));}catch{}throw Object.assign(Error(value?.error?.message||`Cloud build failed (${response.status})`),{code:value?.error?.code||'BUILD_FAILED'});}
    return response;
  }
  async containerJSON(path,body,token){return JSON.parse(await readLimited(await this.containerFetch(path,body,token),65536));}
}
