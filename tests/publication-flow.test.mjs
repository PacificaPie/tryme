import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import ts from 'typescript';

// Exercise the real HTTP router, SQL, transactions, publication/version logic,
// ownership checks and Feed queries. Only platform bindings and unrelated
// analytics/build transport are replaced; repository bytes still pass the real
// publication-artifact validator. No network or cloud resources are touched.
const source=readFileSync(new URL('../lib/funtrack/server.ts',import.meta.url),'utf8')
  .replace("import { env } from 'cloudflare:workers';",'let env = {}; export function testBindings(value){env=value;}')
  .replace(/import \{ handleBuildAPI, handleBuildWorker, getBuildArtifact \} from '\.\/build-service';/,
    `const handleBuildAPI=async()=>null,handleBuildWorker=async()=>null;
     const getBuildArtifact=async(id,owner)=>{const value=env.testBuilds.get(id);if(!value||value.owner!==owner)throw new ApiError(404,'BUILD_NOT_FOUND','missing');return {bytes:value.bytes,provenance:value.provenance};};`)
  .replace(/import \{ analyticsResponse \} from '\.\/analytics';/,'const analyticsResponse=async()=>{throw Error("Analytics is outside this fixture");};')
  .replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL('../lib/funtrack/'+path.slice(2),import.meta.url).href}'`);
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {handleAPI,gameResponse,testBindings}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const OWNER='publication-owner',OTHER='publication-other',REVIEWER='publication-reviewer';
const html=label=>`<!doctype html><html><body><button>${label}</button></body></html>`;
const digest=value=>createHash('sha256').update(value).digest('hex');
const migrations=readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort();
const png=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);

function fixture(t,{legacy=false}={}){
  const database=new DatabaseSync(':memory:');t.after(()=>database.close());database.exec('PRAGMA foreign_keys=ON');
  const old=migrations.filter(file=>Number(file.slice(0,4))<=6),added=migrations.filter(file=>Number(file.slice(0,4))>6);
  for(const file of legacy?old:migrations)database.exec(readFileSync('drizzle/'+file,'utf8'));
  const objects=new Map(),deleted=[],testBuilds=new Map(),faults={beforeCommit:false,afterCommit:false,put:false};
  const db={prepare(query){return {query,values:[],bind(...values){this.values=values;return this;},
    async first(){return database.prepare(query).get(...this.values)||null;},
    async all(){return {results:database.prepare(query).all(...this.values)};},
    async run(){return {meta:{changes:database.prepare(query).run(...this.values).changes}};}};},
    async batch(statements){
      if(faults.beforeCommit){faults.beforeCommit=false;throw Error('commit unavailable');}
      // Match D1: a write batch is one atomic transaction, not JS-interleaved SQL.
      database.exec('BEGIN');let result;
      try{result=statements.map(s=>/^\s*(?:SELECT|WITH)\b/i.test(s.query)
        ?{results:database.prepare(s.query).all(...s.values),meta:{changes:0}}
        :{results:[],meta:{changes:database.prepare(s.query).run(...s.values).changes}});database.exec('COMMIT');}
      catch(error){database.exec('ROLLBACK');throw error;}
      if(faults.afterCommit){faults.afterCommit=false;throw Error('commit response lost');}return result;
    }};
  const bucket={async put(key,value){if(faults.put){faults.put=false;throw Error('R2 unavailable');}objects.set(key,new Uint8Array(value));},
    async delete(keys){for(const key of Array.isArray(keys)?keys:[keys]){deleted.push(key);objects.delete(key);}},
    async get(key){const bytes=objects.get(key);return bytes?{size:bytes.length,body:bytes,async text(){return new TextDecoder().decode(bytes);},async arrayBuffer(){return bytes.slice().buffer;}}:null;}};
  testBindings({DB:db,BUCKET:bucket,FUNTRACK_REVIEWER_IDS:REVIEWER,testBuilds});
  function request(path,{method='GET',body,owner=OWNER,key=randomUUID(),extraHeaders={}}={}){
    const headers={'oai-authenticated-user-id':owner,'oai-authenticated-user-email':owner+'@example.test','oai-authenticated-user-full-name':owner,...extraHeaders};
    if(method!=='GET'){headers.Origin='https://site.test';headers['X-Funtrack-CSRF']='1';headers['Idempotency-Key']=key;if(!(body instanceof FormData))headers['Content-Type']='application/json';}
    return new Request('https://site.test'+path,{method,headers,...(method==='GET'?{}:{body:body instanceof FormData?body:JSON.stringify(body||{})})});
  }
  const api=async(path,options)=>{const response=await handleAPI(request(path,options));return {status:response.status,...await response.json()};};
  const publish=({bytes=html('v1'),owner=OWNER,key=randomUUID(),name='A game',source='html',url,cover=false,buildId,extra={}}={})=>{
    const form=new FormData();form.set('name',name);form.set('desc','Click to explore the game');form.set('source',source);
    if(source==='url')form.set('url',url);else if(buildId)form.set('buildId',buildId);else form.set('file',new File([bytes],'game.html',{type:'text/html'}));
    if(cover)form.set('cover',new File([png],'cover.png',{type:'image/png'}));for(const [name,value] of Object.entries(extra))form.set(name,value);
    return api('/api/works',{method:'POST',body:form,owner,key});
  };
  const version=(id,{bytes=html('v2'),revision=1,owner=OWNER,key=randomUUID(),cover=false,buildId}={})=>{
    const form=new FormData();form.set('expectedRevision',String(revision));form.set('releaseNotes','Updated gameplay');
    if(buildId)form.set('buildId',buildId);else form.set('file',new File([bytes],'game.html',{type:'text/html'}));
    if(cover)form.set('cover',new File([png],'cover.png',{type:'image/png'}));
    return api('/api/works/'+id+'/versions',{method:'POST',body:form,owner,key});
  };
  const get=id=>api('/api/works/'+id);
  const discovery=async(id,action,extra={})=>{const {work}=await get(id);return api('/api/works/'+id+'/discovery',{method:'PATCH',body:{action,expectedRevision:work.discovery.revision,...extra}});};
  const submit=(id,extra={})=>discovery(id,'submit',{kind:'game',playDescription:'Press the button to advance the scene',rulesAccepted:true,...extra});
  const review=async(id,extra={})=>{const {work}=await get(id);return api('/api/review/works/'+id,{method:'POST',owner:REVIEWER,body:{decision:'approve',expectedRevision:work.discovery.revision,versionId:work.versionId,...extra}});};
  const count=table=>database.prepare('SELECT COUNT(*) n FROM '+table).get().n;
  const readWork=id=>database.prepare('SELECT * FROM ft_works WHERE id=?').get(id);
  const feed=async()=>{const r=await api('/api/discover');assert.equal(r.status,200,JSON.stringify(r));return r.works.map(w=>w.id);};
  function seed({id=randomUUID(),owner=OWNER,bytes=html('legacy'),at='2026-01-01T00:00:00.000Z',source='html',url=null}={}){
    const versionId=randomUUID(),gameKey=source==='html'?'games/'+versionId+'.html':null;
    database.prepare('INSERT INTO ft_works(id,author_id,author_name,name,description,source,current_version_id,url,created_at,idempotency_key,request_hash,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,owner,owner,'Legacy','Legacy game',source,versionId,url,at,randomUUID(),'legacy-hash',at);
    database.prepare('INSERT INTO ft_work_versions(id,work_id,version,game_key,created_at,content_hash,created_by) VALUES(?,?,?,?,?,?,?)').run(versionId,id,'v1',gameKey,at,gameKey?digest(bytes):null,owner);
    if(gameKey)objects.set(gameKey,new TextEncoder().encode(bytes));return {id,versionId};
  }
  const migrate=()=>{assert(added.length,'Expected an additive publication migration');for(const file of added)database.exec(readFileSync('drizzle/'+file,'utf8'));};
  return {database,objects,deleted,faults,testBuilds,request,api,publish,version,get,discovery,submit,review,count,readWork,feed,seed,migrate};
}

test('additive migration preserves duplicate legacy works, all old versions/cards/events, and original Feed membership',async t=>{
  const f=fixture(t,{legacy:true}),a=f.seed(),b=f.seed({at:'2026-01-02T00:00:00.000Z'}),other=f.seed({owner:OTHER});
  const card=randomUUID(),snapshot=JSON.stringify({id:card,authorId:OWNER,name:'Creator',template:'fold',workIds:[a.id],works:[{id:a.id,versionId:a.versionId,name:'Original snapshot'}]});
  f.database.prepare('INSERT INTO ft_cards(id,author_id,snapshot_json,created_at) VALUES(?,?,?,?)').run(card,OWNER,snapshot,'2026-01-03T00:00:00.000Z');
  f.database.prepare('INSERT INTO ft_events(id,client_event_id,actor_id,work_id,version_id,card_id,event_type,received_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),randomUUID(),OTHER,a.id,a.versionId,card,'card_view','2026-01-03T00:00:00.000Z');
  const tables=['ft_works','ft_work_versions','ft_cards','ft_events'];
  const before=tables.map(table=>f.database.prepare('SELECT * FROM '+table+' ORDER BY id').all());f.migrate();
  tables.forEach((table,i)=>assert.deepEqual(f.database.prepare('SELECT * FROM '+table+' ORDER BY id').all(),before[i]));
  assert.deepEqual(new Set(await f.feed()),new Set([a.id,b.id,other.id]));
  const duplicate=await f.publish({bytes:html('legacy')});assert.equal(duplicate.status,409);assert.equal(duplicate.error.code,'DUPLICATE_WORK');assert.equal(duplicate.error.existingWork.id,a.id);
  assert.equal(f.count('ft_works'),3);assert.equal(f.objects.size,3);
});

test('fresh publication is unlisted; exact duplicates across new submissions do not create data or replace originals',async t=>{
  const f=fixture(t),first=await f.publish({cover:true});assert.equal(first.status,201,JSON.stringify(first));
  assert.equal(first.work.discovery.visibility,'unlisted');assert.equal(first.work.discovery.reviewStatus,'unsubmitted');assert.equal(first.work.discovery.eligible,false);assert.deepEqual(await f.feed(),[]);
  const before=f.readWork(first.work.id),keys=[...f.objects.keys()];const duplicate=await f.publish({name:'A renamed duplicate'});
  assert.equal(duplicate.status,409);assert.equal(duplicate.error.code,'DUPLICATE_WORK');assert.equal(duplicate.error.existingWork.id,first.work.id);
  assert.deepEqual(f.readWork(first.work.id),before);assert.deepEqual([...f.objects.keys()],keys);assert.equal(f.count('ft_works'),1);assert.equal(f.count('ft_work_versions'),1);
  const foreign=await f.publish({owner:OTHER});assert.equal(foreign.status,201);assert.notEqual(foreign.work.id,first.work.id);assert.equal(f.count('ft_works'),2);
});

test('grandfathered works stay listed but a new version needs scope and gameplay details before approval',async t=>{
  const f=fixture(t,{legacy:true}),legacy=f.seed();f.migrate();assert.deepEqual(await f.feed(),[legacy.id]);
  const updated=await f.version(legacy.id);assert.equal(updated.status,201);assert.deepEqual(await f.feed(),[]);
  const review=await f.review(legacy.id);assert.equal(review.status,422);assert.equal(review.error.code,'DISCOVERY_DETAILS_REQUIRED');
  await f.submit(legacy.id,{kind:'prototype',playDescription:'Press buttons to explore the new prototype'});assert.equal((await f.review(legacy.id)).status,200);assert.deepEqual(await f.feed(),[legacy.id]);
});

test('a previous deployment writing during migration cannot bypass unlisted defaults or historical deduplication',async t=>{
  const f=fixture(t),legacy=f.seed({bytes:html('rolling deployment')});
  assert.equal(f.count('ft_work_fingerprints'),0);assert.equal((await f.get(legacy.id)).work.discovery.visibility,'unlisted');assert.deepEqual(await f.feed(),[]);
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

test('submission requires game scope, gameplay description and rules acknowledgement; owners cannot self-approve',async t=>{
  const f=fixture(t),{work}=await f.publish();
  for(const patch of [{kind:'tool'},{kind:'unspecified'},{playDescription:' '},{rulesAccepted:false},{rulesAccepted:'true'}]){
    const rejected=await f.submit(work.id,patch);assert.equal(rejected.status,422,JSON.stringify(rejected));
  }
  const submitted=await f.submit(work.id,{reviewStatus:'approved',approvedVersionId:work.versionId,reviewedBy:REVIEWER});assert.equal(submitted.status,200);assert.equal(submitted.work.discovery.reviewStatus,'pending');assert.deepEqual(await f.feed(),[]);
  const forbidden=await f.api('/api/review/works/'+work.id,{method:'POST',body:{decision:'approve',expectedRevision:submitted.work.discovery.revision,versionId:work.versionId,canReview:true,role:'admin'},extraHeaders:{'x-funtrack-reviewer':'true'}});
  assert.equal(forbidden.status,403);assert.equal((await f.api('/api/review/works')).status,403);
  assert.equal((await f.api('/api/me')).canReview,false);assert.equal((await f.api('/api/me',{owner:REVIEWER})).canReview,true);
  assert.equal((await f.api('/api/works/'+work.id+'/discovery',{owner:OTHER})).status,403);
  assert.equal((await f.api('/api/works/'+work.id+'/discovery',{method:'PATCH',owner:OTHER,body:{action:'hide',expectedRevision:submitted.work.discovery.revision}})).status,403);
});

test('approved works enter Feed; hide removes discovery everywhere but preserves direct play, history and card snapshots',async t=>{
  const f=fixture(t),{work}=await f.publish(),submitted=await f.submit(work.id);assert.equal(submitted.status,200);
  const pending=await f.api('/api/review/works?status=pending',{owner:REVIEWER});assert.deepEqual(pending.works.map(w=>w.id),[work.id]);
  const approved=await f.review(work.id);assert.equal(approved.status,200);assert.deepEqual(await f.feed(),[work.id]);
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

test('review races and version changes cannot approve stale content or silently return an updated work to Feed',async t=>{
  const f=fixture(t),{work}=await f.publish();await f.submit(work.id);const oldReview=(await f.get(work.id)).work.discovery;
  const next=await f.version(work.id);assert.equal(next.status,201);const stale=await f.api('/api/review/works/'+work.id,{method:'POST',owner:REVIEWER,body:{decision:'approve',expectedRevision:oldReview.revision,versionId:work.versionId}});
  assert.equal(stale.status,409);assert.equal(stale.error.code,'DISCOVERY_CONFLICT');assert.deepEqual(await f.feed(),[]);
  const current=(await f.get(work.id)).work;assert.equal(current.discovery.reviewStatus,'pending');assert.equal(current.discovery.submittedVersionId,next.version.id);
  const competitors=await Promise.all([f.review(work.id),f.review(work.id,{decision:'reject',note:'Gameplay not demonstrated'})]);assert.deepEqual(competitors.map(x=>x.status).sort(),[200,409]);
  if(competitors[0].status!==200){await f.submit(work.id);await f.review(work.id);}
  assert.deepEqual(await f.feed(),[work.id]);await f.discovery(work.id,'hide');
  const updated=await f.version(work.id,{revision:2,bytes:html('v3')});assert.equal(updated.status,201);
  const state=(await f.get(work.id)).work.discovery;assert.equal(state.visibility,'unlisted');assert.equal(state.reviewStatus,'pending');assert.equal(state.approvedVersionId,null);
  assert.equal((await f.discovery(work.id,'restore')).error.code,'DISCOVERY_REVIEW_REQUIRED');assert.deepEqual(await f.feed(),[]);
  await f.review(work.id);assert.deepEqual(await f.feed(),[]);await f.discovery(work.id,'restore');assert.deepEqual(await f.feed(),[work.id]);
});

test('visible metadata changes invalidate review atomically while an unchanged edit keeps approval',async t=>{
  const f=fixture(t),{work}=await f.publish();await f.submit(work.id);await f.review(work.id);
  const form=(name,revision)=>{const value=new FormData();value.set('name',name);value.set('desc','Click to explore the game');value.set('expectedRevision',String(revision));return value;};
  const unchanged=await f.api('/api/works/'+work.id,{method:'PATCH',body:form('A game',1)});assert.equal(unchanged.status,200);assert.equal(unchanged.operation.changed,false);assert.deepEqual(await f.feed(),[work.id]);
  const edited=await f.api('/api/works/'+work.id,{method:'PATCH',body:form('A different title',1)});assert.equal(edited.status,200);assert.deepEqual(await f.feed(),[]);
  const current=(await f.get(work.id)).work;assert.equal(current.discovery.reviewStatus,'pending');assert.equal(current.discovery.approvedVersionId,null);assert.equal(current.versionId,work.versionId);
  await f.review(work.id);assert.deepEqual(await f.feed(),[work.id]);
});

test('private creator pagination retrieves more than 200 unlisted works without exposing them through public author queries',async t=>{
  const f=fixture(t),expected=[];
  for(let i=0;i<205;i++)expected.push(f.seed({bytes:html('private-'+i),at:new Date(Date.UTC(2026,0,1,0,0,i)).toISOString()}).id);
  f.seed({owner:OTHER,bytes:html('other owner')});
  const found=[];let cursor=null,pages=0;
  do{const result=await f.api('/api/works?mine=1&limit=48'+(cursor?'&cursor='+encodeURIComponent(cursor):''));assert.equal(result.status,200,JSON.stringify(result));assert(result.works.length<=48);found.push(...result.works.map(w=>w.id));cursor=result.nextCursor;assert(++pages<=5);}while(cursor);
  assert.equal(pages,5);assert.equal(found.length,205);assert.equal(new Set(found).size,205);assert.deepEqual(new Set(found),new Set(expected));
  assert.deepEqual((await f.api('/api/discover?author='+OWNER)).works,[]);assert.deepEqual((await f.api('/api/works?author='+OWNER)).works,[]);
  assert.equal((await f.api('/api/works?mine=1',{owner:OTHER})).works.length,1);
});

test('review rejection requires a reason and can be corrected without losing work or author data',async t=>{
  const f=fixture(t),{work}=await f.publish();await f.submit(work.id);
  assert.equal((await f.review(work.id,{decision:'reject',note:''})).status,422);
  const rejected=await f.review(work.id,{decision:'reject',note:'Describe a playable interaction'});assert.equal(rejected.status,200);assert.equal(rejected.work.discovery.reviewStatus,'rejected');assert.equal(rejected.work.discovery.reviewNote,'Describe a playable interaction');assert.deepEqual(await f.feed(),[]);
  assert.equal((await f.discovery(work.id,'restore')).error.code,'DISCOVERY_REVIEW_REQUIRED');const corrected=await f.submit(work.id,{kind:'interactive_story',playDescription:'Choose a door and reveal the next scene'});assert.equal(corrected.status,200);assert.equal(corrected.work.discovery.reviewNote,'');assert.equal(corrected.work.discovery.reviewStatus,'pending');
  await f.review(work.id);assert.deepEqual(await f.feed(),[work.id]);assert.equal(f.count('ft_works'),1);assert.equal(f.count('ft_work_versions'),1);
});

test('new version and rollback preserve immutable old card and file while both require fresh Feed approval',async t=>{
  const f=fixture(t),{work}=await f.publish();await f.submit(work.id);await f.review(work.id);
  const {card}=await f.api('/api/cards',{method:'POST',body:{name:'Creator',bio:'Original',template:'fold',workIds:[work.id],workRefs:[{workId:work.id,versionId:work.versionId,metadataId:work.metadataId}]}});
  const snapshot=f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json,original=f.objects.get('games/'+work.versionId+'.html').slice();
  assert.equal((await f.api('/api/events',{method:'POST',owner:OTHER,body:{eventId:randomUUID(),workId:work.id,type:'work_view'}})).status,200);
  assert.equal((await f.api('/api/feedback',{method:'POST',owner:OTHER,body:{eventId:randomUUID(),workId:work.id,type:'建议',text:'Keep this first-version feedback'}})).status,201);
  const dataTables=['ft_events','ft_feedback'],dataBefore=dataTables.map(table=>f.database.prepare('SELECT * FROM '+table+' ORDER BY id').all());
  assert(dataBefore.every(rows=>rows.length>0));
  const v2=await f.version(work.id);assert.equal(v2.status,201);assert.deepEqual(await f.feed(),[]);await f.review(work.id);assert.deepEqual(await f.feed(),[work.id]);
  const back=await f.api('/api/works/'+work.id+'/activate',{method:'POST',body:{versionId:work.versionId,expectedRevision:2}});assert.equal(back.status,200);assert.equal(back.current.versionId,work.versionId);assert.deepEqual(await f.feed(),[]);
  assert.equal(f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json,snapshot);assert.deepEqual(f.objects.get('games/'+work.versionId+'.html'),original);assert.equal(f.count('ft_work_versions'),2);assert.equal(f.readWork(work.id).revision,3);
  dataTables.forEach((table,index)=>assert.deepEqual(f.database.prepare('SELECT * FROM '+table+' ORDER BY id').all(),dataBefore[index]));
});
