// Real local D1/R2 upload-boundary checks. Start one fresh compiled Worker with
// independent local storage before running. This harness never starts/migrates a
// database, changes a source game, executes imported code, or writes production.
// Optional: FUNTRACK_LARGE_HTML_FIXTURE=/absolute/path/to/an/existing/game.html
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {basename} from 'node:path';
import {coverPNG} from './fixtures/version-games.mjs';
import {localPreviewHTML,LOCAL_PREVIEW_CSP} from '../../public/versioning-state.js';

const base=new URL(process.env.FUNTRACK_TEST_URL||'http://127.0.0.1:8767');
assert(['localhost','127.0.0.1','[::1]'].includes(base.hostname),'This harness only runs on loopback.');
assert(!base.username&&!base.password&&base.pathname==='/','Use a bare local origin.');
const MIB=1024*1024,MAX_HTML=8*MIB,MAX_COVER=2*MIB,MAX_PUBLICATION=MAX_HTML+MAX_COVER+128*1024;
const run=randomUUID(),owner=`html_limits_${run}`,reader=`html_limits_reader_${run}`;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pinnedHTML='https://github.com/mpaterakis/html-snakeGame/blob/377d3928d9e595b76dcd0ef8a871f2ab512b110b/snakeGame.html';
const report={run,base:base.origin,owner,checks:[],ids:{},startedAt:new Date().toISOString(),boundaries:{htmlBytes:MAX_HTML,coverBytes:MAX_COVER,publicationBytes:MAX_PUBLICATION}};

function sizedHTML(size,label){
  const prefix=Buffer.from(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${label}</title></head><body><h1>${label}</h1><button onclick="this.textContent='Clicked'">Play fixture</button><!--`);
  const suffix=Buffer.from('--></body></html>');assert(size>prefix.length+suffix.length);
  return Buffer.concat([prefix,Buffer.alloc(size-prefix.length-suffix.length,120),suffix]);
}
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function sizedPNG(size){
  // A valid ancillary tEXt chunk makes the cover exactly 2 MiB, exercising the
  // multipart allowance without relying on invalid image padding or an upload.
  const png=coverPNG(53,103,159),text=Buffer.alloc(size-png.length-12,120);text.write('qa\0');
  const body=Buffer.concat([Buffer.from('tEXt'),text]),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(text.length);checksum.writeUInt32BE(crc32(body));
  const result=Buffer.concat([png.subarray(0,-12),length,body,checksum,png.subarray(-12)]);assert.equal(result.length,size);return result;
}
const fixturePath=process.env.FUNTRACK_LARGE_HTML_FIXTURE;
const large=fixturePath?await readFile(fixturePath):sizedHTML(2*MIB+777,'LARGE_HTML_多字节');
assert(large.length>MIB&&large.length<MAX_HTML,'The real/synthetic fixture must be larger than 1 MiB and smaller than 8 MiB.');
const filename=fixturePath?basename(fixturePath):'large-fixture.html';
const largeText=new TextDecoder('utf-8',{fatal:true}).decode(large);
const exact=sizedHTML(MAX_HTML,'EXACT_8_MIB_多字节'),oversize=sizedHTML(MAX_HTML+1,'OVER_8_MIB_多字节'),cover=sizedPNG(MAX_COVER);
// Initial publication and a different work's update both hit exactly 8 MiB,
// while remaining distinct content under the same-author deduplication rule.
const exactPublication=sizedHTML(MAX_HTML,'EXACT_8_MIB_PUBLICATION_多字节');
report.fixture={kind:fixturePath?'existing-local-game':'deterministic-test-game',filename,bytes:large.length,sha256:sha(large)};

async function request(path,{method='GET',user=owner,json,form,headers={},binary=false}={}){
  const response=await fetch(new URL(path,base),{method,redirect:'manual',signal:AbortSignal.timeout(45000),headers:{...(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@sites.test'}:{}),...(method==='POST'?{Origin:base.origin,'X-Funtrack-CSRF':'1'}:{}),...(json!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:form||(json!==undefined?JSON.stringify(json):undefined)});
  const raw=binary?Buffer.from(await response.arrayBuffer()):await response.text();let body=raw;if(!binary)try{body=JSON.parse(raw);}catch{}
  return {status:response.status,headers:response.headers,body};
}
function ok(result,status=200){assert.equal(result.status,status,`Expected ${status}, got ${result.status}: ${typeof result.body==='string'?result.body.slice(0,600):JSON.stringify(result.body).slice(0,1000)}`);return result.body;}
function error(result,status,code){assert.equal(result.status,status,JSON.stringify(result.body));if(code)assert.equal(result.body.error?.code,code);return result.body;}
async function check(name,fn){try{await fn();report.checks.push(name);console.log(`PASS ${name}`);}catch(failure){report.failure={check:name,message:failure.message};throw failure;}}
function publishForm(name,bytes,{image,nameOfFile='fixture.html'}={}){
  const form=new FormData();form.set('name',name);form.set('desc','Local upload-limit verification only.');form.set('source','html');form.set('file',new File([bytes],nameOfFile,{type:'text/html'}));if(image)form.set('cover',new File([image],'cover.png',{type:'image/png'}));return form;
}
function versionForm(revision,bytes,{image}={}){
  const form=new FormData();form.set('expectedRevision',String(revision));form.set('releaseNotes','Local exact 8 MiB version boundary.');form.set('file',new File([bytes],'new-version.html',{type:'text/html'}));if(image)form.set('cover',new File([image],'cover.png',{type:'image/png'}));return form;
}
const mine=async()=>ok(await request('/api/works?mine=1')).works;
const history=async id=>ok(await request(`/api/works/${id}/versions`));
async function fetchedGame(versionId,sourceBytes){
  const result=await request('/game/'+versionId);ok(result);
  assert.match(result.headers.get('content-security-policy')||'',/sandbox allow-scripts/);assert(!(result.headers.get('content-security-policy')||'').includes('allow-same-origin'));assert.match(result.headers.get('content-security-policy')||'',/connect-src 'none'/);
  assert(result.body.endsWith(new TextDecoder('utf-8',{fatal:true}).decode(sourceBytes)),'The served game must retain its original source after the platform bridge.');
  assert(result.body.includes('funtrack-game'));return sha(result.body);
}
let work,exactWork,updated,oldGameHash,capabilities;
const publishKey=randomUUID(),updateKey=randomUUID();

try{
  await check('capabilities are authenticated, uncached and describe an offline runner without disabling HTML',async()=>{
    error(await request('/api/builds/capabilities',{user:null}),401);
    assert.equal(ok(await request('/api/me')).user.id,owner,'Use a compiled Worker; dev mock auth replaces identity headers.');
    const response=await request('/api/builds/capabilities');capabilities=ok(response);assert.match(response.headers.get('cache-control')||'',/no-store/);
    assert.equal(capabilities.online,false,'Use a fresh independent local store with no active builder heartbeat.');assert(['offline','unconfigured'].includes(capabilities.status));assert.equal(capabilities.configured,capabilities.status!=='unconfigured');assert.equal(capabilities.heartbeatTtlSeconds,90);
    assert.deepEqual(capabilities.imports,{html:true,repository:false});assert.deepEqual(capabilities.limits,{htmlBytes:MAX_HTML,coverBytes:MAX_COVER,publicationBytes:MAX_PUBLICATION});
    assert.equal(capabilities.lastHeartbeatAt,null);assert.deepEqual(capabilities.repositoryRequirements,['public','vite','npm-lockfile','root-license']);
    assert.deepEqual(ok(await request('/api/builds/availability')),capabilities);assert.deepEqual(ok(await request('/api/builds/capabilities')),capabilities);assert.equal((await mine()).length,0);
    report.capabilities=capabilities;
  });
  await check('a real HTML game larger than 1 MiB publishes through multipart into D1/R2',async()=>{
    work=ok(await request('/api/works',{method:'POST',form:publishForm(`Large local ${run}`,large,{nameOfFile:filename}),headers:{'Idempotency-Key':publishKey}}),201).work;
    assert.equal(work.source,'html');assert.equal(work.version,'v1');assert.equal(work.revision,1);assert.equal((await mine()).length,1);
    const listing=await history(work.id);assert.equal(listing.versions.length,1);assert.equal(listing.versions[0].contentHash,sha(large));Object.assign(report.ids,{work:work.id,v1:work.versionId});
  });
  await check('large draft preview, version detail and isolated game/session reads remain available',async()=>{
    const preview=localPreviewHTML(largeText);assert(preview.endsWith(largeText));assert(preview.includes(LOCAL_PREVIEW_CSP));assert(!preview.includes('funtrack-game')||largeText.includes('funtrack-game'),'Draft wrapper must not add platform telemetry.');
    assert(preview.includes("connect-src 'none'"));const detail=ok(await request(`/api/works/${work.id}/versions/${work.versionId}`));assert.equal(detail.version.contentHash,sha(large));
    const session=ok(await request('/api/sessions',{method:'POST',user:reader,json:{workId:work.id,versionId:work.versionId}}),201);assert.equal(session.gameUrl,'/game/'+work.versionId);
    oldGameHash=await fetchedGame(work.versionId,large);report.preview={kind:'client draft wrapper plus real authenticated game/session fetch',bytes:Buffer.byteLength(preview),browserRenderingVerified:false};
  });
  await check('exactly 8 MiB HTML plus exactly 2 MiB PNG cover fits the publication envelope',async()=>{
    assert.equal(exactPublication.length,MAX_HTML);assert.equal(exact.length,MAX_HTML);assert.notEqual(sha(exactPublication),sha(exact));assert.equal(cover.length,MAX_COVER);
    exactWork=ok(await request('/api/works',{method:'POST',form:publishForm(`Exact limit ${run}`,exactPublication,{image:cover}),headers:{'Idempotency-Key':randomUUID()}}),201).work;
    const listing=await history(exactWork.id);assert.equal(listing.versions[0].contentHash,sha(exactPublication));assert.equal((await mine()).length,2);
    await fetchedGame(exactWork.versionId,exactPublication);const image=ok(await request(exactWork.coverUrl,{binary:true}));assert.equal(image.length,MAX_COVER);assert.equal(sha(image),sha(cover));report.ids.exactWork=exactWork.id;
  });
  await check('an exact-limit version updates the same work and keeps the older large game immutable',async()=>{
    updated=ok(await request(`/api/works/${work.id}/versions`,{method:'POST',form:versionForm(1,exact,{image:cover}),headers:{'Idempotency-Key':updateKey}}),201);
    assert.equal(updated.version.workId,work.id);assert.equal(updated.version.version,'v2');assert.equal(updated.version.contentHash,sha(exact));assert.equal(updated.operation.revision,2);
    const current=ok(await request('/api/works/'+work.id)).work;assert.equal(current.id,work.id);assert.equal(current.versionId,updated.version.id);assert.equal(current.createdAt,work.createdAt);assert.equal((await mine()).length,2);
    assert.equal((await history(work.id)).versions.length,2);assert.equal(await fetchedGame(work.versionId,large),oldGameHash);await fetchedGame(updated.version.id,exact);
    assert.equal(sha(ok(await request(current.coverUrl,{binary:true}))),sha(cover));report.ids.v2=updated.version.id;
  });
  await check('8 MiB plus one byte is rejected on initial publication without creating a work',async()=>{
    assert.equal(oversize.length,MAX_HTML+1);const count=(await mine()).length;
    error(await request('/api/works',{method:'POST',form:publishForm(`Too large ${run}`,oversize),headers:{'Idempotency-Key':randomUUID()}}),413,'HTML_TOO_LARGE');assert.equal((await mine()).length,count);
  });
  await check('oversized version and envelope requests keep current version, revision and old resources unchanged',async()=>{
    const before=ok(await request('/api/works/'+work.id)).work;
    error(await request(`/api/works/${work.id}/versions`,{method:'POST',form:versionForm(before.revision,oversize),headers:{'Idempotency-Key':randomUUID()}}),413,'HTML_TOO_LARGE');
    const tooLarge=versionForm(before.revision,exact,{image:cover});tooLarge.set('padding','x'.repeat(128*1024));
    error(await request(`/api/works/${work.id}/versions`,{method:'POST',form:tooLarge,headers:{'Idempotency-Key':randomUUID()}}),413,'BODY_TOO_LARGE');
    const after=ok(await request('/api/works/'+work.id)).work;assert.equal(after.versionId,before.versionId);assert.equal(after.revision,before.revision);assert.equal((await history(work.id)).versions.length,2);
    assert.equal(await fetchedGame(work.versionId,large),oldGameHash);await fetchedGame(after.versionId,exact);
  });
  await check('large retry responses stay pinned and rollback needs no re-upload',async()=>{
    const replay=ok(await request('/api/works',{method:'POST',form:publishForm(`Large local ${run}`,large,{nameOfFile:filename}),headers:{'Idempotency-Key':publishKey}}));assert.equal(replay.work.versionId,work.versionId);assert.equal(replay.current.versionId,updated.version.id);
    const versionReplay=ok(await request(`/api/works/${work.id}/versions`,{method:'POST',form:versionForm(1,exact,{image:cover}),headers:{'Idempotency-Key':updateKey}}));assert.deepEqual(versionReplay.version,updated.version);assert.deepEqual(versionReplay.operation,updated.operation);
    const rollback=ok(await request(`/api/works/${work.id}/activate`,{method:'POST',json:{versionId:work.versionId,expectedRevision:2},headers:{'Idempotency-Key':randomUUID()}}));assert.equal(rollback.operation.toVersionId,work.versionId);assert.equal(rollback.operation.revision,3);
    assert.equal((await history(work.id)).versions.length,2);assert.equal(await fetchedGame(work.versionId,large),oldGameHash);assert.equal((await mine()).length,2);
  });
  await check('an offline repository build fails explicitly while pinned GitHub HTML reads without a runner',async()=>{
    const failed=await request('/api/builds',{method:'POST',json:{url:'https://github.com/yuss-raa/Snake-Game'},headers:{'Idempotency-Key':randomUUID()}});error(failed,503);assert(['BUILD_RUNNER_OFFLINE','BUILD_RUNNER_UNCONFIGURED'].includes(failed.body.error.code));
    const before=(await mine()).length,result=ok(await request('/api/imports/github',{method:'POST',json:{url:pinnedHTML}}));
    assert.equal(result.commitSha,'377d3928d9e595b76dcd0ef8a871f2ab512b110b');assert.equal(result.filename,'snakeGame.html');assert.equal(result.sourceUrl,pinnedHTML);assert(result.html.length>0);assert(Buffer.byteLength(result.html)<=MAX_HTML);assert.equal((await mine()).length,before);
    assert.equal(ok(await request('/api/builds/capabilities')).online,false);
    const imported=ok(await request('/api/works',{method:'POST',form:publishForm(`Offline HTML import ${run}`,Buffer.from(result.html),{nameOfFile:result.filename}),headers:{'Idempotency-Key':randomUUID()}}),201).work;await fetchedGame(imported.versionId,Buffer.from(result.html));
    report.githubHTML={sourceUrl:result.sourceUrl,commitSha:result.commitSha,bytes:Buffer.byteLength(result.html),runnerOnline:false,workId:imported.id};
    report.boundaries.githubLargeByteBoundary='Covered by resolver tests with bounded upstream fixtures; this live anonymous read only verifies runner independence.';
  });
  if(fixturePath)await check('the supplied source game was never modified',async()=>{const after=await readFile(fixturePath);assert.equal(after.length,large.length);assert.equal(sha(after),report.fixture.sha256);});
  report.completedAt=new Date().toISOString();
}finally{
  await mkdir('.preview',{recursive:true});await writeFile('.preview/local-html-upload-limits-integration.json',JSON.stringify(report,null,2));
  console.log(`Completed ${report.checks.length} HTML upload checks. Evidence: .preview/local-html-upload-limits-integration.json`);
}
