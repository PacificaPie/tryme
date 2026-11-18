// Read-only baseline. Run from each real test network; never infer its location.
// No auth, cookies, client IP, response bodies, or secrets are retained.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lookup} from 'node:dns/promises';
const exec = promisify(execFile);
const targets = [
  'https://trymecard.com/site', 'https://trymecard.com/api/auth/config',
  'https://trymecard.com/api/public/discover', 'https://trymecard.com/api/me',
  'https://clerk.trymecard.com/npm/@clerk/clerk-js@6/dist/clerk.browser.js',
  'https://clerk.trymecard.com/.well-known/jwks.json',
  'https://accounts.google.com/', 'https://open.weixin.qq.com/', 'https://api.weixin.qq.com/',
];
const results = await Promise.all(targets.map(async url => {
  let dns;
  try {dns = await lookup(new URL(url).hostname, {all:true});} catch(error) {dns = {error:error.code};}
  const samples = [];
  for (let i=0;i<3;i++) {
    try {
      const {stdout} = await exec('curl', ['--silent','--show-error','--location','--max-redirs','5','--proto','=https','--proto-redir','=https','--max-time','15','--output','/dev/null',
        '--write-out','%{http_code} %{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total} %{size_download} %{url_effective} %{num_redirects}',url]);
      const fields = stdout.trim().split(' ');
      const [status,dnsSeconds,connectSeconds,tlsSeconds,ttfbSeconds,totalSeconds,bytes] = fields.slice(0,7).map(Number);
      const finalURL = new URL(fields[7]);
      const effectiveURL = finalURL.origin + finalURL.pathname, redirects = Number(fields[8]);
      samples.push({status,dnsSeconds,connectSeconds,tlsSeconds,ttfbSeconds,totalSeconds,bytes,effectiveURL,redirects});
    } catch (error) {samples.push({error:'curl failed or timed out',exitCode:error.code});}
  }
  return {url,dns,samples};
}));
console.log(JSON.stringify({observedAt:new Date().toISOString(),vantage:process.env.TRYME_PROBE_LABEL || 'execution host; geography and proxy route unverified',limitations:'No login, upload, email delivery, real QR or mainland-China reachability verified. Root responses do not validate provider APIs.',results},null,2));
