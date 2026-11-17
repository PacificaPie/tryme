import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {allowOutbound,readLimited,safeError,validId,json} from '../cloud-builder/src/protocol.mjs';

const id='88888888-1111-4111-8111-111111111111';
const source=readFileSync(new URL('../cloud-builder/src/index.mjs',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').replace('export default {','const worker = {').replaceAll('export class ','class ');
function fixture(initial,{claim}={}){
  const records=new Map(initial?[['task',structuredClone(initial)]]:[]),calls=[],rules=[];let alarm=null;
  const container={running:false,start(options){calls.push(['start',options]);this.running=true;},async destroy(){calls.push(['destroy']);this.running=false;},async setInactivityTimeout(ms){calls.push(['inactivity',ms]);},
    async interceptOutboundHttp(host,handler){rules.push(['http',host,handler]);},async interceptOutboundHttps(host,handler){rules.push(['https',host,handler]);},
    getTcpPort(port){assert.equal(port,8080);return{fetch:async(url,options={})=>{
      const path=new URL(url).pathname;calls.push(['container',path,options]);
      if(path==='/health')return json({ok:true});
      assert.match(options.headers.Authorization,/^Bearer [a-f0-9]{64}$/);
      if(path==='/prepare')return json({prepared:true});
      if(path==='/build'){assert.deepEqual(rules.slice(-4).map(x=>x[2]),['deny','deny','deny','deny']);return json({metadata:{repository:'owner/game'}});}
      if(path==='/artifact')return new Response('<!doctype html><html>ok</html>');
      throw Error('Unexpected container route');
    }};}};
  const ctx={container,exports:{AllowBuildDownloads:'allow',DenyBuildNetwork:'deny'},storage:{async get(k){return records.get(k);},async put(k,v){records.set(k,structuredClone(v));},async setAlarm(at){alarm=at;},async deleteAlarm(){alarm=null;}},async blockConcurrencyWhile(fn){return fn();}};
  class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}
  class WorkerEntrypoint{}
  const api=async(env,path,body)=>{calls.push(['api',path,body]);if(path==='claim'){if(claim)return claim();return{build:{repository:'owner/game',commitSha:'a'.repeat(40),leaseId:'77777777-1111-4111-8111-111111111111'}};}return{active:true};};
  const deps={DurableObject,WorkerEntrypoint,validId,readLimited,json,api,enqueue:()=>{},safeError,allowOutbound};
  const names=Object.keys(deps),{BuildJob}=new Function(...names,source+'\nreturn {BuildJob,worker};')(...names.map(k=>deps[k]));
  return{job:new BuildJob(ctx,{FUNTRACK_BUILD_RUNNER_TOKEN:'platform-secret-is-never-in-container'}),records,calls,rules,container,get alarm(){return alarm;}};
}

test('cloud outbound only forwards GET to the two download origins and strips credentials',async()=>{
  let seen;
  const fetchImpl=async(url,options)=>{seen={url,options};return new Response('ok');};
  const response=await allowOutbound(new Request('https://registry.npmjs.org/package',{headers:{Authorization:'Bearer private',Cookie:'secret=1'}}),fetchImpl);
  assert.equal(response.status,200);assert.equal(seen.options.redirect,'manual');assert.equal(seen.options.headers.Authorization,undefined);assert.equal(seen.options.headers.Cookie,undefined);
  for(const request of [new Request('https://evil.test'),new Request('https://registry.npmjs.org',{method:'POST',body:'x'}),new Request('https://registry.npmjs.org:444/foo')])assert.equal((await allowOutbound(request,fetchImpl)).status,403);
});
test('cloud read limit applies to streamed bytes and error messages redact all control secrets',async()=>{
  await assert.rejects(readLimited(new Response('12345'),4),/limit/);
  assert.equal(safeError(Error('token aaa secret bbb'),['aaa','bbb']).message,'token [redacted] secret [redacted]');
});
test('durable enqueue is idempotent and cancellation before claim starts no container',async()=>{
  const f=fixture();const request=()=>new Request('https://job/enqueue',{method:'POST',body:JSON.stringify({buildId:id})});
  assert.equal((await f.job.fetch(request())).status,202);const first=f.records.get('task');await f.job.fetch(request());assert.deepEqual(f.records.get('task'),first);
  await f.job.fetch(new Request('https://job/cancel',{method:'POST'}));await f.job.alarm();assert.equal(f.records.get('task').outcome,'cancelled');assert.equal(f.calls.length,0);assert.equal(f.alarm,null);
});
test('recovered running alarm destroys old environment and fails without reopening downloads or re-executing',async()=>{
  const f=fixture({buildId:id,workerId:id,phase:'running',leaseId:id});f.container.running=true;await f.job.alarm();
  assert.equal(f.rules.length,0);assert.equal(f.calls.some(x=>x[0]==='start'),false);assert.equal(f.calls.some(x=>x[1]===`${id}/fail`),true);assert.equal(f.container.running,false);assert.equal(f.records.get('task').outcome,'interrupted');
});
test('cancellation while a claim is in flight never starts a billable container',async()=>{
  let release,claimed;const started=new Promise(resolve=>{claimed=resolve;});
  const f=fixture({buildId:id,workerId:id,phase:'queued',createdAt:Date.now()},{claim:()=>{claimed();return new Promise(resolve=>{release=resolve;});}});
  const running=f.job.alarm();await started;await f.job.fetch(new Request('https://job/cancel',{method:'POST'}));release({build:{leaseId:id,repository:'owner/game',commitSha:'a'.repeat(40)}});await running;
  assert.equal(f.rules.length,0);assert.equal(f.calls.some(x=>x[0]==='start'),false);assert.equal(f.records.get('task').outcome,'cancelled');
});
test('cloud build disables downloads before build, never passes platform token and destroys before completion',async()=>{
  const f=fixture({buildId:id,workerId:id,phase:'queued',createdAt:Date.now()});await f.job.alarm();
  const start=f.calls.find(x=>x[0]==='start')[1];assert.equal(start.enableInternet,false);assert.equal(start.image,undefined);assert.deepEqual(Object.keys(start.env).sort(),['FUNTRACK_CONTAINER_CONTROL_TOKEN','NODE_EXTRA_CA_CERTS']);assert.equal(JSON.stringify(start).includes('platform-secret'),false);
  const finished=f.calls.findIndex(x=>x[1]===`${id}/complete`);assert.ok(f.calls.findIndex(x=>x[0]==='destroy')<finished);
  const form=f.calls[finished][2];assert.equal(JSON.parse(form.get('metadata')).execution.provider,'cloudflare-containers');assert.equal(f.container.running,false);assert.equal(f.records.get('task').outcome,'ready');assert.equal(f.alarm,null);
  assert.equal(JSON.stringify(f.records.get('task')).includes(start.env.FUNTRACK_CONTAINER_CONTROL_TOKEN),false);
});
