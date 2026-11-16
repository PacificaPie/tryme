import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveGithubRepository} from '../lib/funtrack/github-repository.mjs';
import {ApiError} from '../lib/funtrack/rules.mjs';

const sha='1234567890abcdef1234567890abcdef12345678';
const root='https://api.github.com/repos/example/game';
const metadata={full_name:'example/game',html_url:'https://github.com/example/game',private:false,visibility:'public',disabled:false,default_branch:'main',size:1,description:'A real game',license:{spdx_id:'MIT',name:'MIT License'}};
const errorCode=code=>error=>error instanceof ApiError&&error.code===code;
function fixture({repo={},commit=sha,override}={}){
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    if(override){const result=await override(url,options);if(result)return result;}
    if(url===root)return new Response(JSON.stringify({...metadata,...repo}));
    if(url.startsWith(root+'/commits/'))return new Response(commit);
    throw new Error('Unexpected URL '+url);
  };
  return {fetchImpl,calls};
}

test('root, trailing slash and git clone suffix resolve to one pinned repository',async()=>{
  for(const input of ['https://github.com/example/game','https://github.com/example/game/','https://github.com/example/game.git',' https://github.com/example/game.git/ ']){
    const mock=fixture({repo:{default_branch:'release/web'}});
    assert.deepEqual(await resolveGithubRepository(input,mock),{url:'https://github.com/example/game',repository:'example/game',commitSha:sha,defaultBranch:'release/web',description:'A real game',license:{spdxId:'MIT',name:'MIT License'}});
    assert.deepEqual(mock.calls.map(call=>call.url),[root,root+'/commits/release%2Fweb']);
    for(const {url,options} of mock.calls){assert.equal(new URL(url).origin,'https://api.github.com');assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);}
    assert.equal(mock.calls[1].options.headers.Accept,'application/vnd.github.sha');
  }
});

test('invalid roots cannot issue an upstream request',async()=>{
  const inputs=[null,{},'','http://github.com/example/game','https://github.com:443/example/game','https://github.com:8443/example/game','https://user:pass@github.com/example/game','https://github.com.evil.test/example/game','https://api.github.com/repos/example/game','https://raw.githubusercontent.com/example/game/main/index.html','https://github.com/example/game/tree/main','https://github.com/example/game/blob/main/index.html','https://github.com/example/game?','https://github.com/example/game?token=secret','https://github.com/example/game#','https://github.com/example/game#readme','https://github.com/example//game','https://github.com/example/game//','https://github.com/example/game/../other','https://github.com/example/%2e%2e','https://github.com/example/game%2Ftree','https://github.com/example/game%5Cextra','https://github.com/example/ga\nme','https://github.com/example/.git','https://github.com/-example/game','https://github.com/example/'+('a'.repeat(101))];
  for(const input of inputs){const mock=fixture();await assert.rejects(resolveGithubRepository(input,mock),errorCode('INVALID_GITHUB_REPOSITORY'),String(input));assert.equal(mock.calls.length,0);}
});

test('private, disabled and empty repositories fail with actionable codes',async()=>{
  for(const [repo,code] of [[{private:true},'GITHUB_PRIVATE_REPOSITORY'],[{private:undefined},'GITHUB_PRIVATE_REPOSITORY'],[{visibility:'internal'},'GITHUB_PRIVATE_REPOSITORY'],[{disabled:true},'GITHUB_DISABLED_REPOSITORY'],[{default_branch:''},'GITHUB_EMPTY_REPOSITORY'],[{default_branch:null},'GITHUB_EMPTY_REPOSITORY']]){
    const mock=fixture({repo});await assert.rejects(resolveGithubRepository('https://github.com/example/game',mock),errorCode(code));assert.equal(mock.calls.length,1);
  }
  const empty=fixture({repo:{size:0},override:url=>url.includes('/commits/')?new Response('',{status:409}):null});
  await assert.rejects(resolveGithubRepository('https://github.com/example/game',empty),errorCode('GITHUB_EMPTY_REPOSITORY'));
  assert.equal((await resolveGithubRepository('https://github.com/example/game',fixture({repo:{size:0}}))).commitSha,sha);
});

test('upstream repository identity and default branch are validated',async()=>{
  for(const repo of [{full_name:'different/game'},{full_name:'example/game/tree/main'},{full_name:null},{html_url:'https://evil.test/example/game'},{html_url:'https://github.com/other/game'},{default_branch:undefined},{default_branch:'../../main'},{default_branch:'release\nmain'}])await assert.rejects(resolveGithubRepository('https://github.com/example/game',fixture({repo})),errorCode('GITHUB_RESPONSE_INVALID'));
  const canonical=fixture({repo:{full_name:'Example/Game',html_url:'https://github.com/Example/Game'}});
  assert.equal((await resolveGithubRepository('https://github.com/example/game',canonical)).repository,'Example/Game');
});

test('commit response must be a complete SHA and metadata need not declare a license',async()=>{
  for(const commit of ['main','1234567',JSON.stringify({sha}),'<html>error</html>'])await assert.rejects(resolveGithubRepository('https://github.com/example/game',fixture({commit})),errorCode('GITHUB_RESPONSE_INVALID'));
  const result=await resolveGithubRepository('https://github.com/example/game',fixture({commit:sha.toUpperCase()+'\n',repo:{description:null,license:null}}));
  assert.equal(result.commitSha,sha);assert.equal(result.description,null);assert.equal(result.license,null);
  const bounded=await resolveGithubRepository('https://github.com/example/game',fixture({repo:{description:'x'.repeat(1100),license:{spdx_id:'x'.repeat(101),name:'not trusted'}}}));
  assert.equal(bounded.description.length,1000);assert.equal(bounded.license,null);
});

test('redirects and already redirected fetch implementations are rejected',async()=>{
  for(const response of [new Response('',{status:301,headers:{Location:'https://api.github.com/repos/other/game'}}),Object.defineProperty(new Response('{}'),'redirected',{value:true}),Object.defineProperty(new Response('{}'),'url',{value:'https://evil.test'})]){
    const mock=fixture({override:()=>response});await assert.rejects(resolveGithubRepository('https://github.com/example/game',mock),errorCode('GITHUB_REDIRECT'));assert.equal(mock.calls.length,1);
  }
});

test('both declared and streamed response sizes are bounded',async()=>{
  const large=fixture({override:()=>new Response('',{headers:{'Content-Length':'1048577'}})});
  await assert.rejects(resolveGithubRepository('https://github.com/example/game',large),errorCode('GITHUB_RESPONSE_TOO_LARGE'));
  let cancelled=false;
  const streamed=fixture({override:()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(700000));controller.enqueue(new Uint8Array(700000));},cancel(){cancelled=true;}}),{headers:{'Content-Length':'2'}})});
  await assert.rejects(resolveGithubRepository('https://github.com/example/game',streamed),errorCode('GITHUB_RESPONSE_TOO_LARGE'));assert.equal(cancelled,true);
});

test('invalid JSON/UTF-8 metadata is rejected and server diagnostics are not exposed',async()=>{
  for(const body of ['<html>error</html>',new Uint8Array([0xff,0xfe]),'null','[]'])await assert.rejects(resolveGithubRepository('https://github.com/example/game',fixture({override:()=>new Response(body)})),errorCode('GITHUB_RESPONSE_INVALID'));
  await assert.rejects(resolveGithubRepository('https://github.com/example/game',{fetchImpl:async()=>{throw new Error('token=private-diagnostic');}}),error=>errorCode('GITHUB_UNAVAILABLE')(error)&&!error.message.includes('private'));
});

test('missing repositories and API limits have stable errors',async()=>{
  for(const [status,headers,code] of [[404,{},'GITHUB_NOT_FOUND'],[429,{},'GITHUB_RATE_LIMITED'],[403,{'x-ratelimit-remaining':'0'},'GITHUB_RATE_LIMITED'],[403,{},'GITHUB_UNAVAILABLE'],[500,{},'GITHUB_UNAVAILABLE']])await assert.rejects(resolveGithubRepository('https://github.com/example/game',fixture({override:()=>new Response('',{status,headers})})),errorCode(code));
});

test('timeouts abort a stuck upstream request',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let signal;
  const pending=resolveGithubRepository('https://github.com/example/game',{fetchImpl:async(_url,options)=>{signal=options.signal;return new Promise(()=>{});}});
  const rejection=assert.rejects(pending,errorCode('GITHUB_TIMEOUT'));t.mock.timers.tick(10001);await rejection;assert.equal(signal.aborted,true);
});

test('REST rate limit falls back to public feed identity with the exact repository and immutable HEAD',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url,options});return url.startsWith('https://api.github.com/')?new Response('',{status:429}):new Response(`<feed xmlns="http://www.w3.org/2005/Atom"><id>tag:github.com,2008:/example/game/commits/${sha}</id><entry><id>irrelevant</id></entry></feed>`);};
  const result=await resolveGithubRepository('https://github.com/example/game',{fetchImpl});
  assert.equal(result.commitSha,sha);assert.equal(result.defaultBranch,'HEAD');assert.equal(result.license,null);
  assert.equal(calls[1].url,'https://github.com/example/game/commits/HEAD.atom');assert.equal(calls[1].options.redirect,'manual');assert.equal(calls[1].options.headers.Authorization,undefined);
  for(const body of [`<feed xmlns="http://www.w3.org/2005/Atom"><id>tag:github.com,2008:/other/game/commits/${sha}</id></feed>`,`<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>tag:github.com,2008:/example/game/commits/${sha}</id></entry></feed>`,'<html>login</html>']){
    await assert.rejects(resolveGithubRepository('https://github.com/example/game',{fetchImpl:async url=>url.startsWith('https://api.github.com/')?new Response('',{status:429}):new Response(body)}),errorCode('GITHUB_RESPONSE_INVALID'));
  }
});
