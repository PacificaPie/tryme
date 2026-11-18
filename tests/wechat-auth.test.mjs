import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createWechatAuth} from '../lib/funtrack/wechat-auth.mjs';

const ORIGIN='https://funtrack.example';
const APP='wx0123456789abcdef';
const USER='user_existing';
const OPEN='openid_example_123456789';
const profile=id=>({id,emailAddresses:[{emailAddress:'verified@example.test',verification:{status:'verified'}}],twoFactorEnabled:false,totpEnabled:false,backupCodeEnabled:false,banned:false,locked:false});
const context=(id=USER,overrides={})=>({clerkUserId:id,sessionId:'sess_current',profile:profile(id),claims:{fva:[0,-1]},recentVerification:true,...overrides});
const jar=()=>new Map();
function receive(cookies,response) {for(const header of response.headers.getSetCookie()){const value=header.split(';')[0],at=value.indexOf('=');if(header.includes('Max-Age=0'))cookies.delete(value.slice(0,at));else cookies.set(value.slice(0,at),value.slice(at+1));}return response;}
function fixture(t,{migrate=true,settings={},fetchImpl}={}) {
  const database=new DatabaseSync(':memory:');t.after(()=>database.close());if(migrate)database.exec(readFileSync(new URL('../drizzle/0020_wechat_independent_identities.sql',import.meta.url),'utf8'));
  const db={prepare(query){return {values:[],bind(...values){this.values=values;return this;},async first(){return database.prepare(query).get(...this.values)||null;},async run(){return {meta:{changes:database.prepare(query).run(...this.values).changes}};},query};},async batch(statements){database.exec('BEGIN');try{const result=statements.map(s=>({meta:{changes:database.prepare(s.query).run(...s.values).changes}}));database.exec('COMMIT');return result;}catch(error){database.exec('ROLLBACK');throw error;}}};
  const calls={fetch:[],tickets:[],users:[],creates:[]},state={now:1794960000000,openId:OPEN,unionId:'union_example_123456789',profile:profile(USER),auth:{status:'signed-out',isAuthenticated:false,tokenType:'session_token',reason:'session-token-and-uat-missing'},ticketError:false,userError:false};
  const env={DB:db,APP_ORIGIN:ORIGIN,WECHAT_LOGIN_ENABLED:'1',WECHAT_APP_ID:APP,WECHAT_APP_SECRET:'fixture_secret_not_real_credential',...settings};
  const config={configured:true,origin:ORIGIN,publishableKey:'pk_fixture',secretKey:'sk_fixture'};
  const created=new Map();
  const createClerkClient=()=>({authenticateRequest:async()=>state.auth,users:{async getUserList({externalId}){return {data:[...created.values()].filter(u=>externalId.includes(u.externalId))};},async createUser(value){calls.creates.push(value);if(state.createError)throw Error('required email');if(created.has(value.externalId))throw Error('duplicate');const user={...profile('user_new'),emailAddresses:[],...value};created.set(value.externalId,user);if(state.createTimeout)throw Error('timeout after success');return user;},async getUser(id){calls.users.push(id);if(state.onGetUser)await state.onGetUser();if(state.userError)throw Error('private upstream details');return created.has([...created.keys()].find(k=>created.get(k).id===id))?{...created.get([...created.keys()].find(k=>created.get(k).id===id)),...state.newProfilePatch}:{...state.profile,id};}},signInTokens:{async createSignInToken(value){calls.tickets.push(value);if(state.ticketError)throw Error('private ticket error');return {token:'single_use_clerk_fixture_ticket'};}}});
  const fetcher=async(url,options)=>{calls.fetch.push({url,options});if(fetchImpl)return fetchImpl(url,options);return Response.json({access_token:'ephemeral_provider_token',openid:state.openId,unionid:state.unionId,scope:'snsapi_login',expires_in:7200});};
  const service=createWechatAuth({env,config,createClerkClient,fetchImpl:fetcher,now:()=>new Date(state.now)});
  function request(path,{method='GET',body,cookies=new Map(),headers={}}={}) {return new Request(ORIGIN+path,{method,headers:{Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'CF-Connecting-IP':'192.0.2.123',...(method==='POST'?{Origin:ORIGIN,'Content-Type':'application/json','X-Funtrack-CSRF':'1'}:{}),...headers},...(method==='POST'?{body:JSON.stringify(body??{})}:{})});}
  const api=(path,options)=>service.handlePublic(request('/api/auth/wechat/'+path,options));
  const account=(path,ctx=context(),options={})=>service.handleAccount(request('/api/account/wechat'+(path?'/'+path:''),options),ctx);
  async function start(cookies=jar(),ctx=null,returnTo='/site.html#/mine'){const res=ctx?await account('start',ctx,{method:'POST',body:{returnTo},cookies}):await api('start',{method:'POST',body:{returnTo},cookies});receive(cookies,res);const data=await res.json();assert.equal(res.status,200,JSON.stringify(data));return {...data,cookies,state:new URL(data.authorizationUrl).searchParams.get('state')};}
  async function callback(flow){const res=await api('callback?state='+flow.state+'&code=one_time_code',{cookies:flow.cookies});receive(flow.cookies,res);return res;}
  async function confirm(flow,ctx=context(),body={}) {const res=await account('confirm',ctx,{method:'POST',body:{confirm:true,flowId:flow.flowId,expectedUserId:ctx.clerkUserId,...body},cookies:flow.cookies});return receive(flow.cookies,res);}
  async function bind(ctx=context()){const flow=await start(jar(),ctx);await callback(flow);assert.equal((await confirm(flow,ctx)).status,200);return flow;}
  async function completed(){await bind();const flow=await start();assert.equal((await callback(flow)).headers.get('Location'),ORIGIN+'/auth/wechat.html?mode=sign-in');return flow;}
  return {service,env,config,database,calls,state,created,db,request,api,account,start,callback,confirm,bind,completed};
}
async function error(response,status,code){assert.equal(response.status,status);assert.equal((await response.json()).error.code,code);}

test('first WeChat sign-in creates an email-free account only on exchange, never a binding flow',async t=>{
  const f=fixture(t),flow=await f.start();await f.callback(flow);
  const pending=await(await f.api('pending',{cookies:flow.cookies})).json();
  assert.equal(pending.mode,'sign-up');assert.equal(f.calls.creates.length,0);
  await error(await f.confirm(flow),410,'WECHAT_FLOW_EXPIRED');
  const result=await f.api('exchange',{method:'POST',body:{flowId:flow.flowId},cookies:flow.cookies});
  assert.equal(result.status,200);assert.equal((await result.json()).mappedUserId,'user_new');
  assert.equal(f.calls.creates.length,1);
  assert.deepEqual(Object.keys(f.calls.creates[0]).sort(),['externalId','privateMetadata','skipPasswordRequirement']);
  assert.equal(f.database.prepare('SELECT clerk_user_id FROM ft_wechat_identities').get().clerk_user_id,'user_new');
  assert.equal(await f.service.hasIdentity('user_new'),true);
  await error(await f.api('exchange',{method:'POST',body:{flowId:flow.flowId},cookies:flow.cookies}),410,'WECHAT_FLOW_EXPIRED');
});

test('concurrent first sign-ins and a lost Clerk response converge on one identity',async t=>{
  const f=fixture(t);f.state.createTimeout=true;
  const a=await f.start(),b=await f.start();await f.callback(a);await f.callback(b);
  const results=await Promise.all([a,b].map(flow=>f.api('exchange',{method:'POST',body:{flowId:flow.flowId},cookies:flow.cookies})));
  assert.deepEqual(results.map(r=>r.status),[200,200]);
  assert.equal(f.created.size,1);assert.equal(f.database.prepare('SELECT COUNT(*) n FROM ft_wechat_identities').get().n,1);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM ft_wechat_registrations').get().n,1);
  assert(f.calls.tickets.every(ticket=>ticket.userId==='user_new'));
});

test('database failure after Clerk creation recovers on a new scan without a new account',async t=>{
  const f=fixture(t),prepare=f.db.prepare;
  let broken=true;
  f.db.prepare=function(query){const stmt=prepare(query);if(query.startsWith('INSERT OR IGNORE INTO ft_wechat_identities')){const run=stmt.run;stmt.run=async function(){if(broken)throw Error('DB unavailable');return run.call(this);};}return stmt;};
  const a=await f.start();await f.callback(a);
  await error(await f.api('exchange',{method:'POST',body:{flowId:a.flowId},cookies:a.cookies}),503,'WECHAT_UNAVAILABLE');
  assert.equal(f.created.size,1);assert.equal(f.calls.tickets.length,0);broken=false;
  const b=await f.start();await f.callback(b);
  assert.equal((await f.api('exchange',{method:'POST',body:{flowId:b.flowId},cookies:b.cookies})).status,200);
  assert.equal(f.calls.creates.length,1);
});

test('instance-required email failure never fabricates identifiers, issues tickets, or links an existing account',async t=>{
  const f=fixture(t);f.state.createError=true;
  const flow=await f.start();await f.callback(flow);
  await error(await f.api('exchange',{method:'POST',body:{flowId:flow.flowId},cookies:flow.cookies}),503,'WECHAT_REGISTRATION_UNAVAILABLE');
  assert.equal(f.calls.tickets.length,0);assert.equal(f.created.size,0);
  const bind=await f.start(jar(),context());await f.callback(bind);
  await error(await f.confirm(bind),409,'WECHAT_BIND_CONFLICT');
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM ft_wechat_identities').get().n,0);
});

test('an active account cannot silently acquire a new WeChat account through sign-in',async t=>{
  const f=fixture(t),flow=await f.start();await f.callback(flow);
  f.state.auth={status:'signed-in',isAuthenticated:true,tokenType:'session_token',toAuth:()=>({userId:USER,sessionId:'sess_current'})};
  await error(await f.api('exchange',{method:'POST',body:{flowId:flow.flowId},cookies:flow.cookies}),409,'WECHAT_ACCOUNT_MISMATCH');
  assert.equal(f.calls.creates.length,0);assert.equal(f.calls.tickets.length,0);
});

test('mapped no-email account can sign in; missing/revoked mapping, bans and MFA still fail closed',async t=>{
  const f=fixture(t),flow=await f.completed();f.state.profile.emailAddresses=[];
  assert.equal((await f.api('exchange',{method:'POST',body:{flowId:flow.flowId},cookies:flow.cookies})).status,200);
  const next=await f.start();await f.callback(next);f.database.exec('DELETE FROM ft_wechat_identities');
  assert.equal(await f.service.hasIdentity(USER),false);
  await error(await f.api('exchange',{method:'POST',body:{flowId:next.flowId},cookies:next.cookies}),403,'WECHAT_ADDITIONAL_VERIFICATION_REQUIRED');
});

test('CSRF header is required even on same-origin JSON and registration never merges UnionID',async t=>{
  const f=fixture(t);
  await error(await f.api('start',{method:'POST',headers:{'X-Funtrack-CSRF':''}}),403,'AUTH_ORIGIN_MISMATCH');
  await f.bind();f.state.openId='different_openid_12345';
  const flow=await f.start();await f.callback(flow);
  assert.equal((await(await f.api('pending',{cookies:flow.cookies})).json()).mode,'sign-up');
  assert.equal(f.database.prepare('SELECT clerk_user_id FROM ft_wechat_identities').get().clerk_user_id,USER);
});

test('feature is disabled without explicit settings, HTTPS, Clerk configuration or migrated DB',async t=>{
  for(const settings of [{WECHAT_LOGIN_ENABLED:'0'},{WECHAT_APP_ID:''},{WECHAT_APP_SECRET:''},{APP_ORIGIN:'http://funtrack.example'},{DB:null}]){const f=fixture(t,{settings});assert.deepEqual(await f.service.publicConfig(),{enabled:false});await error(await f.api('start',{method:'POST'}),503,'WECHAT_DISABLED');assert.equal(f.calls.fetch.length,0);}
  assert.deepEqual(await fixture(t,{migrate:false}).service.publicConfig(),{enabled:false});
  const f=fixture(t);assert.deepEqual(await f.service.publicConfig(),{enabled:true});assert.equal(await f.service.handlePublic(f.request('/api/other')),null);assert.equal(await f.service.handleAccount(f.request('/api/other'),context()),null);
});

test('OAuth start stores only token hashes and emits a fixed official URL with secure browser proof',async t=>{
  const f=fixture(t),flow=await f.start();const url=new URL(flow.authorizationUrl);assert.equal(url.origin,'https://open.weixin.qq.com');assert.equal(url.pathname,'/connect/qrconnect');assert.equal(url.searchParams.get('scope'),'snsapi_login');assert.equal(url.searchParams.get('redirect_uri'),ORIGIN+'/api/auth/wechat/callback');
  const row=f.database.prepare('SELECT * FROM ft_wechat_flows').get();assert.equal(row.id,flow.flowId);assert.match(row.state_hash,/^[0-9a-f]{64}$/);assert.notEqual(row.state_hash,flow.state);assert(!JSON.stringify(row).includes(flow.cookies.get('__Host-ft_wechat_browser')));assert(!JSON.stringify(row).includes(f.env.WECHAT_APP_SECRET));
  const response=await f.api('start',{method:'POST'});for(const value of response.headers.getSetCookie()){assert.match(value,/HttpOnly; Secure; SameSite=Lax/);assert.match(value,/Path=\//);assert.doesNotMatch(value,/Domain=/);}assert.match(response.headers.get('cache-control'),/no-store/);
});

test('all writes require same-origin JSON and request bytes are bounded without Content-Length',async t=>{
  const f=fixture(t);await error(await f.api('start',{method:'POST',headers:{Origin:'https://evil.example'}}),403,'AUTH_ORIGIN_MISMATCH');await error(await f.api('start',{method:'POST',headers:{'Content-Type':'text/plain'}}),415,'INVALID_REQUEST');
  let cancelled=false;const stream=new ReadableStream({pull(c){c.enqueue(new TextEncoder().encode('雨'.repeat(1000)));},cancel(){cancelled=true;}});
  const req=new Request(ORIGIN+'/api/auth/wechat/start',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json','X-Funtrack-CSRF':'1'},body:stream,duplex:'half'});await error(await f.service.handlePublic(req),413,'BODY_TOO_LARGE');assert.equal(cancelled,true);
});

test('return destinations cannot escape the site or loop through auth callbacks',async t=>{
  for(const path of ['https://evil.example','//evil.example','/\\evil.example','/%2f%2fevil.example','/x/..//evil.example','/api/auth/wechat/callback','/auth/sign-in.html','/%61uth/wechat.html']){const f=fixture(t),flow=await f.start(jar(),null,path);await f.callback(flow);assert.equal((await(await f.api('pending',{cookies:flow.cookies})).json()).returnTo,'/site.html#/feed');}
});

test('callback needs the initiating browser and consumes OAuth state exactly once under concurrency',async t=>{
  const f=fixture(t),flow=await f.start();const wrong=await f.api('callback?state='+flow.state+'&code=one_time_code',{cookies:jar()});assert.match(wrong.headers.get('Location'),/WECHAT_FLOW_EXPIRED/);assert.equal(f.calls.fetch.length,0);
  const responses=await Promise.all([f.callback(flow),f.callback(flow)]);assert.equal(responses.filter(r=>r.headers.get('Location')===ORIGIN+'/auth/wechat.html?mode=sign-up').length,1);assert.equal(f.calls.fetch.length,1);
  const replay=await f.callback(flow);assert.match(replay.headers.get('Location'),/WECHAT_FLOW_EXPIRED/);assert.equal(f.calls.fetch.length,1);
});

test('provider denial, redirect, bad scope and invalid identity fail without storing a fake pending login',async t=>{
  for(const fetchImpl of [async()=>new Response(null,{status:302,headers:{Location:'https://evil.example'}}),async()=>Response.json({errcode:40029,errmsg:'secret upstream text'}),async()=>Response.json({access_token:'token',openid:OPEN,scope:'snsapi_userinfo'})]){const f=fixture(t,{fetchImpl}),flow=await f.start();const res=await f.callback(flow);assert.match(res.headers.get('Location'),/WECHAT_PROVIDER_UNAVAILABLE/);assert(!res.headers.get('Location').includes('secret'));assert.equal((await(await f.api('pending',{cookies:flow.cookies})).json()).pending,false);assert.equal(f.calls.fetch[0].options.redirect,'error');assert.equal(new URL(f.calls.fetch[0].url).origin,'https://api.weixin.qq.com');}
  const f=fixture(t),flow=await f.start();const denied=await f.api('callback?state='+flow.state+'&error=access_denied',{cookies:flow.cookies});assert.match(denied.headers.get('Location'),/WECHAT_DENIED/);assert.equal(f.calls.fetch.length,0);
});

test('explicit linking requires an admitted existing account and fresh confirmation, preserving Clerk identity',async t=>{
  const f=fixture(t),flow=await f.start(jar(),context());await f.callback(flow);const pending=await(await f.api('pending',{cookies:flow.cookies})).json();assert.equal(pending.mode,'bind');assert.equal(pending.flowId,flow.flowId);assert(!JSON.stringify(pending).includes(OPEN));assert.equal(f.database.prepare('SELECT COUNT(*) n FROM ft_wechat_identities').get().n,0);
  await error(await f.confirm(flow,context(),{confirm:false}),400,'INVALID_REQUEST');await error(await f.confirm(flow,context(USER,{recentVerification:false})),403,'WECHAT_REVERIFICATION_REQUIRED');
  f.state.profile.emailAddresses[0].verification.status='unverified';await error(await f.confirm(flow),403,'WECHAT_ADDITIONAL_VERIFICATION_REQUIRED');f.state.profile=profile(USER);
  assert.equal((await f.confirm(flow)).status,200);assert.equal(f.database.prepare('SELECT clerk_user_id FROM ft_wechat_identities').get().clerk_user_id,USER);assert.equal(f.calls.tickets.length,0);assert.equal((await(await f.account('',context())).json()).linked,true);
  await error(await f.confirm(flow),410,'WECHAT_FLOW_EXPIRED');
});

test('binding rejects stale/malformed MFA assurance and impersonation; same-user reauthentication may change session',async t=>{
  const f=fixture(t),flow=await f.start(jar(),context());await f.callback(flow);
  for(const overrides of [{claims:{}},{claims:{fva:[11,-1]}},{claims:{fva:[0]}},{claims:{fva:[0,'0']}},{claims:{fva:[0,-1],act:{sub:'user_actor'}}},{impersonating:true}])await error(await f.confirm(flow,context(USER,overrides)),403,'WECHAT_REVERIFICATION_REQUIRED');
  f.state.profile.twoFactorEnabled=true;await error(await f.confirm(flow),403,'WECHAT_REVERIFICATION_REQUIRED');
  assert.equal((await f.confirm(flow,context(USER,{sessionId:'sess_reauthenticated',claims:{fva:[0,0]}}))).status,200);
});

test('account switching and old UI flow IDs cannot bind or clear another transaction',async t=>{
  const f=fixture(t),cookies=jar(),old=await f.start(cookies,context());await f.callback(old);const displayed=(await(await f.account('',context(),{cookies})).json());assert.equal(displayed.expectedUserId,USER);
  await error(await f.confirm(old,context('user_other'),{expectedUserId:USER}),409,'WECHAT_ACCOUNT_CHANGED');
  const newer=await f.start(cookies);await f.callback(newer);const obsolete=await f.confirm(old);await error(obsolete,409,'WECHAT_FLOW_CHANGED');assert.equal(obsolete.headers.getSetCookie().length,0);
  await error(await f.api('cancel',{method:'POST',body:{flowId:old.flowId},cookies}),409,'WECHAT_FLOW_CHANGED');assert.equal((await(await f.api('pending',{cookies})).json()).flowId,newer.flowId);
});

test('parallel confirmation and competing account slots cannot overwrite bindings',async t=>{
  const f=fixture(t),a=await f.start(jar(),context()),b=await f.start(jar(),context('user_other'));await f.callback(a);await f.callback(b);
  const [one,two]=await Promise.all([f.confirm(a),f.confirm(b,context('user_other'))]);assert.deepEqual([one.status,two.status].sort(),[200,409]);assert.equal(f.database.prepare('SELECT COUNT(*) n FROM ft_wechat_identities').get().n,1);
  const g=fixture(t),flow=await g.start(jar(),context());await g.callback(flow);const concurrent=await Promise.all([g.confirm(flow),g.confirm(flow)]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,410]);
  g.state.openId='openid_another_12345678';const different=await g.start(jar(),context());await g.callback(different);await error(await g.confirm(different),409,'WECHAT_BIND_CONFLICT');assert.equal(g.database.prepare('SELECT open_id FROM ft_wechat_identities').get().open_id,OPEN);
});

test('known bindings return no URL ticket; exchange mints one short Clerk ticket once under races',async t=>{
  const f=fixture(t),flow=await f.completed();const pending=await(await f.api('pending',{cookies:flow.cookies})).json();assert.equal(pending.mappedUserId,USER);assert.equal(pending.mode,'sign-in');assert.equal(f.calls.tickets.length,0);
  const request=()=>f.api('exchange',{method:'POST',body:{flowId:flow.flowId},cookies:flow.cookies});const results=await Promise.all([request(),request()]);assert.deepEqual(results.map(r=>r.status).sort(),[200,410]);assert.deepEqual(f.calls.tickets,[{userId:USER,expiresInSeconds:60}]);
  const ok=results.find(r=>r.status===200),data=await ok.json();assert.equal(data.ticket,'single_use_clerk_fixture_ticket');assert.equal(data.returnTo,'/site.html#/mine');assert.match(ok.headers.get('cache-control'),/no-store/);assert.equal(f.database.prepare("SELECT COUNT(*) n FROM ft_wechat_flows WHERE token_hash IS NOT NULL AND phase='consumed'").get().n,0);
});

test('exchange never silently switches an active account or accepts an actor session',async t=>{
  const f=fixture(t),flow=await f.completed();f.state.auth={status:'signed-in',isAuthenticated:true,tokenType:'session_token',toAuth:()=>({userId:'user_other',sessionId:'sess_other'})};await error(await f.api('exchange',{method:'POST',body:{flowId:flow.flowId},cookies:flow.cookies}),409,'WECHAT_ACCOUNT_MISMATCH');assert.equal(f.calls.tickets.length,0);
  f.state.auth={status:'signed-in',isAuthenticated:true,tokenType:'session_token',toAuth:()=>({userId:USER,sessionId:'sess_actor',actor:{sub:'user_actor'}})};await error(await f.api('exchange',{method:'POST',body:{flowId:flow.flowId},cookies:flow.cookies}),403,'WECHAT_ADDITIONAL_VERIFICATION_REQUIRED');assert.equal(f.calls.tickets.length,0);
});

test('Clerk failed or malformed auth states never masquerade as an anonymous exchange',async t=>{
  const f=fixture(t),flow=await f.completed();
  for(const value of [{status:'signed-out',isAuthenticated:false,tokenType:'session_token',reason:'unexpected-error'},{status:'signed-out',isAuthenticated:false,tokenType:null,reason:'token-type-mismatch'},{status:'signed-out',isAuthenticated:false,tokenType:'session_token',reason:'session-token-invalid-signature'},{status:'signed-in',isAuthenticated:false,tokenType:'session_token',toAuth:()=>({userId:USER,sessionId:'sess_fake'})}]){f.state.auth=value;await error(await f.api('exchange',{method:'POST',body:{flowId:flow.flowId},cookies:flow.cookies}),403,'WECHAT_ADDITIONAL_VERIFICATION_REQUIRED');}
  assert.equal(f.calls.tickets.length,0);assert.equal((await(await f.api('pending',{cookies:flow.cookies})).json()).pending,true);
});

test('provider responses are stream-bounded and a hung provider aborts without creating pending success',async t=>{
  let cancelled=false;const f=fixture(t,{fetchImpl:async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(17000));},cancel(){cancelled=true;}}))}),flow=await f.start();assert.match((await f.callback(flow)).headers.get('Location'),/WECHAT_PROVIDER_UNAVAILABLE/);assert.equal(cancelled,true);
  t.mock.timers.enable({apis:['setTimeout']});let entered,signal;const waiting=new Promise(resolve=>{entered=resolve;});
  const g=fixture(t,{fetchImpl:async(_url,options)=>{signal=options.signal;entered();return new Promise(()=>{});}}),slow=await g.start(),operation=g.callback(slow);await waiting;t.mock.timers.tick(8001);const result=await operation;assert.equal(signal.aborted,true);assert.match(result.headers.get('Location'),/WECHAT_PROVIDER_UNAVAILABLE/);assert.equal((await(await g.api('pending',{cookies:slow.cookies})).json()).pending,false);
});

test('late terminal responses cannot erase a newer browser flow or its proof',async t=>{
  const f=fixture(t),old=await f.completed();let release,entered;const waiting=new Promise(resolve=>{entered=resolve;});
  f.state.onGetUser=()=>{entered();return new Promise(resolve=>{release=resolve;});};
  const exchange=f.api('exchange',{method:'POST',body:{flowId:old.flowId},cookies:old.cookies});await waiting;
  const newer=await f.start(old.cookies);await f.callback(newer);const before=new Map(old.cookies);release();const late=await exchange;receive(old.cookies,late);
  assert.equal(late.status,200);assert.equal(late.headers.getSetCookie().length,0);assert.deepEqual(old.cookies,before);assert.equal((await(await f.api('pending',{cookies:old.cookies})).json()).flowId,newer.flowId);
});

test('a callback delivered after another callback never overwrites that new flow cookie',async t=>{
  const f=fixture(t),cookies=jar(),old=await f.start(cookies);
  const late=await f.api('callback?state='+old.state+'&code=old_code',{cookies});
  const newer=await f.start(cookies,context());await f.callback(newer);receive(cookies,late);
  assert.equal((await(await f.api('pending',{cookies})).json()).flowId,newer.flowId);assert.equal(late.headers.getSetCookie().length,1);assert(late.headers.getSetCookie()[0].startsWith('__Host-ft_wechat_flow_'+old.flowId+'='));
  await error(await f.confirm(old),409,'WECHAT_FLOW_CHANGED');assert.equal((await f.confirm(newer)).status,200);
});

test('the browser proof spans a late OAuth callback followed by account reverification',async t=>{
  const f=fixture(t),cookies=jar(),response=await f.account('start',context(),{method:'POST',cookies});receive(cookies,response);const data=await response.json();
  const proofMaxAge=Number(/Max-Age=(\d+)/.exec(response.headers.getSetCookie()[0])[1]);assert.equal(proofMaxAge,1200);
  const issued=f.state.now,proofExpiry=issued+proofMaxAge*1000,flow={...data,cookies,state:new URL(data.authorizationUrl).searchParams.get('state')};
  f.state.now+=9*60*1000;assert.equal((await f.callback(flow)).status,303);f.state.now+=2*60*1000;
  if(f.state.now>=proofExpiry)cookies.delete('__Host-ft_wechat_browser');
  assert.equal((await(await f.api('pending',{cookies})).json()).pending,true);assert.equal((await f.confirm(flow)).status,200);
});

test('locked or MFA accounts cannot obtain a ticket and consumed exchanges are never retried',async t=>{
  for(const patch of [{locked:true},{banned:true},{deprovisioned:true},{twoFactorEnabled:true},{totpEnabled:true},{backupCodeEnabled:true}]){const f=fixture(t),flow=await f.completed();Object.assign(f.state.profile,patch);const res=await f.api('exchange',{method:'POST',body:{flowId:flow.flowId},cookies:flow.cookies});await error(res,403,'WECHAT_ADDITIONAL_VERIFICATION_REQUIRED');assert.equal(f.calls.tickets.length,0);await error(await f.api('exchange',{method:'POST',body:{flowId:flow.flowId},cookies:flow.cookies}),410,'WECHAT_FLOW_EXPIRED');}
  const f=fixture(t),flow=await f.completed();f.state.ticketError=true;await error(await f.api('exchange',{method:'POST',body:{flowId:flow.flowId},cookies:flow.cookies}),503,'WECHAT_UNAVAILABLE');f.state.ticketError=false;await error(await f.api('exchange',{method:'POST',body:{flowId:flow.flowId},cookies:flow.cookies}),410,'WECHAT_FLOW_EXPIRED');assert.equal(f.calls.tickets.length,1);
});

test('expiry, cancellation and per-IP rate windows are bounded without storing IPs',async t=>{
  const f=fixture(t),flow=await f.start();f.state.now+=601000;assert.match((await f.callback(flow)).headers.get('Location'),/WECHAT_FLOW_EXPIRED/);assert.equal(f.calls.fetch.length,0);
  const current=await f.start();await f.callback(current);const cancel=await f.api('cancel',{method:'POST',body:{flowId:current.flowId},cookies:current.cookies});assert.equal(cancel.status,200);assert(cancel.headers.getSetCookie().every(c=>c.includes('Max-Age=0')));await error(await f.confirm(current),410,'WECHAT_FLOW_EXPIRED');
  const g=fixture(t);for(let i=0;i<8;i++)await g.start();await error(await g.api('start',{method:'POST'}),429,'WECHAT_RATE_LIMITED');const rate=g.database.prepare('SELECT * FROM ft_wechat_rate_windows').get();assert.match(rate.key_hash,/^[0-9a-f]{64}$/);assert.equal(rate.count,8);assert(!JSON.stringify(rate).includes('192.0.2.123'));g.state.now+=601000;assert.equal((await g.api('start',{method:'POST'})).status,200);
  const h=fixture(t),done=await h.completed();h.state.now+=121000;await error(await h.api('exchange',{method:'POST',body:{flowId:done.flowId},cookies:done.cookies}),410,'WECHAT_FLOW_EXPIRED');assert.equal(h.calls.tickets.length,0);
});
