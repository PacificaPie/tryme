import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fixture,OWNER,OTHER,handleAPI} from './helpers/router-fixture.mjs';
import {createAuthClient} from '../public/auth-client.js';

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
const apiSource=source.slice(source.indexOf('class ApiError extends Error'),source.indexOf('function signinURL'));
function clientHarness(){
  let owner='clerk:a',send=async()=>({ok:true,status:200,json:async()=>({saved:true})});
  const clerk={user:{id:'a'},session:{id:'session-a',getToken:async()=> 'header.payload.signature'},signOut:async()=>{}};
  const auth=createAuthClient({fetchImpl:async()=>({ok:true,json:async()=>({provider:'clerk',configured:true,environment:'test',publishableKey:'pk_test_'+Buffer.from('demo.clerk.accounts.dev$').toString('base64')})}),loadClerk:async()=>clerk});
  // Accessors make every await observe the current account, as the real page does.
  const scope={get draftOwner(){return owner;},get me(){return {id:owner};},authHeaders:auth.authHeaders,assertAuthAccount:(...args)=>auth.assertAuthAccount(...args),fetch:(...args)=>send(...args)};
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
