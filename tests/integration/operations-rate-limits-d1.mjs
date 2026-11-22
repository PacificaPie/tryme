// Replay actual router mutations into a fresh, exclusively local D1. Concurrent
// interleavings are covered by operations-rate-limits.test.mjs; this checks D1
// compatibility and shared quota predicates. No remote targets are accepted.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {configureToolEnvironment} from '../../scripts/tool-environment.mjs';
import {fixture} from '../helpers/router-fixture.mjs';
configureToolEnvironment(process.cwd());
const directory=path.resolve('.preview/operations-review/d1-'+randomUUID());await mkdir(directory,{recursive:true});
const config=path.join(directory,'wrangler.json'),state=path.join(directory,'state'),sqlFile=path.join(directory,'smoke.sql');
await writeFile(config,JSON.stringify({name:'operations-local-smoke',compatibility_date:'2026-05-15',d1_databases:[{binding:'DB',database_name:'operations-local-smoke',database_id:randomUUID(),migrations_dir:path.resolve('drizzle')}]}));
const run=args=>execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1',...args,'--local','--config',config,'--persist-to',state],{encoding:'utf8',maxBuffer:16*1024*1024,timeout:60000});
run(['migrations','apply','DB']);
const cleanups=[],f=fixture({after:fn=>cleanups.push(fn)}),queries=[];
const prepare=f.db.prepare.bind(f.db),batch=f.db.batch.bind(f.db);
f.db.prepare=query=>{const s=prepare(query),original=s.run.bind(s);s.run=async()=>{queries.push({query,values:[...s.values]});return original();};return s;};
f.db.batch=async statements=>{queries.push(...statements.filter(s=>!/^\s*(?:SELECT|WITH)\b/i.test(s.query)).map(s=>({query:s.query,values:[...s.values]})));return batch(statements);};
const check=(r,status)=>{assert.equal(r.status,status,JSON.stringify(r));return r;};
try{
  const work=check(await f.publish(),201).work;let session;
  for(let i=0;i<31;i++){
    const result=await f.api('/api/sessions',{method:'POST',body:{workId:work.id,versionId:work.versionId}});check(result,i<30?201:429);if(!i)session=result;
  }
  for(let i=0;i<239;i++)check(await f.api('/api/events',{method:'POST',body:{type:'work_view',workId:work.id,eventId:randomUUID()}}),200);
  const events=['play_start','game_complete','session_end'].map((type,i)=>({id:randomUUID(),type,seq:i+1,elapsedMs:i*1000}));
  check(await f.api(`/api/sessions/${session.id}/events`,{method:'POST',body:{token:session.token,events}}),429);
  check(await f.api('/api/events',{method:'POST',body:{type:'work_view',workId:work.id,eventId:randomUUID()}}),429);
  check(await f.api(`/api/sessions/${session.id}/events`,{method:'POST',body:{token:session.token,events:[events[0]]}}),200);
  for(let i=0;i<31;i++)check(await f.api('/api/feedback',{method:'POST',body:{type:'建议',text:'Local D1 feedback '+i,workId:work.id,eventId:randomUUID()}}),i<30?201:429);
  const literal=v=>v===null?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
  const statements=queries.map(({query,values})=>{let i=0;const bound=query.replace(/\?/g,()=>literal(values[i++]));assert.equal(i,values.length);return bound+';';});
  statements.push("SELECT (SELECT COUNT(*) FROM ft_play_sessions) sessions,(SELECT COUNT(*) FROM ft_events) events,(SELECT COUNT(*) FROM ft_feedback) feedback,(SELECT COUNT(*) FROM ft_events WHERE session_id IS NOT NULL) session_events;");
  await writeFile(sqlFile,statements.join('\n'));
  const results=JSON.parse(run(['execute','DB','--file',sqlFile,'--json']));assert(results.every(r=>r.success));
  assert.deepEqual(results.at(-1).results,[{sessions:30,events:240,feedback:30,session_events:1}]);
  console.log(JSON.stringify({scope:'fresh local D1 only',mutations:queries.length,counts:results.at(-1).results[0],passed:true}));
}finally{cleanups.forEach(fn=>fn());}
