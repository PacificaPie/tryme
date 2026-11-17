import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createWorkEditService} from '../lib/funtrack/work-edit-service.mjs';
import {createVersionService} from '../lib/funtrack/version-service.mjs';
import {publicationArtifact} from '../lib/funtrack/publication-artifact.mjs';
import {ApiError} from '../lib/funtrack/rules.mjs';

function fixture(){
  const database=new DatabaseSync(':memory:');database.exec('PRAGMA foreign_keys=ON');
  for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())database.exec(readFileSync('drizzle/'+file,'utf8'));
  const work=randomUUID(),version=randomUUID(),user={id:'edit-owner'},at='2026-01-01T00:00:00Z';
  database.prepare('INSERT INTO ft_works(id,author_id,author_name,name,description,source,current_version_id,created_at,idempotency_key,request_hash,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(work,user.id,'Owner','Original','Old description','html',version,at,randomUUID(),'initial',at);
  database.prepare('INSERT INTO ft_work_versions(id,work_id,version,game_key,cover_key,cover_mime,created_at) VALUES(?,?,?,?,?,?,?)').run(version,work,'v1','game-v1','cover-v1','image/png',at);
  const objects=new Map([['game-v1',new TextEncoder().encode('<html>v1</html>')],['cover-v1',new Uint8Array([1,2,3])]]),faults={put:false,before:false,after:false,read:false};
  const count=table=>database.prepare('SELECT COUNT(*) n FROM '+table).get().n;
  function prepare(query){return {query,values:[],bind(...values){this.values=values;return this;},async first(){if(faults.read&&query.includes('ft_work_edit_operations')&&count('ft_work_edit_operations'))throw Error('read lost');return database.prepare(query).get(...this.values)||null;},async all(){return {results:database.prepare(query).all(...this.values)};}};}
  const db={prepare,async batch(statements){if(faults.before){faults.before=false;throw Error('before commit');}database.exec('BEGIN');let results;try{results=statements.map(s=>({meta:{changes:database.prepare(s.query).run(...s.values).changes}}));database.exec('COMMIT');}catch(error){database.exec('ROLLBACK');throw error;}if(faults.after){faults.after=false;throw Error('response lost');}return results;}};
  const bucket={async put(key,value){if(faults.put){faults.put=false;throw Error('put failed');}objects.set(key,value);},async delete(keys){for(const key of keys)objects.delete(key);}};
  const readWork=()=>database.prepare(`SELECT w.*,v.version,v.game_key,v.provenance_json,CASE WHEN m.id IS NOT NULL THEN m.cover_key ELSE v.cover_key END cover_key,CASE WHEN m.id IS NOT NULL THEN m.cover_mime ELSE v.cover_mime END cover_mime FROM ft_works w JOIN ft_work_versions v ON v.id=w.current_version_id LEFT JOIN ft_work_metadata m ON m.id=w.current_metadata_id WHERE w.id=?`).get(work);
  const workJSON=w=>({id:w.id,name:w.name,desc:w.description,versionId:w.current_version_id,version:w.version,revision:w.revision,metadataId:w.current_metadata_id||null,coverUrl:w.cover_key?'/media/'+(w.current_metadata_id||w.current_version_id):'',updatedAt:w.updated_at});
  const deps={db:()=>db,bucket:()=>bucket,ownWork:async(id,actor)=>{if(id!==work)throw new ApiError(404,'WORK_NOT_FOUND','missing');if(actor.id!==user.id)throw new ApiError(403,'NOT_OWNER','owner');return readWork();},workJSON,hash:async value=>createHash('sha256').update(value).digest('hex'),readForm:req=>req.formData()};
  const service=createWorkEditService(deps),versions=createVersionService({...deps,readArtifact:(form,source,owner)=>publicationArtifact(form,source,owner,()=>{throw Error('unused');}),bodyJSON:req=>req.json()});
  const edit=({revision=1,key=randomUUID(),name='Updated',desc='New description',cover=false,actor=user,extra}={})=>{const form=new FormData();form.set('name',name);form.set('desc',desc);form.set('expectedRevision',String(revision));if(cover)form.set('cover',new File([new Uint8Array([137,80,78,71,13,10,26,10,5])],'cover.png',{type:'image/png'}));if(extra)form.set(extra,'forbidden');return service(new Request('https://site.test/api/works/'+work,{method:'PATCH',headers:{'Idempotency-Key':key},body:form}),actor);};
  const publish=(revision=1)=>{const form=new FormData();form.set('file',new File(['<html>v2</html>'],'game.html',{type:'text/html'}));form.set('expectedRevision',String(revision));return versions(new Request('https://site.test/api/works/'+work+'/versions',{method:'POST',headers:{'Idempotency-Key':randomUUID()},body:form}),user);};
  const activate=(id,revision)=>versions(new Request('https://site.test/api/works/'+work+'/activate',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({versionId:id,expectedRevision:revision})}),user);
  return {database,work,version,user,objects,faults,count,readWork,edit,publish,activate};
}
test('legacy edit lazily snapshots original text, freezes new cover, and leaves game versions untouched',async()=>{
  const f=fixture();assert.equal(f.readWork().current_metadata_id,null);assert.equal(f.count('ft_work_metadata'),0);
  const old=f.database.prepare('SELECT * FROM ft_work_versions').get(),result=await (await f.edit({cover:true})).json();
  assert.equal(result.work.name,'Updated');assert.equal(result.work.versionId,f.version);assert.equal(result.work.revision,2);assert.equal(result.operation.changed,true);
  assert.deepEqual(f.database.prepare('SELECT * FROM ft_work_versions').get(),old);assert.deepEqual(f.objects.get('cover-v1'),new Uint8Array([1,2,3]));
  const initial=f.database.prepare('SELECT * FROM ft_work_metadata WHERE id=?').get(f.readWork().initial_metadata_id);
  assert.equal(initial.name,'Original');assert.equal(initial.cover_key,'cover-v1');assert.equal(f.count('ft_work_metadata'),2);assert.equal(f.count('ft_work_versions'),1);f.database.close();
});
test('edit retries return frozen work and operation while current points to later state',async()=>{
  const f=fixture(),key=randomUUID(),first=await (await f.edit({key,cover:true})).json();
  await f.edit({revision:2,name:'Later'});const replay=await (await f.edit({key,cover:true})).json();
  assert.deepEqual(replay.work,first.work);assert.deepEqual(replay.operation,first.operation);assert.equal(replay.current.revision,3);assert.equal(f.readWork().name,'Later');
  await assert.rejects(()=>f.edit({key,name:'Different',cover:true}),e=>e.code==='IDEMPOTENCY_CONFLICT');f.database.close();
});
test('no-op edits preserve revision and metadata and cannot reverse later changes on replay',async()=>{
  const f=fixture(),key=randomUUID(),before=f.readWork(),noop=await (await f.edit({key,name:'Original',desc:'Old description'})).json();
  assert.equal(noop.operation.changed,false);assert.equal(noop.work.metadataId,null);assert.deepEqual(f.readWork(),before);assert.equal(f.count('ft_work_metadata'),0);
  await f.edit();const replay=await (await f.edit({key,name:'Original',desc:'Old description'})).json();assert.deepEqual(replay.work,noop.work);assert.equal(replay.current.revision,2);assert.equal(f.readWork().name,'Updated');f.database.close();
});
test('concurrent editors and game publication share one CAS revision; same-key edits replay once',async()=>{
  for(const competition of ['edit','version']){const f=fixture();const results=await Promise.allSettled([f.edit({cover:true}),competition==='edit'?f.edit({name:'Other'}):f.publish()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert(['WORK_CONFLICT','VERSION_CONFLICT'].includes(results.find(r=>r.status==='rejected').reason.code));assert.equal(f.readWork().revision,2);f.database.close();}
  const f=fixture(),key=randomUUID(),results=await Promise.all([f.edit({key,cover:true}),f.edit({key,cover:true})]);assert.deepEqual(await results[0].json(),await results[1].json());assert.equal(f.count('ft_work_edit_operations'),1);assert.equal(f.count('ft_work_metadata'),2);assert.equal(f.objects.size,3);f.database.close();
});
test('a new game inherits the edited cover; rollback preserves new text and restores historical version cover',async()=>{
  const f=fixture();await f.edit({cover:true});const edited=f.readWork(),v2=await (await f.publish(2)).json();
  assert.equal(f.readWork().cover_key,edited.cover_key);assert.equal(f.database.prepare('SELECT cover_key FROM ft_work_versions WHERE id=?').get(v2.version.id).cover_key,edited.cover_key);
  await f.activate(f.version,3);assert.equal(f.readWork().name,'Updated');assert.equal(f.readWork().description,'New description');assert.equal(f.readWork().cover_key,'cover-v1');assert.equal(f.readWork().revision,4);f.database.close();
});
test('R2 and transaction faults do not leave partial metadata or replace existing cover',async()=>{
  for(const fault of ['put','before']){const f=fixture(),before=f.readWork();f.faults[fault]=true;await assert.rejects(()=>f.edit({cover:true}));assert.deepEqual(f.readWork(),before);assert.equal(f.count('ft_work_metadata'),0);assert.equal(f.count('ft_work_edit_operations'),0);assert.equal(f.objects.size,2);f.database.close();}
  const f=fixture();f.database.exec('CREATE TRIGGER ignore_work BEFORE UPDATE ON ft_works BEGIN SELECT RAISE(IGNORE); END');await assert.rejects(()=>f.edit({cover:true}),/NOT NULL constraint failed/);assert.equal(f.count('ft_work_metadata'),0);assert.equal(f.count('ft_work_edit_operations'),0);assert.equal(f.objects.size,2);f.database.close();
});
test('lost commit response recovers the immutable edit and failed recovery retains committed assets',async()=>{
  const f=fixture();f.faults.after=true;const result=await (await f.edit({cover:true})).json();assert.equal(result.current.revision,2);assert.equal(f.objects.size,3);f.database.close();
  const g=fixture();g.faults.after=true;g.faults.read=true;await assert.rejects(()=>g.edit({cover:true}),/read lost/);assert.equal(g.readWork().revision,2);assert.equal(g.objects.size,3);assert.equal(g.count('ft_work_metadata'),2);g.database.close();
});
test('editing only permits owned work metadata fields',async()=>{
  const f=fixture();await assert.rejects(()=>f.edit({actor:{id:'other'}}),e=>e.code==='NOT_OWNER');
  for(const extra of ['file','source','url','removeCover'])await assert.rejects(()=>f.edit({extra}),e=>e.code==='INVALID_WORK_FIELDS');assert.equal(f.count('ft_work_metadata'),0);f.database.close();
});
