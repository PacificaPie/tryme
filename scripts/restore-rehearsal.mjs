// Restore an already exported D1 snapshot and its permanent R2 references into
// fresh local resources. The only remote operation is R2 object GET. This tool
// cannot import into, change, restore or delete a remote resource.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile,mkdir,chmod} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {getPlatformProxy} from 'wrangler';
import {configureToolEnvironment} from './tool-environment.mjs';
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--export'||args[2]!=='--source-config')throw Error('Usage: node scripts/restore-rehearsal.mjs --export .backups/<snapshot>.sql --source-config wrangler.standalone.production.jsonc');
configureToolEnvironment(process.cwd());process.umask(0o077);
const started=Date.now(),source=JSON.parse(await readFile(args[3],'utf8'));
const bucket=source.r2_buckets?.find(b=>b.binding==='BUCKET')?.bucket_name;if(!bucket)throw Error('Source config must declare BUCKET');
const exportFile=path.resolve(args[1]),directory=path.join(path.dirname(exportFile),'rehearsal-'+randomUUID());await mkdir(directory,{recursive:false,mode:0o700});await chmod(exportFile,0o600);
const objectDir=path.join(directory,'objects');await mkdir(objectDir,{mode:0o700});
const dump=await readFile(exportFile,'utf8'),sourceDB=new DatabaseSync(':memory:');sourceDB.exec('PRAGMA foreign_keys=OFF;BEGIN;'+dump+'\nCOMMIT;');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=rows=>JSON.stringify(rows.map(row=>Object.fromEntries(Object.keys(row).sort().map(k=>[k,row[k]]))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
const tables=sourceDB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ft_%' ORDER BY name").all().map(r=>r.name);
assert(tables.length>0);assert.deepEqual(sourceDB.prepare('PRAGMA foreign_key_check').all(),[]);
const references=new Map();
for(const [table,column,filter] of [
 ['ft_work_versions','game_key','1'],['ft_work_versions','cover_key','1'],['ft_work_metadata','cover_key','1'],
 ['ft_profile_avatars','object_key','1'],['ft_video_preview_jobs','object_key',"status='ready'"],
]){
 if(!tables.includes(table))continue;
 for(const {key} of sourceDB.prepare(`SELECT DISTINCT ${column} key FROM ${table} WHERE ${column} IS NOT NULL AND ${column}<>'' AND ${filter}`).all())references.set(key,{key,file:hash(key)});
}
assert(references.size<=1000,'More than 1,000 permanent objects; plan a larger rehearsal explicitly.');
const run=promisify(execFile),cli=['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js'];
async function wrangler(args){try{return await run(process.execPath,[...cli,...args],{env:{...process.env,CI:'true'},maxBuffer:16*1024*1024,timeout:120000});}catch{throw Error('Wrangler operation failed ('+args.slice(0,3).join(' ')+'); private output was not printed.');}}
let bytes=0,downloaded=0;
const pending=[...references.values()];
await Promise.all(Array.from({length:Math.min(3,pending.length)},async()=>{
 while(pending.length){const object=pending.shift(),file=path.join(objectDir,object.file);
  await wrangler(['r2','object','get',bucket+'/'+object.key,'--remote','--config',path.resolve(args[3]),'--file',file]);
  const body=await readFile(file);object.bytes=body.length;object.sha256=hash(body);bytes+=body.length;
  assert(bytes<=512*1024*1024,'Permanent objects exceed 512 MiB; plan storage before continuing.');
  console.log(JSON.stringify({phase:'download',completed:++downloaded,total:references.size}));
 }
}));
for(const row of sourceDB.prepare('SELECT game_key,content_hash FROM ft_work_versions WHERE game_key IS NOT NULL AND content_hash IS NOT NULL').all())assert.equal(references.get(row.game_key)?.sha256,row.content_hash,'Game bytes differ from saved version hash');
const localConfig=path.join(directory,'wrangler.json'),state=path.join(directory,'state');
await writeFile(localConfig,JSON.stringify({name:'tryme-isolated-restore',compatibility_date:'2026-05-15',d1_databases:[{binding:'DB',database_name:'restore-local',database_id:randomUUID()}],r2_buckets:[{binding:'BUCKET',bucket_name:'restore-local'}]}));
// D1 exports can place child rows before a referenced table exists. Rebuild
// schema and unique indexes before rows (FKs may reference those indexes),
// then triggers, so historical inserts do not replay side effects.
const schema=sourceDB.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
const quote=name=>'"'+name.replaceAll('"','""')+'"';
const literal=value=>value===null?'NULL':typeof value==='number'?String(value):value instanceof Uint8Array?"X'"+Buffer.from(value).toString('hex')+"'":"'"+String(value).replaceAll("'","''")+"'";
const canonicalSQL=['PRAGMA defer_foreign_keys=TRUE;',...schema.filter(s=>s.type==='table').map(s=>s.sql+';'),...schema.filter(s=>['index','view'].includes(s.type)).map(s=>s.sql+';')];
for(const table of schema.filter(s=>s.type==='table'))for(const row of sourceDB.prepare('SELECT * FROM '+quote(table.name)).all())canonicalSQL.push('INSERT INTO '+quote(table.name)+' ('+Object.keys(row).map(quote).join(',')+') VALUES ('+Object.values(row).map(literal).join(',')+');');
canonicalSQL.push(...schema.filter(s=>s.type==='trigger').map(s=>s.sql+';'));
const importFile=path.join(directory,'local-import.sql');await writeFile(importFile,canonicalSQL.join('\n'));
await wrangler(['d1','execute','DB','--local','--config',localConfig,'--persist-to',state,'--file',importFile]);
const proxy=await getPlatformProxy({configPath:localConfig,persist:{path:path.join(state,'v3')}});
try{
 const DB=proxy.env.DB,BUCKET=proxy.env.BUCKET,tableChecks=[];
 for(const table of tables){assert(/^[a-z0-9_]+$/.test(table));const expected=sourceDB.prepare('SELECT * FROM '+table).all(),actual=(await DB.prepare('SELECT * FROM '+table).all()).results;
  assert.equal(hash(canonical(actual)),hash(canonical(expected)),'Restored rows differ: '+table);tableChecks.push({table,rows:actual.length,sha256:hash(canonical(actual))});}
 assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results,[]);
 for(const object of references.values()){
  const body=await readFile(path.join(objectDir,object.file));await BUCKET.put(object.key,body);
  const restored=await BUCKET.get(object.key);assert(restored);assert.equal(hash(Buffer.from(await restored.arrayBuffer())),object.sha256,'Restored object hash differs');
 }
 // JSON card references are not covered by SQL foreign keys.
 let cards=0,workRefs=0;
 for(const row of sourceDB.prepare('SELECT snapshot_json FROM ft_cards').all()){
  const card=JSON.parse(row.snapshot_json);cards++;
  for(const work of card.works||[]){workRefs++;
   assert(sourceDB.prepare('SELECT id FROM ft_work_versions WHERE id=? AND work_id=?').get(work.versionId,work.id),'Missing saved game version');
   for(const id of [work.metadataId,work.coverMetadataId].filter(Boolean))assert(sourceDB.prepare('SELECT id FROM ft_work_metadata WHERE id=? AND work_id=?').get(id,work.id),'Missing saved metadata');
  }
 }
 const summary={passed:true,scope:'Production D1 export and permanent referenced R2 objects restored into fresh local D1/R2 only',sourceWorker:source.name,tables:tables.length,rows:tableChecks.reduce((n,t)=>n+t.rows,0),objects:references.size,bytes,cards,cardWorkReferences:workRefs,elapsedMs:Date.now()-started,remoteWrites:false,temporaryCaptureDraftsIncluded:false};
 await writeFile(path.join(directory,'manifest.json'),JSON.stringify({summary,exportSha256:hash(dump),tables:tableChecks,objects:[...references.values()]},null,2)+'\n');
 await writeFile(path.join(directory,'summary.json'),JSON.stringify(summary,null,2)+'\n');
 console.log(JSON.stringify({directory,...summary},null,2));
}finally{await proxy.dispose();sourceDB.close();}
