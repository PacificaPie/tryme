// Local-only backend contract test. Seed before starting the one local Worker.
// The Worker and this harness need the same FUNTRACK_BUILD_RUNNER_TOKEN.
// This harness simulates an authenticated builder uploading a deterministic
// artifact; it does not claim to prove npm builds. The real runner is tested apart.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const base=new URL(process.env.FUNTRACK_TEST_URL||'http://127.0.0.1:8767');
assert(['localhost','127.0.0.1','[::1]'].includes(base.hostname),'Build fixtures are local only');
const seedOnly=process.argv.includes('--seed');
const fixture=seedOnly?{run:randomUUID(),expired:randomUUID(),expiredQueue:randomUUID(),lease:randomUUID()}:JSON.parse(await readFile('.preview/build-service-fixtures.json','utf8'));
const owner='build_owner_'+fixture.run,other='build_other_'+fixture.run,workerA='worker_a_'+fixture.run,workerB='worker_b_'+fixture.run;
const repo='https://github.com/yuss-raa/Snake-Game',sha='1f76427453c48f6f0a02d09a12e0469451c0d1e3';
if(seedOnly){
  const quote=v=>"'"+String(v).replace(/'/g,"''")+"'";
  const rows=[{id:fixture.expired,status:'packaging',lease:fixture.lease},{id:fixture.expiredQueue,status:'queued',lease:null}];
  const statements=rows.map(row=>'INSERT INTO ft_build_jobs (id,owner_id,idempotency_key,request_hash,source_url,repository,commit_sha,status,logs,lease_id,lease_expires_at,created_at,updated_at) VALUES ('+[row.id,owner,row.id,'fixture',repo,'yuss-raa/Snake-Game',sha,row.status,'',row.lease,'2001-01-01T00:10:00.000Z','2001-01-01T00:00:00.000Z','2001-01-01T00:00:00.000Z'].map(v=>v===null?'NULL':quote(v)).join(',')+');');
  await mkdir('.preview',{recursive:true});await writeFile('.preview/build-service-fixtures.sql',statements.join('\n'));
  execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--file','.preview/build-service-fixtures.sql','--yes','--json'],{stdio:['ignore','pipe','pipe'],maxBuffer:1048576});
  await writeFile('.preview/build-service-fixtures.json',JSON.stringify(fixture));console.log('Seeded expired and stale-queue jobs; start the local Worker before running the checks.');process.exit(0);
}
const secret=process.env.FUNTRACK_BUILD_RUNNER_TOKEN;assert(secret&&secret.length>=32,'Set the local test runner token in the environment. Never use production data here.');
const report={run:fixture.run,base:base.origin,checks:[],startedAt:new Date().toISOString()};
async function request(path,{method='GET',user=owner,json,form,headers={},worker=false,token=secret}={}){
  const response=await fetch(new URL(path,base),{method,headers:{...(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@sites.test'}:{}),...(method==='POST'&&!worker?{Origin:base.origin,'X-Funtrack-CSRF':'1'}:{}),...(json!==undefined?{'Content-Type':'application/json'}:{}),...(worker?{Authorization:'Bearer '+token}:{}),...headers},body:form||(json!==undefined?JSON.stringify(json):undefined)});
  const raw=await response.text();let body;try{body=JSON.parse(raw);}catch{body=raw;}return {status:response.status,body,headers:response.headers};
}
const expectStatus=(result,status)=>{assert.equal(result.status,status,'Expected HTTP '+status+', got '+result.status+': '+JSON.stringify(result.body).slice(0,1600));return result;};
const ok=(result,status=200)=>expectStatus(result,status).body;
async function check(name,fn){await fn();report.checks.push(name);console.log('PASS '+name);}
const worker=(suffix,json)=>request('/api/build-worker/'+suffix,{method:'POST',user:null,worker:true,json});
const create=(key=randomUUID())=>request('/api/builds',{method:'POST',json:{url:repo},headers:{'Idempotency-Key':key}});
function artifact(leaseId,html='<!doctype html><html><body>build fixture</body></html>',metadata={framework:'fixture',durationMs:42}){const form=new FormData();form.set('leaseId',leaseId);form.set('file',new File([html],'index.html',{type:'text/html'}));form.set('metadata',JSON.stringify(metadata));return form;}
const finish=(id,leaseId,html,metadata)=>request('/api/build-worker/'+id+'/complete',{method:'POST',user:null,worker:true,form:artifact(leaseId,html,metadata)});
await check('owner and runner authentication paths are separate',async()=>{
  expectStatus(await request('/api/builds/availability',{user:null}),401);
  expectStatus(await request('/api/build-worker/heartbeat',{method:'POST',json:{workerId:workerA}}),401);
  expectStatus(await request('/api/build-worker/heartbeat',{method:'POST',worker:true,user:null,token:'incorrect',json:{workerId:workerA}}),401);
  expectStatus(await request('/api/builds',{method:'POST',json:{url:repo},headers:{Origin:'null','Idempotency-Key':randomUUID()}}),403);
  ok(await worker('heartbeat',{workerId:workerA}));assert.equal(ok(await request('/api/builds/availability')).online,true);
});
await check('queued timeout and expired leases become failed and cannot accept artifacts',async()=>{
  for(const id of [fixture.expired,fixture.expiredQueue])assert.equal(ok(await request('/api/builds/'+id)).build.status,'failed');
  expectStatus(await finish(fixture.expired,fixture.lease),409);
});
const key=randomUUID();let first,second,claimed;
await check('creation pins repository metadata, replays idempotently and enforces the active limit',async()=>{
  first=ok(await create(key),201).build;assert.equal(first.repository,'yuss-raa/Snake-Game');assert.match(first.commitSha,/^[a-f0-9]{40}$/);assert.equal(first.status,'queued');
  assert.equal(ok(await create(key)).build.id,first.id);
  expectStatus(await request('/api/builds',{method:'POST',json:{url:'https://github.com/another/project'},headers:{'Idempotency-Key':key}}),409);
  second=ok(await create(),201).build;expectStatus(await create(),429);
  for(const value of [first,second])assert(!('leaseId' in value)&&!('ownerId' in value)&&!('artifactKey' in value));
});
await check('another owner cannot read, preview or cancel a build',async()=>{
  for(const suffix of ['', '/preview'])expectStatus(await request('/api/builds/'+first.id+suffix,{user:other}),404);
  expectStatus(await request('/api/builds/'+first.id+'/cancel',{method:'POST',user:other,json:{}}),404);
});
await check('two concurrent claims are atomic and do not duplicate a job',async()=>{
  const results=await Promise.all([worker('claim',{workerId:workerA}),worker('claim',{workerId:workerB})]);
  claimed=results.map(r=>ok(r).build);assert(claimed.every(Boolean));assert.equal(new Set(claimed.map(b=>b.id)).size,2);
  assert(claimed.some(b=>b.id===first.id));assert(claimed.some(b=>b.id===second.id));
  assert.equal(ok(await worker('claim',{workerId:workerA})).build,null);
  first=claimed.find(b=>b.id===first.id);second=claimed.find(b=>b.id===second.id);
});
await check('lease and monotonic stage checks protect progress; logs redact the runner token',async()=>{
  expectStatus(await worker(first.id+'/progress',{leaseId:randomUUID(),status:'packaging',log:'wrong lease'}),409);
  const update=ok(await worker(first.id+'/progress',{leaseId:first.leaseId,status:'packaging',log:'test log '+secret}));assert.equal(update.build.status,'packaging');assert(!update.build.logs.includes(secret));
  expectStatus(await worker(first.id+'/progress',{leaseId:first.leaseId,status:'installing',log:'backwards'}),409);
});
await check('cancellation makes a claimed job terminal and rejects a late completion',async()=>{
  const cancelled=ok(await request('/api/builds/'+second.id+'/cancel',{method:'POST',json:{}})).build;assert.equal(cancelled.status,'cancelled');
  expectStatus(await finish(second.id,second.leaseId),409);
  expectStatus(await worker(second.id+'/progress',{leaseId:second.leaseId,status:'packaging',log:'late'}),409);
});
const html='<!doctype html><html><body><h1>Built project</h1>'+('x'.repeat(1048576))+'</body></html>';
await check('ready artifacts accept more than 1 MiB, are hash-checked, idempotent and immutable',async()=>{
  const ready=ok(await finish(first.id,first.leaseId,html)).build;assert.equal(ready.status,'ready');assert.equal(ready.artifactBytes,new TextEncoder().encode(html).byteLength);assert.match(ready.artifactHash,/^[a-f0-9]{64}$/);
  assert.equal(ok(await finish(first.id,first.leaseId,html)).build.artifactHash,ready.artifactHash);
  expectStatus(await finish(first.id,first.leaseId,'<!doctype html><html>different</html>'),409);
  const preview=await request('/api/builds/'+first.id+'/preview');expectStatus(preview,200);assert.match(preview.headers.get('content-security-policy'),/sandbox allow-scripts/);assert(!preview.headers.get('content-security-policy').includes('allow-same-origin'));assert(preview.body.includes('<h1>Built project</h1>'));
});
let published;
await check('only the owner can publish a ready build and provenance follows the immutable version',async()=>{
  const form=()=>{const f=new FormData();f.set('name','Built fixture '+fixture.run);f.set('desc','Local build service contract fixture.');f.set('source','html');f.set('buildId',first.id);return f;};
  expectStatus(await request('/api/works',{method:'POST',user:other,form:form(),headers:{'Idempotency-Key':randomUUID()}}),404);
  const key=randomUUID();published=ok(await request('/api/works',{method:'POST',form:form(),headers:{'Idempotency-Key':key}}),201).work;
  assert.equal(published.build.buildId,first.id);assert.equal(published.build.commitSha,first.commitSha);assert.equal(published.source,'html');
  assert.equal(ok(await request('/api/works',{method:'POST',form:form(),headers:{'Idempotency-Key':key}})).work.id,published.id);
  assert.equal(ok(await request('/api/works/'+published.id)).work.build.artifactHash,published.build.artifactHash);
  const game=await request('/game/'+published.versionId);expectStatus(game,200);assert(game.body.includes('<h1>Built project</h1>'));
});
Object.assign(report,{buildId:first.id,workId:published.id,completedAt:new Date().toISOString()});await writeFile('.preview/local-builds-integration.json',JSON.stringify(report,null,2));console.log('Completed '+report.checks.length+' build service checks.');
