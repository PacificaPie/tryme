import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,OWNER,OTHER,html,handleAPI} from './helpers/router-fixture.mjs';

const START=Date.parse('2026-11-16T15:00:00.000Z'),DAY=86400000;
const at=ms=>new Date(ms).toISOString();
function setup(t,options){t.mock.timers.enable({apis:['Date'],now:START});return fixture(t,options);}
const credits=f=>f.database.prepare('SELECT * FROM ft_contribution_credits ORDER BY created_at,target_work_id').all();
const impressions=f=>f.database.prepare('SELECT * FROM ft_feed_impressions ORDER BY received_at,id').all();
async function feed(f,query='',owner=OWNER){const r=await f.api('/api/discover?sort=recommended'+query,{owner});assert.equal(r.status,200,JSON.stringify(r));return r;}
async function play(f,w,owner=OWNER){
  const session=await f.api('/api/sessions',{method:'POST',owner,body:{workId:w.id,versionId:w.versionId}});assert.equal(session.status,201,JSON.stringify(session));
  const result=await f.api('/api/sessions/'+session.id+'/events',{method:'POST',owner,body:{token:session.token,events:[{id:randomUUID(),type:'play_start',seq:1}]}});
  assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.accepted.length,1);return session;
}
const like=(f,w,owner=OWNER,liked=true)=>f.api('/api/works/'+w.id+'/like',{method:'POST',owner,body:{liked}});
const feedback=(f,w,{owner=OWNER,eventId=randomUUID(),type='问题',text='The second room stops responding.'}={})=>f.api('/api/feedback',{method:'POST',owner,body:{eventId,workId:w.id,versionId:w.versionId,type,text}});
const comment=(f,w,{owner=OWNER,key=randomUUID(),parentId=null}={})=>f.api('/api/works/'+w.id+'/comments',{method:'POST',owner,key,body:{body:'The door is difficult to find.',parentId}});
const expose=(f,items,owner=OTHER)=>f.api('/api/feed/impressions',{method:'POST',owner,body:{impressions:items.map(item=>({eventId:randomUUID(),sort:'recommended',...item}))}});
function rankingPair(f,owner=OWNER,{age=60*DAY,label=owner}={}){
  const a=f.seed({owner,at:at(START-age),bytes:html(label+'-a')}),b=f.seed({owner,at:at(START-age-1),bytes:html(label+'-b')});return [a,b];
}
async function topScore(f,owner=OWNER){const result=await feed(f,'&author='+encodeURIComponent(owner)+'&limit=1');assert(result.nextCursor);return JSON.parse(Buffer.from(result.nextCursor,'base64url').toString()).last.rank;}

test('recommendation migration is additive and does not change works, versions, cards, events or visibility',async t=>{
  const f=setup(t,{through:8}),[a]=rankingPair(f),other=f.seed({owner:OTHER,at:at(START-DAY)});
  const c=await f.api('/api/cards',{method:'POST',body:{name:'Creator',bio:'Games',template:'fold',workIds:[a.id],workRefs:[{workId:a.id,versionId:a.versionId}]}});assert.equal(c.status,201,JSON.stringify(c));
  assert.equal((await f.api('/api/events',{method:'POST',owner:OTHER,body:{eventId:randomUUID(),type:'work_view',workId:a.id}})).status,200);
  const tables=['ft_works','ft_work_versions','ft_work_discovery','ft_cards','ft_events'];
  const before=tables.map(table=>f.database.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());f.migrate();
  tables.forEach((table,i)=>{const after=f.database.prepare('SELECT * FROM '+table+' ORDER BY rowid').all();if(table==='ft_works')for(const row of after){assert.equal(row.archived_at,null);delete row.archived_at;}if(table==='ft_cards')for(const row of after){assert.equal(row.deleted_at,null);delete row.deleted_at;}assert.deepEqual(after,before[i]);});
  assert.equal(credits(f).length,0);assert.equal(impressions(f).length,0);assert.equal((await feed(f)).total,3);
});

test('recommended and latest are separate, hidden works stay excluded and all explicit sorts remain available',async t=>{
  const f=setup(t),[old]=rankingPair(f),fresh=f.seed({owner:OTHER,at:at(START)});
  const hide=await f.discovery(old.id,'hide');assert.equal(hide.status,200);
  for(const sort of ['recommended','newest','likes','comments']){
    const result=await f.api('/api/discover?sort='+sort);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.sort,sort);assert(!result.works.some(w=>w.id===old.id));
  }
  const latest=await f.api('/api/discover?sort=newest');assert.equal(latest.works[0].id,fresh.id);
  assert.equal((await f.api('/api/discover?sort=unsupported')).status,422);
  assert.equal((await f.api('/api/works?mine=1')).works.length,2);
});

test('new works receive exploration priority without having contributed, own impressions do not consume it',async t=>{
  const f=setup(t),[a,b]=rankingPair(f,OWNER,{age:0});
  assert.equal(credits(f).length,0);assert.equal(await topScore(f),600);
  assert.equal((await expose(f,[{workId:a.id},{workId:b.id}],OWNER)).status,200);
  assert.equal(await topScore(f),600);
  for(let i=0;i<20;i++)assert.equal((await expose(f,[{workId:a.id},{workId:b.id}],'viewer-'+i)).status,200);
  assert.equal(await topScore(f),400,'After twenty distinct outside viewers the cold-start bonus has been used');
  t.mock.timers.setTime(START+8*DAY);assert((await topScore(f))<400,'Freshness declines, and the seven-day exploration window ends');
});

test('actual accepted play followed by a like boosts the contributor’s own works, with no pre-play retroactive reward',async t=>{
  const f=setup(t);rankingPair(f);const target=f.seed({owner:OTHER,at:at(START-DAY)});
  assert.equal(await topScore(f),0);
  assert.equal((await like(f,target)).status,200);assert.equal(credits(f).length,0);
  t.mock.timers.setTime(START+1000);await play(f,target);
  assert.equal((await like(f,target)).status,200);assert.equal(credits(f).length,0,'Retrying a pre-play like must not move its interaction timestamp');
  assert.equal((await like(f,target,OWNER,false)).status,200);
  t.mock.timers.setTime(START+2000);assert.equal((await like(f,target)).status,200);
  assert.equal(credits(f).length,1);assert.equal(credits(f)[0].actor_id,OWNER);assert.equal(credits(f)[0].target_work_id,target.id);assert.equal(await topScore(f),10);
  const viewer=await feed(f,'&author='+OWNER,OTHER);assert.equal(viewer.works.length,2,'Reward applies to public placement of contributor works, independent of who views the Feed');
});

test('like, root comment and private problem feedback share one lifetime reward per target across versions',async t=>{
  const f=setup(t);rankingPair(f);const target=f.seed({owner:OTHER,at:at(START-DAY)});await play(f,target);
  const results=await Promise.all([like(f,target),comment(f,target),feedback(f,target)]);assert(results.every(r=>[200,201].includes(r.status)),JSON.stringify(results));assert.equal(credits(f).length,1);
  for(let i=0;i<3;i++){await like(f,target,OWNER,false);await like(f,target);}
  t.mock.timers.setTime(START+DAY);const version=await f.version(target.id,{owner:OTHER,bytes:html('new target version')});assert.equal(version.status,201,JSON.stringify(version));
  const updated={...target,versionId:version.version.id};await play(f,updated);assert.equal((await feedback(f,updated)).status,201);assert.equal(credits(f).length,1);
});

test('suggestions, problems and root comments qualify equally after play; replies and comment likes do not',async t=>{
  const f=setup(t);const problem=f.seed({owner:'problem-maker'}),suggestion=f.seed({owner:'suggestion-maker'}),rootTarget=f.seed({owner:'root-maker'}),replyTarget=f.seed({owner:'reply-maker'});
  await play(f,problem);assert.equal((await feedback(f,problem,{type:'问题'})).status,201);
  await play(f,suggestion);assert.equal((await feedback(f,suggestion,{type:'建议',text:'Please make the exit easier to see.'})).status,201);
  const root=await comment(f,replyTarget,{owner:OTHER});assert.equal(root.status,201);await play(f,replyTarget);
  assert.equal((await comment(f,replyTarget,{parentId:root.comment.id})).status,201);
  assert.equal((await f.api('/api/comments/'+root.comment.id+'/like',{method:'POST',body:{liked:true}})).status,200);assert.equal(credits(f).length,2);
  await play(f,rootTarget);assert.equal((await comment(f,rootTarget)).status,201);assert.equal(credits(f).length,3);
  assert.deepEqual(new Set(credits(f).map(c=>c.source_kind)),new Set(['feedback','comment']));
});

test('self actions, mere views/outbound clicks, hidden targets and stale play cannot earn contribution',async t=>{
  const f=setup(t),own=f.seed(),outside=f.seed({owner:OTHER,source:'url',url:'https://example.com/game'}),unplayed=f.seed({owner:'unplayed-maker'}),hidden=f.seed({owner:'hidden-maker'}),stale=f.seed({owner:'stale-maker'});
  await play(f,own);await like(f,own);await feedback(f,own);assert.equal(credits(f).length,0);
  assert.equal((await f.api('/api/events',{method:'POST',body:{eventId:randomUUID(),workId:outside.id,type:'outbound_click'}})).status,200);await like(f,outside);await feedback(f,outside);
  assert.equal((await f.api('/api/events',{method:'POST',body:{eventId:randomUUID(),workId:unplayed.id,type:'work_view'}})).status,200);await like(f,unplayed);
  await play(f,hidden);f.database.prepare("UPDATE ft_work_discovery SET visibility='unlisted' WHERE work_id=?").run(hidden.id);await like(f,hidden);await feedback(f,hidden);
  await play(f,stale);t.mock.timers.setTime(START+DAY+1);await like(f,stale);assert.equal(credits(f).length,0);
});

test('concurrent rewards enforce three per actor/day and one per target author/day; seven-day total is capped and decays',async t=>{
  const f=setup(t);rankingPair(f);const works=[];
  for(let i=0;i<5;i++){const w=f.seed({owner:'maker-'+i,bytes:html('cap-'+i)});works.push(w);await play(f,w);}
  const results=await Promise.all(works.map(w=>like(f,w)));assert(results.every(r=>r.status===200));assert.equal(credits(f).length,3);assert.equal(await topScore(f),30);
  t.mock.timers.setTime(START+DAY);const shared=[];
  for(let i=0;i<2;i++){const w=f.seed({owner:'same-maker',bytes:html('shared-'+i)});shared.push(w);await play(f,w);}
  await Promise.all(shared.map(w=>feedback(f,w)));assert.equal(credits(f).filter(c=>c.target_author_id==='same-maker').length,1);
  for(let i=0;i<2;i++){const w=f.seed({owner:'next-maker-'+i,bytes:html('next-'+i)});await play(f,w);await comment(f,w);}
  assert.equal(credits(f).length,6);assert.equal(await topScore(f),40);
  t.mock.timers.setTime(START+6*DAY);const aged=await topScore(f);assert(aged>0&&aged<40,`Expected decayed credit below the cap, got ${aged}`);
  t.mock.timers.setTime(START+8*DAY);assert.equal(await topScore(f),0);
});

test('recommendation pagination freezes evaluation time and excludes new signals and works until a new traversal',async t=>{
  const f=setup(t),seeded=[];
  for(let i=0;i<15;i++)seeded.push(f.seed({owner:'maker-'+i,at:at(START-(i+1)*DAY),bytes:html('paged-'+i)}));
  const initial=await feed(f,'&limit=48'),expected=initial.works.map(w=>w.id),first=await feed(f,'&limit=4');
  assert(first.nextCursor);assert.equal(first.asOf,at(START));const seen=first.works.map(w=>w.id);
  t.mock.timers.setTime(START+1000);const newest=f.seed({owner:'new-maker',at:at(START+1000)});
  await play(f,seeded[12]);await like(f,seeded[12]);await expose(f,[{workId:seeded[5].id}]);
  let cursor=first.nextCursor,pages=0;
  while(cursor){const page=await feed(f,'&limit=4&cursor='+encodeURIComponent(cursor));assert.equal(page.asOf,first.asOf);seen.push(...page.works.map(w=>w.id));cursor=page.nextCursor;assert(++pages<8);}
  assert.deepEqual(seen,expected);assert.equal(new Set(seen).size,15);assert(!seen.includes(newest.id));assert((await feed(f)).works.some(w=>w.id===newest.id));
  assert.equal((await f.api('/api/discover?sort=newest&cursor='+encodeURIComponent(first.nextCursor))).status,400);
});

test('feed impressions deduplicate by event and viewer/work/UTC day across reloads, sort changes and concurrent batches',async t=>{
  const f=setup(t),w=f.seed(),id=randomUUID(),item={eventId:id,workId:w.id,sort:'recommended'};
  const results=await Promise.all([expose(f,[item]),expose(f,[item]),expose(f,[{workId:w.id,sort:'newest'}])]);
  assert(results.every(r=>r.status===200),JSON.stringify(results));assert.equal(impressions(f).length,1);assert.equal(results.reduce((n,r)=>n+r.accepted.length,0),1);
  assert.equal(impressions(f)[0].actor_id,OTHER);assert.equal(impressions(f)[0].exposure_day,'2026-11-16');assert.equal(impressions(f)[0].received_at,at(START));
  t.mock.timers.setTime(Date.parse('2026-11-17T00:00:00.000Z'));const next=await expose(f,[{workId:w.id}]);assert.equal(next.accepted.length,1);assert.equal(impressions(f).length,2);
});

test('impressions ignore no-longer-listed works, validate full batches before writes and reject conflicting event reuse',async t=>{
  const f=setup(t),a=f.seed(),b=f.seed({owner:OTHER}),hidden=f.seed();await f.discovery(hidden.id,'hide');const missing=randomUUID();
  const result=await expose(f,[{workId:a.id},{workId:hidden.id},{workId:missing}]);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.accepted.length,1);assert.equal(result.ignored.length,2);assert.equal(impressions(f).length,1);
  const key=randomUUID();assert.equal((await expose(f,[{workId:b.id,eventId:key}])).status,200);
  const conflict=await expose(f,[{workId:a.id,eventId:key}]);assert.equal(conflict.status,409);assert.equal(impressions(f).length,2);
  const before=impressions(f).length,invalid=await expose(f,[{workId:b.id},{workId:a.id,sort:'bad-sort'}],'fresh-viewer');assert.equal(invalid.status,422);assert.equal(impressions(f).length,before);
  const tooMany=await expose(f,Array.from({length:25},()=>({workId:a.id})));assert.equal(tooMany.status,422);assert.equal(impressions(f).length,before);
});

test('impression writes require authentication and same-origin CSRF; payload cannot impersonate another viewer',async t=>{
  const f=setup(t),w=f.seed(),body={impressions:[{eventId:randomUUID(),workId:w.id,sort:'recommended',actorId:'forged'}],actorId:'forged'};
  const noAuth=await handleAPI(new Request('https://site.test/api/feed/impressions',{method:'POST',headers:{Origin:'https://site.test','X-Funtrack-CSRF':'1','Content-Type':'application/json'},body:JSON.stringify(body)}));assert.equal(noAuth.status,401);
  const csrf=await f.api('/api/feed/impressions',{method:'POST',body,extraHeaders:{Origin:'https://attacker.test'}});assert.equal(csrf.status,403);assert.equal(impressions(f).length,0);
  const okay=await f.api('/api/feed/impressions',{method:'POST',owner:OTHER,body});assert.equal(okay.status,200);assert.equal(impressions(f)[0].actor_id,OTHER);
});

test('recommendation quality counts distinct outside players, caps at 200 and expires after thirty days',async t=>{
  const f=setup(t),pair=rankingPair(f);for(const w of pair){await play(f,w,OWNER);await like(f,w,OWNER);}assert.equal(await topScore(f),0,'The creator playing their own game cannot improve its rank');
  for(const w of pair){await play(f,w,OTHER);await play(f,w,OTHER);await play(f,w,OTHER);}assert.equal(await topScore(f),10,'Repeated sessions from one player count once');
  for(let i=0;i<24;i++)for(const w of pair)await play(f,w,'quality-player-'+i);
  assert.equal(await topScore(f),200);t.mock.timers.setTime(START+31*DAY);assert.equal(await topScore(f),0);
});

test('late credit creation cannot backdate into an in-progress recommendation traversal; ancient likes cannot earn rewards',async t=>{
  const f=setup(t);rankingPair(f);const old=f.seed({owner:'old-interaction-maker'}),recent=f.seed({owner:'recent-interaction-maker'});
  t.mock.timers.setTime(START-2*DAY);await play(f,old);f.database.prepare('INSERT INTO ft_work_likes(work_id,actor_id,created_at) VALUES(?,?,?)').run(old.id,OWNER,at(START-2*DAY));
  t.mock.timers.setTime(START-1000);await play(f,recent);f.database.prepare('INSERT INTO ft_work_likes(work_id,actor_id,created_at) VALUES(?,?,?)').run(recent.id,OWNER,at(START-500));
  t.mock.timers.setTime(START);const first=await feed(f,'&author='+OWNER+'&limit=1');assert(first.nextCursor);assert.equal(credits(f).length,0);
  t.mock.timers.setTime(START+1000);await like(f,old);assert.equal(credits(f).length,0);await like(f,recent);assert.equal(credits(f).length,1);assert.equal(credits(f)[0].created_at,at(START+1000));
  const next=await feed(f,'&author='+OWNER+'&limit=1&cursor='+encodeURIComponent(first.nextCursor));assert.equal(next.works.length,1);assert.notEqual(next.works[0].id,first.works[0].id);assert.equal(next.nextCursor,null);assert.equal(await topScore(f),10);
});

test('exposure ingestion enforces its per-minute cap inside concurrent transactions and permits retry after the window',async t=>{
  const f=setup(t),works=[];
  for(let i=0;i<242;i++)works.push(f.seed({owner:'throttle-maker',bytes:html('throttle-'+i)}));
  for(let i=0;i<239;i+=24){const batch=works.slice(i,Math.min(i+24,239));const result=await expose(f,batch.map(w=>({workId:w.id})));assert.equal(result.status,200,JSON.stringify(result));}
  assert.equal(impressions(f).length,239);const pending=works.slice(239).map(w=>({eventId:randomUUID(),workId:w.id}));const results=await Promise.all(pending.map(item=>expose(f,[item])));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,429,429]);assert.equal(impressions(f).length,240);
  t.mock.timers.setTime(START+60001);for(let i=0;i<results.length;i++)if(results[i].status===429)assert.equal((await expose(f,[pending[i]])).status,200);
  assert.equal(impressions(f).length,242);
});

test('recommended cursors exclude rows committed late even when all four ranking sources carry older timestamps',async t=>{
  const f=setup(t),works=[];
  for(let i=0;i<15;i++)works.push(f.seed({owner:'snapshot-maker-'+i,at:at(START-(i+1)*3600000),bytes:html('snapshot-'+i)}));
  const expected=(await feed(f,'&limit=48')).works.map(w=>w.id),first=await feed(f,'&limit=4');assert(first.nextCursor);
  const late=at(START-500),newWork=f.seed({owner:'late-maker',at:late,bytes:html('late committed publication')});
  for(let i=0;i<20;i++){
    const actor='late-player-'+i,sessionId=randomUUID(),target=works[14];
    f.database.prepare('INSERT INTO ft_play_sessions(id,actor_id,work_id,version_id,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(sessionId,actor,target.id,target.versionId,'test-hash',late,at(START+3600000));
    f.database.prepare('INSERT INTO ft_events(id,client_event_id,actor_id,work_id,version_id,session_id,event_type,seq,received_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),randomUUID(),actor,target.id,target.versionId,sessionId,'play_start',1,late);
    f.database.prepare('INSERT INTO ft_feed_impressions(id,client_event_id,actor_id,work_id,sort,exposure_day,received_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),randomUUID(),'late-viewer-'+i,works[0].id,'recommended',late.slice(0,10),late);
  }
  f.database.prepare('INSERT INTO ft_contribution_credits(actor_id,target_work_id,target_author_id,source_kind,source_id,earned_day,created_at) VALUES(?,?,?,?,?,?,?)').run('snapshot-maker-5',works[14].id,'snapshot-maker-14','like',works[14].id,late.slice(0,10),late);
  const seen=first.works.map(w=>w.id);let cursor=first.nextCursor,pages=0;
  while(cursor){const result=await feed(f,'&limit=4&cursor='+encodeURIComponent(cursor));seen.push(...result.works.map(w=>w.id));cursor=result.nextCursor;assert(++pages<8);}
  assert.deepEqual(seen,expected);assert.equal(new Set(seen).size,15);assert(!seen.includes(newWork.id));assert.notDeepEqual((await feed(f,'&limit=48')).works.map(w=>w.id),expected);
});

test('recommended cursor watermarks must contain four non-negative safe integers and cannot be silently omitted',async t=>{
  const f=setup(t);rankingPair(f);const first=await feed(f,'&limit=1');assert(first.nextCursor);
  const decoded=JSON.parse(Buffer.from(first.nextCursor,'base64url').toString());assert(decoded.snapshot);
  for(const field of ['works','events','impressions','credits']){
    assert(Number.isSafeInteger(decoded.snapshot[field]));assert(decoded.snapshot[field]>=0);
    for(const value of [-1,0.5,Number.MAX_SAFE_INTEGER+1,'0',null]){
      const changed=structuredClone(decoded);changed.snapshot[field]=value;
      const result=await f.api('/api/discover?sort=recommended&limit=1&cursor='+Buffer.from(JSON.stringify(changed)).toString('base64url'));assert.equal(result.status,400,field+'='+value);
    }
  }
  const missing=structuredClone(decoded);delete missing.snapshot;assert.equal((await f.api('/api/discover?sort=recommended&limit=1&cursor='+Buffer.from(JSON.stringify(missing)).toString('base64url'))).status,400);
});

test('delayed exposure batches cannot be attributed to an account that replaced the viewing account',async t=>{
  const f=setup(t),w=f.seed(),body={expectedActorId:OWNER,impressions:[{eventId:randomUUID(),workId:w.id,sort:'recommended'}]};
  const mismatch=await f.api('/api/feed/impressions',{method:'POST',owner:OTHER,body});assert.equal(mismatch.status,409);assert.equal(mismatch.error.code,'ACTOR_CHANGED');assert.equal(impressions(f).length,0);
  const matching=await f.api('/api/feed/impressions',{method:'POST',owner:OWNER,body});assert.equal(matching.status,200);assert.equal(matching.accepted.length,1);assert.equal(impressions(f)[0].actor_id,OWNER);
});
