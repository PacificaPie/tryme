import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';

// Compile the production TS module for Node. Only the platform import is
// substituted; all SQL, state transitions and service callbacks run unchanged.
const source=readFileSync(new URL('../lib/funtrack/build-service.ts',import.meta.url),'utf8')
  .replace("import { env } from 'cloudflare:workers';",'const env = {};')
  .replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL('../lib/funtrack/'+path.slice(2),import.meta.url).href}'`);
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createBuildService}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const secret='cloud-unit-token-not-a-real-secret-1234567890';
const code=expected=>error=>error.code===expected;
function fixture(t,{mode='cloud'}={}){
  const database=new DatabaseSync(':memory:');t.after(()=>database.close());
  for(const file of readdirSync('drizzle').filter(name=>name.endsWith('.sql')).sort())database.exec(readFileSync('drizzle/'+file,'utf8'));
  const faults={dispatch:false,afterReady:false},calls=[],objects=new Map();let resolved=0;
  const db={prepare(query){return {query,values:[],bind(...values){this.values=values;return this;},async first(){return database.prepare(query).get(...this.values)||null;},async all(){return {results:database.prepare(query).all(...this.values)};},async run(){const result={meta:{changes:database.prepare(query).run(...this.values).changes}};if(faults.afterReady&&query.includes("SET status='ready'")){faults.afterReady=false;throw Error('committed response lost');}return result;}};},async batch(statements){database.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());database.exec('COMMIT');return results;}catch(error){database.exec('ROLLBACK');throw error;}}};
  // D1 serializes writes. Keep transactions synchronous while exercising the
  // asynchronous service code, including concurrent claim/create requests.
  db.batch=async statements=>{database.exec('BEGIN');try{const results=statements.map(statement=>({meta:{changes:database.prepare(statement.query).run(...statement.values).changes}}));database.exec('COMMIT');return results;}catch(error){database.exec('ROLLBACK');throw error;}};
  const bucket={async put(key,bytes){objects.set(key,new Uint8Array(bytes));},async delete(key){objects.delete(key);},async get(key){const bytes=objects.get(key);return bytes?{size:bytes.byteLength,async arrayBuffer(){return bytes.slice().buffer;},async text(){return new TextDecoder().decode(bytes);}}:null;}};
  const cloud={online:true,async fetch(input,options){const request=new Request(input,options),path=new URL(request.url).pathname;
    const record={path,headers:Object.fromEntries(request.headers),body:request.method==='POST'?await request.json():null};calls.push(record);
    if(path==='/capabilities')return Response.json({online:cloud.online,mode:'cloud'});
    if(path.endsWith('/cancel'))record.statusAtCancel=database.prepare('SELECT status FROM ft_build_jobs WHERE id=?').get(record.body.buildId)?.status;
    if(faults.dispatch)throw Error('binding response lost');return Response.json({accepted:true},{status:202});
  }};
  const runtime={DB:db,BUCKET:bucket,FUNTRACK_BUILD_MODE:mode,FUNTRACK_BUILD_RUNNER_TOKEN:secret,FUNTRACK_CLOUD_BUILDER:cloud};
  const service=createBuildService({runtime:()=>runtime,resolveRepository:async url=>{resolved++;return {url,repository:'example/game',commitSha:'a'.repeat(40),defaultBranch:'main',description:'test',license:null};}});
  function request(path,{method='POST',body={},key,token=secret}={}){const headers={};if(key)headers['Idempotency-Key']=key;if(token)headers.Authorization='Bearer '+token;
    if(method!=='GET'&&!(body instanceof FormData))headers['Content-Type']='application/json';
    return new Request('https://site.test'+path,{method,headers,...(method==='GET'?{}:{body:body instanceof FormData?body:JSON.stringify(body)})});}
  const user=id=>({id:id||'cloud-owner'});
  const api=async(path,options={},owner)=>{const response=await service.handleBuildAPI(request('/api/builds'+path,options),user(owner));return {status:response.status,...await response.json()};};
  const worker=async(path,body={},token=secret)=>{const response=await service.handleBuildWorker(request('/api/build-worker/'+path,{body,token}));return response.json();};
  const create=async(owner,key=randomUUID(),url='https://github.com/example/game')=>api('',{key,body:{url}},owner);
  const read=id=>database.prepare('SELECT * FROM ft_build_jobs WHERE id=?').get(id);
  const claim=(id,workerId='cloud-worker-'+id)=>worker('claim',{buildId:id,workerId});
  const complete=async(job,html='<html>game</html>',metadata={framework:'vite'})=>{const form=new FormData();form.set('leaseId',job.leaseId);form.set('file',new File([html],'index.html',{type:'text/html'}));form.set('metadata',JSON.stringify(metadata));return worker(job.id+'/complete',form);};
  return {database,db,bucket,runtime,service,cloud,faults,calls,objects,api,worker,create,claim,complete,read,get resolved(){return resolved;}};
}

test('cloud capabilities are read-only, require a binding and token, and do not depend on local heartbeats',async t=>{
  const f=fixture(t),created=await f.create();f.database.prepare("UPDATE ft_build_jobs SET created_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(created.build.id);
  const before=f.database.prepare('SELECT total_changes() n').get().n;
  const cap=await f.api('/capabilities',{method:'GET'});
  assert.equal(cap.online,true);assert.equal(cap.mode,'cloud');assert.equal(cap.heartbeatTtlSeconds,null);assert.equal(cap.lastHeartbeatAt,null);
  assert.equal(f.database.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.read(created.build.id).status,'queued');
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM ft_build_workers').get().n,0);
  f.cloud.online=false;assert.equal((await f.api('/availability',{method:'GET'})).status,'offline');
  const binding=f.runtime.FUNTRACK_CLOUD_BUILDER;delete f.runtime.FUNTRACK_CLOUD_BUILDER;
  assert.equal((await f.api('/capabilities',{method:'GET'})).configured,false);f.runtime.FUNTRACK_CLOUD_BUILDER=binding;
  delete f.runtime.FUNTRACK_BUILD_RUNNER_TOKEN;assert.equal((await f.api('/capabilities',{method:'GET'})).configured,false);
  f.runtime.FUNTRACK_BUILD_MODE='typo';await assert.rejects(f.api('/capabilities',{method:'GET'}),code('BUILD_RUNNER_UNCONFIGURED'));
});

test('a failed dispatch leaves a durable job; owner read and idempotent replay recover without repinning or leaking credentials',async t=>{
  const f=fixture(t),key=randomUUID();f.faults.dispatch=true;const first=await f.create(undefined,key);
  assert.equal(first.status,201);assert.equal(first.build.status,'queued');assert.equal(f.read(first.build.id).status,'queued');
  const replay=await f.create(undefined,key);assert.equal(replay.status,200);assert.deepEqual(replay.build,first.build);assert.equal(f.resolved,1);
  f.faults.dispatch=false;await f.api('/'+first.build.id,{method:'GET'});
  assert.deepEqual((await f.worker('queued')).buildIds,[first.build.id]);
  const dispatch=f.calls.filter(call=>call.path==='/jobs');assert.equal(dispatch.length,3);
  for(const call of dispatch){assert.deepEqual(call.body,{buildId:first.build.id});assert.equal(call.headers.authorization,undefined);assert.equal(call.headers.cookie,undefined);assert(!JSON.stringify(call).includes(secret));}
  await assert.rejects(f.create(undefined,key,'https://github.com/example/other'),code('IDEMPOTENCY_CONFLICT'));
  const count=f.calls.length;await assert.rejects(f.api('/'+first.build.id,{method:'GET'},'foreign-owner'),code('BUILD_NOT_FOUND'));assert.equal(f.calls.length,count);
  await f.create();await assert.rejects(f.create(),code('BUILD_LIMIT_REACHED'));
});

test('cloud mode rejects legacy generic claims and concurrent same-worker claims replay one fixed lease',async t=>{
  const f=fixture(t),{build}=await f.create(),workerId='cloud-worker-one';
  await assert.rejects(f.worker('claim',{workerId}),code('BUILD_TARGET_REQUIRED'));
  await assert.rejects(f.worker('claim',{workerId,buildId:build.id},'wrong-token'),code('BUILD_RUNNER_AUTH_REQUIRED'));
  const [a,b]=await Promise.all([f.claim(build.id,workerId),f.claim(build.id,workerId)]);
  assert.deepEqual(a,b);assert.equal(a.build.status,'fetching');assert(a.build.leaseId);assert.equal(a.build.commitSha,'a'.repeat(40));
  const replay=await f.claim(build.id,workerId);assert.equal(replay.build.leaseId,a.build.leaseId);assert.equal(replay.build.leaseExpiresAt,a.build.leaseExpiresAt);
  const other=await f.claim(build.id,'different-worker');assert.deepEqual(other,{build:null,status:'fetching',retryable:false});
  const own=await f.api('/'+build.id,{method:'GET'});assert.equal(own.build.leaseId,undefined);assert.equal(own.build.workerId,undefined);
});

test('concurrent cloud creation keeps owner limits atomic and same-key submissions create one durable job',async t=>{
  const f=fixture(t),key=randomUUID(),same=await Promise.all([f.create('same-owner',key),f.create('same-owner',key)]);
  assert.equal(same[0].build.id,same[1].build.id);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM ft_build_jobs WHERE owner_id=?').get('same-owner').n,1);
  const requests=await Promise.allSettled([f.create('limited-owner'),f.create('limited-owner'),f.create('limited-owner')]);
  assert.equal(requests.filter(result=>result.status==='fulfilled').length,2);
  assert.equal(requests.find(result=>result.status==='rejected').reason.code,'BUILD_LIMIT_REACHED');
});

test('atomic cloud claims allow at most two global leases and cancellation frees capacity before notifying the coordinator',async t=>{
  const f=fixture(t),jobs=await Promise.all(['owner-one','owner-two','owner-three'].map(owner=>f.create(owner)));
  const claimed=await Promise.all(jobs.map(({build})=>f.claim(build.id)));
  assert.equal(claimed.filter(result=>result.build).length,2);
  const waiting=claimed.findIndex(result=>!result.build);assert.deepEqual(claimed[waiting],{build:null,status:'queued',retryable:true});
  const running=claimed.findIndex(result=>result.build),runningJob=claimed[running].build;
  await f.api('/'+runningJob.id+'/cancel',{},['owner-one','owner-two','owner-three'][running]);
  assert.equal(f.calls.find(call=>call.path.endsWith('/cancel')).statusAtCancel,'cancelled');
  const late=await f.claim(runningJob.id);assert.deepEqual(late,{build:null,status:'cancelled',retryable:false});
  const next=await f.claim(jobs[waiting].build.id);assert.equal(next.build.status,'fetching');
  await assert.rejects(f.complete(runningJob),code('BUILD_LEASE_INVALID'));assert.equal(f.objects.size,0);
});

test('lease status reveals cancellation and expiry only to its matching worker and lease',async t=>{
  const f=fixture(t),{build}=await f.create(),workerId='status-worker',job=(await f.claim(build.id,workerId)).build;
  const identity={workerId,leaseId:job.leaseId};assert.equal((await f.worker(job.id+'/status',identity)).active,true);
  for(const body of [{...identity,workerId:'other-worker'},{...identity,leaseId:randomUUID()}])await assert.rejects(f.worker(job.id+'/status',body),code('BUILD_LEASE_INVALID'));
  f.database.prepare("UPDATE ft_build_jobs SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(job.id);
  const status=await f.worker(job.id+'/status',identity);assert.equal(status.active,false);assert.equal(status.status,'failed');
  assert.equal(JSON.parse(f.read(job.id).metadata_json).failureCode,'BUILD_TIMEOUT');
  await assert.rejects(f.complete(job),code('BUILD_LEASE_INVALID'));assert.equal(f.objects.size,0);
});

test('a completion whose commit response is lost remains immutable and retryable; cancellation cannot replace a ready artifact',async t=>{
  const f=fixture(t),{build}=await f.create(),workerId='complete-worker',job=(await f.claim(build.id,workerId)).build;
  await f.worker(job.id+'/progress',{leaseId:job.leaseId,status:'packaging',log:'ready to upload'});
  f.faults.afterReady=true;const completed=await f.complete(job),artifactKey=f.read(job.id).artifact_key;
  assert.equal(completed.build.status,'ready');assert.equal(f.objects.size,1);
  const retry=await f.complete(job);assert.deepEqual(retry,completed);assert.equal(f.read(job.id).artifact_key,artifactKey);assert.equal(f.objects.size,1);
  await assert.rejects(f.complete(job,'<html>different</html>'),code('BUILD_ARTIFACT_CONFLICT'));
  assert.equal((await f.claim(job.id,workerId)).status,'ready');
  const state=await f.worker(job.id+'/status',{workerId,leaseId:job.leaseId});assert.equal(state.status,'ready');assert.equal(state.active,false);
  const cancelled=await f.api('/'+job.id+'/cancel');assert.equal(cancelled.build.status,'ready');assert.equal(f.calls.filter(call=>call.path.endsWith('/cancel')).length,0);
  await assert.rejects(f.worker(job.id+'/progress',{leaseId:job.leaseId,status:'packaging',log:'late'}),code('BUILD_STATE_CHANGED'));
});

test('cancellation during R2 upload wins the lease CAS and removes the unreferenced artifact',async t=>{
  const f=fixture(t),{build}=await f.create(),job=(await f.claim(build.id)).build;
  await f.worker(job.id+'/progress',{leaseId:job.leaseId,status:'packaging',log:''});
  let uploaded,resume;const atUpload=new Promise(resolve=>uploaded=resolve),release=new Promise(resolve=>resume=resolve),put=f.bucket.put;
  f.bucket.put=async(...args)=>{await put(...args);uploaded();await release;};
  const pending=f.complete(job),rejected=assert.rejects(pending,code('BUILD_LEASE_INVALID'));
  await atUpload;await f.api('/'+job.id+'/cancel');resume();await rejected;
  assert.equal(f.read(job.id).status,'cancelled');assert.equal(f.read(job.id).artifact_key,null);assert.equal(f.objects.size,0);
});

test('recovery expires old queued jobs rather than resurrecting them and lists only bounded live queued ids',async t=>{
  const f=fixture(t),old=await f.create('old-owner'),fresh=await f.create('fresh-owner');
  f.database.prepare("UPDATE ft_build_jobs SET created_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(old.build.id);
  assert.deepEqual((await f.worker('queued')).buildIds,[fresh.build.id]);assert.equal(f.read(old.build.id).status,'failed');
  assert.equal(JSON.parse(f.read(old.build.id).metadata_json).failureCode,'BUILD_QUEUE_TIMEOUT');
  assert.deepEqual(await f.claim(old.build.id),{build:null,status:'failed',retryable:false});
});

test('default local mode retains heartbeat availability and generic claims',async t=>{
  const f=fixture(t,{mode:undefined});delete f.runtime.FUNTRACK_BUILD_MODE;delete f.runtime.FUNTRACK_CLOUD_BUILDER;
  assert.equal((await f.api('/capabilities',{method:'GET'})).online,false);
  await f.worker('heartbeat',{workerId:'local-worker'});
  const cap=await f.api('/capabilities',{method:'GET'});assert.equal(cap.online,true);assert.equal(cap.mode,'local');assert.equal(cap.heartbeatTtlSeconds,90);
  const {build}=await f.create();assert.equal(f.calls.length,0);
  const claimed=await f.worker('claim',{workerId:'local-worker'});assert.equal(claimed.build.id,build.id);assert.equal(claimed.build.status,'fetching');
});
