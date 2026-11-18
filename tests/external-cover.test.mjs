import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,OWNER,OTHER,handleAPI} from './helpers/router-fixture.mjs';
import {createCoverReviewService,COVER_REVIEW_LIMITS} from '../lib/funtrack/cover-review-service.mjs';
import {externalURL,publicAddress,createCaptureNetwork} from '../lib/funtrack/external-cover-network.mjs';
const jpeg=new Uint8Array([255,216,255,224,1,2,3]),captured=()=>({bytes:jpeg,mime:'image/jpeg'});
const service=(f,options={})=>createCoverReviewService({db:()=>f.db,bucket:()=>f.bucket,configured:()=>true,capture:async()=>captured(),...options});
const publish=f=>f.publish({source:'url',url:'https://bingosun.vercel.app/'});
const path=work=>'/api/works/'+work.id+'/cover-review';
const state=(f,work)=>f.api(path(work));
const action=(f,work,action,extra={})=>f.api(path(work),{method:'POST',body:{action,versionId:work.versionId,expectedRevision:work.revision,...extra}});

test('external publication queues one private candidate; only explicit acceptance updates immutable metadata',async t=>{
 const f=fixture(t,{externalCover:true}),{work}=await publish(f),s=service(f);
 assert.equal((await state(f,work)).status,'queued');assert.equal(f.count('ft_auto_cover_jobs'),0);
 const card=await f.api('/api/cards',{method:'POST',body:{name:'Test',bio:'',template:'wall',workIds:[work.id]}});assert.equal(card.status,201);
 const old=f.database.prepare('SELECT snapshot_json FROM ft_cards').get();
 await action(f,work,'generate');assert.equal(f.count('ft_cover_review_jobs'),1);
 assert.equal((await s.processPending()).status,'candidate');const candidate=await state(f,work);
 assert.equal((await f.get(work.id)).work.coverUrl,'');assert.equal(f.count('ft_work_metadata'),1);
 const image=await handleAPI(f.request(candidate.candidateUrl));assert.equal(image.status,200);assert.equal(image.headers.get('cache-control'),'private, no-store');
 const accepted=await action(f,work,'accept',{candidateId:candidate.candidateId});assert.equal(accepted.status,'accepted');
 assert.equal(accepted.revision,work.revision+1);assert.match(accepted.coverUrl,/^\/media\//);
 assert.deepEqual(f.database.prepare('SELECT snapshot_json FROM ft_cards').get(),old);
 assert.equal((await action(f,work,'accept',{candidateId:candidate.candidateId})).status,'accepted','lost response replay is idempotent');assert.equal(f.count('ft_work_metadata'),2);
 for(const table of ['ft_events','ft_play_sessions','ft_feed_impressions'])assert.equal(f.count(table),0);
});

test('candidate image, actions and status are owner-only and no client-supplied URL can be captured',async t=>{
 const f=fixture(t,{externalCover:true}),{work}=await publish(f);await service(f).processPending();const candidate=await state(f,work);
 assert.equal((await f.api(path(work),{owner:OTHER})).status,403);
 assert.equal((await handleAPI(f.request(candidate.candidateUrl,{owner:OTHER}))).status,403);
 assert.equal((await action(f,work,'accept',{candidateId:'wrong'})).status,409);
 assert.equal((await action(f,work,'generate',{url:'https://evil.example.org/'})).status,422);
 assert.equal((await action(f,work,'retake',{waitMs:900000})).status,422);
 assert.equal((await action(f,{...work,versionId:'stale'},'generate')).status,409);
});

test('manual cover and text edits invalidate in-flight candidates without being overwritten',async t=>{
 const f=fixture(t,{externalCover:true}),{work}=await publish(f);
 const s=service(f,{capture:async()=>{
  const form=new FormData();form.set('name','Manual name');form.set('desc',work.desc);form.set('expectedRevision',work.revision);form.set('cover',new File([jpeg],'cover.jpg',{type:'image/jpeg'}));
  assert.equal((await f.api('/api/works/'+work.id,{method:'PATCH',body:form})).status,200);return captured();
 }});
 await s.processPending();const candidate=await state(f,work);assert.equal(candidate.status,'stale');assert.equal(candidate.candidateUrl,undefined);
 assert.equal((await action(f,work,'accept',{candidateId:candidate.candidateId})).status,409);
 const latest=(await f.get(work.id)).work;assert.equal(latest.name,'Manual name');assert.equal(latest.revision,2);assert.equal(f.count('ft_work_metadata'),2);
});

test('accepted cover stays visible while retaking; old candidate tokens cannot approve a replacement',async t=>{
 const f=fixture(t,{externalCover:true}),{work}=await publish(f),s=service(f);await s.processPending();const first=await state(f,work);
 await action(f,work,'accept',{candidateId:first.candidateId});const latest=(await f.get(work.id)).work;
 assert.equal((await action(f,latest,'retake',{candidateId:first.candidateId,waitMs:10000})).status,'queued');
 const oldCover=latest.coverUrl;await s.processPending();const second=await state(f,latest);
 assert.notEqual(second.candidateId,first.candidateId);assert.equal((await f.get(work.id)).work.coverUrl,oldCover);
 assert.equal((await action(f,latest,'accept',{candidateId:first.candidateId})).status,409);
 assert.equal((await action(f,latest,'accept',{candidateId:second.candidateId})).status,'accepted');
 assert.equal(f.objects.size,2,'accepted historical assets are kept');
});

test('manual upload skips automatic enqueue; legacy external work can explicitly capture',async t=>{
 const f=fixture(t,{externalCover:true});await f.publish({source:'url',url:'https://example.org',cover:true});assert.equal(f.count('ft_cover_review_jobs'),0);
 const legacy=f.seed({source:'url',url:'https://example.org'}),work=(await f.get(legacy.id)).work;
 assert.equal((await action(f,work,'generate')).status,'queued');
 const disabled=fixture(t),result=await publish(disabled);assert.equal(result.status,201);assert.equal(disabled.count('ft_cover_review_jobs'),0);
 const old=fixture(t,{externalCover:true});old.database.exec('DROP TABLE ft_cover_review_attempts; DROP TABLE ft_cover_review_jobs;');assert.equal((await publish(old)).status,201,'migration lag cannot break publication');
});

test('bounded retries, budget reservation and concurrent leases prevent unbounded capture',async t=>{
 const f=fixture(t,{externalCover:true}),{work}=await publish(f);let calls=0;
 const s=service(f,{capture:async()=>{calls++;throw Object.assign(new Error('timeout'),{code:'CAPTURE_TIMEOUT'});}});
 await Promise.all([s.processPending(),s.processPending()]);assert.equal(calls,1);
 for(let n=1;n<3;n++){await action(f,work,'retake');await s.processPending();}
 assert.equal(calls,3);assert.equal((await state(f,work)).retryable,false);await action(f,work,'retake');assert.equal((await s.processPending()).processed,false);
 const f2=fixture(t,{externalCover:true});await publish(f2);const budget=service(f2,{limits:{...COVER_REVIEW_LIMITS,dailySeconds:0}});
 assert.equal((await budget.processPending()).processed,false);assert.equal(f2.count('ft_cover_review_attempts'),0);
});

test('uncertain acceptance commits once and races roll back metadata atomically',async t=>{
 const f=fixture(t,{externalCover:true}),{work}=await publish(f);await service(f).processPending();const candidate=await state(f,work);
 f.faults.afterCommit=true;assert.equal((await action(f,work,'accept',{candidateId:candidate.candidateId})).status,'accepted');assert.equal(f.count('ft_work_metadata'),2);
 const f2=fixture(t,{externalCover:true}),w=(await publish(f2)).work;await service(f2).processPending();const c=await state(f2,w);
 const original=f2.db.batch;let raced=false;
 f2.db.batch=async statements=>{if(!raced){raced=true;f2.database.prepare("UPDATE ft_cover_review_jobs SET status='queued' WHERE work_id=?").run(w.id);}return original(statements);};
 assert.equal((await action(f2,w,'accept',{candidateId:c.candidateId})).status,409);assert.equal(f2.count('ft_work_metadata'),1);assert.equal((await f2.get(w.id)).work.coverUrl,'');
});

test('unsafe URL forms and non-public addresses are rejected',()=>{
 for(const url of ['http://example.com','https://user:pass@example.com','https://localhost/','https://127.0.0.1','https://2130706433','https://0x7f000001','https://[::1]','https://service.local/','https://a.internal/','https://example.com:8443','file:///tmp/a'])assert.throws(()=>externalURL(url),{code:'UNSAFE_URL'},url);
 assert.equal(externalURL('https://bingosun.vercel.app/').hostname,'bingosun.vercel.app');
 for(const ip of ['127.0.0.1','10.1.2.3','172.16.1.1','169.254.169.254','100.64.1.1','192.168.1.1','198.18.1.1','::1','fc00::1','::ffff:127.0.0.1','2001:db8::1','2002:7f00:1::','3fff::1'])assert.equal(publicAddress(ip),false,ip);
 for(const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888'])assert.equal(publicAddress(ip),true,ip);
});

function netFetcher({privateDNS=false,redirect=false,large=false}={}){
 const calls=[];const fetcher=async(value,options)=>{
  const url=new URL(value);calls.push({url:url.href,options});
  if(url.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:url.searchParams.get('type')==='A'?[{type:1,data:privateDNS?'127.0.0.1':'8.8.8.8'}]:[]});
  return redirect?new Response(null,{status:302,headers:{location:'http://169.254.169.254/latest/meta-data'}}):new Response(large?'x'.repeat(101):'hello',{headers:{'Content-Type':'text/html','Set-Cookie':'never=forward'}});
 };return {calls,fetcher};
}
test('network gate rejects private DNS and unsafe redirects, strips credentials and caps resources',async()=>{
 let f=netFetcher({privateDNS:true}),net=createCaptureNetwork({fetcher:f.fetcher});await assert.rejects(net.resource('https://example.com'),{code:'UNSAFE_URL'});assert.equal(f.calls.length,2,'no origin fetch');
 f=netFetcher({redirect:true});await assert.rejects(createCaptureNetwork({fetcher:f.fetcher}).resource('https://example.com'),{code:'UNSAFE_URL'});
 f=netFetcher();net=createCaptureNetwork({fetcher:f.fetcher,maxRequests:1});const result=await net.resource('https://example.com');assert.equal(result.headers['Set-Cookie'],undefined);assert.equal(f.calls.at(-1).options.redirect,'manual');assert.equal(f.calls.at(-1).options.credentials,'omit');assert.equal(f.calls.at(-1).options.headers.Cookie,undefined);await assert.rejects(net.resource('https://example.com'),{code:'RESOURCE_LIMIT'});
 f=netFetcher({large:true});await assert.rejects(createCaptureNetwork({fetcher:f.fetcher,maxBytes:100}).resource('https://example.com'),{code:'RESOURCE_LIMIT'});
});

test('HTML and imported hosted artifacts share candidate review and disable legacy automatic application',async t=>{
 const f=fixture(t,{externalCover:true,autoCover:true}),{work}=await f.publish();
 assert.equal(f.count('ft_auto_cover_jobs'),0);assert.equal((await state(f,work)).status,'queued');
 let source;const s=service(f,{capture:async(html,options)=>{assert.match(html,/<button>/);source=options.source;return captured();}});await s.processPending();
 assert.equal(source,'html');assert.equal((await f.get(work.id)).work.coverUrl,'');
 const candidate=await state(f,work);assert.equal((await action(f,work,'accept',{candidateId:candidate.candidateId})).status,'accepted');
});
