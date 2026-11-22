import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,OWNER,OTHER} from './helpers/router-fixture.mjs';

// Fix an allowed interleaving: every legacy check observes the same snapshot.
// Atomic INSERT predicates run on real SQLite and are never intercepted.
function alignLegacyReads(f,table,requests){
  const prepare=f.db.prepare.bind(f.db);let reads=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  f.db.prepare=query=>{const s=prepare(query);if(query.startsWith(`SELECT COUNT(*) AS n FROM ${table} WHERE `)){
    const first=s.first.bind(s);s.first=async()=>{const snapshot=await first();if(++reads===requests)release();await gate;return snapshot;};
  }return s;};
  return ()=>{release();f.db.prepare=prepare;};
}
const view=(f,work,body={},options={})=>f.api('/api/events',{method:'POST',body:{type:'work_view',workId:work.id,eventId:randomUUID(),...body},...options});
const feedback=(f,work,body={},options={})=>f.api('/api/feedback',{method:'POST',body:{type:'建议',text:'Feedback',workId:work.id,eventId:randomUUID(),...body},...options});
const session=(f,work,options={})=>f.api('/api/sessions',{method:'POST',body:{workId:work.id,versionId:work.versionId},...options});
const send=(f,s,events)=>f.api(`/api/sessions/${s.id}/events`,{method:'POST',body:{token:s.token,events}});
const event=(type,seq)=>({id:randomUUID(),type,seq,elapsedMs:seq*1000});

test('concurrent play-session creation cannot exceed 30 per account/minute',async t=>{
  const f=fixture(t),work=f.seed();
  for(let i=0;i<29;i++)assert.equal((await session(f,work)).status,201);
  const restore=alignLegacyReads(f,'ft_play_sessions',12);
  const results=await Promise.all(Array.from({length:12},()=>session(f,work)));restore();
  assert.equal(results.filter(r=>r.status===201).length,1);
  assert.equal(results.filter(r=>r.error?.code==='RATE_LIMITED').length,11);
  assert.equal(f.count('ft_play_sessions'),30);
  assert.equal((await session(f,work,{owner:OTHER})).status,201);
  f.database.prepare('UPDATE ft_play_sessions SET created_at=? WHERE actor_id=?').run(new Date(Date.now()-61000).toISOString(),OWNER);
  assert.equal((await session(f,work)).status,201);
});

test('event quota is atomic; full-quota replays retain their receipt and reject changed payloads',async t=>{
  const f=fixture(t),work=f.seed();
  for(let i=0;i<239;i++)assert.equal((await view(f,work)).status,200);
  const inputs=Array.from({length:12},()=>({eventId:randomUUID()})),restore=alignLegacyReads(f,'ft_events',12);
  const results=await Promise.all(inputs.map(input=>view(f,work,input)));restore();
  assert.equal(results.filter(r=>r.status===200).length,1);
  assert.equal(results.filter(r=>r.error?.code==='RATE_LIMITED').length,11);
  assert.equal(f.count('ft_events'),240);
  const index=results.findIndex(r=>r.status===200),replay=await view(f,work,inputs[index]);
  assert.equal(replay.status,200);assert.equal(replay.receipt.id,results[index].receipt.id);assert.equal(replay.duplicate,true);
  assert.equal((await view(f,f.seed({bytes:'<!doctype html><body>Other</body>'}),inputs[index])).error.code,'EVENT_CONFLICT');
  assert.equal((await view(f,work,{}, {owner:OTHER})).status,200);
});

test('private feedback quota is atomic and denied writes cannot issue recommendation credit',async t=>{
  const f=fixture(t),work=f.seed({owner:OTHER});
  for(let i=0;i<29;i++)assert.equal((await feedback(f,work,{text:'Seed '+i})).status,201);
  const inputs=Array.from({length:12},(_,i)=>({eventId:randomUUID(),text:'Concurrent '+i})),restore=alignLegacyReads(f,'ft_feedback',12);
  const results=await Promise.all(inputs.map(input=>feedback(f,work,input)));restore();
  assert.equal(results.filter(r=>r.status===201).length,1);
  assert.equal(results.filter(r=>r.error?.code==='RATE_LIMITED').length,11);
  assert.equal(f.count('ft_feedback'),30);
  const index=results.findIndex(r=>r.status===201),credits=f.count('ft_contribution_credits');
  const replay=await feedback(f,work,inputs[index]);assert.equal(replay.status,200);assert.equal(replay.feedback.id,results[index].feedback.id);
  assert.equal((await feedback(f,work,{...inputs[index],text:'Changed'})).error.code,'EVENT_CONFLICT');
  assert.equal(f.count('ft_contribution_credits'),credits);
});

test('a session event batch shares the 240-event quota with views and can safely retry after partial acceptance',async t=>{
  const f=fixture(t),work=f.seed(),s=await session(f,work);
  for(let i=0;i<239;i++)await view(f,work);
  const events=[event('play_start',1),event('game_complete',2),event('session_end',3)];
  const result=await send(f,s,events);assert.equal(result.status,429);assert.equal(result.error.code,'RATE_LIMITED');assert.equal(f.count('ft_events'),240);
  assert.equal((await send(f,s,[events[0]])).status,200,'Committed start is a replay even at quota');
  f.database.prepare('UPDATE ft_events SET received_at=? WHERE session_id IS NULL').run(new Date(Date.now()-61000).toISOString());
  const replay=await send(f,s,events);assert.equal(replay.status,200);assert.equal(replay.accepted.length,2);assert.deepEqual(replay.duplicates,[events[0].id]);
  assert.equal((await send(f,s,events)).accepted.length,0);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM ft_events WHERE session_id=?').get(s.id).n,3);
});

test('concurrent single-event and session batches cannot take the same last quota slot',async t=>{
  const f=fixture(t),work=f.seed(),s=await session(f,work);
  for(let i=0;i<239;i++)await view(f,work);
  const restore=alignLegacyReads(f,'ft_events',2),start=event('play_start',1);
  const results=await Promise.all([view(f,work),send(f,s,[start])]);restore();
  assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===429).length,1);assert.equal(f.count('ft_events'),240);
});
