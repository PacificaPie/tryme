import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync,createGzip} from 'node:zlib';
import {Readable} from 'node:stream';
import {unpackTar,validateNpmProject,validateJob,validatePackedHTML,buildRepository,LIMITS} from '../scripts/repo-builder.mjs';
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
test('repository limits distinguish compressed, per-file, file-count and damaged archives',()=>{
  assert.deepEqual([LIMITS.archive,LIMITS.unpacked,LIMITS.file,LIMITS.html,LIMITS.files],[64*1024*1024,256*1024*1024,32*1024*1024,16*1024*1024,5000]);
  assert.throws(()=>unpackTar(Buffer.alloc(LIMITS.archive+1)),error=>error.code==='ARCHIVE_TOO_LARGE'&&/64 MiB/.test(error.message));
  assert.throws(()=>unpackTar(archive([{name:'root/assets/font.ttf',body:Buffer.alloc(LIMITS.file+1)}])),error=>error.code==='ARCHIVE_FILE_TOO_LARGE'&&error.message.includes('assets/font.ttf')&&error.message.includes('32 MiB'));
  const entries=Array.from({length:LIMITS.files+1},(_,i)=>({name:`root/file-${i}`}));
  assert.throws(()=>unpackTar(archive(entries)),error=>error.code==='ARCHIVE_TOO_MANY_FILES'&&error.message.includes('5001')&&error.message.includes('5000'));
  assert.throws(()=>unpackTar(Buffer.from('broken gzip')),error=>error.code==='INVALID_ARCHIVE'&&!error.message.includes('256'));
});
test('bounded decompression reports expanded-size overflow independently of corrupt gzip',async()=>{
  // Generate a highly-compressible bomb as a stream; the test itself does not
  // need to allocate another 256 MiB input alongside the bounded decompressor.
  const chunk=Buffer.alloc(64*1024),parts=[];
  async function* zeros(){for(let size=0;size<LIMITS.unpacked;size+=chunk.length)yield chunk;yield Buffer.from([0]);}
  for await(const compressed of Readable.from(zeros()).pipe(createGzip()))parts.push(compressed);
  assert.throws(()=>unpackTar(Buffer.concat(parts)),error=>error.code==='ARCHIVE_UNPACKED_TOO_LARGE'&&/256 MiB/.test(error.message));
});
test('source assets between the old and new per-file limits can be imported',()=>{
  const files=unpackTar(archive([{name:'root/font.ttf',body:Buffer.alloc(9*1024*1024)}]));
  assert.equal(files[0].bytes.length,9*1024*1024);
});
test('local prebuilt import respects cancellation before download, during download and after progress',async()=>{
  const job={repository:'owner/game',commitSha:'a'.repeat(40)},previous=globalThis.fetch;
  const bytes=archive([{name:'root/dist/index.html',body:'<!doctype html><html><head></head><body>Ready</body></html>'}]);
  try{
    let requests=0;globalThis.fetch=async()=>{requests++;throw Error('Pre-cancelled jobs must not download');};
    await assert.rejects(buildRepository(job,{signal:AbortSignal.abort()}),{code:'BUILD_CANCELLED'});assert.equal(requests,0);
    const during=new AbortController();let downloadSignal;
    globalThis.fetch=async(url,options)=>{
      downloadSignal=options.signal;
      return await new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});queueMicrotask(()=>during.abort());});
    };
    await assert.rejects(buildRepository(job,{signal:during.signal}),{code:'BUILD_CANCELLED'});assert.equal(downloadSignal.aborted,true);
    const after=new AbortController(),progress=[];
    globalThis.fetch=async url=>{const response=new Response(bytes);Object.defineProperty(response,'url',{value:url});return response;};
    await assert.rejects(buildRepository(job,{signal:after.signal,onProgress:async status=>{progress.push(status);if(status==='packaging')after.abort();}}),{code:'BUILD_CANCELLED'});
    assert.deepEqual(progress,['fetching','packaging']);
  }finally{globalThis.fetch=previous;}
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
test('final HTML accepts the new boundary and identifies oversized artifacts separately from invalid documents',()=>{
  const start='<html>',end='</html>',html=start+'a'.repeat(LIMITS.html-start.length-end.length)+end;
  assert.equal(Buffer.byteLength(validatePackedHTML(html)),LIMITS.html);
  assert.throws(()=>validatePackedHTML(html+' '),error=>error.code==='OUTPUT_TOO_LARGE'&&/16 MiB/.test(error.message));
  assert.throws(()=>validatePackedHTML('not HTML'),error=>error.code==='OUTPUT_REQUIRED');
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
