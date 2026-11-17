import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {unpackTar,validateNpmProject,validateJob,validatePackedHTML,LIMITS} from '../scripts/repo-builder.mjs';
import {validateRunnerConfig,redactLog,runWorker} from '../scripts/build-runner.mjs';
function archive(entries){const parts=[];for(const {name,type='0',body=''} of entries){const bytes=Buffer.from(body),header=Buffer.alloc(512);header.write(name,0,100);header.write('0000644\0',100);header.write('0001750\0',108);header.write('0001750\0',116);header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124);header.write('00000000000\0',136);header.fill(32,148,156);header[156]=type.charCodeAt(0);header.write('ustar\0',257);let sum=0;for(const byte of header)sum+=byte;header.write(sum.toString(8).padStart(6,'0')+'\0 ',148);parts.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512));}parts.push(Buffer.alloc(1024));return gzipSync(Buffer.concat(parts));}
function project(){return [{path:'package.json',bytes:Buffer.from(JSON.stringify({scripts:{build:'vite build'},devDependencies:{vite:'7.1.7'}}))},{path:'package-lock.json',bytes:Buffer.from(JSON.stringify({lockfileVersion:3,packages:{'':{},'node_modules/vite':{version:'7.1.7',resolved:'https://registry.npmjs.org/vite/-/vite-7.1.7.tgz',integrity:'sha512-YWJj'}}}))},{path:'LICENSE',bytes:Buffer.from('MIT License\nCopyright (c) Example')}];}
test('archive extraction rejects traversal, links, duplicate case paths and malformed integrity',()=>{
  for(const name of ['root/../escape','/absolute','root/a\\b','root/./file'])assert.throws(()=>unpackTar(archive([{name}])));
  for(const type of ['1','2','3','4','6'])assert.throws(()=>unpackTar(archive([{name:'root/file',type}])));
  assert.throws(()=>unpackTar(archive([{name:'root/A'},{name:'root/a'}])));
  const corrupt=Buffer.alloc(1024,1);assert.throws(()=>unpackTar(gzipSync(corrupt)));
});
test('archive accepts ordinary multi-file source and excludes config, secrets and existing dependency folders',()=>{
  const entries=['package.json','src/App.jsx','.env','.env.local','.npmrc','.git/config','node_modules/escape'].map(name=>({name:'root/'+name,body:'abc'}));
  assert.deepEqual(unpackTar(archive(entries)).map(x=>x.path),['package.json','src/App.jsx']);
});
test('npm project requires Vite build, lock v2/3, license and registry integrity',()=>{
  assert.equal(validateNpmProject(project()).pkg.scripts.build,'vite build');
  for(const mutation of [files=>files.pop(),files=>files.splice(1,1),files=>{const lock=JSON.parse(files[1].bytes);lock.packages['node_modules/vite'].resolved='https://evil.test/a.tgz';files[1].bytes=Buffer.from(JSON.stringify(lock));},files=>{const lock=JSON.parse(files[1].bytes);delete lock.packages['node_modules/vite'].integrity;files[1].bytes=Buffer.from(JSON.stringify(lock));},files=>{const pkg=JSON.parse(files[0].bytes);pkg.dependencies={bad:'git+https://github.com/evil/repo'};files[0].bytes=Buffer.from(JSON.stringify(pkg));}]){const files=project();mutation(files);assert.throws(()=>validateNpmProject(files));}
});
test('job identity is a pinned public repository pair, not a URL or path',()=>{
  assert.equal(validateJob({repository:'yuss-raa/Snake-Game',commitSha:'a'.repeat(40)}).repository,'yuss-raa/Snake-Game');
  for(const repository of ['../x','a/b/c','a/b?token=x','a/..','https://github.com/a/b'])assert.throws(()=>validateJob({repository,commitSha:'a'.repeat(40)}));
  assert.throws(()=>validateJob({repository:'a/b',commitSha:'main'}));
});
test('final HTML rejects external static assets and oversize output while allowing embedded assets',()=>{
  assert(validatePackedHTML('<!doctype html><html><img src="data:image/png;base64,eA=="></html>'));
  for(const html of ['<html><script src="x.js"></script></html>','<html><img src="https://evil.test/a.png"></html>','<html><link href="style.css" rel="stylesheet"></html>','<html>'+ 'a'.repeat(LIMITS.html)+'</html>'])assert.throws(()=>validatePackedHTML(html));
});
test('runner configuration binds credentials to one explicit origin and uses UUID identity',()=>{
  const config=validateRunnerConfig({siteOrigin:'https://example.chatgpt.site',runnerToken:'r'.repeat(40)});assert.match(config.workerId,/^[a-f0-9-]{36}$/);
  for(const siteOrigin of ['http://evil.test','https://example.chatgpt.site/path','https://secret@example.chatgpt.site'])assert.throws(()=>validateRunnerConfig({siteOrigin,runnerToken:'r'.repeat(40)}));
  assert.equal(redactLog('Bearer secret abc-token ghp_abcdefg',['abc-token']),'Bearer [REDACTED] [REDACTED] [REDACTED]');
});
test('one-shot runner reports ordered build state and artifact without passing config secrets to builder',async()=>{
  const calls=[],logs=[],job={id:'e68c2c64-9907-4672-873c-3e3ffda456b7',repository:'a/b',commitSha:'a'.repeat(40),leaseId:'lease'};const runnerToken='r'.repeat(40),siteAccessToken='s'.repeat(40);
  const result=await runWorker({siteOrigin:'https://example.chatgpt.site',runnerToken,siteAccessToken,once:true},{onLog:line=>logs.push(line),fetchImpl:async(url,options)=>{calls.push({url,options});assert.equal(new URL(url).origin,'https://example.chatgpt.site');assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer '+runnerToken);return Response.json(url.endsWith('/claim')?{build:job}:{});},build:async(received,options)=>{assert.deepEqual(received,job);assert(!('runnerToken'in options));for(const status of ['fetching','installing','building','packaging'])await options.onProgress(status,status);return {html:'<!doctype html><html></html>',metadata:{},filename:'index.html'};}});
  assert.equal(result.completed,1);assert(calls.at(-1).url.endsWith('/complete'));assert(calls.at(-1).options.body instanceof FormData);assert(!logs.join('\n').includes(runnerToken));assert(!logs.join('\n').includes(siteAccessToken));
});

test('runner forwards a stable failure code while redacting the error message',async()=>{
  const calls=[],token='r'.repeat(40),job={id:'e68c2c64-9907-4672-873c-3e3ffda456b7',repository:'a/b',commitSha:'a'.repeat(40),leaseId:'lease'};
  await runWorker({siteOrigin:'https://example.chatgpt.site',runnerToken:token,once:true},{onLog:()=>{},fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json(url.endsWith('/claim')?{build:job}:{});},build:async()=>{throw Object.assign(new Error('Unsupported project '+token),{code:'UNSUPPORTED_PROJECT'});}});
  const failure=calls.find(call=>call.url.endsWith('/fail'));
  assert.deepEqual(JSON.parse(failure.options.body),{leaseId:'lease',error:'Unsupported project [REDACTED]',code:'UNSUPPORTED_PROJECT'});
});
