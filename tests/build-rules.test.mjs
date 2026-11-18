import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError,htmlSource } from '../lib/funtrack/rules.mjs';
import { builtHTML,buildProgress,buildLog,buildMetadata,verifyBuildWorker,BUILD_MAX_BYTES,BUILD_LOG_MAX_CHARS,buildCapabilities,buildFailureCode } from '../lib/funtrack/build-rules.mjs';
const throws=(fn,code)=>assert.throws(fn,e=>e instanceof ApiError&&e.code===code);
test('built artifacts and ordinary uploads share the 16 MiB limit',()=>{
  const bytes=new TextEncoder().encode('<!doctype html><html><body>'+'x'.repeat(1048576)+'</body></html>');
  assert(builtHTML(bytes,'text/html','index.html').startsWith('<!doctype'));
  assert(htmlSource(bytes,'text/html','index.html').startsWith('<!doctype'));
  throws(()=>builtHTML(new Uint8Array(BUILD_MAX_BYTES+1),'text/html','index.html'),'BUILD_ARTIFACT_TOO_LARGE');
  throws(()=>builtHTML(new Uint8Array([255]),'text/html','index.html'),'INVALID_BUILD_ARTIFACT');
  throws(()=>builtHTML(new TextEncoder().encode('hello'),'text/html','index.html'),'INVALID_BUILD_ARTIFACT');
  throws(()=>builtHTML(bytes,'application/javascript','index.js'),'INVALID_BUILD_ARTIFACT');
});
test('progress is monotonic and terminal states cannot reopen',()=>{
  assert.equal(buildProgress('fetching','installing'),'installing');
  assert.equal(buildProgress('building','building'),'building');
  assert.equal(buildProgress('fetching','packaging'),'packaging');
  for(const [current,next] of [['building','fetching'],['ready','building'],['cancelled','packaging'],['failed','building']])throws(()=>buildProgress(current,next),'BUILD_STATE_CHANGED');
  throws(()=>buildProgress('building','ready'),'INVALID_BUILD_STATUS');
});
test('log chunks and history are bounded and runner credentials are redacted',()=>{
  const secret='secret'.repeat(8);
  const text=buildLog('old\n',`\u0000new ${secret} Bearer abcdefghijklmnopqrstuvwxyz`,secret);
  assert(!text.includes(secret));assert(!text.includes('abcdefghijklmnopqrstuvwxyz'));assert(!text.includes('\u0000'));assert(text.includes('[redacted]'));
  assert.equal(buildLog('a'.repeat(BUILD_LOG_MAX_CHARS),'new').length,BUILD_LOG_MAX_CHARS);
  throws(()=>buildLog('','a'.repeat(16385)),'INVALID_BUILD_LOG');
});
test('metadata is a bounded JSON object and never accepted as executable content',()=>{
  assert.deepEqual(buildMetadata('{"framework":"vite","durationMs":42}'),{framework:'vite',durationMs:42});
  for(const value of [null,[],1,'nope'])throws(()=>buildMetadata(value),'INVALID_BUILD_METADATA');
  throws(()=>buildMetadata({license:'x'.repeat(65536)}),'BUILD_METADATA_TOO_LARGE');
});
test('worker credentials use only the dedicated Bearer secret',async()=>{
  const expected='x'.repeat(48);
  await verifyBuildWorker(new Headers({Authorization:'Bearer '+expected}),expected);
  await assert.rejects(verifyBuildWorker(new Headers(),expected),e=>e.code==='BUILD_RUNNER_AUTH_REQUIRED');
  await assert.rejects(verifyBuildWorker(new Headers({Authorization:'Bearer '+'y'.repeat(48)}),expected),e=>e.code==='BUILD_RUNNER_AUTH_REQUIRED');
  await assert.rejects(verifyBuildWorker(new Headers({Authorization:'Bearer '+expected}),undefined),e=>e.code==='BUILD_RUNNER_UNCONFIGURED');
});

test('capabilities distinguish unconfigured, offline and fresh heartbeats without disclosing credentials',()=>{
  const now=Date.parse('2026-11-16T15:00:00.000Z'),fresh='2026-11-16T14:59:59.000Z';
  const unconfigured=buildCapabilities({configured:false,lastHeartbeatAt:fresh,now});
  assert.equal(unconfigured.status,'unconfigured');assert.equal(unconfigured.online,false);assert.equal(unconfigured.lastHeartbeatAt,null);
  assert.deepEqual(unconfigured.imports,{html:true,repository:false});assert.equal(unconfigured.heartbeatTtlSeconds,90);
  assert.deepEqual(unconfigured.limits,{htmlBytes:16777216,coverBytes:2097152,publicationBytes:19005440});
  assert.equal(buildCapabilities({configured:true,now}).status,'offline');
  assert.equal(buildCapabilities({configured:true,lastHeartbeatAt:'invalid',now}).online,false);
  assert.equal(buildCapabilities({configured:true,lastHeartbeatAt:'2026-11-16T15:00:01.000Z',now}).online,false);
  assert.equal(buildCapabilities({configured:true,lastHeartbeatAt:'2026-11-16T14:58:30.000Z',now}).status,'offline');
  const online=buildCapabilities({configured:true,lastHeartbeatAt:fresh,now,token:'secret',workerId:'hidden'});
  assert.equal(online.status,'online');assert.equal(online.imports.repository,true);assert.equal(online.lastHeartbeatAt,fresh);
  assert.equal(JSON.stringify(online).includes('secret'),false);assert.equal(JSON.stringify(online).includes('hidden'),false);
});
test('build failure codes retain supported actionable categories and bound unknown runner input',()=>{
  for(const code of ['UNSUPPORTED_PROJECT','UNSUPPORTED_LOCKFILE','UNSUPPORTED_DEPENDENCY','LICENSE_REQUIRED','EXTERNAL_ASSET','OUTPUT_TOO_LARGE','ARCHIVE_TOO_LARGE','ARCHIVE_UNPACKED_TOO_LARGE','ARCHIVE_FILE_TOO_LARGE','ARCHIVE_TOO_MANY_FILES','BUILD_TIMEOUT'])assert.equal(buildFailureCode(code),code);
  for(const value of [undefined,null,'constructor','secret'.repeat(1000),{}])assert.equal(buildFailureCode(value),'BUILD_FAILED');
});
