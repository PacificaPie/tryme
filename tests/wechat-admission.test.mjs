import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,handleAPI,gameResponse} from './helpers/router-fixture.mjs';
import {createStandaloneHandler} from '../lib/funtrack/standalone-auth.mjs';
import {authenticate} from '../lib/funtrack/rules.mjs';
import {withVerifiedIdentity} from '../lib/funtrack/identity-context.mjs';

const appId='wx1234567890abcdef',subject='user_wechat',owner='clerk:'+subject;
function boundary(t,{mapped=true}={}) {
  const f=fixture(t);
  if(mapped)f.database.prepare('INSERT INTO ft_wechat_identities VALUES(?,?,?,?,?)').run(appId,'openid_verified_123',subject,null,Date.now());
  const profile={id:subject,emailAddresses:[],firstName:'',unsafeMetadata:{verified:true},publicMetadata:{wechat:true}};
  const state={signedIn:true,pending:false};
  const env={DB:f.db,APP_ORIGIN:'https://site.test',CLERK_PUBLISHABLE_KEY:'pk_live_'+Buffer.from('clerk.site.test$').toString('base64'),CLERK_SECRET_KEY:'sk_live_fixture_only',WECHAT_LOGIN_ENABLED:'1',WECHAT_APP_ID:appId,WECHAT_APP_SECRET:'fixture_secret_only_123'};
  const handler=createStandaloneHandler({fetch:request=>new URL(request.url).pathname.startsWith('/game/')?gameResponse(request,new URL(request.url).pathname.split('/').at(-1)):handleAPI(request),createClerkClient:()=>({
    authenticateRequest:async()=>({status:state.signedIn?'signed-in':'signed-out',isAuthenticated:state.signedIn,tokenType:'session_token',toAuth:()=>state.pending?null:{userId:subject,sessionId:'sess_valid'}}),users:{getUser:async()=>profile},
  })});
  const request=async(path,options={})=>{
    const req=f.request(path,options);
    // The real adapter strips these forged legacy headers as well.
    req.headers.set('oai-authenticated-user-id','forged');req.headers.set('oai-authenticated-user-email','forged@example.test');
    return handler(req,env);
  };
  return {...f,profile,state,env,request};
}

test('server-mapped no-email session publishes, plays, comments and keeps all existing ownership',async t=>{
  const f=boundary(t),legacy=f.seed(),before=f.readWork(legacy.id);
  const form=new FormData();form.set('name','No email work');form.set('desc','Verified WeChat creator');form.set('source','html');form.set('file',new File(['<!doctype html><html><body>new</body></html>'],'game.html',{type:'text/html'}));
  const publication=await f.request('/api/works',{method:'POST',body:form});assert.equal(publication.status,201);
  const {work}=await publication.json();assert.equal(f.readWork(work.id).author_id,owner);
  const me=await(await f.request('/api/me')).json();assert.equal(me.user.id,owner);assert.equal(me.user.email,undefined);assert.equal(me.user.name,'创作者');
  assert.equal((await f.request('/game/'+work.versionId)).status,200);
  assert.equal((await f.request('/api/sessions',{method:'POST',body:{workId:work.id,versionId:work.versionId}})).status,201);
  const comment=await f.request('/api/works/'+legacy.id+'/comments',{method:'POST',body:{body:'Verified identity without email',versionId:legacy.versionId}});assert.equal(comment.status,201);
  assert.equal(f.database.prepare('SELECT author_id FROM ft_comments').get().author_id,owner);
  assert.deepEqual(f.readWork(legacy.id),before);
  assert.equal((await f.request('/api/works/'+legacy.id+'/archive',{method:'POST',body:{action:'archive',expectedRevision:1}})).status,403);
});

test('no-email admission rejects absent/revoked mappings, metadata claims, disabled flag and pending/banned users',async t=>{
  const f=boundary(t,{mapped:false});assert.equal((await f.request('/api/me')).status,403);
  f.database.prepare('INSERT INTO ft_wechat_identities VALUES(?,?,?,?,?)').run(appId,'openid_verified_123',subject,null,Date.now());
  assert.equal((await f.request('/api/me')).status,200);
  for(const field of ['banned','locked','deprovisioned']){f.profile[field]=true;assert.equal((await f.request('/api/me')).status,401);delete f.profile[field];}
  f.state.pending=true;assert.equal((await f.request('/api/me')).status,401);f.state.pending=false;
  f.state.signedIn=false;assert.equal((await f.request('/api/me')).status,401);f.state.signedIn=true;
  f.env.WECHAT_LOGIN_ENABLED='0';assert.equal((await f.request('/api/me')).status,403);f.env.WECHAT_LOGIN_ENABLED='1';
  f.database.exec('DELETE FROM ft_wechat_identities');assert.equal((await f.request('/api/me')).status,403);
  assert.equal((await f.request('/api/public/discover')).status,200);
});

test('verified email stays compatible and no-email writes still require CSRF',async t=>{
  const f=boundary(t,{mapped:false});f.profile.emailAddresses=[{emailAddress:'creator@example.test',verification:{status:'verified'}}];
  assert.equal((await f.request('/api/me')).status,200);
  assert.equal((await f.request('/api/sessions',{method:'POST',body:{},extraHeaders:{'X-Funtrack-CSRF':''}})).status,403);
});

test('request-local evidence cannot be forged with headers, leaked between users, or reused outside its async scope',async()=>{
  const headers=new Headers({'oai-authenticated-user-id':owner,'oai-authenticated-user-verified':'wechat'});
  assert.throws(()=>authenticate(headers),{code:'AUTH_REQUIRED'});
  await Promise.all([
    withVerifiedIdentity({id:owner,email:null},async()=>{await Promise.resolve();assert.equal(authenticate(headers).email,null);}),
    withVerifiedIdentity({id:'clerk:user_other',email:null},async()=>{await Promise.resolve();assert.throws(()=>authenticate(headers),{code:'AUTH_REQUIRED'});}),
  ]);
  assert.throws(()=>authenticate(headers),{code:'AUTH_REQUIRED'});
});
