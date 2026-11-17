import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createVersionService} from '../lib/funtrack/version-service.mjs';
import {publicationArtifact} from '../lib/funtrack/publication-artifact.mjs';
import {expectedRevision,cardWorkRefs,versionPage,versionCursor} from '../lib/funtrack/version-rules.mjs';
import {ApiError} from '../lib/funtrack/rules.mjs';

function fixture(){
  const database=new DatabaseSync(':memory:');database.exec('PRAGMA foreign_keys=ON');
  for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())database.exec(readFileSync('drizzle/'+file,'utf8'));
  const ids={work:randomUUID(),version:randomUUID()},user={id:'version-unit-owner'},at='2026-01-01T00:00:00.000Z';
  database.prepare('INSERT INTO ft_works(id,author_id,author_name,name,description,source,current_version_id,created_at,idempotency_key,request_hash,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(ids.work,user.id,'Owner','Fixture','Fixture','html',ids.version,at,randomUUID(),'initial',at);
  database.prepare('INSERT INTO ft_work_versions(id,work_id,version,game_key,cover_key,cover_mime,created_at,created_by) VALUES(?,?,?,?,?,?,?,?)').run(ids.version,ids.work,'v1','games/v1.html','covers/v1','image/png',at,user.id);
  const objects=new Map([['games/v1.html',new TextEncoder().encode('<html>v1</html>')],['covers/v1',new Uint8Array([1,2,3])]]),deleted=[];
  const faults={put:false,beforeCommit:false,afterCommit:false,readAfterCommit:false};
  function prepare(query){return {query,values:[],bind(...values){this.values=values;return this;},async first(){if(faults.readAfterCommit&&query.includes('ft_version_operations'))throw Error('read unavailable');return database.prepare(query).get(...this.values)||null;},async all(){return {results:database.prepare(query).all(...this.values)};}};}
  const db={prepare,async batch(statements){
    if(faults.beforeCommit){faults.beforeCommit=false;throw Error('commit unavailable');}
    database.exec('BEGIN');let result;
    try{result=statements.map(s=>({meta:{changes:database.prepare(s.query).run(...s.values).changes},results:[]}));database.exec('COMMIT');}catch(error){database.exec('ROLLBACK');throw error;}
    if(faults.afterCommit){faults.afterCommit=false;throw Error('commit response lost');}
    return result;
  }};
  const bucket={async put(key,bytes){if(faults.put){faults.put=false;throw Error('R2 unavailable');}objects.set(key,bytes);},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys]){deleted.push(key);objects.delete(key);}}};
  const readWork=()=>database.prepare('SELECT w.*,v.version,v.cover_key,v.cover_mime FROM ft_works w JOIN ft_work_versions v ON v.id=w.current_version_id WHERE w.id=?').get(ids.work);
  const service=createVersionService({db:()=>db,bucket:()=>bucket,ownWork:async(id,actor)=>{const w=readWork();if(id!==w.id)throw new ApiError(404,'WORK_NOT_FOUND','missing');if(actor.id!==w.author_id)throw new ApiError(403,'NOT_OWNER','owner');return w;},workJSON:w=>({id:w.id,versionId:w.current_version_id,revision:w.revision}),hash:async value=>createHash('sha256').update(value).digest('hex'),readForm:req=>req.formData(),readArtifact:(form,source,owner)=>publicationArtifact(form,source,owner,async()=>{throw Error('no build fixture');}),bodyJSON:req=>req.json()});
  const publish=(revision=1,key=randomUUID(),text='v2',cover=false)=>{
    const form=new FormData();form.set('file',new File(['<!doctype html><html>'+text+'</html>'],'game.html',{type:'text/html'}));form.set('expectedRevision',String(revision));form.set('releaseNotes',text);
    if(cover)form.set('cover',new File([new Uint8Array([137,80,78,71,13,10,26,10,0])],'cover.png',{type:'image/png'}));
    return service(new Request('https://site.test/api/works/'+ids.work+'/versions',{method:'POST',headers:{'Idempotency-Key':key},body:form}),user);
  };
  const activate=(target,revision,key=randomUUID())=>service(new Request('https://site.test/api/works/'+ids.work+'/activate',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({versionId:target,expectedRevision:revision})}),user);
  const count=table=>database.prepare('SELECT COUNT(*) n FROM '+table).get().n;
  return {database,ids,user,objects,deleted,faults,service,publish,activate,readWork,count};
}

test('revision and cursor inputs stay bounded and card references match preview order',()=>{
  assert.equal(expectedRevision('12'),12);for(const value of [undefined,null,0,-1,'1.0','01',Number.MAX_SAFE_INTEGER])assert.throws(()=>expectedRevision(value));
  assert.deepEqual(cardWorkRefs(['work-a'],[{workId:'work-a',versionId:'version-a'}]),[{workId:'work-a',versionId:'version-a'}]);
  assert.throws(()=>cardWorkRefs(['work-a'],[{workId:'work-b',versionId:'version-a'}]));
  assert.deepEqual(cardWorkRefs(['work-a'],[{workId:'work-a',versionId:'version-a',metadataId:'metadata-one'}]),[{workId:'work-a',versionId:'version-a',metadataId:'metadata-one'}]);
  assert.deepEqual(cardWorkRefs(['work-a'],[{workId:'work-a',versionId:'version-a',metadataId:null}]),[{workId:'work-a',versionId:'version-a'}]);
  assert.throws(()=>cardWorkRefs(['work-a'],[{workId:'work-a',versionId:'version-a',metadataId:12}]));
  assert.deepEqual(cardWorkRefs(['work-a'],[{workId:'work-a',versionId:'version-a',expectedRevision:2}]),[{workId:'work-a',versionId:'version-a',expectedRevision:2}]);
  assert.throws(()=>cardWorkRefs(['work-a'],[{workId:'work-a',versionId:'version-a',expectedRevision:0}]));
  assert.deepEqual(versionPage(new URLSearchParams({cursor:versionCursor('work-a',8)}),'work-a'),{limit:20,before:8});
  assert.throws(()=>versionPage(new URLSearchParams({cursor:versionCursor('work-b',8)}),'work-a'));
});
test('version publication freezes operation response, inherits cover, survives rollback and prevents ABA',async()=>{
  const f=fixture(),key=randomUUID();const response=await f.publish(1,key),v2=await response.json();assert.equal(response.status,201);assert.equal(v2.version.ordinal,2);assert.equal(v2.operation.revision,2);assert.equal(f.count('ft_works'),1);assert.equal(v2.version.coverUrl,'/media/'+v2.version.id);
  assert.equal(f.database.prepare('SELECT cover_key FROM ft_work_versions WHERE id=?').get(v2.version.id).cover_key,'covers/v1');
  const back=await (await f.activate(f.ids.version,2)).json();assert.equal(back.operation.revision,3);
  const replay=await (await f.publish(1,key)).json();assert.deepEqual(replay.operation,v2.operation);assert.deepEqual(replay.version,v2.version);assert.equal(replay.current.versionId,f.ids.version);assert.equal(f.readWork().revision,3);
  await assert.rejects(()=>f.publish(1,randomUUID(),'stale'),e=>e.code==='VERSION_CONFLICT');
  const v3=await (await f.publish(3,randomUUID(),'v3')).json();assert.equal(v3.version.ordinal,3);assert.equal(f.readWork().revision,4);
  await assert.rejects(()=>f.publish(1,key,'different'),e=>e.code==='IDEMPOTENCY_CONFLICT');f.database.close();
});
test('simultaneous publishers produce one new version and a conflict, same-key racers replay',async()=>{
  const f=fixture(),results=await Promise.allSettled([f.publish(1,randomUUID(),'left'),f.publish(1,randomUUID(),'right')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'VERSION_CONFLICT');assert.equal(f.count('ft_work_versions'),2);assert.equal(f.count('ft_version_operations'),1);
  const key=randomUUID(),same=await Promise.all([f.publish(2,key,'same'),f.publish(2,key,'same')]);assert.deepEqual(same.map(r=>r.status).sort(),[200,201]);assert.equal(f.count('ft_work_versions'),3);assert.equal(f.count('ft_version_operations'),2);f.database.close();
});
test('activation no-op is recorded once and old activation replay cannot reset a later pointer',async()=>{
  const f=fixture(),key=randomUUID(),noop=await (await f.activate(f.ids.version,1,key)).json();assert.equal(noop.operation.changed,false);assert.equal(noop.operation.revision,1);
  const v2=await (await f.publish()).json();const retry=await (await f.activate(f.ids.version,1,key)).json();assert.deepEqual(retry.operation,noop.operation);assert.equal(retry.current.versionId,v2.version.id);assert.equal(f.readWork().revision,2);
  await assert.rejects(()=>f.activate(f.ids.version,1),e=>e.code==='VERSION_CONFLICT');f.database.close();
});
test('R2 failure or a database rejection never switches or removes the existing version',async()=>{
  for(const fault of ['put','beforeCommit']){const f=fixture();f.faults[fault]=true;await assert.rejects(()=>f.publish());assert.equal(f.readWork().current_version_id,f.ids.version);assert.equal(f.count('ft_work_versions'),1);assert.equal(f.count('ft_version_operations'),0);assert(f.objects.has('games/v1.html'));assert(f.objects.has('covers/v1'));assert.equal(f.objects.size,2);f.database.close();}
});
test('a zero-row CAS forces SQL rollback, including version and operation inserts',async()=>{
  const f=fixture();f.database.exec("CREATE TRIGGER refuse_pointer BEFORE UPDATE OF current_version_id ON ft_works BEGIN SELECT RAISE(IGNORE); END");
  await assert.rejects(()=>f.publish(),/NOT NULL constraint failed/);assert.equal(f.readWork().revision,1);assert.equal(f.count('ft_work_versions'),1);assert.equal(f.count('ft_version_operations'),0);assert.equal(f.objects.size,2);f.database.close();
});
test('lost commit response recovers the operation without deleting its R2 objects',async()=>{
  const f=fixture();f.faults.afterCommit=true;const result=await (await f.publish(1,randomUUID(),'v2',true)).json();assert.equal(result.operation.revision,2);assert.equal(f.count('ft_work_versions'),2);assert(f.objects.has('games/'+result.version.id+'.html'));assert(f.objects.has('covers/'+result.version.id));assert.deepEqual(f.deleted,[]);f.database.close();
});
test('an uncertain recovery read conservatively retains possibly committed objects',async()=>{
  const f=fixture();const original=f.faults;
  // Block only recovery reads after the transaction committed and its response
  // was lost. The initial idempotency lookup must still run normally.
  const trigger=f.database.prepare('SELECT COUNT(*) n FROM ft_version_operations');
  Object.defineProperty(original,'readAfterCommit',{get:()=>trigger.get().n>0});original.afterCommit=true;
  await assert.rejects(()=>f.publish(),/read unavailable/);assert.equal(f.count('ft_work_versions'),2);assert.equal(f.objects.size,3);assert.deepEqual(f.deleted,[]);f.database.close();
});
