import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,OWNER,OTHER,handleAPI} from './helpers/router-fixture.mjs';
import {createCoverDraftService} from '../lib/funtrack/cover-draft-service.mjs';
import {createCoverReviewService,COVER_REVIEW_LIMITS} from '../lib/funtrack/cover-review-service.mjs';
const jpeg=new Uint8Array([255,216,255,224,1,2,3]);
const service=(f,extra={})=>createCoverDraftService({db:()=>f.db,bucket:()=>f.bucket,configured:()=>true,bodyJSON:r=>r.json(),capture:async()=>({bytes:jpeg,mime:'image/jpeg'}),...extra});
const input=()=>({id:randomUUID(),url:'https://bingosun.vercel.app/',waitMs:5000});
const send=(f,s,body,owner=OWNER)=>s.handle(f.request('/api/cover-drafts',{method:'POST',body,owner}),{id:owner});
test('prepublication capture starts immediately, stays private and publishes only as the selected uploaded cover',async t=>{
 const f=fixture(t,{externalCover:true}),s=service(f),body=input();
 const draft=await (await send(f,s,body)).json();assert.equal(draft.status,'candidate');assert.equal(f.count('ft_works'),0);
 const image=await s.handle(f.request(draft.imageUrl),{id:OWNER});assert.equal(image.headers.get('cache-control'),'private, no-store');assert.deepEqual(new Uint8Array(await image.arrayBuffer()),jpeg);
 await assert.rejects(()=>s.handle(f.request(draft.imageUrl,{owner:OTHER}),{id:OTHER}),e=>e.status===404);
 assert.equal((await handleAPI(new Request('https://site.test'+draft.imageUrl))).status,401);
 const {work}=await f.publish({source:'url',url:body.url,extra:{cover:new File([jpeg],'selected.jpg',{type:'image/jpeg'})}});
 assert.ok(work.coverUrl);assert.equal(f.count('ft_cover_review_jobs'),0);assert.equal(f.count('ft_play_sessions'),0);
});
test('same request concurrently or after a lost response never spends twice; ownership and URL cannot change',async t=>{
 const f=fixture(t),body=input();let finish,calls=0;
 const s=service(f,{capture:async()=>{calls++;return new Promise(r=>finish=()=>r({bytes:jpeg,mime:'image/jpeg'}));}});
 const first=send(f,s,body);while(!finish)await new Promise(r=>setTimeout(r,0));
 assert.equal((await (await send(f,s,body)).json()).status,'running');finish();await first;
 assert.equal((await (await send(f,s,body)).json()).status,'candidate');assert.equal(calls,1);
 await assert.rejects(()=>send(f,s,body,OTHER),e=>e.status===409);
 await assert.rejects(()=>send(f,s,{...body,url:'https://example.com/'}),e=>e.status===409);
 assert.equal(f.count('ft_cover_drafts'),1);
});
test('drafts and published cover jobs share the same budget in both directions; expiry removes only temporary objects',async t=>{
 const f=fixture(t,{externalCover:true}),limits={...COVER_REVIEW_LIMITS,dailySeconds:100,monthlySeconds:100},s=service(f,{limits});
 await send(f,s,input());await assert.rejects(()=>send(f,s,input()),e=>e.code==='CAPTURE_LIMIT');
 const {work}=await f.publish({source:'url',url:'https://example.com/'});
 const review=createCoverReviewService({db:()=>f.db,bucket:()=>f.bucket,configured:()=>true,capture:async()=>{throw Error('Budget must prevent capture');},limits});
 assert.equal((await review.processPending()).processed,false);assert.equal((await review.status(f.readWork(work.id))).reason,'MONTHLY_BUDGET');
 const row=f.database.prepare('SELECT * FROM ft_cover_drafts').get();assert.ok(await f.bucket.get(row.object_key));
 await service(f,{now:()=>new Date(Date.now()+86400001)}).cleanup();assert.equal(await f.bucket.get(row.object_key),null);assert.equal(f.count('ft_cover_drafts'),1);
 const g=fixture(t,{externalCover:true});await g.publish({source:'url',url:'https://example.com/'});
 await createCoverReviewService({db:()=>g.db,bucket:()=>g.bucket,configured:()=>true,capture:async()=>({bytes:jpeg,mime:'image/jpeg'}),limits}).processPending();
 await assert.rejects(()=>send(g,service(g,{limits}),input()),e=>e.code==='CAPTURE_LIMIT');
});
test('reject unsafe URLs before capture, bound attempts, and preserve failure status for recovery',async t=>{
 const f=fixture(t),s=service(f,{capture:async()=>{throw Object.assign(Error('timeout'),{code:'CAPTURE_TIMEOUT'});}});
 for(const url of ['http://example.com','https://127.0.0.1','https://x.local','https://me:password@example.com'])await assert.rejects(()=>send(f,s,{...input(),url}),e=>e.status===422);
 for(let n=0;n<3;n++)assert.equal((await (await send(f,s,input())).json()).status,'failed');
 await assert.rejects(()=>send(f,s,input()),e=>e.code==='CAPTURE_LIMIT');assert.equal(f.count('ft_cover_drafts'),3);
});
