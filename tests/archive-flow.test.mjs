import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,OWNER,OTHER,html,gameResponse} from './helpers/router-fixture.mjs';

const archive=(f,work,action='archive',extra={})=>f.api('/api/works/'+work.id+'/archive',{method:'POST',body:{action,expectedRevision:work.revision,...extra}});
const edit=(f,work,{key=randomUUID(),revision=work.revision}={})=>{
  const body=new FormData();body.set('name','Edited title');body.set('desc','Edited description');body.set('expectedRevision',String(revision));
  return f.api('/api/works/'+work.id,{method:'PATCH',key,body});
};
const cardInput=work=>({name:'Creator',bio:'Original card',template:'editorial',workIds:[work.id],workRefs:[{workId:work.id,versionId:work.versionId,metadataId:work.metadataId}]});
const tables=['ft_work_versions','ft_work_metadata','ft_version_operations','ft_work_edit_operations','ft_work_fingerprints','ft_cards','ft_events','ft_feedback'];
const snapshot=f=>tables.map(table=>f.database.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());

test('archive removes only active/public membership; direct links, versions, cards, files and history survive',async t=>{
  const f=fixture(t),{work}=await f.publish({cover:true}),input=cardInput(work);
  const saved=await f.api('/api/cards',{method:'POST',body:input});assert.equal(saved.status,201);
  assert.equal((await f.api('/api/events',{method:'POST',owner:OTHER,body:{eventId:randomUUID(),type:'work_view',workId:work.id,versionId:work.versionId}})).status,200);
  assert.equal((await f.api('/api/feedback',{method:'POST',owner:OTHER,body:{eventId:randomUUID(),workId:work.id,versionId:work.versionId,type:'建议',text:'Original feedback'}})).status,201);
  const immutable=snapshot(f),objects=[...f.objects].map(([key,bytes])=>[key,bytes.slice()]);
  const hidden=await archive(f,work);assert.equal(hidden.status,200,JSON.stringify(hidden));
  assert(hidden.work.archivedAt);assert.equal(hidden.work.revision,work.revision+1);assert.equal(hidden.work.discovery.visibility,'unlisted');assert.equal(hidden.work.discovery.eligible,false);assert.equal(hidden.work.discovery.revision,work.discovery.revision+1);
  assert.equal((await f.api('/api/works?mine=1')).total,0);
  assert.deepEqual((await f.api('/api/works?mine=1&state=archived')).works.map(w=>w.id),[work.id]);
  assert.deepEqual((await f.api('/api/works?mine=1&state=all')).works.map(w=>w.id),[work.id]);
  assert.deepEqual(await f.feed(),[]);assert.deepEqual((await f.api('/api/works')).works,[]);assert.deepEqual((await f.api('/api/discover?author='+OWNER)).works,[]);
  assert.equal((await f.api('/api/works/'+work.id,{owner:OTHER})).status,200);
  const history=await f.api('/api/works/'+work.id+'/versions');assert.equal(history.status,200);assert.equal(history.versions[0].id,work.versionId);
  assert.deepEqual((await f.api('/api/cards/'+saved.card.id)).card,saved.card);
  const playable=await gameResponse(f.request('/game/'+work.versionId,{owner:OTHER}),work.versionId);assert.equal(playable.status,200);assert((await playable.text()).includes(html('v1')));
  const media=await f.api('/api/works/'+work.id);assert.equal(media.work.coverUrl,work.coverUrl);
  assert.deepEqual(snapshot(f),immutable);assert.deepEqual([...f.objects],objects);assert.deepEqual(f.deleted,[]);
});

test('restore remains hidden, increments revisions once and invalidates stale Feed restore forms',async t=>{
  const f=fixture(t),{work}=await f.publish();
  const first=await archive(f,work),same=await archive(f,work);assert.equal(same.status,200);assert.equal(same.work.revision,first.work.revision);
  const forbidden=await f.discovery(work.id,'restore');assert.equal(forbidden.status,409);assert.equal(forbidden.error.code,'WORK_ARCHIVED');
  assert.throws(()=>f.database.prepare("UPDATE ft_work_discovery SET visibility='listed' WHERE work_id=?").run(work.id),/WORK_ARCHIVED/);
  const restored=await archive(f,first.work,'restore');assert.equal(restored.status,200);assert.equal(restored.work.archivedAt,null);assert.equal(restored.work.revision,first.work.revision+1);
  assert.equal(restored.work.discovery.visibility,'unlisted');assert.equal(restored.work.discovery.revision,first.work.discovery.revision+1);
  assert.equal((await f.api('/api/works?mine=1')).total,1);assert.equal((await f.api('/api/works?mine=1&state=archived')).total,0);assert.deepEqual(await f.feed(),[]);
  const stale=await f.discovery(work.id,'restore',{expectedRevision:first.work.discovery.revision});assert.equal(stale.error.code,'DISCOVERY_CONFLICT');
  assert.equal((await f.discovery(work.id,'restore')).status,200);assert.deepEqual(await f.feed(),[work.id]);
  const repeated=await archive(f,first.work,'restore');assert.equal(repeated.status,200);assert.equal(repeated.work.revision,restored.work.revision);assert.equal(repeated.work.discovery.visibility,'listed','A same-state retry must not override later explicit visibility');
});

test('archive rejects foreign owners, invalid state and stale revisions without changing data',async t=>{
  const f=fixture(t),{work}=await f.publish(),before=f.readWork(work.id);
  const foreign=await f.api('/api/works/'+work.id+'/archive',{method:'POST',owner:OTHER,body:{action:'archive',expectedRevision:1}});assert.equal(foreign.status,403);
  assert.equal((await archive(f,work,'delete')).error.code,'INVALID_ARCHIVE_ACTION');
  assert.equal((await archive(f,work,'archive',{expectedRevision:0})).status,422);
  const stale=await archive(f,work,'archive',{expectedRevision:99});assert.equal(stale.error.code,'ARCHIVE_CONFLICT');assert.equal(stale.error.current.revision,1);assert.equal(stale.error.current.archivedAt,null);
  assert.equal((await f.api('/api/works?mine=1&state=deleted')).error.code,'INVALID_WORK_STATE');
  assert.deepEqual(f.readWork(work.id),before);assert.deepEqual(await f.feed(),[work.id]);
});

test('new writes to an archive are blocked, but original publish/version/edit/card receipts still replay',async t=>{
  const f=fixture(t),publishKey=randomUUID(),{work}=await f.publish({key:publishKey}),versionKey=randomUUID(),v2=await f.version(work.id,{key:versionKey});assert.equal(v2.status,201);
  const current=(await f.get(work.id)).work,editKey=randomUUID(),edited=await edit(f,current,{key:editKey});assert.equal(edited.status,200,JSON.stringify(edited));
  const latest=(await f.get(work.id)).work,cardKey=randomUUID(),input=cardInput(latest),saved=await f.api('/api/cards',{method:'POST',key:cardKey,body:input});assert.equal(saved.status,201);
  const archived=await archive(f,latest);assert.equal(archived.status,200);
  const counts=snapshot(f),keys=[...f.objects.keys()];
  assert.equal((await f.version(work.id,{bytes:html('v3'),revision:archived.work.revision})).error.code,'WORK_ARCHIVED');
  assert.equal((await edit(f,archived.work)).error.code,'WORK_ARCHIVED');
  assert.equal((await f.api('/api/works/'+work.id+'/activate',{method:'POST',body:{versionId:work.versionId,expectedRevision:archived.work.revision}})).error.code,'WORK_ARCHIVED');
  assert.equal((await f.api('/api/cards',{method:'POST',body:input})).error.code,'WORK_ARCHIVED');
  assert.equal((await f.publish({key:publishKey})).status,200);
  const replayVersion=await f.version(work.id,{key:versionKey});assert.equal(replayVersion.status,200);assert.deepEqual(replayVersion.operation,v2.operation);
  const replayEdit=await edit(f,current,{key:editKey});assert.equal(replayEdit.status,200);assert.deepEqual(replayEdit.operation,edited.operation);
  assert.deepEqual((await f.api('/api/cards',{method:'POST',key:cardKey,body:input})).card,saved.card);
  assert.deepEqual(snapshot(f),counts);assert.deepEqual([...f.objects.keys()],keys);assert.deepEqual(f.deleted,[]);
});

test('deduplication retains archived identity and directs repeat uploads to the recoverable work',async t=>{
  const f=fixture(t),{work}=await f.publish();await archive(f,work);
  const original=f.database.prepare('SELECT * FROM ft_work_fingerprints').all();
  const duplicate=await f.publish({name:'New title'});assert.equal(duplicate.status,409);assert.equal(duplicate.error.code,'DUPLICATE_WORK');assert.equal(duplicate.error.existingWork.id,work.id);assert(duplicate.error.existingWork.archivedAt);
  assert.equal(f.count('ft_works'),1);assert.equal(f.count('ft_work_versions'),1);assert.deepEqual(f.database.prepare('SELECT * FROM ft_work_fingerprints').all(),original);
  const legacy=f.seed({bytes:html('v1')});const preferred=await f.publish();assert.equal(preferred.error.existingWork.id,legacy.id);assert.equal(preferred.error.existingWork.archivedAt,null);assert.deepEqual(f.database.prepare('SELECT * FROM ft_work_fingerprints').all(),original);
});

test('mine pagination is lifecycle-scoped and archive remains live during an older Feed traversal',async t=>{
  const f=fixture(t);const works=[];
  for(let i=0;i<4;i++)works.push((await f.publish({bytes:html('page-'+i)})).work);
  const mine=await f.api('/api/works?mine=1&limit=1');assert(mine.nextCursor);
  for(const state of ['archived','all'])assert.equal((await f.api('/api/works?mine=1&limit=1&state='+state+'&cursor='+encodeURIComponent(mine.nextCursor))).error.code,'INVALID_CURSOR');
  const feed=await f.api('/api/discover?limit=1&sort=recommended');assert(feed.nextCursor);
  const target=works.find(w=>w.id!==feed.works[0].id);await archive(f,target);
  const page=await f.api('/api/discover?limit=48&sort=recommended&cursor='+encodeURIComponent(feed.nextCursor));assert.equal(page.status,200);assert(!page.works.some(w=>w.id===target.id));
  const archived=await f.api('/api/works?mine=1&state=archived');assert.deepEqual(archived.works.map(w=>w.id),[target.id]);
  assert.equal((await f.api('/api/works?mine=1&state=all')).total,4);
});

test('archive is atomic through failures and races, and rejects an old deployment saving an archived selection',async t=>{
  const f=fixture(t),{work}=await f.publish();
  f.faults.beforeCommit=true;assert.equal((await archive(f,work)).status,500);assert.equal((await f.get(work.id)).work.archivedAt,null);assert.deepEqual(await f.feed(),[work.id]);
  f.faults.afterCommit=true;const committed=await archive(f,work);assert.equal(committed.status,200);assert(committed.work.archivedAt);assert.equal(committed.work.discovery.visibility,'unlisted');
  const snapshotJSON=JSON.stringify({id:randomUUID(),workIds:[work.id],works:[{id:work.id,versionId:work.versionId}]});
  assert.throws(()=>f.database.prepare('INSERT INTO ft_cards(id,author_id,snapshot_json,created_at) VALUES(?,?,?,?)').run(randomUUID(),OWNER,snapshotJSON,new Date().toISOString()),/WORK_ARCHIVED/);assert.equal(f.count('ft_cards'),0);
  await archive(f,committed.work,'restore');const active=(await f.get(work.id)).work;
  const race=await Promise.all([archive(f,active),f.discovery(work.id,'restore')]);assert(race.some(result=>result.status===200));
  const final=(await f.get(work.id)).work;assert(final.archivedAt);assert.equal(final.discovery.visibility,'unlisted');assert.equal(final.discovery.eligible,false);
});

test('archived direct play remains valid but cannot create Feed exposure or reciprocity credit',async t=>{
  const f=fixture(t),{work}=await f.publish();await archive(f,work);
  const session=await f.api('/api/sessions',{method:'POST',owner:OTHER,body:{workId:work.id,versionId:work.versionId}});assert.equal(session.status,201);
  assert.equal((await f.api('/api/sessions/'+session.id+'/events',{method:'POST',owner:OTHER,body:{token:session.token,events:[{id:randomUUID(),type:'play_start',seq:1}]}})).status,200);
  assert.equal((await f.api('/api/works/'+work.id+'/like',{method:'POST',owner:OTHER,body:{liked:true}})).status,200);assert.equal(f.count('ft_contribution_credits'),0);
  const eventId=randomUUID(),exposure=await f.api('/api/feed/impressions',{method:'POST',owner:OTHER,body:{impressions:[{eventId,workId:work.id,sort:'recommended'}]}});assert.equal(exposure.status,200);assert.deepEqual(exposure.ignored,[eventId]);assert.equal(f.count('ft_feed_impressions'),0);
});
