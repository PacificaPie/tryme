import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {allowOutbound,readLimited,safeError,validId,json} from '../cloud-builder/src/protocol.mjs';
import {HTML_MAX_BYTES} from '../lib/funtrack/limits.mjs';
import {BuildEngine} from '../cloud-builder/runner/build.mjs';
import {gzipSync} from 'node:zlib';

const id='88888888-1111-4111-8111-111111111111';
const source=readFileSync(new URL('../cloud-builder/src/index.mjs',import.meta.url),'utf8')
  .replace(/^import .*;\n/gm,'').replace('export default {','const worker = {').replaceAll('export class ','class ');
function fixture(initial,{claim,env={},metadata={repository:'owner/game'},prebuilt=false}={}){
  const records=new Map(initial?[['task',structuredClone(initial)]]:[]),calls=[],rules=[];let alarm=null;
  const container={running:false,start(options){calls.push(['start',options]);this.running=true;},async destroy(){calls.push(['destroy']);this.running=false;},async setInactivityTimeout(ms){calls.push(['inactivity',ms]);},
    async interceptOutboundHttp(host,handler){rules.push(['http',host,handler]);},async interceptOutboundHttps(host,handler){rules.push(['https',host,handler]);},
    getTcpPort(port){assert.equal(port,8080);return{fetch:async(url,options={})=>{
      const path=new URL(url).pathname;calls.push(['container',path,options]);
      if(path==='/health')return json({ok:true});
      assert.match(options.headers.Authorization,/^Bearer [a-f0-9]{64}$/);
      if(path==='/prepare')return json({prepared:true,metadata:{framework:prebuilt?'prebuilt-html':'vite'}});
      if(path==='/build'){assert.deepEqual(rules.slice(-4).map(x=>x[2]),['deny','deny','deny','deny']);return json({metadata});}
      if(path==='/artifact')return new Response('<!doctype html><html>ok</html>');
      throw Error('Unexpected container route');
    }};}};
  const ctx={container,exports:{AllowBuildDownloads:'allow',DenyBuildNetwork:'deny'},storage:{async get(k){return records.get(k);},async put(k,v){records.set(k,structuredClone(v));},async setAlarm(at){alarm=at;},async deleteAlarm(){alarm=null;}},async blockConcurrencyWhile(fn){return fn();}};
  class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env;}}
  class WorkerEntrypoint{}
  const api=async(env,path,body)=>{calls.push(['api',path,body]);if(path==='claim'){if(claim)return claim();return{build:{repository:'owner/game',commitSha:'a'.repeat(40),leaseId:'77777777-1111-4111-8111-111111111111'}};}return{active:true};};
  const deps={DurableObject,WorkerEntrypoint,validId,readLimited,json,api,enqueue:()=>{},safeError,allowOutbound,HTML_MAX_BYTES};
  const names=Object.keys(deps),{BuildJob}=new Function(...names,source+'\nreturn {BuildJob,worker};')(...names.map(k=>deps[k]));
  return{job:new BuildJob(ctx,{FUNTRACK_BUILD_RUNNER_TOKEN:'platform-secret-is-never-in-container',...env}),records,calls,rules,container,get alarm(){return alarm;}};
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

const readJSON=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
for(const environment of ['production','staging']) {
  test(`${environment} completion uses its configured worker and preserves build metadata`,async()=>{
    const config=readJSON(`../cloud-builder/wrangler${environment==='production'?'.production':''}.jsonc`);
    assert.equal(config.vars.FUNTRACK_BUILD_WORKER,config.name);
    assert.equal(config.name,`funtrack-builder-${environment}`);
    assert.equal(config.services.find(service=>service.binding==='FUNTRACK_SITE').service,`funtrack-${environment}`);
    for(const prebuilt of [false,true]) {
      const metadata={repository:'owner/game',commitSha:'a'.repeat(40),framework:prebuilt?'prebuilt-html':'vite',outputSha256:'b'.repeat(64),license:{path:'LICENSE'},execution:{
        worker:'client-supplied-worker',environment:'client-supplied-environment',provider:'client-supplied-provider',buildId:'client-supplied-build-id',network:'client-supplied-network',schedulingPolicy:'client-supplied-policy',
        ...(prebuilt?{projectScriptsExecuted:false,dependenciesInstalled:false}:{buildUid:1000,noNewPrivileges:true,processLimit:128,taskTimeoutMs:480000}),
      }};
      const f=fixture({buildId:id,workerId:id,phase:'queued',createdAt:Date.now()},{env:config.vars,metadata,prebuilt});
      await f.job.alarm();
      const complete=f.calls.find(call=>call[1]===`${id}/complete`);
      assert.ok(complete,'job must reach completion');
      const actual=JSON.parse(complete[2].get('metadata'));
      assert.deepEqual(actual,{...metadata,execution:{...metadata.execution,provider:'cloudflare-containers',worker:config.name,environment,buildId:id,
        network:prebuilt?'repository download allowlist; no project code executed':'install allowlist; build denied',schedulingPolicy:'default'}});
      if(environment==='production')assert.equal(JSON.stringify(actual).includes('staging'),false);
      const start=f.calls.find(call=>call[0]==='start')[1];
      assert.equal(JSON.stringify(actual).includes(start.env.FUNTRACK_CONTAINER_CONTROL_TOKEN),false);
      assert.equal(JSON.stringify(actual).includes('platform-secret'),false);
      assert.equal(start.env.FUNTRACK_BUILD_WORKER,undefined);
      assert.equal(f.records.get('task').outcome,'ready');
    }
  });
}

test('local dev explicitly overrides deployment identity and disables remote bindings',async()=>{
  const args=readJSON('../cloud-builder/package.json').scripts.dev.split(' ');
  assert.deepEqual(args.slice(0,3),['wrangler','dev','--local']);
  const worker=args[args.indexOf('--name')+1];
  assert.equal(worker,'funtrack-builder-local');
  assert.equal(args[args.indexOf('--var')+1],`FUNTRACK_BUILD_WORKER:${worker}`);
  for(const file of ['wrangler.jsonc','wrangler.production.jsonc']) {
    const config=readJSON(`../cloud-builder/${file}`);
    const f=fixture({buildId:id,workerId:id,phase:'queued',createdAt:Date.now()},{env:{...config.vars,FUNTRACK_BUILD_WORKER:worker}});
    await f.job.alarm();
    const execution=JSON.parse(f.calls.find(call=>call[1]===`${id}/complete`)[2].get('metadata')).execution;
    assert.equal(execution.worker,worker);assert.equal(execution.environment,'local');
  }
});

test('missing or invalid deployment identity is unknown, ignores claimed identity, and leaks no config',async()=>{
  for(const value of [undefined,null,'','production','constructor','__proto__','https://trymecard.com','secret-config-value',{},['funtrack-builder-production']]) {
    const f=fixture({buildId:id,workerId:id,phase:'queued',createdAt:Date.now(),worker:'funtrack-builder-production',environment:'production'},{
      env:{FUNTRACK_BUILD_WORKER:value,FUNTRACK_SITE_ORIGIN:'https://trymecard.com',UNRELATED_SECRET:'unrelated-secret-value'},
      claim:()=>({build:{repository:'owner/game',commitSha:'a'.repeat(40),leaseId:id,worker:'funtrack-builder-production',environment:'production',FUNTRACK_BUILD_WORKER:'funtrack-builder-production'}}),
      metadata:{execution:{worker:'funtrack-builder-production',environment:'production'}},
    });
    await f.job.alarm();
    const encoded=f.calls.find(call=>call[1]===`${id}/complete`)[2].get('metadata'),{execution}=JSON.parse(encoded);
    assert.equal(execution.worker,'unknown');assert.equal(execution.environment,'unknown');
    for(const forbidden of ['production','staging','secret-config-value','unrelated-secret-value','platform-secret','trymecard.com'])assert.equal(encoded.includes(forbidden),false);
    assert.equal(f.records.get('task').outcome,'ready');
  }
});

test('cloud engine imports an existing standalone entry without installation or repository command execution',async()=>{
  const html=readFileSync(new URL('./fixtures/prebuilt-loader.html',import.meta.url),'utf8'),bytes=Buffer.from(html),header=Buffer.alloc(512);
  header.write('root/dist/index.html');header.write('0000644\0',100);header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124);header.fill(32,148,156);header[156]=48;
  let sum=0;for(const byte of header)sum+=byte;header.write(sum.toString(8).padStart(6,'0')+'\0 ',148);
  const archive=gzipSync(Buffer.concat([header,bytes,Buffer.alloc((512-bytes.length%512)%512),Buffer.alloc(1024)])),previous=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,options});const response=new Response(archive);Object.defineProperty(response,'url',{value:url});return response;};
  const engine=new BuildEngine();
  try{
    const prepared=await engine.prepare({repository:'owner/game',commitSha:'a'.repeat(40)});
    assert.equal(prepared.metadata.framework,'prebuilt-html');assert.equal(engine.phase,'prepared');
    const built=await engine.build();assert.equal(engine.phase,'ready');assert.equal(built.metadata.framework,'prebuilt-html');assert.deepEqual(built.metadata.buildCommands,[]);
    assert.equal(built.metadata.execution.projectScriptsExecuted,false);assert.equal(built.metadata.execution.dependenciesInstalled,false);
    assert.equal(built.metadata.sourcePath,'dist/index.html');assert.equal(engine.artifact.toString().replace(/\n<!--\nSource:[\s\S]*?-->\n/,''),html);
    assert.equal(calls.length,1);assert.match(calls[0].url,/^https:\/\/codeload.github.com\/owner\/game\/tar.gz\/[a-f0-9]{40}$/);
  }finally{globalThis.fetch=previous;clearTimeout(engine.deadline);}
});
