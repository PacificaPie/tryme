// Explicitly local end-to-end checks against real Miniflare D1/R2.
// No production identity spoofing or remote writes are allowed by this harness.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const base = new URL(process.env.FUNTRACK_TEST_URL || 'http://127.0.0.1:8767');
assert(['localhost','127.0.0.1','[::1]'].includes(base.hostname), 'Integration harness only runs on loopback.');
const run = randomUUID();
const owner = `test_owner_${run}`, stranger = `test_stranger_${run}`;
const baseHeaders = user => ({ 'oai-authenticated-user-id': user, 'oai-authenticated-user-email': `${user}@sites.test` });
async function request(path, { method='GET', user=owner, json, form, headers={} }={}) {
  const hs={...(user?baseHeaders(user):{}),...(method!=='GET'?{Origin:base.origin,'X-Funtrack-CSRF':'1'}:{}),...headers};
  if(json!==undefined)hs['Content-Type']='application/json';
  const response=await fetch(new URL(path,base),{method,headers:hs,body:form|| (json!==undefined?JSON.stringify(json):undefined)});
  const text=await response.text();let body;try{body=JSON.parse(text);}catch{body=text;}
  return {status:response.status,headers:response.headers,body};
}
function ok(r,status=200){assert.equal(r.status,status,JSON.stringify(r.body).slice(0,500));return r.body;}
const report={run,base:base.origin,checks:[],ids:{},startedAt:new Date().toISOString()};
async function check(name,fn){await fn();report.checks.push(name);console.log(`PASS ${name}`);}
let work,card,session,firstReceipt;
await check('missing identity and cross-origin writes rejected',async()=>{
  assert.equal((await request('/api/me',{user:null})).status,401);
  assert.equal((await request('/api/events',{method:'POST',json:{},headers:{Origin:'https://untrusted.example'}})).status,403);
  assert.equal((await request('/api/events',{method:'POST',json:{},headers:{Origin:'null'}})).status,403);
  assert.equal((await request('/api/events',{method:'POST',json:{},headers:{'X-Funtrack-CSRF':''}})).status,403);
});
const html=await readFile('examples/tiles.html');
const cover=await readFile('examples/tiles.png');
function workForm(name=`QA 九宫格 ${run.slice(0,8)}`){const f=new FormData();f.set('name',name);f.set('desc','本地端到端测试上传；无演示统计。');f.set('source','html');f.set('file',new File([html],'tiles.html',{type:'text/html'}));f.set('cover',new File([cover],'tiles.png',{type:'image/png'}));return f;}
await check('upload commits one durable work and retries deduplicate',async()=>{
  const key=`upload-${run}`;work=ok(await request('/api/works',{method:'POST',form:workForm(),headers:{'Idempotency-Key':key}}),201).work;
  report.ids.work=work.id;report.ids.version=work.versionId;
  const replay=ok(await request('/api/works',{method:'POST',form:workForm(),headers:{'Idempotency-Key':key}})).work;
  assert.equal(replay.id,work.id);
  assert.equal((await request('/api/works',{method:'POST',form:workForm('Different content'),headers:{'Idempotency-Key':key}})).status,409);
  assert.equal(ok(await request('/api/works/'+work.id)).work.id,work.id);
  const mine=ok(await request('/api/works?mine=1')).works;assert.equal(mine.filter(w=>w.id===work.id).length,1);
  assert.equal(ok(await request('/api/works?mine=1',{user:stranger})).works.length,0);
});
await check('invalid upload fails without publishing a work',async()=>{
  const before=ok(await request('/api/works?mine=1')).works.length;
  const f=workForm('Bad cover upload');f.set('cover',new File(['not an image'],'bad.png',{type:'image/png'}));
  assert.equal((await request('/api/works',{method:'POST',form:f,headers:{'Idempotency-Key':`invalid-${run}`}})).status,415);
  assert.equal(ok(await request('/api/works?mine=1')).works.length,before);
  const oversize=workForm('Oversize upload');oversize.set('file',new File(['<!doctype html>'+ 'x'.repeat(1048576)],'large.html',{type:'text/html'}));
  assert.equal((await request('/api/works',{method:'POST',form:oversize,headers:{'Idempotency-Key':`oversize-${run}`}})).status,413);
  assert.equal(ok(await request('/api/works?mine=1')).works.length,before);
});
await check('served game and cover retain isolation and media headers',async()=>{
  const game=await request('/game/'+work.versionId);assert.equal(game.status,200);
  const csp=game.headers.get('content-security-policy')||'';
  assert.match(csp,/sandbox allow-scripts/);assert(!csp.includes('allow-same-origin'));assert.match(csp,/connect-src 'none'/);assert.match(csp,/frame-ancestors 'self'/);
  assert.equal(game.headers.get('x-content-type-options'),'nosniff');assert.match(game.body,/funtrack-game/);assert(!game.body.includes(owner));
  const image=await fetch(new URL(work.coverUrl,base),{headers:baseHeaders(owner)});assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/image\/png/);assert((await image.arrayBuffer()).byteLength>100);
});
await check('work view receipts deduplicate',async()=>{
  const event={eventId:`view-${run}`,type:'work_view',workId:work.id};firstReceipt=ok(await request('/api/events',{method:'POST',json:event}));
  const retry=ok(await request('/api/events',{method:'POST',json:event}));assert.equal(retry.duplicate,true);assert.equal(retry.receipt.id,firstReceipt.receipt.id);
});
await check('session ownership, real database receipts and retry ordering',async()=>{
  session=ok(await request('/api/sessions',{method:'POST',json:{workId:work.id,versionId:work.versionId}}),201);report.ids.session=session.id;
  const start={id:`start-${run}`,type:'play_start',seq:1};
  const rejected=await request(`/api/sessions/${session.id}/events`,{method:'POST',user:stranger,json:{token:session.token,events:[start]}});assert([403,404].includes(rejected.status));
  const accepted=ok(await request(`/api/sessions/${session.id}/events`,{method:'POST',json:{token:session.token,events:[start]}}));assert.equal(accepted.accepted.length,1);
  const retry=ok(await request(`/api/sessions/${session.id}/events`,{method:'POST',json:{token:session.token,events:[start]}}));assert.equal(retry.accepted.length,0);
  const terminal=[{id:`complete-${run}`,type:'game_complete',seq:2,result:{score:3,label:'全部点亮'}},{id:`end-${run}`,type:'session_end',seq:3,elapsedMs:12000}];
  assert.equal(ok(await request(`/api/sessions/${session.id}/events`,{method:'POST',json:{token:session.token,events:terminal}})).accepted.length,2);
  assert.equal(ok(await request(`/api/sessions/${session.id}/events`,{method:'POST',json:{token:session.token,events:terminal}})).accepted.length,0);
});
await check('feedback persists once and author inbox is scoped',async()=>{
  const payload={workId:work.id,eventId:`feedback-${run}`,type:'建议',text:'真实数据库接口测试：手机操作顺畅。'};
  const sent=await request('/api/feedback',{method:'POST',user:stranger,json:payload});assert([200,201].includes(sent.status));report.ids.feedback=sent.body.feedback.id;
  const retried=await request('/api/feedback',{method:'POST',user:stranger,json:payload});assert([200,201].includes(retried.status));assert.equal(retried.body.feedback.id,report.ids.feedback);
  const incoming=ok(await request('/api/feedback')).feedback;assert.equal(incoming.filter(f=>f.id===report.ids.feedback).length,1);
  assert.equal(ok(await request('/api/feedback',{user:stranger})).feedback.length,0);
});
await check('immutable card snapshots only include owned works',async()=>{
  const payload={workIds:[work.id],template:'fold',name:'本地测试创作者',bio:'从已上传作品生成。'};
  assert([403,404].includes((await request('/api/cards',{method:'POST',user:stranger,json:payload})).status));
  card=ok(await request('/api/cards',{method:'POST',json:payload}),201).card;report.ids.card=card.id;
  assert.equal(card.works[0].versionId,work.versionId);assert.equal(card.works[0].coverUrl,work.coverUrl);
  const second=ok(await request('/api/cards',{method:'POST',json:{...payload,name:'另一版',template:'wall'}}),201).card;
  assert.notEqual(second.id,card.id);assert.equal(ok(await request('/api/cards/'+card.id)).card.name,payload.name);
});
await check('analytics use stored counts and ownership',async()=>{
  const data=ok(await request(`/api/analytics?work=${work.id}`));
  assert.equal(data.summary.views,1);assert.equal(data.summary.starts,1);assert.equal(data.summary.ends,1);assert.equal(data.summary.feedback,1);assert(data.receipts.length>=4);
  assert([403,404].includes((await request(`/api/analytics?work=${work.id}`,{user:stranger})).status));
  assert.equal(ok(await request('/api/analytics',{user:stranger})).summary.starts,0);
  report.analytics=data;
});
await check('external work starts remain unknown',async()=>{
  const f=new FormData();f.set('name','External QA');f.set('desc','External link telemetry boundary.');f.set('source','url');f.set('url','https://example.com/');
  const external=ok(await request('/api/works',{method:'POST',form:f,headers:{'Idempotency-Key':`external-${run}`}}),201).work;
  const stats=ok(await request(`/api/analytics?work=${external.id}`));assert.equal(stats.byWork[0].starts,null);
  assert((await request('/api/sessions',{method:'POST',json:{workId:external.id,versionId:external.versionId}})).status>=400);
});
report.completedAt=new Date().toISOString();await mkdir('.preview',{recursive:true});await writeFile('.preview/local-api-integration.json',JSON.stringify(report,null,2));
console.log(`Completed ${report.checks.length} checks. Evidence: .preview/local-api-integration.json`);
