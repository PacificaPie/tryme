// Standalone-only OAuth adapter. Dependency injection is exclusively for tests;
// no request parameter can select a provider, identity source or upstream host.
const BROWSER_COOKIE = '__Host-ft_wechat_browser';
const FLOW_COOKIE = '__Host-ft_wechat_flow';
const FLOW_MS = 10 * 60 * 1000;
// Covers the full OAuth window plus a subsequent email-verification window.
// Individual server-side phases still expire independently after 10 minutes.
const BROWSER_PROOF_MS = 2 * FLOW_MS;
const COMPLETE_MS = 2 * 60 * 1000;
const RATE_MS = 10 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SUBJECT = /^user_[A-Za-z0-9_-]{1,230}$/;
const DEFAULT_RETURN = '/site.html#/feed';
const PAGE = '/auth/wechat.html';
const MESSAGES = {
  WECHAT_DISABLED:'微信登录暂不可用，请使用邮箱登录。', WECHAT_UNAVAILABLE:'暂时无法处理微信登录，请重新开始或使用邮箱登录。',
  WECHAT_FLOW_EXPIRED:'本次微信验证已过期或已使用，请重新开始。', WECHAT_FLOW_CHANGED:'另一页面已开始新的验证，请返回该页面继续。',
  WECHAT_ACCOUNT_CHANGED:'登录账号已变化，请确认当前账号后重新开始绑定。', WECHAT_ACCOUNT_MISMATCH:'此微信对应另一个账号，请先退出当前账号后重新登录。',
  WECHAT_BIND_CONFLICT:'微信或当前账号已有其他绑定，请使用原账号登录。', WECHAT_REVERIFICATION_REQUIRED:'请先重新验证当前邮箱账号，再确认绑定。',
  WECHAT_EMAIL_SIGN_IN_REQUIRED:'请使用邮箱登录并完成账号要求的验证。', WECHAT_PROVIDER_UNAVAILABLE:'微信验证暂不可用，请重新开始或使用邮箱登录。',
  WECHAT_DENIED:'微信授权未完成。', WECHAT_RATE_LIMITED:'尝试次数较多，请稍后再试或使用邮箱登录。',
  INVALID_REQUEST:'请求内容无效。', BODY_TOO_LARGE:'请求内容过大。', AUTH_ORIGIN_MISMATCH:'请从本站发起操作。', METHOD_NOT_ALLOWED:'不支持该请求方法。',
};
class FlowError extends Error { constructor(code,status=400,extra={}) { super(MESSAGES[code]||MESSAGES.WECHAT_UNAVAILABLE); this.code=code;this.status=status;this.extra=extra; } }
const fail=(code,status,extra)=>{throw new FlowError(code,status,extra);};
const token=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
const cookie=(name,value,seconds)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
const flowCookieName=id=>FLOW_COOKIE+'_'+id;
function cookies(request) {
  const result=new Map();
  for(const part of (request.headers.get('cookie')||'').split(';')) {const [key,...rest]=part.trim().split('=');if(key!==BROWSER_COOKIE&&!/^__Host-ft_wechat_flow_[0-9a-f-]{36}$/.test(key))continue;if(result.has(key))return new Map();result.set(key,rest.join('='));}
  return result;
}
function response(value,status=200,setCookies=[]) {
  const headers=new Headers({'Cache-Control':'private, no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
  for(const item of setCookies)headers.append('Set-Cookie',item);
  if(typeof value==='string'){headers.set('Location',value);return new Response(null,{status:303,headers});}
  return Response.json(value,{status,headers});
}
function safeReturn(value) {
  if(typeof value!=='string'||value.length>1200||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020\u007f]/.test(value))return DEFAULT_RETURN;
  try {const decoded=decodeURIComponent(value);if(/[\\\u0000-\u0020\u007f]/.test(decoded)||decoded.startsWith('//'))return DEFAULT_RETURN;const url=new URL(value,'https://local.invalid');if(url.origin!=='https://local.invalid'||url.pathname.startsWith('//')||/^\/(?:api|auth)(?:\/|$)/i.test(decodeURIComponent(url.pathname)))return DEFAULT_RETURN;return url.pathname+url.search+url.hash;}catch{return DEFAULT_RETURN;}
}
async function limitedJSON(request,max=2048,code='INVALID_REQUEST') {
  if(Number(request.headers.get('content-length'))>max)fail('BODY_TOO_LARGE',413);
  const reader=request.body?.getReader();if(!reader)fail(code,400);
  let length=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>max){void reader.cancel().catch(()=>{});fail('BODY_TOO_LARGE',413);}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const item of chunks){bytes.set(item,offset);offset+=item.byteLength;}
  try{const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!result||typeof result!=='object'||Array.isArray(result))throw Error();return result;}catch{fail(code,400);}
}
function keys(input,allowed) {if(Object.keys(input).some(key=>!allowed.includes(key)))fail('INVALID_REQUEST',400);}
function activeEmail(profile,id) {
  if(!profile||profile.id!==id||profile.banned||profile.locked||profile.deprovisioned)fail('WECHAT_EMAIL_SIGN_IN_REQUIRED',403);
  const addresses=Array.isArray(profile.emailAddresses)?profile.emailAddresses:[];
  if(!addresses.some(item=>item?.verification?.status==='verified'&&typeof item.emailAddress==='string'&&/^[^\s@]+@[^\s@]+$/.test(item.emailAddress)&&item.emailAddress.length<=320&&!/[^\x20-\x7e]/.test(item.emailAddress)))fail('WECHAT_EMAIL_SIGN_IN_REQUIRED',403);
  return profile;
}
function recent(context,profile) {
  const fva=context.claims?.fva;
  return context.recentVerification===true&&!context.impersonating&&!context.claims?.act&&Array.isArray(fva)&&fva.length===2&&fva.every(value=>Number.isInteger(value)&&value>=-1)
    &&fva[0]>=0&&fva[0]<=5&&(!(profile.twoFactorEnabled||profile.totpEnabled||profile.backupCodeEnabled)||fva[1]>=0&&fva[1]<=5);
}

export function createWechatAuth({env,config,createClerkClient,fetchImpl=globalThis.fetch,now=()=>new Date()}) {
  const bindings=()=>typeof env==='function'?env():env||{};
  const authConfig=()=>typeof config==='function'?config():config||{};
  const time=()=>{const value=now();return value instanceof Date?value.getTime():Number(value);};
  const sql=(query,...values)=>bindings().DB.prepare(query).bind(...values);
  const first=(query,...values)=>sql(query,...values).first();
  function settings() {
    const e=bindings(),c=authConfig();let origin;
    try{const url=new URL(e.APP_ORIGIN);if(url.protocol!=='https:'||url.origin!==e.APP_ORIGIN||url.username||url.password||c.origin!==url.origin||!c.configured)throw Error();origin=url.origin;}catch{return null;}
    if(e.WECHAT_LOGIN_ENABLED!=='1'||!/^wx[0-9a-f]{16}$/.test(e.WECHAT_APP_ID||'')||typeof e.WECHAT_APP_SECRET!=='string'||!/^\S{16,256}$/.test(e.WECHAT_APP_SECRET)||typeof e.DB?.prepare!=='function')return null;
    return {origin,appId:e.WECHAT_APP_ID,secret:e.WECHAT_APP_SECRET};
  }
  async function publicConfig() {
    if(!settings())return {enabled:false};
    try{await first('SELECT (SELECT COUNT(*) FROM ft_wechat_identities WHERE 0)+(SELECT COUNT(*) FROM ft_wechat_flows WHERE 0)+(SELECT COUNT(*) FROM ft_wechat_rate_windows WHERE 0) ready');return {enabled:true};}catch{return {enabled:false};}
  }
  const clerk=()=>{const c=authConfig();return createClerkClient({publishableKey:c.publishableKey,secretKey:c.secretKey});};
  async function enabled(request) {
    const s=settings();if(!s||!(await publicConfig()).enabled)fail('WECHAT_DISABLED',503);
    if(new URL(request.url).origin!==s.origin)fail('AUTH_ORIGIN_MISMATCH',403);return s;
  }
  async function write(request,s) {
    if(request.method!=='POST')fail('METHOD_NOT_ALLOWED',405);
    if(request.headers.get('origin')!==s.origin||request.headers.get('sec-fetch-site')==='cross-site')fail('AUTH_ORIGIN_MISMATCH',403);
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))fail('INVALID_REQUEST',415);
    return limitedJSON(request);
  }
  async function pending(request,s) {
    const jar=cookies(request),proof=jar.get(BROWSER_COOKIE);if(!TOKEN.test(proof||''))return null;
    const flow=await first("SELECT * FROM ft_wechat_flows WHERE app_id=? AND browser_hash=? AND phase IN ('bind','complete') AND expires_at>? ORDER BY created_at DESC,id DESC LIMIT 1",s.appId,await hash(proof),time());
    const credential=flow&&jar.get(flowCookieName(flow.id));if(!TOKEN.test(credential||''))return null;
    return await hash(credential)===flow.token_hash?flow:null;
  }
  function dto(flow) {return {pending:!!flow,mode:flow?(flow.phase==='complete'?'sign-in':'bind'):null,returnTo:flow?.return_to||DEFAULT_RETURN,...flow?{flowId:flow.id,displayName:'微信账号',...(flow.phase==='complete'?{mappedUserId:flow.mapped_user_id}:{})}:{}};}
  function matchFlow(flow,input) {if(!flow)fail('WECHAT_FLOW_EXPIRED',410);if(typeof input.flowId!=='string'||input.flowId!==flow.id)fail('WECHAT_FLOW_CHANGED',409);}
  async function cleanup() {
    const at=time();await bindings().DB.batch([
      sql('DELETE FROM ft_wechat_flows WHERE id IN (SELECT id FROM ft_wechat_flows WHERE expires_at<? LIMIT 100)',at-24*60*60*1000),
      sql('DELETE FROM ft_wechat_rate_windows WHERE key_hash IN (SELECT key_hash FROM ft_wechat_rate_windows WHERE expires_at<? LIMIT 100)',at),
    ]);
  }
  async function start(request,s,context) {
    const input=await write(request,s);keys(input,['returnTo']);
    if(context){if(!SUBJECT.test(context.clerkUserId||'')||!context.sessionId||context.impersonating||context.claims?.act)fail('WECHAT_EMAIL_SIGN_IN_REQUIRED',403);activeEmail(context.profile,context.clerkUserId);}
    const at=time(),window=Math.floor(at/RATE_MS),ip=request.headers.get('cf-connecting-ip')||'unknown';
    const rateKey=await hash(s.secret+'\0'+s.appId+'\0'+ip.slice(0,100)+'\0'+window);
    await cleanup();
    const rate=await first('INSERT INTO ft_wechat_rate_windows(key_hash,count,expires_at) VALUES(?,1,?) ON CONFLICT(key_hash) DO UPDATE SET count=count+1 WHERE count<8 RETURNING count',rateKey,(window+1)*RATE_MS);
    if(!rate)fail('WECHAT_RATE_LIMITED',429);
    const state=token(),id=crypto.randomUUID(),oldProof=cookies(request).get(BROWSER_COOKIE),proof=TOKEN.test(oldProof||'')?oldProof:token(),statements=[];
    if(TOKEN.test(oldProof||''))statements.push(sql("UPDATE ft_wechat_flows SET phase='cancelled',token_hash=NULL,consumed_at=? WHERE app_id=? AND browser_hash=? AND phase NOT IN ('consumed','cancelled')",at,s.appId,await hash(oldProof)));
    statements.push(sql("INSERT INTO ft_wechat_flows(id,app_id,state_hash,browser_hash,kind,phase,expected_user_id,initiating_session_id,return_to,created_at,expires_at) VALUES(?,?,?,? ,?,'oauth',?,?,?,?,?)",id,s.appId,await hash(state),await hash(proof),context?'bind':'sign-in',context?.clerkUserId||null,context?.sessionId||null,safeReturn(input.returnTo),at,at+FLOW_MS));
    await bindings().DB.batch(statements);
    const url=new URL('https://open.weixin.qq.com/connect/qrconnect');url.search=new URLSearchParams({appid:s.appId,redirect_uri:s.origin+'/api/auth/wechat/callback',response_type:'code',scope:'snsapi_login',state}).toString();url.hash='wechat_redirect';
    return response({authorizationUrl:url.href,flowId:id},200,[cookie(BROWSER_COOKIE,proof,BROWSER_PROOF_MS/1000)]);
  }
  async function wechatIdentity(code,s) {
    const url=new URL('https://api.weixin.qq.com/sns/oauth2/access_token');url.search=new URLSearchParams({appid:s.appId,secret:s.secret,code,grant_type:'authorization_code'}).toString();
    const controller=new AbortController();let timer;const timed=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new FlowError('WECHAT_PROVIDER_UNAVAILABLE',503));},8000);});
    try{return await Promise.race([(async()=>{const res=await fetchImpl(url.href,{method:'GET',redirect:'error',signal:controller.signal,headers:{Accept:'application/json'}});if(!res.ok||res.redirected)throw Error();const value=await limitedJSON(res,16384,'WECHAT_PROVIDER_UNAVAILABLE');if(value.errcode||!/^[-_A-Za-z0-9]{8,128}$/.test(value.openid||'')||typeof value.access_token!=='string'||!value.access_token||!String(value.scope||'').split(/[ ,]+/).includes('snsapi_login'))throw Error();return {openId:value.openid,unionId:/^[-_A-Za-z0-9]{8,128}$/.test(value.unionid||'')?value.unionid:null};})(),timed]);}catch{fail('WECHAT_PROVIDER_UNAVAILABLE',503);}finally{clearTimeout(timer);controller.abort();}
  }
  async function callback(request,s) {
    if(request.method!=='GET')fail('METHOD_NOT_ALLOWED',405);
    const url=new URL(request.url),state=url.searchParams.get('state'),proof=cookies(request).get(BROWSER_COOKIE);
    if(url.searchParams.getAll('state').length!==1||!TOKEN.test(state||'')||!TOKEN.test(proof||''))fail('WECHAT_FLOW_EXPIRED',410);
    const flow=await first("UPDATE ft_wechat_flows SET phase='exchanging' WHERE app_id=? AND state_hash=? AND browser_hash=? AND phase='oauth' AND expires_at>? RETURNING *",s.appId,await hash(state),await hash(proof),time());
    if(!flow)fail('WECHAT_FLOW_EXPIRED',410);
    const code=url.searchParams.get('code');if(url.searchParams.get('error')||!code)fail('WECHAT_DENIED',400);
    if(url.searchParams.getAll('code').length!==1||!/^[-_A-Za-z0-9]{1,512}$/.test(code))fail('WECHAT_PROVIDER_UNAVAILABLE',400);
    const identity=await wechatIdentity(code,s);
    const mapping=await first('SELECT clerk_user_id FROM ft_wechat_identities WHERE app_id=? AND open_id=?',s.appId,identity.openId);
    if(flow.expected_user_id&&mapping&&mapping.clerk_user_id!==flow.expected_user_id)fail('WECHAT_BIND_CONFLICT',409);
    const complete=flow.kind==='sign-in'&&!!mapping,credential=token(),at=time(),expiry=at+(complete?COMPLETE_MS:FLOW_MS);
    const changed=await first("UPDATE ft_wechat_flows SET phase=?,token_hash=?,open_id=?,union_id=?,mapped_user_id=?,expires_at=? WHERE id=? AND phase='exchanging' AND expires_at>? RETURNING id",complete?'complete':'bind',await hash(credential),identity.openId,identity.unionId,complete?mapping.clerk_user_id:null,expiry,flow.id,at);
    if(!changed)fail('WECHAT_FLOW_EXPIRED',410);
    // A late response can add only its own cookie, never replace a newer flow's
    // proof. The original browser cookie is not reset by callbacks.
    return response(s.origin+PAGE+'?mode='+(complete?'sign-in':'bind'),303,[cookie(flowCookieName(flow.id),credential,(expiry-at)/1000)]);
  }
  async function cancel(request,s) {
    const input=await write(request,s);keys(input,['flowId']);const flow=await pending(request,s);
    if(flow){matchFlow(flow,input);await sql("UPDATE ft_wechat_flows SET phase='cancelled',token_hash=NULL,consumed_at=? WHERE id=? AND token_hash=?",time(),flow.id,flow.token_hash).run();}
    // Never clear another transaction's browser proof on an obsolete UI action.
    return response({cancelled:true,returnTo:flow?.return_to||DEFAULT_RETURN});
  }
  async function exchange(request,s) {
    const input=await write(request,s);keys(input,['flowId']);const flow=await pending(request,s);matchFlow(flow,input);if(flow.phase!=='complete')fail('WECHAT_FLOW_EXPIRED',410);
    const client=clerk();let authState;
    try{authState=await client.authenticateRequest(request,{authorizedParties:[s.origin],acceptsToken:'session_token'});}catch{fail('WECHAT_UNAVAILABLE',503);}
    if(!authState||!['signed-in','signed-out'].includes(authState.status))fail('WECHAT_EMAIL_SIGN_IN_REQUIRED',403,{returnTo:flow.return_to});
    if(authState.status==='signed-in'){
      if(authState.isAuthenticated!==true||authState.tokenType!=='session_token')fail('WECHAT_EMAIL_SIGN_IN_REQUIRED',403,{returnTo:flow.return_to});
      const current=authState.toAuth?.({treatPendingAsSignedOut:true});
      if(!current?.userId||!current.sessionId||current.actor||current.sessionClaims?.act)fail('WECHAT_EMAIL_SIGN_IN_REQUIRED',403,{returnTo:flow.return_to});
      if(current.userId!==flow.mapped_user_id)fail('WECHAT_ACCOUNT_MISMATCH',409);
    } else if(authState.isAuthenticated!==false||authState.tokenType!=='session_token'||request.headers.has('authorization')||!['session-token-missing','session-token-and-uat-missing'].includes(authState.reason))fail('WECHAT_EMAIL_SIGN_IN_REQUIRED',403,{returnTo:flow.return_to});
    const claimed=await first("UPDATE ft_wechat_flows SET phase='consumed',token_hash=NULL,consumed_at=? WHERE id=? AND phase='complete' AND token_hash=? AND expires_at>? RETURNING id",time(),flow.id,flow.token_hash,time());
    if(!claimed)fail('WECHAT_FLOW_EXPIRED',410);
    try {
      const mapping=await first('SELECT clerk_user_id FROM ft_wechat_identities WHERE app_id=? AND open_id=?',s.appId,flow.open_id);
      if(mapping?.clerk_user_id!==flow.mapped_user_id)fail('WECHAT_EMAIL_SIGN_IN_REQUIRED',403);
      const profile=activeEmail(await client.users.getUser(flow.mapped_user_id),flow.mapped_user_id);
      if(profile.twoFactorEnabled||profile.totpEnabled||profile.backupCodeEnabled)fail('WECHAT_EMAIL_SIGN_IN_REQUIRED',403);
      const ticket=await client.signInTokens.createSignInToken({userId:profile.id,expiresInSeconds:60});
      if(typeof ticket?.token!=='string'||!ticket.token)throw Error();
      return response({ticket:ticket.token,returnTo:flow.return_to});
    } catch(error) {return response({error:{code:error instanceof FlowError?error.code:'WECHAT_UNAVAILABLE',message:error instanceof FlowError?error.message:MESSAGES.WECHAT_UNAVAILABLE},returnTo:flow.return_to},error instanceof FlowError?error.status:503);}
  }
  async function account(request,s,context) {
    if(!SUBJECT.test(context?.clerkUserId||'')||!context.sessionId||context.impersonating||context.claims?.act)fail('WECHAT_EMAIL_SIGN_IN_REQUIRED',403);
    const flow=await pending(request,s),linked=await first('SELECT created_at FROM ft_wechat_identities WHERE app_id=? AND clerk_user_id=?',s.appId,context.clerkUserId);
    return {enabled:true,linked:!!linked,...dto(flow),expectedUserId:context.clerkUserId,needsReverification:!recent(context,context.profile),...(linked?{linkedAt:new Date(linked.created_at).toISOString()}:{})};
  }
  async function confirm(request,s,context) {
    const input=await write(request,s);keys(input,['confirm','flowId','expectedUserId']);if(input.confirm!==true)fail('INVALID_REQUEST',400);
    const flow=await pending(request,s);matchFlow(flow,input);if(flow.phase!=='bind')fail('WECHAT_FLOW_EXPIRED',410);
    if(!SUBJECT.test(context?.clerkUserId||'')||!context.sessionId||input.expectedUserId!==context.clerkUserId||(flow.expected_user_id&&flow.expected_user_id!==context.clerkUserId))fail('WECHAT_ACCOUNT_CHANGED',409);
    const profile=activeEmail(await clerk().users.getUser(context.clerkUserId),context.clerkUserId);
    if(!recent(context,profile))fail('WECHAT_REVERIFICATION_REQUIRED',403);
    const at=time();const result=await bindings().DB.batch([
      sql("INSERT OR IGNORE INTO ft_wechat_identities(app_id,open_id,clerk_user_id,union_id,created_at) SELECT app_id,open_id,?,union_id,? FROM ft_wechat_flows WHERE id=? AND phase='bind' AND token_hash=? AND expires_at>?",context.clerkUserId,at,flow.id,flow.token_hash,at),
      sql("UPDATE ft_wechat_flows SET phase='consumed',token_hash=NULL,mapped_user_id=?,consumed_at=? WHERE id=? AND phase='bind' AND token_hash=? AND expires_at>? AND EXISTS(SELECT 1 FROM ft_wechat_identities WHERE app_id=? AND open_id=? AND clerk_user_id=?)",context.clerkUserId,at,flow.id,flow.token_hash,at,s.appId,flow.open_id,context.clerkUserId),
    ]);
    if(result[1]?.meta?.changes!==1){const latest=await first('SELECT phase FROM ft_wechat_flows WHERE id=?',flow.id);fail(latest?.phase==='bind'?'WECHAT_BIND_CONFLICT':'WECHAT_FLOW_EXPIRED',latest?.phase==='bind'?409:410);}
    return response({linked:true,returnTo:flow.return_to});
  }
  function errorResponse(error,request,isCallback=false) {
    const value=error instanceof FlowError?error:new FlowError('WECHAT_UNAVAILABLE',503);
    if(isCallback){const allowed=['WECHAT_FLOW_EXPIRED','WECHAT_DENIED','WECHAT_BIND_CONFLICT','WECHAT_DISABLED'];const code=allowed.includes(value.code)?value.code:'WECHAT_PROVIDER_UNAVAILABLE';return response(PAGE+'?mode=error&error='+code);}
    return response({error:{code:value.code,message:value.message},...value.extra},value.status);
  }
  async function handlePublic(request) {
    const path=new URL(request.url).pathname;if(!['/api/auth/wechat/start','/api/auth/wechat/callback','/api/auth/wechat/pending','/api/auth/wechat/exchange','/api/auth/wechat/cancel'].includes(path))return null;
    try{const s=await enabled(request);if(path.endsWith('/callback'))return await callback(request,s);if(path.endsWith('/start'))return await start(request,s);if(path.endsWith('/exchange'))return await exchange(request,s);if(path.endsWith('/cancel'))return await cancel(request,s);if(request.method!=='GET')fail('METHOD_NOT_ALLOWED',405);return response({enabled:true,...dto(await pending(request,s))});}catch(error){return errorResponse(error,request,path.endsWith('/callback'));}
  }
  async function handleAccount(request,context) {
    const path=new URL(request.url).pathname;if(!['/api/account/wechat','/api/account/wechat/start','/api/account/wechat/confirm','/api/account/wechat/cancel'].includes(path))return null;
    try{const s=await enabled(request);if(path.endsWith('/start'))return await start(request,s,context);if(path.endsWith('/confirm'))return await confirm(request,s,context);if(path.endsWith('/cancel'))return await cancel(request,s);if(request.method!=='GET')fail('METHOD_NOT_ALLOWED',405);return response(await account(request,s,context));}catch(error){return errorResponse(error,request);}
  }
  return {publicConfig,handlePublic,handleAccount};
}
