import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,OWNER,OTHER,html,digest,handleAPI} from './helpers/router-fixture.mjs';
import {createPublishDraftService} from '../lib/funtrack/publish-draft-service.mjs';
import {createCoverDraftService} from '../lib/funtrack/cover-draft-service.mjs';
import {COVER_REVIEW_LIMITS} from '../lib/funtrack/cover-review-service.mjs';
const jpeg=new Uint8Array([255,216,255,224,1,2,3]);
const mp4=new Uint8Array(64);mp4.set(new TextEncoder().encode('ftyp'),4);
const service=(f,extra={})=>createPublishDraftService({db:()=>f.db,bucket:()=>f.bucket,configured:()=>true,bodyJSON:r=>r.json(),hash:digest,captureCover:async()=>({bytes:jpeg,mime:'image/jpeg'}),captureVideo:async()=>({bytes:mp4,mime:'video/mp4',durationMs:7944}),...extra});
async function draft(f,{id=randomUUID(),bytes=html('v1'),source='html',url='https://example.com/',buildId,owner=OWNER}={}){const form=new FormData();form.set('id',id);form.set('source',source);if(source==='url')form.set('url',url);else if(buildId)form.set('buildId',buildId);else form.set('file',new File([bytes],'same.html',{type:'text/html'}));return f.api('/api/publish-drafts',{method:'POST',body:form,owner});}
async function capture(f,s,d,kind='cover',id=randomUUID()){return (await s.handle(f.request('/api/publish-drafts/'+d.id+'/capture',{method:'POST',body:{kind,id,waitMs:5000}}),{id:OWNER})).json();}
const skip=d=>({draftId:d.id,coverChoice:'skip',videoChoice:'skip'});

test('all three sources remain private until server-validated explicit publication',async t=>{
 for(const source of ['html','github','url']){
  const f=fixture(t,{prepublish:true,externalCover:true,autoPreview:true}),buildId=randomUUID();
  f.testBuilds.set(buildId,{owner:OWNER,bytes:new TextEncoder().encode(html('build')),provenance:{repository:'owner/repo',commitSha:'a'.repeat(40)}});
  const args=source==='github'?{buildId}:source==='url'?{source,url:'https://example.com/'}:{};
  const d=await draft(f,args);assert.equal(d.status,200,JSON.stringify(d));assert.equal(f.count('ft_works'),0);assert.deepEqual(await f.feed(),[]);
  assert.equal((await f.publish(args)).error.code,'MEDIA_REVIEW_REQUIRED');
  assert.equal((await f.publish({...args,extra:{draftId:d.id,coverChoice:'skip'}})).error.code,'MEDIA_REVIEW_REQUIRED');
  const result=await f.publish({...args,extra:skip(d)});assert.equal(result.status,201,JSON.stringify(result));assert.deepEqual(await f.feed(),[result.work.id]);
  assert.equal(f.count('ft_cover_review_jobs'),0);assert.equal(f.count('ft_video_preview_jobs'),0);
 }
});
test('draft ownership, build ownership, same-size changed bytes and arbitrary media IDs are enforced',async t=>{
 const f=fixture(t,{prepublish:true}),d=await draft(f),s=service(f),c=await capture(f,s,d);
 assert.equal((await f.api('/api/publish-drafts/'+d.id,{owner:OTHER})).status,404);
 assert.equal((await handleAPI(new Request('https://site.test'+c.url))).status,401);
 assert.equal((await f.api(c.url,{owner:OTHER})).status,404);
 const response=await handleAPI(f.request(c.url));assert.equal(response.headers.get('cache-control'),'private, no-store');
 const buildId=randomUUID();f.testBuilds.set(buildId,{owner:OTHER,bytes:new TextEncoder().encode(html('v1')),provenance:{}});
 assert.equal((await draft(f,{buildId})).error.code,'BUILD_NOT_FOUND');
 assert.equal((await draft(f,{id:d.id,bytes:html('v2')})).error.code,'DRAFT_CHANGED');
 assert.equal((await f.publish({bytes:html('v2'),extra:skip(d)})).error.code,'DRAFT_CHANGED');
 assert.equal((await f.publish({extra:{...skip(d),coverChoice:'candidate',coverCaptureId:randomUUID()}})).error.code,'DRAFT_CHANGED');
 assert.equal(f.count('ft_works'),0);
});
test('selected cover and video are in the first public row, survive cleanup, and never reserve twice',async t=>{
 const f=fixture(t,{prepublish:true,externalCover:true,autoPreview:true}),s=service(f),d=await draft(f);
 const c=await capture(f,s,d),v=await capture(f,s,d,'video');
 const extra={draftId:d.id,coverChoice:'candidate',coverCaptureId:c.id,videoChoice:'candidate',videoCaptureId:v.id},key=randomUUID();
 f.faults.afterCommit=true;
 const result=await f.publish({extra,key});assert.equal(result.status,201,JSON.stringify(result));assert.ok(result.work.coverUrl);
 const replay=await f.publish({extra,key});assert.equal(replay.work.id,result.work.id);assert.equal(f.count('ft_works'),1);
 assert.equal(f.count('ft_publish_captures'),2);assert.equal(f.count('ft_video_preview_attempts'),0);assert.equal(f.count('ft_cover_review_attempts'),0);
 const job=f.database.prepare('SELECT * FROM ft_video_preview_jobs').get();assert.equal(job.status,'ready');assert.ok(!job.object_key.startsWith('publish-drafts/'));
 const version=f.database.prepare('SELECT * FROM ft_work_versions').get();assert.deepEqual(f.objects.get(version.cover_key),jpeg);
 await service(f,{now:()=>new Date(Date.now()+86400001)}).cleanup();
 assert.deepEqual(f.objects.get(version.cover_key),jpeg);assert.deepEqual(f.objects.get(job.object_key),mp4);assert.ok(f.objects.get(version.game_key));
 assert.equal([...f.objects.keys()].filter(k=>k.startsWith('publish-drafts/')).length,0);assert.equal(f.count('ft_publish_captures'),2);
 assert.equal((await f.publish({extra,key})).work.id,result.work.id);
});
test('capture replay and global legacy concurrency reserve only once, failures remain recoverable',async t=>{
 const f=fixture(t),d=await draft(f);let finish,calls=0;
 const s=service(f,{captureCover:async()=>{calls++;return new Promise(r=>finish=()=>r({bytes:jpeg,mime:'image/jpeg'}));}}),id=randomUUID();
 const pending=capture(f,s,d,'cover',id);while(!finish)await new Promise(r=>setTimeout(r,0));
 assert.equal((await capture(f,s,d,'cover',id)).status,'running');
 await assert.rejects(()=>capture(f,s,d,'video'),e=>e.code==='CAPTURE_BUSY');
 const legacy=createCoverDraftService({db:()=>f.db,bucket:()=>f.bucket,configured:()=>true,bodyJSON:r=>r.json(),capture:async()=>{throw Error('must not capture');}});
 await assert.rejects(()=>legacy.handle(f.request('/api/cover-drafts',{method:'POST',body:{id:randomUUID(),url:'https://example.com/',waitMs:5000}}),{id:OWNER}),e=>e.status===429);
 finish();await pending;assert.equal((await capture(f,s,d,'cover',id)).status,'ready');assert.equal(calls,1);
 assert.equal((await capture(f,service(f,{captureVideo:async()=>{throw Object.assign(Error(),{code:'CAPTURE_TIMEOUT'});}}),d,'video')).status,'failed');
 assert.equal((await capture(f,service(f),d,'video')).status,'ready');
});
test('legacy reservations count toward new budgets and expired leases discard late pixels',async t=>{
 const f=fixture(t),d=await draft(f),limits={...COVER_REVIEW_LIMITS,dailySeconds:100,monthlySeconds:100};
 const legacy=createCoverDraftService({db:()=>f.db,bucket:()=>f.bucket,configured:()=>true,bodyJSON:r=>r.json(),capture:async()=>({bytes:jpeg,mime:'image/jpeg'}),limits});
 await legacy.handle(f.request('/api/cover-drafts',{method:'POST',body:{id:randomUUID(),url:'https://example.com/',waitMs:5000}}),{id:OWNER});
 await assert.rejects(()=>capture(f,service(f,{coverLimits:limits}),d),e=>e.code==='CAPTURE_LIMIT');
 let clock=new Date();const s=service(f,{now:()=>clock,captureVideo:async()=>{clock=new Date(clock.getTime()+46000);return {bytes:mp4,mime:'video/mp4',durationMs:7944};}});
 assert.equal((await capture(f,s,d,'video')).status,'failed');assert.equal([...f.objects.keys()].filter(k=>k.endsWith('.mp4')).length,0);
});
test('manual cover, range requests, rollback and URL video constraints',async t=>{
 const f=fixture(t,{prepublish:true}),d=await draft(f),s=service(f),v=await capture(f,s,d,'video');
 const r=await handleAPI(f.request(v.url,{extraHeaders:{Range:'bytes=4-7'}}));assert.equal(r.status,206);assert.equal(await r.text(),'ftyp');
 f.faults.beforeCommit=true;assert.equal((await f.publish({cover:true,extra:{...skip(d),coverChoice:'manual'}})).status,500);assert.equal(f.count('ft_works'),0);
 assert.equal((await f.publish({cover:true,extra:{...skip(d),coverChoice:'manual'}})).status,201);
 const u=await draft(f,{source:'url'});await assert.rejects(()=>capture(f,s,u,'video'),e=>e.code==='VIDEO_UNSUPPORTED');
 assert.equal(f.count('ft_play_sessions'),0);assert.equal(f.count('ft_events'),0);
});

test('damaged temporary media cannot become a public permanent resource',async t=>{
 const f=fixture(t,{prepublish:true}),d=await draft(f),c=await capture(f,service(f),d);
 const row=f.database.prepare('SELECT object_key FROM ft_publish_captures WHERE id=?').get(c.id);f.objects.set(row.object_key,new Uint8Array([1]));
 assert.equal((await f.publish({extra:{...skip(d),coverChoice:'candidate',coverCaptureId:c.id}})).error.code,'DRAFT_CHANGED');assert.equal(f.count('ft_works'),0);
});

test('interrupted capture lease reports a retryable timeout without spending another attempt',async t=>{
 const f=fixture(t),d=await draft(f);let finish,clock=new Date();
 const s=service(f,{now:()=>clock,captureCover:async()=>new Promise(resolve=>finish=()=>resolve({bytes:jpeg,mime:'image/jpeg'}))}),id=randomUUID();
 const pending=capture(f,s,d,'cover',id);while(!finish)await new Promise(r=>setTimeout(r,0));
 clock=new Date(clock.getTime()+46000);
 const replay=await capture(f,s,d,'cover',id);assert.equal(replay.status,'failed');assert.equal(replay.reason,'CAPTURE_TIMEOUT');assert.equal(f.count('ft_publish_captures'),1);
 finish();assert.equal((await pending).status,'failed');
 assert.equal((await capture(f,service(f),d)).status,'ready');
});
