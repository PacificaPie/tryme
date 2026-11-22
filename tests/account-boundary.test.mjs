import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fixture,OWNER,OTHER,handleAPI} from './helpers/router-fixture.mjs';
import {createAuthClient} from '../public/auth-client.js';
import {apiTimeout,withRequestDeadline} from '../public/api-request.js';

const expected=id=>({'X-Funtrack-Expected-User':id});
test('stale page identity is rejected before profile, interaction and publication writes or receipts',async t=>{
  const f=fixture(t),{work}=await f.publish();
  const comment=(await f.api(`/api/works/${work.id}/comments`,{method:'POST',body:{body:'Seed'}})).comment;
  const paths=[
    ['/api/me/profile','POST',{name:'A draft in B',bio:'Private draft'}],
    [`/api/works/${work.id}/like`,'POST',{liked:true}],
    [`/api/comments/${comment.id}/like`,'POST',{liked:true}],
    [`/api/creators/${OWNER}/follow`,'POST',{following:true}],
    ['/api/works','POST',new FormData()],
    [`/api/works/${work.id}`,'PATCH',new FormData()],
    [`/api/works/${work.id}/discovery`,'PATCH',{action:'hide',expectedRevision:1}],
    ['/api/sessions','POST',{workId:work.id,versionId:work.versionId}],
    ['/api/imports/github','POST',{url:'https://github.com/example/repo'}],
    ['/api/builds','POST',{url:'https://github.com/example/repo'}],
    ['/api/me/avatar','POST',new FormData()],
  ];
  const before=f.database.prepare('SELECT name FROM sqlite_master WHERE type=\'table\'').all().map(({name})=>[name,f.database.prepare(`SELECT * FROM "${name}"`).all()]);
  for(const [path,method,body]of paths){const result=await f.api(path,{method,body,owner:OTHER,extraHeaders:expected(OWNER)});assert.equal(result.status,409,path);assert.equal(result.error.code,'AUTH_SESSION_CHANGED',path);}
  for(const [name,rows]of before)assert.deepEqual(f.database.prepare(`SELECT * FROM "${name}"`).all(),rows,name);
});
test('matching and legacy requests retain auth, CSRF, idempotency and ownership; private reads check expected identity too',async t=>{
  const f=fixture(t),{work}=await f.publish(),path=`/api/works/${work.id}/comments`,key=randomUUID(),body={body:'Original'};
  const accepted=await f.api(path,{method:'POST',body,key,extraHeaders:expected(OWNER)});assert.equal(accepted.status,201);
  assert.equal((await f.api(path,{method:'POST',body,key,owner:OTHER,extraHeaders:expected(OWNER)})).status,409);
  const replay=await f.api(path,{method:'POST',body,key});assert.equal(replay.status,200);assert.equal(replay.comment.id,accepted.comment.id);
  for(const id of ['', ' ', 'x'.repeat(257),OTHER])assert.equal((await f.api('/api/me',{extraHeaders:expected(id)})).status,409);
  assert.equal((await f.api('/api/me',{extraHeaders:expected(OWNER)})).user.id,OWNER);
  const denied=await f.api(path,{method:'POST',body,extraHeaders:{...expected(OWNER),'X-Funtrack-CSRF':''}});assert.equal(denied.status,403);
  const anonymous=await handleAPI(new Request('https://site.test/api/me',{headers:expected(OWNER)}));assert.equal(anonymous.status,401);
  const ownership=await f.api(`/api/works/${work.id}/discovery`,{method:'PATCH',owner:OTHER,body:{action:'hide',expectedRevision:1},extraHeaders:expected(OTHER)});assert.equal(ownership.status,403);
});

// Execute the real site's API boundary, with fake transport and Clerk only.
const source=readFileSync(new URL('../public/site.js',import.meta.url),'utf8');
// Keep this transport harness scoped to the API boundary; the notification
// widget mounted immediately after it needs a real DOM and has separate tests.
const apiSource=source.slice(source.indexOf('class ApiError extends Error'),source.indexOf('const notificationCenter='));
function clientHarness({timers=globalThis}={}){
  let owner='clerk:a',send=async()=>({ok:true,status:200,json:async()=>({saved:true})});
  const clerk={user:{id:'a'},session:{id:'session-a',getToken:async()=> 'header.payload.signature'},signOut:async()=>{}};
  const auth=createAuthClient({fetchImpl:async()=>({ok:true,json:async()=>({provider:'clerk',configured:true,environment:'test',publishableKey:'pk_test_'+Buffer.from('demo.clerk.accounts.dev$').toString('base64')})}),loadClerk:async()=>clerk});
  // Accessors make every await observe the current account, as the real page does.
  const scope={apiTimeout,withRequestDeadline:(task,options)=>withRequestDeadline(task,{...options,timers}),get draftOwner(){return owner;},get me(){return {id:owner};},authHeaders:auth.authHeaders,assertAuthAccount:(...args)=>auth.assertAuthAccount(...args),fetch:(...args)=>send(...args)};
  const api=Function('scope',`with(scope){${apiSource};return api;}`)(scope);
  return {api,clerk,setOwner:value=>{owner=value;},transport:fn=>{send=fn;}};
}
test('A page cannot submit with B credentials, even when the switch precedes token acquisition',async()=>{
  const h=clientHarness();let requests=0;h.transport(async()=>{requests++;return {ok:true,json:async()=>({})};});
  h.clerk.user={id:'b'};h.clerk.session={id:'session-b',getToken:async()=> 'header.payload.signature'};
  await assert.rejects(h.api('/api/me/profile',{method:'POST',body:{name:'A draft'}}),{code:'AUTH_SESSION_CHANGED'});assert.equal(requests,0);
});
test('account headers bind JSON and multipart writes without changing the body or receipt key',async()=>{
  const h=clientHarness(),form=new FormData();form.set('name','Draft');const sent=[];
  h.transport(async(path,options)=>{sent.push(options);return {ok:true,status:200,json:async()=>({saved:true})};});
  await h.api('/api/works',{method:'POST',headers:{'Idempotency-Key':'receipt-123'},body:form});
  await h.api('/api/me/profile',{method:'POST',body:{name:'Draft'}});
  assert.equal(sent[0].headers['X-Funtrack-Expected-User'],'clerk:a');assert.equal(sent[0].headers['Idempotency-Key'],'receipt-123');assert.equal(sent[0].body,form);assert.equal(sent[0].headers['X-Funtrack-CSRF'],'1');
  assert.deepEqual(JSON.parse(sent[1].body),{name:'Draft'});
});
test('a response completing after a Clerk account switch cannot reach its caller',async()=>{
  const h=clientHarness();let release,started;const gate=new Promise(resolve=>{started=resolve;});
  h.transport(async()=>({ok:true,status:200,json:()=>{started();return new Promise(resolve=>{release=resolve;});}}));
  const pending=h.api('/api/me/profile',{method:'POST',body:{name:'A'}});await gate;h.clerk.user={id:'b'};release({user:{id:'clerk:a',name:'A'}});
  await assert.rejects(pending,{code:'AUTH_SESSION_CHANGED'});
});
test('a late response after the page identity changes cannot reach the new account',async()=>{
  const h=clientHarness();let release,started;const gate=new Promise(resolve=>{started=resolve;});
  h.transport(async()=>{started();return new Promise(resolve=>{release=resolve;});});
  const pending=h.api('/api/works?mine=1');await gate;h.setOwner('clerk:b');release({ok:true,status:200,json:async()=>({works:[{name:'A private draft'}]})});
  await assert.rejects(pending,{code:'AUTH_SESSION_CHANGED'});
});
test('guest public reads stay credential-free',async()=>{
  const h=clientHarness();h.transport(async(path,options)=>{assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers['X-Funtrack-Expected-User'],undefined);return {ok:true,status:200,json:async()=>({works:[]})};});
  assert.deepEqual(await h.api('/api/public/feed'),{works:[]});
});

test('a stale initial me response cannot hydrate a different current Clerk account',async()=>{
  const h=clientHarness();h.setOwner(null);let release,started;const gate=new Promise(resolve=>{started=resolve;});
  h.transport(async()=>({ok:true,status:200,json:()=>{started();return new Promise(resolve=>{release=resolve;});}}));
  const pending=h.api('/api/me');await gate;h.clerk.user={id:'b'};release({user:{id:'clerk:a',name:'A'}});
  await assert.rejects(pending,{code:'AUTH_SESSION_CHANGED'});
});

function deadlineClock(){
  const jobs=new Map();let id=0;
  return {jobs,setTimeout(fn,ms){jobs.set(++id,{fn,ms});return id;},clearTimeout(key){jobs.delete(key);},expire(){assert.equal(jobs.size,1);[...jobs.values()][0].fn();}};
}
test('the production API deadline covers a hung token and never sends a late write',async()=>{
  const timers=deadlineClock(),h=clientHarness({timers});let release,started,requests=0;
  const ready=new Promise(resolve=>{started=resolve;});
  h.clerk.session.getToken=()=>{started();return new Promise(resolve=>{release=resolve;});};h.transport(async()=>{requests++;return {ok:true,json:async()=>({})};});
  const pending=h.api('/api/cards',{method:'POST',headers:{'Idempotency-Key':'same-key'},body:{workIds:['work']}});
  const rejected=assert.rejects(pending,{code:'REQUEST_TIMEOUT',status:0});await ready;timers.expire();await rejected;
  release('header.payload.signature');await new Promise(resolve=>setImmediate(resolve));assert.equal(requests,0);assert.equal(timers.jobs.size,0);
});
test('hung JSON body is bounded; late data is discarded and retry preserves the submission key',async()=>{
  const timers=deadlineClock(),h=clientHarness({timers}),requests=[];let release,started;
  const ready=new Promise(resolve=>{started=resolve;});
  h.transport(async(path,options)=>{requests.push(options);return {ok:true,status:200,json:()=>{started();return new Promise(resolve=>{release=resolve;});}};});
  const options={method:'POST',headers:{'Idempotency-Key':'same-key'},body:{workIds:['work']}},pending=h.api('/api/cards',options);
  const rejected=assert.rejects(pending,{code:'REQUEST_TIMEOUT'});await ready;timers.expire();await rejected;assert.equal(requests[0].signal.aborted,true);
  release({card:{id:'late-card'}});await new Promise(resolve=>setImmediate(resolve));
  h.transport(async(path,options)=>{requests.push(options);return {ok:true,status:200,json:async()=>({card:{id:'committed-card'}})};});
  assert.equal((await h.api('/api/cards',options)).card.id,'committed-card');
  assert.equal(requests[1].headers['Idempotency-Key'],requests[0].headers['Idempotency-Key']);assert.equal(requests[1].body,requests[0].body);assert.equal(timers.jobs.size,0);
});
test('a caller cancellation settles ignored transport and an already cancelled request never sends',async()=>{
  const timers=deadlineClock(),h=clientHarness({timers}),controller=new AbortController();let count=0,started;
  const ready=new Promise(resolve=>{started=resolve;});h.transport(()=>{count++;started();return new Promise(()=>{});});
  const pending=h.api('/api/works?mine=1',{signal:controller.signal}),rejected=assert.rejects(pending,{code:'REQUEST_ABORTED'});
  await ready;controller.abort();await rejected;assert.equal(timers.jobs.size,0);
  await assert.rejects(h.api('/api/works?mine=1',{signal:controller.signal}),{code:'REQUEST_ABORTED'});assert.equal(count,1);
});
test('deadline policy leaves longer bounded windows for uploads, imports and captures',()=>{
  assert.equal(apiTimeout('/api/me'),15000);assert.equal(apiTimeout('/api/cards',{method:'POST'}),30000);
  assert.equal(apiTimeout('/api/works',{method:'POST',body:new FormData()}),90000);
  assert.equal(apiTimeout('/api/imports/github',{method:'POST'}),60000);
  assert.equal(apiTimeout('/api/publish-drafts/draft-id/capture',{method:'POST'}),45000);
});
