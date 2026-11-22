import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,OWNER,OTHER,REVIEWER,handleAPI,gameResponse,mediaResponse,publicCardPageResponse} from './helpers/router-fixture.mjs';
import {readAnalytics} from '../lib/funtrack/analytics-query.mjs';
const setup=(t,extra={})=>fixture(t,{moderators:REVIEWER,...extra});
const endpoint=(kind,id)=>`/api/moderation/${kind}/${id}`;
const inspect=(f,kind,id)=>f.api(endpoint(kind,id),{owner:REVIEWER});
const change=(f,kind,id,{action='block',revision=0,key=randomUUID(),owner=REVIEWER,reason='Verified test complaint',extraHeaders}={})=>f.api(endpoint(kind,id),{method:'POST',owner,key,extraHeaders,body:{action,reason,expectedRevision:revision}});
const card=async(f,work)=>(await f.api('/api/cards',{method:'POST',body:{name:'Original card',template:'wall',workIds:[work.id]}})).card;
const publicGet=path=>handleAPI(new Request('https://site.test'+path));
const checked=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r));return r;};

test('moderation is disabled by default, requires an exact allowed identity, CSRF and matching account',async t=>{
 let f=fixture(t),w=f.seed();assert.equal((await change(f,'work',w.id)).status,403);
 f=setup(t);w=f.seed();
 for(const owner of [OWNER,OTHER,REVIEWER+'-suffix'])assert.equal((await change(f,'work',w.id,{owner})).status,403);
 for(const extraHeaders of [{Origin:'https://evil.test'},{'X-Funtrack-CSRF':''},{'X-Funtrack-Expected-User':OTHER}])assert([403,409].includes((await change(f,'work',w.id,{extraHeaders})).status));
 assert.equal((await publicGet(endpoint('work',w.id))).status,401);
 for(const reason of ['', 'x'.repeat(1001)])assert.equal((await change(f,'work',w.id,{reason})).status,422);
 assert.equal(f.count('ft_moderation_actions'),0);
 checked(await change(f,'work',w.id));assert.equal((await inspect(f,'work',w.id)).blocked,true);
});

test('a work block closes current and old game/media/card/share/Feed paths, restoration preserves all snapshots and objects',async t=>{
 const f=setup(t),{work}=checked(await f.publish({cover:true}),201),saved=await card(f,work);
 checked(await f.api(`/api/cards/${saved.id}/discovery`,{method:'POST',body:{listed:true,expectedRevision:0}}));
 checked(await f.version(work.id,{cover:true}),201);const updated=checked(await f.get(work.id)).work;
 const before={snapshot:f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(saved.id).snapshot_json,objects:[...f.objects.entries()],versions:f.database.prepare('SELECT * FROM ft_work_versions').all()};
 const request=f.request('/');
 const reads=[
  ()=>f.api('/api/works/'+work.id),()=>f.api('/api/works/'+work.id+'/versions'),()=>f.api('/api/cards/'+saved.id),()=>f.api('/api/cards/me'),
  ()=>mediaResponse(request,work.versionId),()=>mediaResponse(request,work.metadataId),()=>mediaResponse(request,updated.versionId),
  ()=>gameResponse(request,work.versionId),()=>gameResponse(request,updated.versionId),
  ()=>publicGet('/api/public/cards/'+saved.id),()=>publicGet(`/api/public/cards/${saved.id}/works/${work.id}/cover`),
  ()=>publicGet(`/api/public/works/${work.id}/cover`),()=>publicGet(`/api/public/discover/cards/${saved.id}/works/${work.id}/cover`),
  ()=>publicCardPageResponse(new Request('https://site.test/c/'+saved.id),saved.id),
 ];
 for(const read of reads)checked(await read());
 checked(await change(f,'work',work.id));assert.equal((await inspect(f,'work',work.id)).affectedCards,1);
 for(const read of reads)checked(await read(),404);
 const feed=await (await publicGet('/api/public/discover?type=all')).json();assert.equal(feed.items.length,0);
 assert.equal((await f.api('/api/works?mine=1&state=all')).works.length,0);
 assert.equal((await f.api('/api/cards')).cards.length,0);
 assert.equal((await f.api('/api/creators/'+OWNER)).card,null);
 for(const method of ['GET','HEAD']){
  const response=await handleAPI(new Request(`https://site.test/api/public/cards/${saved.id}/works/${work.id}/cover`,{method}));assert.equal(response.status,404);assert.equal(response.headers.get('Cache-Control'),'no-store');
 }
 checked(await change(f,'work',work.id,{action:'restore',revision:1}));
 for(const read of reads)checked(await read());
 assert.equal((await mediaResponse(request,work.versionId)).headers.get('Cache-Control'),'no-store');
 assert.equal(f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(saved.id).snapshot_json,before.snapshot);
 assert.deepEqual([...f.objects.entries()],before.objects);assert.deepEqual(f.database.prepare('SELECT * FROM ft_work_versions').all(),before.versions);
});

test('card decisions compose with inherited work blocks and never fall back to an older card',async t=>{
 const f=setup(t),{work}=checked(await f.publish(),201),old=await card(f,work),saved=await card(f,work);
 checked(await change(f,'card',saved.id));checked(await f.api('/api/cards/'+saved.id),404);checked(await f.api('/api/cards/'+old.id));checked(await f.get(work.id));
 assert.equal((await f.api('/api/creators/'+OWNER)).card,null);assert.equal((await f.api('/api/cards')).cards.length,0);
 checked(await change(f,'work',work.id));checked(await change(f,'card',saved.id,{action:'restore',revision:1}));
 assert.deepEqual((await inspect(f,'card',saved.id)).inheritedWorkBlocks,[work.id]);checked(await f.api('/api/cards/'+saved.id),404);
 checked(await change(f,'work',work.id,{action:'restore',revision:1}));checked(await f.api('/api/cards/'+saved.id));
 checked(await f.api('/api/cards/'+saved.id+'/delete',{method:'POST'}));checked(await change(f,'card',saved.id,{revision:2}));checked(await change(f,'card',saved.id,{action:'restore',revision:3}));
 checked(await f.api('/api/cards/'+saved.id),404);assert.equal((await f.api('/api/creators/'+OWNER)).card,null);
});

test('atomic moderation CAS, stable replay, payload conflicts and late stale retries cannot undo newer decisions',async t=>{
 const f=setup(t),w=f.seed(),keys=[randomUUID(),randomUUID()];
 const results=await Promise.all(keys.map(key=>change(f,'work',w.id,{key})));assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
 const key=keys[results.findIndex(r=>r.status===200)];checked(await change(f,'work',w.id,{key}));
 assert.equal((await change(f,'work',w.id,{key,reason:'Changed reason'})).error.code,'IDEMPOTENCY_CONFLICT');
 checked(await change(f,'work',w.id,{action:'restore',revision:1}));const replay=checked(await change(f,'work',w.id,{key}));assert.equal(replay.blocked,false);assert.equal(replay.receipt.revision,1);
 assert.equal(f.count('ft_moderation_actions'),2);
 assert.throws(()=>f.database.exec('DELETE FROM ft_moderation_actions'),/MODERATION_AUDIT_IMMUTABLE/);
 assert.throws(()=>f.database.exec("UPDATE ft_moderation_actions SET reason='changed'"),/MODERATION_AUDIT_IMMUTABLE/);
});

test('blocked work cannot accept stale sessions, snapshot writes or expose comments, notifications and analytics',async t=>{
 const f=setup(t),{work}=checked(await f.publish(),201),saved=await card(f,work);
 const s=checked(await f.api('/api/sessions',{method:'POST',body:{workId:work.id,versionId:work.versionId}}),201);
 const comment=checked(await f.api(`/api/works/${work.id}/comments`,{method:'POST',owner:OTHER,body:{body:'Do not leak comment'}}),201).comment;
 checked(await change(f,'work',work.id));
 for(const url of [`/api/comments/${comment.id}/context`,`/api/comments/${comment.id}/replies`,`/api/works/${work.id}/auto-preview`,`/api/works/${work.id}/cover-review`])checked(await f.api(url),404);
 assert.equal((await f.api('/api/comments?mine=1')).comments.length,0);
 const inbox=checked(await f.api('/api/notifications?expectedRecipientId='+OWNER));assert(inbox.items.every(item=>!item.available&&item.body===null&&item.workName===null));
 checked(await f.api('/api/sessions/'+s.id+'/events',{method:'POST',body:{token:s.token,events:[{id:randomUUID(),type:'play_start',seq:1,elapsedMs:0}]}}),404);
 checked(await f.api('/api/cards',{method:'POST',body:{name:'New card',template:'wall',workIds:[work.id]}}),404);
 assert.throws(()=>f.database.prepare('INSERT INTO ft_cards(id,author_id,snapshot_json,created_at) VALUES(?,?,?,?)').run(randomUUID(),OWNER,JSON.stringify(saved),new Date().toISOString()),/CONTENT_UNAVAILABLE/);
 const analytics=await readAnalytics(new URL('https://site.test/api/analytics'),{id:OWNER},f.db);assert.equal(JSON.stringify(analytics).includes('Do not leak comment'),false);assert.equal(JSON.stringify(analytics).includes(work.name),false);
});

test('restoring moderation does not override author archive or Feed visibility',async t=>{
 const f=setup(t),{work}=checked(await f.publish(),201);
 checked(await f.api(`/api/works/${work.id}/archive`,{method:'POST',body:{action:'archive',expectedRevision:1}}));
 checked(await change(f,'work',work.id));checked(await change(f,'work',work.id,{action:'restore',revision:1}));
 const current=checked(await f.get(work.id)).work;assert(current.archivedAt);assert.equal(current.discovery.visibility,'unlisted');assert.deepEqual(await f.feed(),[]);
});

test('lost audit-write acknowledgements replay the committed decision without duplicating it',async t=>{
 const f=setup(t),w=f.seed(),key=randomUUID(),prepare=f.db.prepare.bind(f.db);let lost=false;
 f.db.prepare=query=>{const s=prepare(query);if(query.startsWith('INSERT OR IGNORE INTO ft_moderation_actions')){const run=s.run.bind(s);s.run=async()=>{const result=await run();if(!lost){lost=true;throw Error('Response lost after commit');}return result;};}return s;};
 const result=checked(await change(f,'work',w.id,{key}));assert.equal(result.blocked,true);assert.equal(f.count('ft_moderation_actions'),1);checked(await change(f,'work',w.id,{key}));assert.equal(f.count('ft_moderation_actions'),1);
});

test('ready video URLs and publication/card receipts cannot bypass a later block',async t=>{
 const f=setup(t,{autoPreview:true}),key=randomUUID(),publication={key,cover:true},published=checked(await f.publish(publication),201),work=published.work;
 const cardKey=randomUUID(),body={name:'Saved card',template:'wall',workIds:[work.id]},saved=checked(await f.api('/api/cards',{method:'POST',key:cardKey,body}),201).card;
 const preview=f.database.prepare('SELECT id FROM ft_video_preview_jobs WHERE work_id=?').get(work.id).id,object='previews/'+preview+'.mp4';
 f.objects.set(object,new TextEncoder().encode('synthetic video'));
 f.database.prepare("UPDATE ft_video_preview_jobs SET status='ready',attempts=1,object_key=?,byte_size=15,duration_ms=8000 WHERE id=?").run(object,preview);
 const publicPath=`/api/public/works/${work.id}/preview/${preview}`,privatePath=`/api/works/${work.id}/preview/${preview}`;
 checked(await publicGet(publicPath));checked(await handleAPI(f.request(privatePath)));
 checked(await change(f,'work',work.id));
 checked(await publicGet(publicPath),404);checked(await handleAPI(f.request(privatePath)),404);
 checked(await f.publish(publication),404);checked(await f.publish({...publication,key:randomUUID()}),404);checked(await f.api('/api/cards',{method:'POST',key:cardKey,body}),404);checked(await f.api('/api/cards/'+saved.id),404);
 checked(await change(f,'work',work.id,{action:'restore',revision:1}));checked(await publicGet(publicPath));
});
