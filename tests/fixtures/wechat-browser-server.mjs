// Local-only UI fixture: serves the real production pages/modules, substitutes
// the auth SDK at the HTTP boundary, and never contacts Clerk/WeChat or the DB.
// Run: node tests/fixtures/wechat-browser-server.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const publicRoot = path.resolve(fileURLToPath(new URL('../../public/', import.meta.url)));
const port = Number(process.env.FUNTRACK_FIXTURE_PORT || 4893);
const states = ['disabled', 'enabled', 'sign-up', 'no-email', 'unknown', 'confirm', 'linked', 'conflict', 'expired', 'reverify', 'mismatch', 'mfa', 'account'];
const flowId = 'fixture-flow-12345';
const finish = '/fixture-done';
const cookie = request => Object.fromEntries((request.headers.cookie || '').split(';').map(item => item.trim().split('=')));
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
function send(response, body, type = 'text/html', status = 200, extra = {}) { response.writeHead(status, { ...headers, 'Content-Type': `${type}; charset=utf-8`, ...extra }); response.end(body); }
const json = (response, data, status = 200, extra) => send(response, JSON.stringify(data), 'application/json', status, extra);
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`), scenario = cookie(request).fixture_state || 'enabled';
  try {
    if (url.pathname === '/') {
      send(response, `<h1>WeChat UI fixtures — local fake services</h1><p>Production HTML/JS/CSS; no real sign-in, QR, or binding. For mobile use the browser's responsive viewport.</p>${states.map(state => `<p><a href="/fixture?state=${state}">${state} · 中文 / light</a> &nbsp; <a href="/fixture?state=${state}&lang=en&theme=dark">English / dark</a></p>`).join('')}`); return;
    }
    if (url.pathname === '/fixture') {
      const state = states.includes(url.searchParams.get('state')) ? url.searchParams.get('state') : 'enabled';
      const target = ['disabled', 'enabled'].includes(state) ? '/auth/sign-in.html' : ['linked', 'account'].includes(state) ? '/auth/account.html' : `/auth/wechat.html?mode=${state === 'sign-up' ? 'sign-up' : ['mismatch', 'mfa'].includes(state) ? 'sign-in' : 'bind'}`;
      send(response, `<script>localStorage.setItem('funtrack.locale',${JSON.stringify(url.searchParams.get('lang') === 'en' ? 'en' : 'zh-CN')});localStorage.setItem('funtrack.theme',${JSON.stringify(url.searchParams.get('theme') === 'dark' ? 'dark' : 'light')});sessionStorage.setItem('funtrack.wechat.flow',JSON.stringify(${JSON.stringify({ flowId, returnTo: finish })}));location.replace(${JSON.stringify(target)});</script>`, 'text/html', 200, { 'Set-Cookie': [`fixture_state=${state}; Path=/; SameSite=Strict`, 'fixture_signed=; Path=/; Max-Age=0; SameSite=Strict'] }); return;
    }
    if (url.pathname === '/fixture-login') {
      response.writeHead(302, { Location: url.searchParams.get('next')?.startsWith('/auth/') ? url.searchParams.get('next') : finish, 'Set-Cookie': 'fixture_signed=1; Path=/; SameSite=Strict' }); response.end(); return;
    }
    if (url.pathname === '/fixture-signout') {
      response.writeHead(302, { Location: url.searchParams.get('next')?.startsWith('/auth/') ? url.searchParams.get('next') : finish, 'Set-Cookie': 'fixture_signed=0; Path=/; SameSite=Strict' }); response.end(); return;
    }
    if (url.pathname === finish) { send(response, '<h1>Returned safely</h1><p>Local fixture only. No production data changed.</p><a href="/">All fixtures</a>'); return; }
    if (url.pathname === '/auth-client-original.js') { send(response, await readFile(path.join(publicRoot, 'auth-client.js')), 'text/javascript'); return; }
    if (url.pathname === '/auth-client.js') {
      const signed = cookie(request).fixture_signed === '1' || (cookie(request).fixture_signed !== '0' && ['confirm', 'linked', 'conflict', 'reverify', 'mismatch', 'account', 'no-email'].includes(scenario));
      send(response, `
import {safeAuthReturnTo} from '/auth-client-original.js'; export {safeAuthReturnTo};
const config={provider:'clerk',configured:true,environment:'test',wechat:{enabled:${scenario !== 'disabled'}}};
const email={emailAddress:'tester@example.com',verification:{status:'verified'}};
const user={id:'user_fixture',primaryEmailAddress:${scenario === 'no-email' ? 'null' : 'email'},emailAddresses:${scenario === 'no-email' ? '[]' : '[email]'}};
const clerk={isSignedIn:${signed},user:${signed ? 'user' : 'null'},session:${signed ? "{id:'session_fixture',status:'active',user}" : 'null'},
 mountSignIn(node,options){node.innerHTML='<section style="padding:28px;border:1px solid var(--border);border-radius:14px;background:var(--surface);color:var(--text)"><h2>Clerk fixture</h2><p>Local test, no email is sent.</p><button type="button" style="padding:12px">Complete email verification</button></section>';node.querySelector('button').onclick=()=>location.assign('/fixture-login?next='+encodeURIComponent(options.forceRedirectUrl));},
 unmountSignIn(node){node.innerHTML='';},mountUserProfile(node){node.innerHTML='<section style="padding:28px"><h2>Account fixture</h2><p>tester@example.com</p></section>';},unmountUserProfile(node){node.innerHTML='';},
 signOut({redirectUrl}){location.assign('/fixture-signout?next='+encodeURIComponent(redirectUrl));return Promise.resolve();}};
const ticketUser={id:'user_new',emailAddresses:[]};const ticketSession={id:'session_new',status:'active',user:ticketUser};clerk.client={sessions:[ticketSession],signIn:{create:async()=>({status:'complete',createdSessionId:'session_new'})}};clerk.setActive=async()=>{clerk.isSignedIn=true;clerk.user=ticketUser;clerk.session=ticketSession;};
export const ensureAuth=async()=>config,getAuthConfig=()=>config,getClerk=()=>clerk,authHeaders=async()=>clerk.isSignedIn?{Authorization:'Bearer fixture'}:{},authURL=(action,to)=>'/auth/'+action+'.html?return_to='+encodeURIComponent(safeAuthReturnTo(to,location.origin)),signOut=options=>clerk.signOut({redirectUrl:options.returnTo});
`, 'text/javascript'); return;
    }
    if (url.pathname.startsWith('/api/')) {
      const pending = scenario !== 'expired';
      const state = { enabled: scenario !== 'disabled', pending, mode: scenario === 'sign-up' ? 'sign-up' : ['mfa', 'mismatch'].includes(scenario) ? 'sign-in' : 'bind', flowId, returnTo: finish, displayName: '微信账号', mappedUserId: scenario === 'sign-up' ? null : 'user_other' };
      if (url.pathname.endsWith('/pending')) { json(response, state); return; }
      if (url.pathname === '/api/account/wechat') { json(response, { ...state, linked: scenario === 'linked', expectedUserId: 'user_fixture', needsReverification: scenario === 'reverify' && cookie(request).fixture_signed !== '1' }); return; }
      if (url.pathname.endsWith('/confirm')) { if (scenario === 'conflict') json(response, { error: { code: 'WECHAT_BIND_CONFLICT' } }, 409); else json(response, { linked: true, returnTo: finish }); return; }
      if (url.pathname.endsWith('/cancel')) { json(response, { cancelled: true, returnTo: finish }); return; }
      if (url.pathname === '/api/me') { json(response,{user:{id:'clerk:user_new',name:'创作者'}});return; }
      if (url.pathname.endsWith('/exchange') && scenario === 'sign-up') {json(response,{ticket:'local_fixture_only',mappedUserId:'user_new',returnTo:finish});return;}
      if (url.pathname.endsWith('/exchange')) { json(response, { error: { code: 'WECHAT_ADDITIONAL_VERIFICATION_REQUIRED' }, returnTo: finish }, 403); return; }
      // Never send a test browser to a real provider or display a simulated QR.
      if (url.pathname.endsWith('/start')) { json(response, { error: { code: 'WECHAT_PROVIDER_UNAVAILABLE' } }, 503); return; }
      json(response, { error: { code: 'NOT_FOUND' } }, 404); return;
    }
    const file = path.resolve(publicRoot, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(publicRoot + path.sep)) { send(response, 'Not found', 'text/plain', 404); return; }
    const ext = path.extname(file), types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' };
    send(response, await readFile(file), types[ext] || 'application/octet-stream');
  } catch { send(response, 'Not found', 'text/plain', 404); }
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`Local WeChat UI fixtures: http://127.0.0.1:${port}/\n`));
