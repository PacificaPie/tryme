import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, OWNER, OTHER, html, handleAPI } from './helpers/router-fixture.mjs';
import { createVideoPreviewService, PREVIEW_LIMITS } from '../lib/funtrack/video-preview-service.mjs';
import { captureVideoPreview, validatePreview, VIDEO_PREVIEW } from '../lib/funtrack/video-preview-capture.mjs';

const mp4 = new Uint8Array(64); mp4.set([0,0,0,24,...new TextEncoder().encode('ftypisom')]);
const captured = () => ({bytes:mp4,mime:'video/mp4',durationMs:8000});
const service = (f, extra={}) => createVideoPreviewService({db:()=>f.db,bucket:()=>f.bucket,configured:()=>true,capture:async()=>captured(),...extra});
const state = (f,w) => f.api(`/api/works/${w.id}/auto-preview`);
const generate = (f,w,action='generate',extra={}) => f.api(`/api/works/${w.id}/auto-preview`,{method:'POST',body:{action,versionId:w.versionId},...extra});
const publicRead = (url,options={}) => handleAPI(new Request('https://site.test'+url,options));

test('HTML with a manual cover and repository builds enqueue previews; URL works do not',async t=>{
  const f=fixture(t,{autoPreview:true}),key=randomUUID(),{work}=await f.publish({key,cover:true});
  assert.equal((await state(f,work)).status,'queued');await f.publish({key,cover:true});await generate(f,work);assert.equal(f.count('ft_video_preview_jobs'),1);
  const buildId=randomUUID();f.testBuilds.set(buildId,{owner:OWNER,bytes:html('repository'),provenance:{provider:'test'}});
  assert.equal((await f.publish({buildId})).status,201);assert.equal(f.count('ft_video_preview_jobs'),2);
  const external=(await f.publish({source:'url',url:'https://example.test/game'})).work;
  assert.equal((await state(f,external)).reason,'EXTERNAL_WORK');await generate(f,external);assert.equal(f.count('ft_video_preview_jobs'),2);
});

test('preview readiness leaves covers, revisions, versions, cards and play analytics unchanged',async t=>{
  const f=fixture(t,{autoPreview:true}),{work}=await f.publish({cover:true});
  await f.api('/api/cards',{method:'POST',body:{name:'Creator',bio:'',template:'wall',workIds:[work.id]}});
  const before=Object.fromEntries(['ft_works','ft_work_versions','ft_work_metadata','ft_cards'].map(table=>[table,f.database.prepare('SELECT * FROM '+table).all()]));
  const previews=service(f,{capture:async content=>{assert.equal(content,html('v1'));return captured();}});
  assert.equal((await previews.processPending()).status,'ready');assert.equal((await previews.processPending()).processed,false);
  const after=(await f.get(work.id)).work;assert.match(after.preview.url,/^\/api\/public\/works\/.*\/preview\//);
  for(const [table,rows] of Object.entries(before))assert.deepEqual(f.database.prepare('SELECT * FROM '+table).all(),rows,table);
  for(const table of ['ft_events','ft_play_sessions','ft_feed_impressions'])assert.equal(f.count(table),0);
  assert.equal((await state(f,work)).status,'ready');
});

test('anonymous Feed gets only a public preview pointer; Range/HEAD work and no game session is exposed',async t=>{
  const f=fixture(t,{autoPreview:true}),{work}=await f.publish();await service(f).processPending();
  const feed=await (await publicRead('/api/public/discover')).json(),visible=feed.works[0];
  assert.deepEqual(Object.keys(visible.preview).sort(),['durationMs','mime','url']);assert.equal(visible.versionId,undefined);assert.equal(visible.authorId,undefined);assert.equal(visible.game_key,undefined);
  assert.equal((await publicRead(visible.preview.url,{method:'POST'})).status,401);
  const response=await publicRead(visible.preview.url);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),mp4);
  const partial=await publicRead(visible.preview.url,{headers:{Range:'bytes=4-7'}});assert.equal(partial.status,206);assert.equal(partial.headers.get('content-range'),'bytes 4-7/64');assert.equal(await partial.text(),'ftyp');
  const suffix=await publicRead(visible.preview.url,{headers:{Range:'bytes=-4'}});assert.equal(suffix.status,206);assert.equal((await suffix.arrayBuffer()).byteLength,4);
  const head=await publicRead(visible.preview.url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'64');assert.equal(await head.text(),'');
  for(const range of ['bytes=99-','bytes=10-2','bytes=-0','bytes=0-1,5-6','nope'])assert.equal((await publicRead(visible.preview.url,{headers:{Range:range}})).status,416,range);
  assert.equal((await f.api('/api/works/'+work.id+'/auto-preview',{owner:OTHER})).status,403);
});

test('hide/archive/current-version changes immediately revoke bookmarked public media, even for signed-in strangers',async t=>{
  const f=fixture(t,{autoPreview:true}),{work}=await f.publish();await service(f).processPending();
  const old=(await f.get(work.id)).work.preview.url;
  assert.equal((await f.discovery(work.id,'hide')).status,200);
  assert.equal((await publicRead(old)).status,404);
  const privateURL=(await f.get(work.id)).work.preview.url;assert.match(privateURL,/^\/api\/works\//);
  assert.equal((await handleAPI(f.request(privateURL,{owner:OTHER}))).status,404);assert.equal((await handleAPI(f.request(privateURL))).status,200);
  await f.discovery(work.id,'restore');assert.equal((await publicRead(old)).status,200);
  assert.equal((await f.version(work.id)).status,201);assert.equal((await publicRead(old)).status,404);assert.equal((await f.get(work.id)).work.preview,undefined);
  await service(f).processPending();const latest=(await f.get(work.id)).work;
  await f.api('/api/works/'+work.id+'/archive',{method:'POST',body:{action:'archive',expectedRevision:latest.revision}});
  assert.equal((await publicRead(latest.preview.url)).status,404);
});

test('queue outage and disabled configuration never fail publication or version update',async t=>{
  const f=fixture(t,{autoPreview:true});f.database.exec('DROP TABLE ft_video_preview_attempts; DROP TABLE ft_video_preview_jobs;');
  const result=await f.publish();assert.equal(result.status,201);assert.equal((await state(f,result.work)).status,'unavailable');assert.equal((await f.version(result.work.id)).status,201);
  const disabled=fixture(t);assert.equal((await disabled.publish()).status,201);assert.equal(disabled.count('ft_video_preview_jobs'),0);
});

test('generation is owner-only, fixed-version, limited to hosted data and byte-bounded',async t=>{
  const f=fixture(t,{autoPreview:true}),{work}=await f.publish();
  assert.equal((await generate(f,work,'generate',{owner:OTHER})).status,403);
  assert.equal((await generate(f,{...work,versionId:randomUUID()})).status,409);
  assert.equal((await f.api(`/api/works/${work.id}/auto-preview`,{method:'POST',body:{action:'generate',versionId:work.versionId,url:'http://localhost'}})).status,422);
  let cancelled=false;const body=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(600));},cancel(){cancelled=true;}});
  await assert.rejects(service(f).handle(new Request(`https://site.test/api/works/${work.id}/auto-preview`,{method:'POST',body,duplex:'half'}),{id:OWNER}),{code:'BODY_TOO_LARGE'});assert.equal(cancelled,true);
});

test('failures are explicit, bounded retries; interrupted leases cannot silently re-run',async t=>{
  const f=fixture(t,{autoPreview:true}),{work}=await f.publish();let calls=0;
  const previews=service(f,{capture:async()=>{calls++;throw Object.assign(Error('timeout'),{code:'CAPTURE_TIMEOUT'});}});
  assert.equal((await previews.processPending()).status,'failed');assert.equal((await state(f,work)).retryable,true);
  await generate(f,work);assert.equal((await previews.processPending()).processed,false);
  await generate(f,work,'retry');await previews.processPending();assert.equal(calls,2);assert.equal((await state(f,work)).retryable,false);assert.equal(f.count('ft_video_preview_attempts'),2);
  const other=(await f.publish({bytes:html('interrupted')})).work;
  f.database.prepare("UPDATE ft_video_preview_jobs SET status='running',attempts=1,lease_id='lost',lease_until='2000-01-01' WHERE work_id=?").run(other.id);
  assert.equal((await previews.processPending()).processed,false);assert.equal((await state(f,other)).reason,'CAPTURE_INTERRUPTED');
});

test('concurrent triggers reserve a single slot and enforce a shared daily/monthly preview budget',async t=>{
  const f=fixture(t,{autoPreview:true});await f.publish();await f.publish({bytes:html('second')});let calls=0;
  const previews=service(f,{limits:{...PREVIEW_LIMITS,dailySeconds:90,monthlySeconds:90},capture:async()=>{calls++;return captured();}});
  await Promise.all([previews.processPending(),previews.processPending()]);assert.equal(calls,1);assert.equal(f.count('ft_video_preview_attempts'),1);
  assert.equal((await previews.processPending()).processed,false);assert.equal(calls,1);
});

test('version/archive races never attach stale results or leak an orphan; storage failure is recoverable',async t=>{
  for(const change of ['version','archive','put']){
    const f=fixture(t,{autoPreview:true}),{work}=await f.publish();
    const previews=service(f,{capture:async()=>{if(change==='version')await f.version(work.id);else if(change==='archive')await f.api('/api/works/'+work.id+'/archive',{method:'POST',body:{action:'archive',expectedRevision:1}});else f.faults.put=true;return captured();}});
    assert.equal((await previews.processPending()).status,change==='put'?'failed':'skipped');assert.equal((await f.get(work.id)).work.preview,undefined);
  }
  const f=fixture(t,{autoPreview:true}),{work}=await f.publish(),put=f.bucket.put;
  let raced=false;f.bucket.put=async(...args)=>{await put(...args);if(!raced){raced=true;await f.version(work.id);}};
  assert.equal((await service(f).processPending()).status,'skipped');assert.equal(f.deleted.length,1);
});

test('changed stored HTML cannot be recorded under an old version hash',async t=>{
  const f=fixture(t,{autoPreview:true}),{work}=await f.publish();const key=f.database.prepare('SELECT game_key FROM ft_work_versions WHERE id=?').get(work.versionId).game_key;
  f.objects.set(key,new TextEncoder().encode(html('corrupt')));let calls=0;
  assert.equal((await service(f,{capture:async()=>{calls++;return captured();}}).processPending()).reason,'CONTENT_CHANGED');assert.equal(calls,0);
});

test('invalid video bytes and out-of-range sizes are rejected before storage',()=>{
  assert.throws(()=>validatePreview(new Uint8Array(40)),{code:'INVALID_PREVIEW'});assert.throws(()=>validatePreview(new Uint8Array(VIDEO_PREVIEW.maxBytes+1)),{code:'INVALID_PREVIEW'});assert.equal(validatePreview(mp4),mp4);
});

test('cloud browser timeout closes a late launch without rendering the game',async()=>{
  let finish,closed=0,pages=0;
  const result=captureVideoPreview({fetch(){}},html('late'),{launch:()=>new Promise(resolve=>finish=resolve),timeoutMs:5});
  await assert.rejects(result,{code:'CAPTURE_TIMEOUT'});finish({async close(){closed++;},async newPage(){pages++;}});
  await new Promise(resolve=>setTimeout(resolve,5));assert.equal(pages,0);assert.equal(closed,1);
});
