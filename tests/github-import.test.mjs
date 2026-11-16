import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveGithubHTML} from '../lib/funtrack/github-import.mjs';
import {ApiError} from '../lib/funtrack/rules.mjs';

const sha='1234567890abcdef1234567890abcdef12345678';
const root='https://api.github.com/repos/example/game';
const blob=`https://github.com/example/game/blob/${sha}/index.html`;
const raw=`https://raw.githubusercontent.com/example/game/${sha}/index.html`;
const html='<!doctype html><html><style>body{color:#222}</style><body><canvas></canvas><script>const score=0;</script></body></html>';
const json=value=>new Response(JSON.stringify(value));
const errorCode=code=>error=>error instanceof ApiError&&error.code===code;
function fixture({source=html,branch='trunk',refs=[],override}={}){
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    if(override){const response=await override(url,options);if(response)return response;}
    if(url===root)return json({default_branch:branch,private:false});
    if(url.includes('/git/matching-refs/'))return json(refs);
    if(url.startsWith(root+'/commits/'))return new Response(sha);
    if(url.startsWith('https://raw.githubusercontent.com/'))return new Response(source);
    throw new Error('Unexpected URL '+url);
  };
  return {fetchImpl,calls};
}

test('repository root uses its actual default branch then pins the raw file',async()=>{
  const mock=fixture({branch:'release/web'});
  const result=await resolveGithubHTML('https://github.com/example/game',mock);
  assert.deepEqual(result,{html,filename:'index.html',sourceUrl:blob,repository:'example/game',commitSha:sha,path:'index.html'});
  assert.equal(mock.calls[1].url,root+'/commits/release%2Fweb');
  assert.equal(mock.calls[2].url,raw);
  for(const call of mock.calls){
    assert.equal(call.options.redirect,'manual');assert.equal(call.options.credentials,'omit');
    assert.equal(call.options.referrerPolicy,'no-referrer');
    assert.equal(call.options.headers.Authorization,undefined);assert.equal(call.options.headers.Cookie,undefined);
    assert.ok(['api.github.com','raw.githubusercontent.com'].includes(new URL(call.url).hostname));
  }
});

test('blob and raw commit URLs return the same pinned source, including encoded filenames',async()=>{
  for(const url of [blob,raw]){
    const mock=fixture();assert.equal((await resolveGithubHTML(url,mock)).sourceUrl,blob);
    assert.equal(mock.calls.length,2);assert.equal(mock.calls[0].url,root+'/commits/'+sha);
  }
  const result=await resolveGithubHTML(`https://github.com/example/game/blob/${sha}/games/a%20b.html`,fixture());
  assert.equal(result.path,'games/a b.html');assert.equal(result.filename,'a b.html');assert.match(result.sourceUrl,/games\/a%20b.html$/);
});

test('ordinary branch plus nested file works, slash-containing matching refs are rejected',async()=>{
  const normal=fixture({refs:[{ref:'refs/heads/main'}]});
  const result=await resolveGithubHTML('https://github.com/example/game/blob/main/games/index.html',normal);
  assert.equal(result.path,'games/index.html');
  const ambiguous=fixture({refs:[{ref:'refs/heads/feature/mobile'}]});
  await assert.rejects(resolveGithubHTML('https://github.com/example/game/blob/feature/mobile/index.html',ambiguous),errorCode('GITHUB_AMBIGUOUS_REF'));
  assert.ok(ambiguous.calls.every(call=>!call.url.includes('/commits/')&&!call.url.includes('raw.githubusercontent.com')));
});

test('rejects nonofficial hosts, credentials, protocol, traversal and non-HTML URLs before fetching',async()=>{
  const urls=['http://github.com/example/game','https://github.com.evil.test/example/game','https://user:pass@github.com/example/game','https://github.com:8443/example/game','https://api.github.com/repos/example/game',`https://github.com/example/game/blob/${sha}/index.js`,'https://github.com/example/game/tree/main','https://github.com/example/game?token=secret',`https://github.com/example/game/blob/${sha}/a%2Fb.html`,`https://github.com/example/game/blob/${sha}/%2e%2e/index.html`];
  for(const url of urls){const mock=fixture();await assert.rejects(resolveGithubHTML(url,mock),errorCode('INVALID_GITHUB_URL'));assert.equal(mock.calls.length,0);}
});

test('does not follow redirects or accept a fetch implementation that already followed one',async()=>{
  for(const response of [new Response('',{status:302,headers:{Location:'https://example.org/game.html'}}),Object.defineProperty(new Response(sha),'redirected',{value:true})]){
    const mock=fixture({override:()=>response});await assert.rejects(resolveGithubHTML(blob,mock),errorCode('GITHUB_REDIRECT'));assert.equal(mock.calls.length,1);
  }
});

test('size is bounded from both content length and streamed bytes',async()=>{
  const largeHeader=fixture({override:url=>url===raw?new Response('',{headers:{'Content-Length':'1048577'}}):null});
  await assert.rejects(resolveGithubHTML(blob,largeHeader),errorCode('GITHUB_FILE_TOO_LARGE'));
  let cancelled=false;
  const streamed=fixture({override:url=>url===raw?new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(600000));controller.enqueue(new Uint8Array(600000));},cancel(){cancelled=true;}}),{headers:{'Content-Length':'1'}}):null});
  await assert.rejects(resolveGithubHTML(blob,streamed),errorCode('GITHUB_FILE_TOO_LARGE'));assert.equal(cancelled,true);
});

test('reuses UTF-8 and HTML document validation',async()=>{
  for(const source of [new Uint8Array([0xff,0xfe]),'plain text'])await assert.rejects(resolveGithubHTML(blob,fixture({source})),errorCode('INVALID_HTML'));
});

test('rejects external or relative markup, CSS and script dependencies',async()=>{
  const cases=['<script src="./game.js"></script>','<link rel="stylesheet" href="https://cdn.example/style.css">','<img src="./sprite.png">','<audio src="sound.mp3"></audio>','<svg><image href="https://example.org/a.svg" /></svg>','<img srcset="data:image/png;base64,AAAA 1x, other.png 2x">','<style>@import "./style.css";</style>','<style>body{background:url(./image.png)}</style>','<div style="background:url(https://example.org/x)"></div>','<script>import x from "./game.js";</script>','<script>import("./game.js");</script>','<script>fetch("./level.json")</script>','<script>fetch(levelURL)</script>','<script>image.src="./sprite.png"</script>','<script>importScripts("data:text/javascript,", "./second.js")</script>','<base href="https://example.org">'];
  for(const content of cases)await assert.rejects(resolveGithubHTML(blob,fixture({source:'<!doctype html><html><body>'+content+'</body></html>'})),errorCode('GITHUB_MULTIFILE_PROJECT'),content);
});

test('allows inline scripts, SVG and data URI assets',async()=>{
  const source='<!doctype html><html><style>body{background:url(data:image/png;base64,AAAA)}</style><body><svg><defs><path id="mark" d="M0 0" /></defs><use href="#mark" /></svg><img src="data:image/png;base64,AAAA"><audio src="data:audio/wav;base64,AAAA"></audio><script>const a=new Audio();</script></body></html>';
  assert.equal((await resolveGithubHTML(blob,fixture({source}))).html,source);
});

test('maps missing, rate limited and network failures to stable errors',async()=>{
  for(const [status,headers,code] of [[404,{},'GITHUB_NOT_FOUND'],[429,{},'GITHUB_RATE_LIMITED'],[403,{'x-ratelimit-remaining':'0'},'GITHUB_RATE_LIMITED'],[503,{},'GITHUB_UNAVAILABLE']])await assert.rejects(resolveGithubHTML(blob,fixture({override:()=>new Response('',{status,headers})})),errorCode(code));
  await assert.rejects(resolveGithubHTML(blob,{fetchImpl:async()=>{throw new Error('private runtime details');}}),errorCode('GITHUB_UNAVAILABLE'));
});

test('timeouts abort the request without waiting for a stuck fetch',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let signal;
  const pending=resolveGithubHTML(blob,{fetchImpl:async(_url,options)=>{signal=options.signal;return new Promise(()=>{});}});
  const rejection=assert.rejects(pending,errorCode('GITHUB_TIMEOUT'));
  t.mock.timers.tick(10001);await rejection;assert.equal(signal.aborted,true);
});
