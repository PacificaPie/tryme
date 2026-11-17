// Deterministic local-only SQL fixtures exercise more than 200 works and equal
// timestamps. All discovery, popularity, publication and cursor checks use HTTP.
// Run `node tests/integration/discover.mjs --seed` before starting the one local
// Worker, then run without arguments after it is ready. This avoids competing
// Miniflare instances writing the same SQLite state.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const base=new URL(process.env.FUNTRACK_TEST_URL||'http://127.0.0.1:8767');
assert(['localhost','127.0.0.1','[::1]'].includes(base.hostname),'This fixture harness is local only.');
const seedOnly=process.argv.includes('--seed');
const fixtureState=seedOnly?{run:randomUUID()}:JSON.parse(await readFile('.preview/discover-fixtures.json','utf8'));
const run=fixtureState.run,marker='discover_'+run,owner='discover_owner_'+run,other='discover_other_'+run,third='discover_reader_'+run;
const report={run,base:base.origin,checks:[],startedAt:new Date().toISOString()};
async function request(path,{method='GET',user=owner,json,form,headers={}}={}){
  const response=await fetch(new URL(path,base),{method,headers:{...(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':`${user}@sites.test`}:{}),...(method==='POST'?{Origin:base.origin,'X-Funtrack-CSRF':'1'}:{}),...(json!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:form||(json!==undefined?JSON.stringify(json):undefined)});
  const raw=await response.text();let body;try{body=JSON.parse(raw);}catch{body=raw;}return {status:response.status,body};
}
function ok(r,status=200){assert.equal(r.status,status,JSON.stringify(r.body).slice(0,500));return r.body;}
async function check(name,fn){await fn();report.checks.push(name);console.log(`PASS ${name}`);}
const query=(values={})=>'/api/discover?'+new URLSearchParams({q:marker,...values});
const quote=value=>"'"+String(value).replace(/'/g,"''")+"'";
const fixtures=fixtureState.fixtures||Array.from({length:207},(_,i)=>({id:randomUUID(),versionId:randomUUID(),author:i===206?other:owner,authorName:i===206?'Beta Creator':'Alpha Creator',name:`${marker} ${i===0?'Old popular':String(i).padStart(3,'0')}`,desc:i===10?'A literal%_ NeEdLe':'Deterministic local fixture.',createdAt:i===0?'2000-01-01T00:00:00.000Z':'2001-01-01T00:00:00.000Z'}));
if(seedOnly){
const statements=[];
for(let at=0;at<fixtures.length;at+=20){const batch=fixtures.slice(at,at+20);
  statements.push('INSERT INTO ft_works (id,author_id,author_name,name,description,source,current_version_id,url,created_at,idempotency_key,request_hash) VALUES '+batch.map(w=>'('+[w.id,w.author,w.authorName,w.name,w.desc,'url',w.versionId,'https://example.com/discover/'+w.id,w.createdAt,w.id,'local-test-fixture'].map(quote).join(',')+')').join(',')+';');
  statements.push('INSERT INTO ft_work_versions (id,work_id,version,created_at) VALUES '+batch.map(w=>'('+[w.versionId,w.id,'v1',w.createdAt].map(quote).join(',')+')').join(',')+';');
}
await mkdir('.preview',{recursive:true});await writeFile('.preview/discover-fixtures.sql',statements.join('\n'));
execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--config','dist/server/wrangler.json','--local','--persist-to','.wrangler/state','--file','.preview/discover-fixtures.sql','--yes','--json'],{stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024});
await writeFile('.preview/discover-fixtures.json',JSON.stringify({run,fixtures}));
console.log('Seeded 207 local-only discovery fixtures. Start the Worker before running this harness without --seed.');process.exit(0);
}
async function publish(name,source='url'){const form=new FormData();form.set('name',name);form.set('desc','An actual HTTP-published work.');form.set('source',source);if(source==='html')form.set('file',new File(['<!doctype html><body>Test game</body>'],'test.html',{type:'text/html'}));else form.set('url','https://example.com/discover/'+randomUUID());const work=ok(await request('/api/works',{method:'POST',form,headers:{'Idempotency-Key':randomUUID()}}),201).work;assert.equal(work.discovery.eligible,true);assert.equal(work.discovery.reviewRequired,false);return work;}
// Migration 0008's insert trigger lists SQL fixtures just like a new publication.
const html=await publish(marker+' HTML','html'),hot=fixtures[0];
for(const user of [owner,other,third])ok(await request(`/api/works/${hot.id}/like`,{method:'POST',user,json:{liked:true}}));
for(let i=0;i<3;i++)ok(await request(`/api/works/${hot.id}/comments`,{method:'POST',user:third,json:{body:'Popularity fixture '+i},headers:{'Idempotency-Key':randomUUID()}}),201);
await check('discovery ranks old popular works outside the legacy newest-200 window',async()=>{
  assert(!ok(await request('/api/works')).works.some(w=>w.id===hot.id));
  assert(!ok(await request('/api/works?mine=1')).works.some(w=>w.id===hot.id));
  for(const sort of ['likes','comments']){const page=ok(await request(query({sort})));assert.equal(page.works[0].id,hot.id);assert.equal(page.total,208);assert.equal(page.sort,sort);assert(page.asOf);assert(page.nextCursor);}
});
async function collect(values={},initial=null){let page=initial||ok(await request(query(values))),works=[...page.works],asOf=page.asOf,total=page.total;while(page.nextCursor){page=ok(await request(query({...values,cursor:page.nextCursor})));assert.equal(page.asOf,asOf);assert.equal(page.total,total);works.push(...page.works);}return {works,asOf,total};}
await check('newest pagination covers all authors and equal-time ties without duplicates',async()=>{
  const all=await collect({limit:'48'});assert.equal(all.total,208);assert.equal(all.works.length,208);assert.equal(new Set(all.works.map(w=>w.id)).size,208);
  const expected=[...fixtures,{...html,createdAt:html.createdAt}].sort((a,b)=>a.createdAt===b.createdAt?(a.id<b.id?1:-1):(a.createdAt<b.createdAt?1:-1)).map(w=>w.id);
  assert.deepEqual(all.works.map(w=>w.id),expected);
  assert(all.works.some(w=>w.authorId===other));
  const mine=await collect({author:owner,limit:'48'});assert.equal(mine.total,207);assert(mine.works.some(w=>w.id===hot.id));assert(mine.works.every(w=>w.authorId===owner));
});
await check('server search and source/author filters operate on the full dataset',async()=>{
  assert.equal(ok(await request(query({source:'html'}))).works[0].id,html.id);
  assert.equal(ok(await request(query({source:'url'}))).total,207);
  assert.equal(ok(await request('/api/discover?'+new URLSearchParams({q:'needle',author:owner}))).works[0].id,fixtures[10].id);
  assert.equal(ok(await request('/api/discover?'+new URLSearchParams({q:'%_',author:owner}))).total,1);
  const beta=ok(await request('/api/discover?'+new URLSearchParams({q:'beta creator',author:other})));assert.equal(beta.total,1);assert.equal(beta.works[0].id,fixtures[206].id);
});
await check('cursors reject changed filters, malformed input and unauthenticated access',async()=>{
  const page=ok(await request(query()));
  for(const changed of [{q:'different'},{source:'url'},{sort:'likes'},{author:owner}])assert.equal((await request(query({...changed,cursor:page.nextCursor}))).status,400);
  for(const invalid of [{limit:'49'},{sort:'random'},{source:'zip'},{q:'x'.repeat(101)}])assert.equal((await request(query(invalid))).status,422);
  assert.equal((await request(query({cursor:'invalid'}))).status,400);assert.equal((await request(query(),{user:null})).status,401);
});
await check('asOf keeps later publications and comments out of the current ranking traversal',async()=>{
  const first=ok(await request(query({sort:'comments',limit:'1'})));assert.equal(first.works[0].id,hot.id);
  const added=await publish(marker+' Later work');
  ok(await request(`/api/works/${fixtures[1].id}/comments`,{method:'POST',user:third,json:{body:'After snapshot'},headers:{'Idempotency-Key':randomUUID()}}),201);
  const all=await collect({sort:'comments',limit:'48'},first);assert.equal(all.total,208);assert.equal(all.works.length,208);assert.equal(new Set(all.works.map(w=>w.id)).size,208);assert(!all.works.some(w=>w.id===added.id));
  const expected=[...fixtures.slice(1),html].sort((a,b)=>a.createdAt===b.createdAt?(a.id<b.id?1:-1):(a.createdAt<b.createdAt?1:-1)).map(w=>w.id);
  assert.deepEqual(all.works.slice(1).map(w=>w.id),expected);
  assert.equal(ok(await request(query())).total,209);
});
Object.assign(report,{fixtureWorks:207,httpPublishedWorks:2,completedAt:new Date().toISOString()});await writeFile('.preview/local-discover-integration.json',JSON.stringify(report,null,2));
console.log(`Completed ${report.checks.length} checks. Evidence: .preview/local-discover-integration.json`);
