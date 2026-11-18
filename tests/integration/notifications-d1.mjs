// Replay the real router's bound SQL into a fresh local D1, including triggers,
// grouped reads and read acknowledgements. Never accepts a remote target.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {configureToolEnvironment} from '../../scripts/tool-environment.mjs';
import {fixture,OWNER,OTHER,REVIEWER} from '../helpers/router-fixture.mjs';

configureToolEnvironment(process.cwd());
const directory=path.resolve('.preview/notifications/d1-'+randomUUID());await mkdir(directory,{recursive:true});
const config=path.join(directory,'wrangler.json'),state=path.join(directory,'state'),sqlFile=path.join(directory,'smoke.sql');
await writeFile(config,JSON.stringify({name:'notifications-local-smoke',compatibility_date:'2026-05-15',d1_databases:[{binding:'DB',database_name:'notifications-local-smoke',database_id:randomUUID(),migrations_dir:path.resolve('drizzle')}]}));
const run=args=>execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1',...args,'DB','--local','--config',config,'--persist-to',state],{encoding:'utf8',maxBuffer:16*1024*1024,timeout:60000});
run(['migrations','apply']);
const cleanups=[],f=fixture({after:fn=>cleanups.push(fn)}),queries=[];
const prepare=f.db.prepare.bind(f.db),batch=f.db.batch.bind(f.db);
f.db.prepare=query=>{const statement=prepare(query);for(const method of ['first','all','run']){const original=statement[method].bind(statement);statement[method]=async()=>{queries.push({query,values:[...statement.values]});return original();};}return statement;};
f.db.batch=async statements=>{queries.push(...statements.map(s=>({query:s.query,values:[...s.values]})));return batch(statements);};
const checked=(result,status=200)=>{assert.equal(result.status,status,JSON.stringify(result));return result;};
try{
  const work=checked(await f.publish({name:'D1 inbox smoke'}),201).work;
  for(const owner of [OTHER,REVIEWER])checked(await f.api('/api/works/'+work.id+'/like',{method:'POST',owner,body:{liked:true}}));
  checked(await f.api('/api/works/'+work.id+'/comments',{method:'POST',owner:OTHER,body:{body:'Real local D1 grouping'}}),201);
  checked(await f.api('/api/creators/'+OWNER+'/follow',{method:'POST',owner:OTHER,body:{following:true}}));
  const listed=checked(await f.api('/api/notifications?expectedRecipientId='+OWNER));assert.equal(listed.items.length,3);
  const likes=listed.items.find(item=>item.kind==='work_like');assert.equal(likes.actorCount,2);
  checked(await f.api('/api/notifications/'+likes.id+'/actors?expectedRecipientId='+OWNER));
  checked(await f.api('/api/notifications/'+likes.id+'/read',{method:'POST',body:{expectedRecipientId:OWNER}}));
  checked(await f.api('/api/notifications/read-all',{method:'POST',body:{expectedRecipientId:OWNER,through:listed.snapshot}}));
  const literal=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
  const statements=queries.map(({query,values})=>{let index=0;const bound=query.replace(/\?/g,()=>literal(values[index++]));assert.equal(index,values.length);return bound+';';});
  statements.push("SELECT COUNT(*) total,SUM(CASE WHEN read_at IS NULL AND active=1 THEN 1 ELSE 0 END) unread FROM ft_notifications;");
  await writeFile(sqlFile,statements.join('\n'));
  const raw=execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config',config,'--persist-to',state,'--file',sqlFile,'--json'],{encoding:'utf8',maxBuffer:16*1024*1024,timeout:60000});
  const results=JSON.parse(raw);assert(results.every(result=>result.success));
  assert(results.some(result=>result.results?.some(row=>row.actor_count===2&&row.kind==='work_like')));
  assert.deepEqual(results.at(-1).results,[{total:4,unread:0}]);
  console.log('Local D1 passed: migrations, atomic source triggers, grouped inbox, actor list, read-group and read-all.');
  console.log('SQL statements replayed:',statements.length);
}finally{cleanups.forEach(fn=>fn());}
