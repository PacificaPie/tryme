// Real D1 checks run only on an explicitly local built Worker. No remote writes.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const base=new URL(process.env.FUNTRACK_TEST_URL||'http://127.0.0.1:8767');
assert(['localhost','127.0.0.1','[::1]'].includes(base.hostname),'Only loopback test identities are allowed.');
const run=randomUUID(),owner=`likes_owner_${run}`,other=`likes_other_${run}`;
const report={run,base:base.origin,checks:[],startedAt:new Date().toISOString()};
async function request(path,{method='GET',user=owner,json,form,headers={}}={}){
  const response=await fetch(new URL(path,base),{method,headers:{...(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':`${user}@sites.test`}:{}),...(method==='POST'?{Origin:base.origin,'X-Funtrack-CSRF':'1'}:{}),...(json!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:form||(json!==undefined?JSON.stringify(json):undefined)});
  const raw=await response.text();let body;try{body=JSON.parse(raw);}catch{body=raw;}return {status:response.status,body};
}
function ok(response,status=200){assert.equal(response.status,status,JSON.stringify(response.body).slice(0,400));return response.body;}
async function check(name,fn){await fn();report.checks.push(name);console.log(`PASS ${name}`);}
const form=new FormData();form.set('name','Like integration');form.set('desc','Local database verification only.');form.set('source','url');form.set('url','https://example.com/game');
const work=ok(await request('/api/works',{method:'POST',form,headers:{'Idempotency-Key':`work-${run}`}}),201).work;
const path=`/api/works/${work.id}/like`,set=(liked,user=owner,extra={})=>request(path,{method:'POST',user,json:{liked,...extra}});
await check('like endpoint retains identity, CSRF, type and target validation',async()=>{
  assert.equal((await request(path,{user:null})).status,401);
  assert.equal((await request(path,{method:'POST',json:{liked:true},headers:{Origin:'null'}})).status,403);
  assert.equal((await set('true')).status,422);assert.equal((await set(null)).status,422);
  assert.equal((await request('/api/works/missing/like',{method:'POST',json:{liked:true}})).status,404);
  assert.deepEqual(ok(await request(path)),{workId:work.id,liked:false,likesCount:0});
});
await check('repeated and concurrent true requests store one user like',async()=>{
  const responses=await Promise.all(Array.from({length:6},()=>set(true)));
  responses.forEach(response=>assert.deepEqual(ok(response),{workId:work.id,liked:true,likesCount:1}));
  assert.deepEqual(ok(await set(true)),{workId:work.id,liked:true,likesCount:1});
  const listed=ok(await request('/api/works?mine=1')).works.find(w=>w.id===work.id);assert.equal(listed.likesCount,1);assert.equal(listed.likedByMe,true);
  const otherWork=ok(await request(`/api/works/${work.id}`,{user:other})).work;assert.equal(otherWork.likesCount,1);assert.equal(otherWork.likedByMe,false);
});
await check('a second account adds one like and unsetting cannot remove another account',async()=>{
  assert.deepEqual(ok(await set(true,other)),{workId:work.id,liked:true,likesCount:2});
  assert.deepEqual(ok(await set(false,owner,{actorId:other})),{workId:work.id,liked:false,likesCount:1});
  assert.deepEqual(ok(await set(false)),{workId:work.id,liked:false,likesCount:1});
  assert.deepEqual(ok(await request(path,{user:other})),{workId:work.id,liked:true,likesCount:1});
  assert.deepEqual(ok(await set(false,other)),{workId:work.id,liked:false,likesCount:0});
  assert.equal(ok(await request(`/api/analytics?work=${work.id}`)).summary.feedback,0);
});
const initial={workIds:[work.id],template:'fold',name:'Original creator',bio:'Original bio',signature:'Seedy',headline:'Play small things',website:'https://example.com/about',backStyle:'ivory'};
const key=`card-${run}`;let card;
await check('new card details persist with profile and explicit retry identity',async()=>{
  card=ok(await request('/api/cards',{method:'POST',json:initial,headers:{'Idempotency-Key':key}}),201).card;
  for(const field of ['signature','headline','website','backStyle'])assert.equal(card[field],initial[field]);
  assert(!('likesCount' in card.works[0]));assert(!('likedByMe' in card.works[0]));
  assert.deepEqual(ok(await request('/api/cards',{method:'POST',json:initial,headers:{'Idempotency-Key':key}})).card,card);
  assert.equal((await request('/api/cards',{method:'POST',json:{...initial,signature:'Changed'},headers:{'Idempotency-Key':key}})).status,409);
  const profile=ok(await request('/api/me')).user;
  for(const field of ['name','bio','signature','headline','website','backStyle'])assert.equal(profile[field],initial[field]);
});
await check('detail validation and ownership fail before profile changes',async()=>{
  for(const patch of [{signature:'x'.repeat(81)},{headline:'x'.repeat(121)},{website:'javascript:alert(1)'},{website:'https://name:password@example.com/'},{backStyle:'custom'}])assert.equal((await request('/api/cards',{method:'POST',json:{...initial,...patch}})).status,422);
  assert.equal((await request('/api/cards',{method:'POST',user:other,json:initial})).status,403);
  assert.equal(ok(await request('/api/me')).user.signature,'Seedy');
});
await check('later profile and like changes never rewrite old card snapshots',async()=>{
  const secondInput={...initial,name:'Current creator',signature:'New signature',headline:'New headline',website:'',backStyle:'cobalt'};
  const second=ok(await request('/api/cards',{method:'POST',json:secondInput}),201).card;
  await set(true);assert.deepEqual(ok(await request('/api/cards/'+card.id)).card,card);
  assert.equal(ok(await request('/api/cards/me')).card.id,second.id);
  assert.equal(ok(await request('/api/me')).user.signature,'New signature');
  assert.equal(ok(await request('/api/works/'+work.id)).work.authorName,'Current creator');
  assert.equal(card.works[0].authorName,'Original creator');
});
await check('omitted new details retain the documented compatible defaults',async()=>{
  const {signature,headline,website,backStyle,...legacyInput}=initial;
  const defaults=ok(await request('/api/cards',{method:'POST',json:legacyInput}),201).card;
  assert.equal(defaults.signature,'');assert.equal(defaults.headline,'');assert.equal(defaults.website,'');assert.equal(defaults.backStyle,'ink');
});
Object.assign(report,{workId:work.id,cardId:card.id,completedAt:new Date().toISOString()});
await mkdir('.preview',{recursive:true});await writeFile('.preview/local-likes-cards-integration.json',JSON.stringify(report,null,2));
console.log(`Completed ${report.checks.length} checks. Evidence: .preview/local-likes-cards-integration.json`);
