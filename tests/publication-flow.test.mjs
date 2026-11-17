import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,OWNER,OTHER,REVIEWER,html,digest,gameResponse} from './helpers/router-fixture.mjs';

test('additive migration preserves duplicate legacy works, all old versions/cards/events, and original Feed membership',async t=>{
  const f=fixture(t,{legacy:true}),a=f.seed(),b=f.seed({at:'2026-01-02T00:00:00.000Z'}),other=f.seed({owner:OTHER});
  const card=randomUUID(),snapshot=JSON.stringify({id:card,authorId:OWNER,name:'Creator',template:'fold',workIds:[a.id],works:[{id:a.id,versionId:a.versionId,name:'Original snapshot'}]});
  f.database.prepare('INSERT INTO ft_cards(id,author_id,snapshot_json,created_at) VALUES(?,?,?,?)').run(card,OWNER,snapshot,'2026-01-03T00:00:00.000Z');
  f.database.prepare('INSERT INTO ft_events(id,client_event_id,actor_id,work_id,version_id,card_id,event_type,received_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),randomUUID(),OTHER,a.id,a.versionId,card,'card_view','2026-01-03T00:00:00.000Z');
  const tables=['ft_works','ft_work_versions','ft_cards','ft_events'];
  const before=tables.map(table=>f.database.prepare('SELECT * FROM '+table+' ORDER BY id').all());f.migrate();
  tables.forEach((table,i)=>{const after=f.database.prepare('SELECT * FROM '+table+' ORDER BY id').all();if(table==='ft_works')for(const row of after){assert.equal(row.archived_at,null);delete row.archived_at;}assert.deepEqual(after,before[i]);});
  assert.deepEqual(new Set(await f.feed()),new Set([a.id,b.id,other.id]));
  const duplicate=await f.publish({bytes:html('legacy')});assert.equal(duplicate.status,409);assert.equal(duplicate.error.code,'DUPLICATE_WORK');assert.equal(duplicate.error.existingWork.id,a.id);
  assert.equal(f.count('ft_works'),3);assert.equal(f.objects.size,3);
});

test('fresh publication immediately enters Feed; exact duplicates do not create data or replace originals',async t=>{
  const f=fixture(t),first=await f.publish({cover:true});assert.equal(first.status,201,JSON.stringify(first));
  assert.equal(first.work.discovery.visibility,'listed');assert.equal(first.work.discovery.reviewRequired,false);assert.equal(first.work.discovery.eligible,true);assert.deepEqual(await f.feed(),[first.work.id]);
  const before=f.readWork(first.work.id),keys=[...f.objects.keys()];const duplicate=await f.publish({name:'A renamed duplicate'});
  assert.equal(duplicate.status,409);assert.equal(duplicate.error.code,'DUPLICATE_WORK');assert.equal(duplicate.error.existingWork.id,first.work.id);
  assert.deepEqual(f.readWork(first.work.id),before);assert.deepEqual([...f.objects.keys()],keys);assert.equal(f.count('ft_works'),1);assert.equal(f.count('ft_work_versions'),1);
  const foreign=await f.publish({owner:OTHER});assert.equal(foreign.status,201);assert.notEqual(foreign.work.id,first.work.id);assert.equal(f.count('ft_works'),2);
});

test('grandfathered works remain in Feed after an update without a review or gameplay declaration',async t=>{
  const f=fixture(t,{legacy:true}),legacy=f.seed();f.migrate();assert.deepEqual(await f.feed(),[legacy.id]);
  const before=(await f.get(legacy.id)).work.discovery;
  const updated=await f.version(legacy.id);assert.equal(updated.status,201);assert.deepEqual(await f.feed(),[legacy.id]);
  const current=(await f.get(legacy.id)).work;assert.equal(current.versionId,updated.version.id);assert.deepEqual(current.discovery,before);
});

test('a previous deployment writing during migration gets listed defaults and historical deduplication',async t=>{
  const f=fixture(t),legacy=f.seed({bytes:html('rolling deployment')});
  assert.equal(f.count('ft_work_fingerprints'),0);assert.equal((await f.get(legacy.id)).work.discovery.visibility,'listed');assert.deepEqual(await f.feed(),[legacy.id]);
  const duplicate=await f.publish({bytes:html('rolling deployment')});assert.equal(duplicate.status,409);assert.equal(duplicate.error.code,'DUPLICATE_WORK');assert.equal(duplicate.error.existingWork.id,legacy.id);
  const url=f.seed({source:'url',url:'https://example.com/rolling-deployment'});
  const link=await f.publish({source:'url',url:'https://example.com/rolling-deployment'});assert.equal(link.error.code,'DUPLICATE_WORK');assert.equal(link.error.existingWork.id,url.id);assert.equal(f.count('ft_works'),2);
});

test('concurrent same-author uploads with distinct keys commit only one work and clean only losing objects',async t=>{
  const f=fixture(t),results=await Promise.all([f.publish({cover:true}),f.publish({cover:true})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409],JSON.stringify(results));
  const accepted=results.find(r=>r.status===201),rejected=results.find(r=>r.status===409);assert.equal(rejected.error.code,'DUPLICATE_WORK');assert.equal(rejected.error.existingWork.id,accepted.work.id);
  assert.equal(f.count('ft_works'),1);assert.equal(f.count('ft_work_versions'),1);assert.equal(f.objects.size,2);
  assert(f.objects.has('games/'+accepted.work.versionId+'.html'));assert(f.objects.has('covers/'+accepted.work.versionId));
});

test('same publication key replays original receipt before duplicate detection and after later version updates',async t=>{
  const f=fixture(t),key=randomUUID(),results=await Promise.all([f.publish({key}),f.publish({key})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,201],JSON.stringify(results));assert.equal(results[0].work.id,results[1].work.id);const first=results[0].work;
  const updated=await f.version(first.id);assert.equal(updated.status,201,JSON.stringify(updated));
  const replay=await f.publish({key});assert.equal(replay.status,200);assert.equal(replay.work.versionId,first.versionId);assert.equal(replay.current.versionId,updated.version.id);
  const mismatch=await f.publish({key,name:'Different request'});assert.equal(mismatch.error.code,'IDEMPOTENCY_CONFLICT');assert.equal(f.count('ft_works'),1);assert.equal(f.count('ft_work_versions'),2);
});

test('new-work publication racing an existing-work version cannot claim identical content twice',async t=>{
  const f=fixture(t),{work}=await f.publish(),results=await Promise.all([f.publish({bytes:html('v2')}),f.version(work.id)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409],JSON.stringify(results));assert.equal(results.find(r=>r.status===409).error.code,'DUPLICATE_WORK');
  assert.equal(f.count('ft_work_versions'),2);assert.equal(f.objects.size,2);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM ft_work_versions WHERE content_hash=?').get(digest(html('v2'))).n,1);
});

test('URL identity uses full normalized URL without conflating distinct paths, queries or owners',async t=>{
  const f=fixture(t),first=await f.publish({source:'url',url:'https://EXAMPLE.com:443/game'});assert.equal(first.status,201);
  const duplicate=await f.publish({source:'url',url:'https://example.com/game'});assert.equal(duplicate.error.code,'DUPLICATE_WORK');assert.equal(duplicate.error.existingWork.id,first.work.id);
  for(const url of ['https://example.com/game?level=2','https://example.com/game#level-2','https://example.com/other'])assert.equal((await f.publish({source:'url',url})).status,201);
  assert.equal((await f.publish({source:'url',url:'https://example.com/game',owner:OTHER})).status,201);
});

test('cloud artifacts and uploaded HTML share byte identity while foreign builds remain inaccessible',async t=>{
  const f=fixture(t),first=await f.publish(),buildId=randomUUID();f.testBuilds.set(buildId,{owner:OWNER,bytes:new TextEncoder().encode(html('v1')),provenance:{buildId,repository:'owner/game',commitSha:'a'.repeat(40)}});
  const duplicate=await f.publish({buildId});assert.equal(duplicate.error.code,'DUPLICATE_WORK');assert.equal(duplicate.error.existingWork.id,first.work.id);
  assert.equal((await f.publish({buildId,owner:OTHER})).status,404);assert.equal(f.count('ft_works'),1);
});

test('unchanged and historical content cannot produce redundant versions; other owned works remain distinct',async t=>{
  const f=fixture(t),first=await f.publish(),id=first.work.id;
  const unchanged=await f.version(id,{bytes:html('v1'),cover:true});assert.equal(unchanged.status,409);assert.equal(unchanged.error.code,'VERSION_UNCHANGED');assert.equal(unchanged.error.existingVersion.id,first.work.versionId);assert.equal(f.count('ft_work_versions'),1);
  const second=await f.version(id);assert.equal(second.status,201);
  const historical=await f.version(id,{revision:2,bytes:html('v1')});assert.equal(historical.error.code,'VERSION_ALREADY_EXISTS');assert.equal(historical.error.existingVersion.id,first.work.versionId);
  const other=await f.publish({bytes:html('other')});assert.equal(other.status,201);
  const copied=await f.version(other.work.id,{bytes:html('v1')});assert.equal(copied.error.code,'DUPLICATE_WORK');assert.equal(copied.error.existingWork.id,id);
  const separate=await f.publish({bytes:html('v2')});assert.equal(separate.error.code,'DUPLICATE_WORK');assert.equal(separate.error.existingWork.id,id);
  assert.equal(f.count('ft_works'),2);assert.equal(f.count('ft_work_versions'),3);assert.equal(f.objects.size,3);
});

test('publication R2/transaction failures leave no fingerprints or partial work; lost commit response safely replays',async t=>{
  const f=fixture(t);
  for(const fault of ['put','beforeCommit']){f.faults[fault]=true;assert.equal((await f.publish({cover:true})).status,500);assert.equal(f.count('ft_works'),0);assert.equal(f.count('ft_work_versions'),0);assert.equal(f.objects.size,0);}
  f.faults.afterCommit=true;const result=await f.publish({cover:true});assert.equal(result.status,201,JSON.stringify(result));assert.equal(f.count('ft_works'),1);assert.equal(f.objects.size,2);
  assert.equal((await f.publish()).error.code,'DUPLICATE_WORK');
});

test('retired review APIs and submit actions return 410 without writes, even with a former reviewer identity',async t=>{
  const f=fixture(t),{work}=await f.publish();
  const tables=['ft_works','ft_work_versions','ft_work_discovery'];
  const before=tables.map(table=>f.database.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());
  for(const owner of [OWNER,REVIEWER]){
    assert.equal((await f.api('/api/me',{owner})).canReview,false);
    for(const path of ['/api/review','/api/review/works','/api/review/works/'+work.id,'/api/review/unknown/path']){
      for(const method of ['GET','POST','PATCH']){
        const disabled=await f.api(path,{method,owner,body:{decision:'approve',expectedRevision:1,versionId:work.versionId,canReview:true},extraHeaders:{'x-funtrack-reviewer':'true'}});
        assert.equal(disabled.status,410,JSON.stringify(disabled));assert.equal(disabled.error.code,'REVIEW_DISABLED');
      }
    }
  }
  for(const expectedRevision of [undefined,1,999]){
    const disabled=await f.api('/api/works/'+work.id+'/discovery',{method:'PATCH',body:{action:'submit',expectedRevision,kind:'game',playDescription:'A game',rulesAccepted:true}});
    assert.equal(disabled.status,410);assert.equal(disabled.error.code,'REVIEW_DISABLED');
  }
  tables.forEach((table,i)=>assert.deepEqual(f.database.prepare('SELECT * FROM '+table+' ORDER BY rowid').all(),before[i]));
  assert.equal((await f.api('/api/works/'+work.id+'/discovery',{owner:OTHER})).status,403);
  for(const action of ['hide','restore','submit'])assert.equal((await f.api('/api/works/'+work.id+'/discovery',{method:'PATCH',owner:OTHER,body:{action,expectedRevision:1}})).status,403);
});

test('hide removes discovery everywhere but preserves direct play, history and card snapshots; restore needs no review',async t=>{
  const f=fixture(t),{work}=await f.publish();assert.deepEqual(await f.feed(),[work.id]);
  const card=await f.api('/api/cards',{method:'POST',body:{name:'Creator',bio:'Small games',template:'fold',workIds:[work.id],workRefs:[{workId:work.id,versionId:work.versionId,metadataId:work.metadataId}]}});assert.equal(card.status,201,JSON.stringify(card));
  const snapshot=f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.card.id).snapshot_json;
  const oldVersion=f.database.prepare('SELECT * FROM ft_work_versions WHERE id=?').get(work.versionId),oldWork=f.readWork(work.id);
  const hidden=await f.discovery(work.id,'hide');assert.equal(hidden.status,200);assert.equal(hidden.work.discovery.visibility,'unlisted');assert.deepEqual(await f.feed(),[]);
  assert.deepEqual((await f.api('/api/works')).works,[]);assert.deepEqual((await f.api('/api/discover?author='+OWNER)).works,[]);assert.equal((await f.api('/api/works?mine=1')).works.length,1);
  assert.equal((await f.get(work.id)).status,200);const game=await gameResponse(f.request('/game/'+work.versionId),work.versionId);assert.equal(game.status,200);assert((await game.text()).includes(html('v1')));
  assert.equal((await f.api('/api/cards/'+card.card.id)).status,200);assert.equal(f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.card.id).snapshot_json,snapshot);
  assert.deepEqual(f.database.prepare('SELECT * FROM ft_work_versions WHERE id=?').get(work.versionId),oldVersion);assert.deepEqual(f.readWork(work.id),oldWork);
  const restored=await f.discovery(work.id,'restore');assert.equal(restored.status,200);assert.deepEqual(await f.feed(),[work.id]);
});

test('visibility changes use owner revision CAS and a hidden version update never returns the work to Feed',async t=>{
  const f=fixture(t),{work}=await f.publish();
  const mutation=action=>f.api('/api/works/'+work.id+'/discovery',{method:'PATCH',body:{action,expectedRevision:work.discovery.revision}});
  const competitors=await Promise.all([mutation('hide'),mutation('restore')]);assert.deepEqual(competitors.map(x=>x.status).sort(),[200,409]);
  assert.equal(competitors.find(x=>x.status===409).error.code,'DISCOVERY_CONFLICT');
  if((await f.get(work.id)).work.discovery.visibility!=='unlisted')assert.equal((await f.discovery(work.id,'hide')).status,200);
  const hidden=(await f.get(work.id)).work.discovery;
  const next=await f.version(work.id);assert.equal(next.status,201);assert.deepEqual((await f.get(work.id)).work.discovery,hidden);assert.deepEqual(await f.feed(),[]);
  const stale=await mutation('restore');assert.equal(stale.status,409);assert.equal(stale.error.code,'DISCOVERY_CONFLICT');
  assert.equal((await f.discovery(work.id,'restore')).status,200);assert.deepEqual(await f.feed(),[work.id]);
  const visible=(await f.get(work.id)).work.discovery;
  assert.equal((await f.version(work.id,{revision:2,bytes:html('v3')})).status,201);assert.deepEqual((await f.get(work.id)).work.discovery,visible);assert.deepEqual(await f.feed(),[work.id]);
});

test('metadata edits retain the explicit visibility and never introduce a review requirement',async t=>{
  const f=fixture(t),{work}=await f.publish(),visible=(await f.get(work.id)).work.discovery;
  const form=(name,revision)=>{const value=new FormData();value.set('name',name);value.set('desc','Click to explore the game');value.set('expectedRevision',String(revision));return value;};
  const unchanged=await f.api('/api/works/'+work.id,{method:'PATCH',body:form('A game',1)});assert.equal(unchanged.status,200);assert.equal(unchanged.operation.changed,false);assert.deepEqual(await f.feed(),[work.id]);
  const edited=await f.api('/api/works/'+work.id,{method:'PATCH',body:form('A different title',1)});assert.equal(edited.status,200);assert.deepEqual(await f.feed(),[work.id]);
  const current=(await f.get(work.id)).work;assert.deepEqual(current.discovery,visible);assert.equal(current.versionId,work.versionId);
  await f.discovery(work.id,'hide');const hidden=(await f.get(work.id)).work.discovery;
  const hiddenEdit=await f.api('/api/works/'+work.id,{method:'PATCH',body:form('An edited hidden title',2)});assert.equal(hiddenEdit.status,200);assert.deepEqual((await f.get(work.id)).work.discovery,hidden);assert.deepEqual(await f.feed(),[]);
});

test('private creator pagination retrieves more than 200 unlisted works without exposing them through public author queries',async t=>{
  const f=fixture(t),expected=[];
  for(let i=0;i<205;i++){const {id}=f.seed({bytes:html('private-'+i),at:new Date(Date.UTC(2026,0,1,0,0,i)).toISOString()});expected.push(id);assert.equal((await f.discovery(id,'hide')).status,200);}
  const other=f.seed({owner:OTHER,bytes:html('other owner')});
  const otherWork=(await f.get(other.id)).work;assert.equal((await f.api('/api/works/'+other.id+'/discovery',{method:'PATCH',owner:OTHER,body:{action:'hide',expectedRevision:otherWork.discovery.revision}})).status,200);
  const found=[];let cursor=null,pages=0;
  do{const result=await f.api('/api/works?mine=1&limit=48'+(cursor?'&cursor='+encodeURIComponent(cursor):''));assert.equal(result.status,200,JSON.stringify(result));assert(result.works.length<=48);found.push(...result.works.map(w=>w.id));cursor=result.nextCursor;assert(++pages<=5);}while(cursor);
  assert.equal(pages,5);assert.equal(found.length,205);assert.equal(new Set(found).size,205);assert.deepEqual(new Set(found),new Set(expected));
  assert.deepEqual((await f.api('/api/discover?author='+OWNER)).works,[]);assert.deepEqual((await f.api('/api/works?author='+OWNER)).works,[]);
  assert.equal((await f.api('/api/works?mine=1',{owner:OTHER})).works.length,1);
});

test('removing review preserves every existing pending, rejected and hidden row while eligibility follows visibility only',async t=>{
  const f=fixture(t,{through:7}),pending=f.seed({bytes:html('pending')}),hidden=f.seed({bytes:html('hidden')}),rejected=f.seed({bytes:html('rejected')});
  for(const [work,visibility,status] of [[pending,'listed','pending'],[hidden,'unlisted','pending'],[rejected,'listed','rejected']]){
    f.database.prepare('UPDATE ft_work_discovery SET visibility=?,review_status=?,kind=?,play_description=?,submitted_version_id=?,review_note=?,reviewed_by=?,revision=5 WHERE work_id=?').run(visibility,status,'prototype','Historical gameplay',work.versionId,'Historical review note',REVIEWER,work.id);
  }
  const cardId=randomUUID(),snapshot=JSON.stringify({id:cardId,authorId:OWNER,name:'Old card',template:'fold',works:[{id:hidden.id,versionId:hidden.versionId}]});
  f.database.prepare('INSERT INTO ft_cards(id,author_id,snapshot_json,created_at) VALUES(?,?,?,?)').run(cardId,OWNER,snapshot,'2026-01-04T00:00:00.000Z');
  f.database.prepare('INSERT INTO ft_events(id,client_event_id,actor_id,work_id,version_id,event_type,received_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),randomUUID(),OTHER,pending.id,pending.versionId,'work_view','2026-01-04T00:00:00.000Z');
  const tables=['ft_works','ft_work_versions','ft_work_metadata','ft_work_discovery','ft_work_fingerprints','ft_cards','ft_events'];
  const before=tables.map(table=>f.database.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());f.migrate();
  tables.forEach((table,i)=>{const after=f.database.prepare('SELECT * FROM '+table+' ORDER BY rowid').all();if(table==='ft_works')for(const row of after){assert.equal(row.archived_at,null);delete row.archived_at;}assert.deepEqual(after,before[i]);});
  assert.deepEqual(new Set(await f.feed()),new Set([pending.id,rejected.id]));assert.equal((await f.get(hidden.id)).work.discovery.reviewRequired,false);
  assert.equal((await f.discovery(hidden.id,'restore')).status,200);assert.deepEqual(new Set(await f.feed()),new Set([pending.id,hidden.id,rejected.id]));
  const fresh=await f.publish({bytes:html('post migration')});assert.equal(fresh.status,201);assert.equal(fresh.work.discovery.visibility,'listed');assert.equal(fresh.work.discovery.eligible,true);
  assert.deepEqual(f.database.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('new version and rollback preserve immutable card, file, events and the author-selected visibility',async t=>{
  const f=fixture(t),{work}=await f.publish();
  const {card}=await f.api('/api/cards',{method:'POST',body:{name:'Creator',bio:'Original',template:'fold',workIds:[work.id],workRefs:[{workId:work.id,versionId:work.versionId,metadataId:work.metadataId}]}});
  const snapshot=f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json,original=f.objects.get('games/'+work.versionId+'.html').slice();
  assert.equal((await f.api('/api/events',{method:'POST',owner:OTHER,body:{eventId:randomUUID(),workId:work.id,type:'work_view'}})).status,200);
  assert.equal((await f.api('/api/feedback',{method:'POST',owner:OTHER,body:{eventId:randomUUID(),workId:work.id,type:'建议',text:'Keep this first-version feedback'}})).status,201);
  const dataTables=['ft_events','ft_feedback'],dataBefore=dataTables.map(table=>f.database.prepare('SELECT * FROM '+table+' ORDER BY id').all());
  assert(dataBefore.every(rows=>rows.length>0));
  const v2=await f.version(work.id);assert.equal(v2.status,201);assert.deepEqual(await f.feed(),[work.id]);
  const back=await f.api('/api/works/'+work.id+'/activate',{method:'POST',body:{versionId:work.versionId,expectedRevision:2}});assert.equal(back.status,200);assert.equal(back.current.versionId,work.versionId);assert.deepEqual(await f.feed(),[work.id]);
  assert.equal(f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json,snapshot);assert.deepEqual(f.objects.get('games/'+work.versionId+'.html'),original);assert.equal(f.count('ft_work_versions'),2);assert.equal(f.readWork(work.id).revision,3);
  dataTables.forEach((table,index)=>assert.deepEqual(f.database.prepare('SELECT * FROM '+table+' ORDER BY id').all(),dataBefore[index]));
  await f.discovery(work.id,'hide');const hidden=(await f.get(work.id)).work.discovery;
  const hiddenActivation=await f.api('/api/works/'+work.id+'/activate',{method:'POST',body:{versionId:v2.version.id,expectedRevision:3}});assert.equal(hiddenActivation.status,200);assert.deepEqual(await f.feed(),[]);assert.deepEqual((await f.get(work.id)).work.discovery,hidden);
  assert.equal(f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json,snapshot);assert.deepEqual(f.objects.get('games/'+work.versionId+'.html'),original);assert.equal(f.count('ft_work_versions'),2);
  dataTables.forEach((table,index)=>assert.deepEqual(f.database.prepare('SELECT * FROM '+table+' ORDER BY id').all(),dataBefore[index]));
});
