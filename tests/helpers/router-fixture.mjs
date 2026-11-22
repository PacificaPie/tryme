import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import ts from 'typescript';

// Exercise the real HTTP router, SQL, transactions, publication/version logic,
// ownership checks and Feed queries. Only platform bindings and unrelated
// analytics/build transport are replaced; repository bytes still pass the real
// publication-artifact validator. No network or cloud resources are touched.
const source=readFileSync(new URL('../../lib/funtrack/server.ts',import.meta.url),'utf8')
  .replace("import { env } from 'cloudflare:workers';",'let env = {}; export function testBindings(value){env=value;}')
  .replace(/import \{ handleBuildAPI, handleBuildWorker, getBuildArtifact \} from '\.\/build-service';/,
    `const handleBuildAPI=async()=>null,handleBuildWorker=async()=>null;
     const getBuildArtifact=async(id,owner)=>{const value=env.testBuilds.get(id);if(!value||value.owner!==owner)throw new ApiError(404,'BUILD_NOT_FOUND','missing');return {bytes:value.bytes,provenance:value.provenance};};`)
  .replace(/import \{ analyticsResponse \} from '\.\/analytics';/,'const analyticsResponse=async()=>{throw Error("Analytics is outside this fixture");};')
  .replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL('../../lib/funtrack/'+path.slice(2),import.meta.url).href}'`);
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {handleAPI,gameResponse,mediaResponse,publicCardPageResponse,testBindings}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const OWNER='publication-owner',OTHER='publication-other',REVIEWER='publication-reviewer';
const html=label=>`<!doctype html><html><body><button>${label}</button></body></html>`;
const digest=value=>createHash('sha256').update(value).digest('hex');
const migrations=readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort();
const png=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);

export function fixture(t,{legacy=false,through=legacy?6:Infinity,autoCover=false,autoPreview=false,externalCover=false,prepublish=false,moderators=''}={}){
  const database=new DatabaseSync(':memory:');t.after(()=>database.close());database.exec('PRAGMA foreign_keys=ON');
  const applied=migrations.filter(file=>Number(file.slice(0,4))<=through),added=migrations.filter(file=>Number(file.slice(0,4))>through);
  for(const file of applied)database.exec(readFileSync('drizzle/'+file,'utf8'));
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
  testBindings({DB:db,BUCKET:bucket,FUNTRACK_MODERATOR_IDS:moderators,...prepublish?{FUNTRACK_PREPUBLISH_MEDIA_REQUIRED:"1"}:{},FUNTRACK_REVIEWER_IDS:REVIEWER,testBuilds,...autoCover?{FUNTRACK_AUTO_COVER_ENABLED:'1',BROWSER:{fetch:async()=>{throw Error('No real browser in the local fixture');}}}:{},...externalCover?{FUNTRACK_COVER_REVIEW_ENABLED:'1',BROWSER:{fetch:async()=>{throw Error('No real browser in the local fixture');}}}:{},...autoPreview?{FUNTRACK_VIDEO_PREVIEW_ENABLED:'1',BROWSER:{fetch:async()=>{throw Error('No real browser in the local fixture');}}}:{}});
  function request(path,{method='GET',body,owner=OWNER,key=randomUUID(),extraHeaders={}}={}){
    const headers={'oai-authenticated-user-id':owner,'oai-authenticated-user-email':owner+'@example.test','oai-authenticated-user-full-name':owner};
    if(method!=='GET'){headers.Origin='https://site.test';headers['X-Funtrack-CSRF']='1';headers['Idempotency-Key']=key;if(!(body instanceof FormData))headers['Content-Type']='application/json';}
    Object.assign(headers,extraHeaders);
    return new Request('https://site.test'+path,{method,headers,...(method==='GET'?{}:{body:body instanceof FormData?body:JSON.stringify(body||{})})});
  }
  const api=async(path,options)=>{const response=await handleAPI(request(path,options));return {status:response.status,...await response.json()};};
  const publish=({bytes=html('v1'),owner=OWNER,key=randomUUID(),name='A game',source='html',url,cover=false,buildId,extra={},category}={})=>{
    const form=new FormData();form.set('name',name);form.set('desc','Click to explore the game');form.set('source',source);if(category!==undefined)form.set('category',category);
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
  return {database,db,bucket,objects,deleted,faults,testBuilds,request,api,publish,version,get,discovery,count,readWork,feed,seed,migrate};
}


export {OWNER,OTHER,REVIEWER,html,digest,gameResponse,mediaResponse,publicCardPageResponse,handleAPI};
