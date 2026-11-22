// Actual bound router SQL + fresh local D1. No remote target accepted.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {configureToolEnvironment} from '../../scripts/tool-environment.mjs';
import {fixture,REVIEWER} from '../helpers/router-fixture.mjs';
configureToolEnvironment(process.cwd());
const directory=path.resolve('.preview/moderation/d1-'+randomUUID());await mkdir(directory,{recursive:true});
const config=path.join(directory,'wrangler.json'),state=path.join(directory,'state'),sqlFile=path.join(directory,'smoke.sql');
await writeFile(config,JSON.stringify({name:'moderation-local-smoke',compatibility_date:'2026-05-15',d1_databases:[{binding:'DB',database_name:'moderation-local-smoke',database_id:randomUUID(),migrations_dir:path.resolve('drizzle')}]}));
const run=args=>execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1',...args,'--local','--config',config,'--persist-to',state],{encoding:'utf8',maxBuffer:16*1024*1024,timeout:60000});run(['migrations','apply','DB']);
const cleanups=[],f=fixture({after:fn=>cleanups.push(fn)},{moderators:REVIEWER}),queries=[];
const prepare=f.db.prepare.bind(f.db),batch=f.db.batch.bind(f.db);
f.db.prepare=query=>{const s=prepare(query);for(const method of ['run','all','first']){const original=s[method].bind(s);s[method]=async()=>{queries.push({query,values:[...s.values]});return original();};}return s;};
f.db.batch=async statements=>{queries.push(...statements.map(s=>({query:s.query,values:[...s.values]})));return batch(statements);};
try{
 const {work}=await f.publish(),card=(await f.api('/api/cards',{method:'POST',body:{name:'D1 card',template:'wall',workIds:[work.id]}})).card;
 const change=(action,revision)=>f.api('/api/moderation/work/'+work.id,{method:'POST',owner:REVIEWER,body:{action,reason:'Local D1 exercise',expectedRevision:revision}});
 assert.equal((await change('block',0)).status,200);assert.equal((await f.get(work.id)).status,404);assert.equal((await f.api('/api/cards/'+card.id)).status,404);assert.equal((await change('restore',1)).status,200);assert.equal((await f.get(work.id)).status,200);assert.equal((await f.api('/api/cards/'+card.id)).status,200);
 const literal=v=>v===null?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
 const statements=queries.map(({query,values})=>{let i=0;const bound=query.replace(/\?/g,()=>literal(values[i++]));assert.equal(i,values.length);return bound+';';});
 statements.push('SELECT (SELECT COUNT(*) FROM ft_moderation_actions) actions,(SELECT COUNT(*) FROM ft_content_restrictions) restrictions,(SELECT COUNT(*) FROM ft_cards) cards;');await writeFile(sqlFile,statements.join('\n'));
 const results=JSON.parse(run(['execute','DB','--file',sqlFile,'--json']));assert(results.every(r=>r.success));assert.deepEqual(results.at(-1).results,[{actions:2,restrictions:0,cards:1}]);
 console.log(JSON.stringify({passed:true,scope:'Fresh local D1, real router SQL',statements:statements.length,result:results.at(-1).results[0]}));
}finally{cleanups.forEach(fn=>fn());}
