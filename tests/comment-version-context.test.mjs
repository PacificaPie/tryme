import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,OWNER,OTHER,REVIEWER,digest,html,handleAPI} from './helpers/router-fixture.mjs';

const post=(f,work,body,options={})=>f.api('/api/works/'+work.id+'/comments',{method:'POST',owner:OTHER,body,...options});
const comments=(f,work,query='')=>f.api('/api/works/'+work.id+'/comments'+query);
const context=(f,id)=>f.api('/api/comments/'+id+'/context');
const versionContext=c=>({versionId:c.versionId,version:c.version});

test('live author profiles coexist with immutable comment versions in lists, replies, inbox and context',async t=>{
  const f=fixture(t),{work:v1}=await f.publish();
  const profile=body=>f.api('/api/me/profile',{method:'POST',owner:OTHER,body});
  assert.equal((await profile({name:'Before',avatarPreset:'moon'})).status,200);
  const root=(await post(f,v1,{body:'Old version',versionId:v1.versionId,expectedAuthorId:OTHER})).comment;
  assert.equal((await f.version(v1.id)).status,201);
  const v2=(await f.get(v1.id)).work;
  const reply=(await post(f,v2,{body:'Current version reply',parentId:root.id,versionId:v2.versionId,expectedAuthorId:OTHER})).comment;
  const stored=f.database.prepare('SELECT * FROM ft_comments ORDER BY seq').all();
  assert.equal((await profile({name:'After',avatarPreset:'sprout'})).status,200);
  const list=await comments(f,v2),paged=await f.api('/api/comments/'+root.id+'/replies');
  const inbox=await f.api('/api/comments?mine=1'),focused=await context(f,reply.id);
  const visible=[list.comments[0],...list.comments[0].replies,...paged.replies,...inbox.comments,focused.thread,...focused.thread.replies];
  assert.equal(visible.length,7);
  for(const c of visible){
    assert.equal(c.authorName,'After');assert.equal(c.authorAvatarUrl,'/avatars/sprout.svg');
    assert.deepEqual(versionContext(c),versionContext(c.id===root.id?root:reply));
  }
  assert.deepEqual(f.database.prepare('SELECT * FROM ft_comments ORDER BY seq').all(),stored,'Reading current profiles must not rewrite comment history');
});

test('an account switch cannot publish another account draft or consume its key and contribution opportunity',async t=>{
  const f=fixture(t),{work}=await f.publish({owner:REVIEWER}),key=randomUUID();
  const session=await f.api('/api/sessions',{method:'POST',owner:OTHER,body:{workId:work.id,versionId:work.versionId}});assert.equal(session.status,201);
  const played=await f.api('/api/sessions/'+session.id+'/events',{method:'POST',owner:OTHER,body:{token:session.token,events:[{id:randomUUID(),type:'play_start',seq:1}]}});assert.equal(played.status,200);assert.equal(played.accepted.length,1);
  const body={body:'Draft belongs to account A',versionId:work.versionId,expectedAuthorId:OWNER};
  const switched=await post(f,work,body,{owner:OTHER,key});assert.equal(switched.status,409);assert.equal(switched.error.code,'AUTH_SESSION_CHANGED');assert.equal(switched.comment,undefined);
  assert.equal(f.count('ft_comments'),0);assert.equal(f.count('ft_contribution_credits'),0);
  assert.equal(f.database.prepare('SELECT COUNT(*) n FROM ft_comments WHERE idempotency_key=?').get(key).n,0);
  const original=await post(f,work,body,{owner:OWNER,key});assert.equal(original.status,201);assert.equal(original.comment.authorId,OWNER);
  assert.equal((await post(f,work,body,{owner:OWNER,key})).status,200);
  const other=await post(f,work,{...body,expectedAuthorId:OTHER},{owner:OTHER,key});assert.equal(other.status,201);assert.equal(other.comment.authorId,OTHER);
  assert.equal(f.count('ft_comments'),2);assert.equal(f.count('ft_contribution_credits'),1);
  assert.equal(f.database.prepare('SELECT actor_id FROM ft_contribution_credits').get().actor_id,OTHER);
  const wrongReplay=await post(f,work,body,{owner:OTHER,key});assert.equal(wrongReplay.status,409);assert.equal(wrongReplay.error.code,'AUTH_SESSION_CHANGED');assert.equal(wrongReplay.comment,undefined);
  assert.equal(f.count('ft_comments'),2);assert.equal(f.count('ft_contribution_credits'),1);
  const oldClient=await post(f,work,{body:body.body,versionId:work.versionId},{owner:OTHER,key});assert.equal(oldClient.status,200);assert.equal(oldClient.comment.id,other.comment.id,'Guard is not part of the content hash, and legacy clients keep their authenticated identity');
});

test('malformed expected authors fail before comment receipts and writes while omission remains compatible',async t=>{
  const f=fixture(t),{work}=await f.publish(),key=randomUUID(),body={body:'A valid legacy comment',versionId:work.versionId};
  const existing=await post(f,work,body,{key});assert.equal(existing.status,201);
  for(const expectedAuthorId of [null,[],{},42,true,'',' ','x'.repeat(257)]){
    const rejected=await post(f,work,{...body,expectedAuthorId},{key});assert.equal(rejected.status,409);assert.equal(rejected.error.code,'AUTH_SESSION_CHANGED');assert.equal(rejected.comment,undefined);
  }
  assert.equal(f.count('ft_comments'),1);assert.equal(f.count('ft_contribution_credits'),0);
  const valid=await post(f,work,{...body,expectedAuthorId:OTHER},{key});assert.equal(valid.status,200);assert.equal(valid.comment.id,existing.comment.id);
  assert.equal((await post(f,work,{body:'Another legacy client comment'})).status,201);
});

test('an old card v1 comment and a current v2 comment share discussion without changing snapshots or gameplay history',async t=>{
  const f=fixture(t),{work:v1}=await f.publish();
  const saved=await f.api('/api/cards',{method:'POST',body:{name:'Creator',bio:'',template:'wall',workIds:[v1.id]}});
  assert.equal(saved.status,201);
  assert.equal((await f.version(v1.id)).status,201);
  const v2=(await f.get(v1.id)).work,oldCard=(await f.api('/api/cards/'+saved.card.id)).card;
  assert.equal(oldCard.works[0].versionId,v1.versionId);
  const beforeVersions=f.database.prepare('SELECT * FROM ft_work_versions ORDER BY id').all();
  const old=await post(f,v1,{body:'The old card still has this issue',versionId:oldCard.works[0].versionId});
  const current=await post(f,v2,{body:'The update fixes it',versionId:v2.versionId});
  for(const response of [old,current])assert.equal(response.status,201,JSON.stringify(response));
  assert.deepEqual(versionContext(old.comment),{versionId:v1.versionId,version:v1.version});
  assert.deepEqual(versionContext(current.comment),{versionId:v2.versionId,version:v2.version});
  const list=await comments(f,v2);assert.equal(list.commentsCount,2);
  assert.deepEqual(list.comments.map(versionContext),[versionContext(current.comment),versionContext(old.comment)]);
  const inbox=await f.api('/api/comments?mine=1');assert.deepEqual(inbox.comments.map(versionContext),list.comments.map(versionContext));
  assert.deepEqual((await f.api('/api/cards/'+saved.card.id)).card,oldCard);
  assert.deepEqual(f.database.prepare('SELECT * FROM ft_work_versions ORDER BY id').all(),beforeVersions);
  for(const table of ['ft_events','ft_play_sessions','ft_feed_impressions','ft_contribution_credits'])assert.equal(f.count(table),0,'Version context must not fabricate gameplay or contribution evidence');
});

test('migration preserves historical rows and old-client retries without guessing a current version',async t=>{
  const f=fixture(t,{through:12}),work=f.seed(),key=randomUUID(),id=randomUUID(),body='A historical comment';
  const legacyHash=digest(JSON.stringify({workId:work.id,body,parentId:null}));
  f.database.prepare('INSERT INTO ft_comments(id,work_id,author_id,author_name,body,parent_id,created_at,idempotency_key,request_hash) VALUES(?,?,?,?,?,NULL,?,?,?)').run(id,work.id,OTHER,'Reader',body,'2026-01-01T00:00:00.000Z',key,legacyHash);
  const historical=f.database.prepare('SELECT * FROM ft_comments WHERE id=?').get(id);
  f.migrate();
  assert.deepEqual({...f.database.prepare('SELECT * FROM ft_comments WHERE id=?').get(id)},{...historical,version_id:null});
  assert.equal((await f.version(work.id)).status,201);
  const retry=await post(f,work,{body},{key});assert.equal(retry.status,200);assert.equal(retry.comment.id,id);
  assert.deepEqual(versionContext(retry.comment),{versionId:null,version:null});
  assert.equal((await post(f,work,{body,versionId:null},{key})).status,200);
  assert.equal((await post(f,work,{body,versionId:work.versionId},{key})).error.code,'IDEMPOTENCY_CONFLICT');
  assert.equal(f.count('ft_comments'),1);
  assert.equal(f.database.prepare('SELECT request_hash FROM ft_comments WHERE id=?').get(id).request_hash,legacyHash);
  const list=await comments(f,work);assert.deepEqual(versionContext(list.comments[0]),{versionId:null,version:null});
  const inbox=await f.api('/api/comments?mine=1');assert.deepEqual(versionContext(inbox.comments[0]),{versionId:null,version:null});
});

test('omitted or explicit null version remains unknown; malformed, missing and foreign versions are rejected',async t=>{
  const f=fixture(t),{work}=await f.publish(),foreign=(await f.publish({bytes:html('other game')})).work;
  for(const body of [{body:'Old client'},{body:'Unknown context',versionId:null}]){
    const key=randomUUID(),response=await post(f,work,body,{key});assert.equal(response.status,201);assert.deepEqual(versionContext(response.comment),{versionId:null,version:null});
    const retried=await post(f,work,{...body,versionId:null},{key});assert.equal(retried.status,200);assert.equal(retried.comment.id,response.comment.id);
  }
  for(const versionId of [foreign.versionId,randomUUID()]){
    const response=await post(f,work,{body:'Forged context',versionId});assert.equal(response.status,422);assert.equal(response.error.code,'INVALID_COMMENT_VERSION');
  }
  for(const versionId of ['',{},42,'x'.repeat(129)])assert.equal((await post(f,work,{body:'Invalid',versionId})).status,422);
  assert.equal(f.count('ft_comments'),2);
});

test('replies carry their own page version through embedded replies, reply paging, inbox and exact context',async t=>{
  const f=fixture(t),{work:v1}=await f.publish();assert.equal((await f.version(v1.id)).status,201);const v2=(await f.get(v1.id)).work;
  const root=(await post(f,v1,{body:'Old version report',versionId:v1.versionId})).comment;
  const replies=[];
  for(let i=0;i<5;i++){
    const versionId=i%2?v1.versionId:v2.versionId;
    const response=await post(f,v2,{body:'Reply '+i,parentId:root.id,versionId},{owner:i%2?OTHER:OWNER});assert.equal(response.status,201);replies.push(response.comment);
  }
  const list=await comments(f,v2),thread=list.comments[0];assert.equal(thread.versionId,v1.versionId);assert.equal(thread.replyCount,5);
  assert.deepEqual(thread.replies.map(versionContext),replies.slice(0,3).map(versionContext));
  const rest=await f.api('/api/comments/'+root.id+'/replies?cursor='+encodeURIComponent(thread.repliesNextCursor));
  assert.deepEqual(rest.replies.map(versionContext),replies.slice(3).map(versionContext));assert.equal(rest.nextCursor,null);
  const focused=await context(f,replies[4].id);assert.equal(focused.workId,v1.id);assert.equal(focused.targetId,replies[4].id);assert.equal(focused.contextOnly,true);
  assert.equal(focused.thread.id,root.id);assert.deepEqual(focused.thread.replies.map(versionContext),[versionContext(replies[4])]);assert.equal(focused.thread.repliesNextCursor,null);
  const inbox=await f.api('/api/comments?mine=1&work='+v1.id);assert.equal(inbox.comments.length,6);
  assert.deepEqual(inbox.comments.find(c=>c.id===replies[4].id),replies[4]);
  const cross=(await f.publish({bytes:html('different')})).work;
  assert.equal((await post(f,cross,{body:'wrong parent',parentId:root.id,versionId:cross.versionId})).error.code,'INVALID_COMMENT_PARENT');
});

test('idempotency includes version context across parallel retry, changed version and unknown context',async t=>{
  const f=fixture(t),{work:v1}=await f.publish();assert.equal((await f.version(v1.id)).status,201);const v2=(await f.get(v1.id)).work,key=randomUUID();
  const responses=await Promise.all(Array.from({length:5},()=>post(f,v1,{body:'Same text',versionId:v1.versionId},{key})));
  assert.equal(responses.filter(r=>r.status===201).length,1);assert(responses.every(r=>[200,201].includes(r.status)));
  assert.equal(new Set(responses.map(r=>r.comment.id)).size,1);assert.equal(f.count('ft_comments'),1);
  for(const versionId of [v2.versionId,null])assert.equal((await post(f,v1,{body:'Same text',versionId},{key})).error.code,'IDEMPOTENCY_CONFLICT');
  const racingKey=randomUUID(),raced=await Promise.all([v1,v2].map(work=>post(f,work,{body:'Racing context',versionId:work.versionId},{key:racingKey})));
  assert.deepEqual(raced.map(r=>r.status).sort(),[201,409]);assert.equal(f.count('ft_comments'),2);
  const winner=raced.find(r=>r.status===201).comment;
  assert.equal(f.database.prepare('SELECT version_id FROM ft_comments WHERE id=?').get(winner.id).version_id,winner.versionId);
});

test('a lost commit response retries the same versioned comment without duplication',async t=>{
  const f=fixture(t),{work}=await f.publish(),key=randomUUID(),body={body:'Submitted once',versionId:work.versionId};
  f.faults.afterCommit=true;assert.equal((await post(f,work,body,{key})).status,500);assert.equal(f.count('ft_comments'),1);
  const retried=await post(f,work,body,{key});assert.equal(retried.status,200);assert.equal(retried.duplicate,true);assert.equal(retried.comment.versionId,work.versionId);assert.equal(f.count('ft_comments'),1);
});

test('exact context reaches old roots and deep replies without changing normal paging, and stays authenticated',async t=>{
  const f=fixture(t),{work}=await f.publish();
  const root=(await post(f,work,{body:'Old root',versionId:work.versionId})).comment;
  let target;
  for(let i=0;i<5;i++)target=(await post(f,work,{body:'Reply '+i,parentId:root.id,versionId:work.versionId})).comment;
  for(let i=0;i<21;i++)assert.equal((await post(f,work,{body:'New root '+i,versionId:work.versionId})).status,201);
  const first=await comments(f,work);assert.equal(first.comments.length,20);assert(!first.comments.some(c=>c.id===root.id));assert(first.nextCursor);
  const oldRoot=await context(f,root.id);assert.equal(oldRoot.thread.id,root.id);assert.deepEqual(oldRoot.thread.replies,[]);assert.equal(oldRoot.thread.replyCount,5);
  const deep=await context(f,target.id);assert.equal(deep.thread.id,root.id);assert.deepEqual(deep.thread.replies.map(c=>c.id),[target.id]);assert.equal(deep.thread.repliesNextCursor,null);
  assert.deepEqual(await comments(f,work),first,'Context lookup must not mutate normal paging or discussion');
  assert.equal((await context(f,randomUUID())).status,404);
  assert.equal((await context(f,'x'.repeat(129))).status,404);
  const anonymous=await handleAPI(new Request('https://site.test/api/comments/'+target.id+'/context'));assert.equal(anonymous.status,401);
});


test('concurrent comments share an atomic minute quota, with safe replay at the limit',async t=>{
  const f=fixture(t),{work}=await f.publish();
  for(let i=0;i<29;i++)assert.equal((await post(f,work,{body:'Quota seed '+i,versionId:work.versionId})).status,201);
  const attempts=Array.from({length:12},(_,i)=>({key:randomUUID(),body:{body:'Concurrent '+i,versionId:work.versionId,expectedAuthorId:OTHER}}));
  // Hold legacy quota reads at the same snapshot. Real D1 requests can
  // interleave here; a synchronous SQLite fixture otherwise hides the race.
  const prepare=f.db.prepare.bind(f.db);let reads=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  f.db.prepare=query=>{const statement=prepare(query);if(query.startsWith('SELECT COUNT(*) AS n FROM ft_comments WHERE author_id=')){
    const first=statement.first.bind(statement);statement.first=async()=>{const snapshot=await first();if(++reads===attempts.length)release();await gate;return snapshot;};
  }return statement;};
  const results=await Promise.all(attempts.map(({key,body})=>post(f,work,body,{key})));
  f.db.prepare=prepare;
  assert.equal(results.filter(r=>r.status===201).length,1);
  assert.equal(results.filter(r=>r.status===429&&r.error.code==='RATE_LIMITED').length,11);
  assert.equal(f.count('ft_comments'),30);
  const index=results.findIndex(r=>r.status===201),accepted=attempts[index];
  const replay=await post(f,work,accepted.body,{key:accepted.key});assert.equal(replay.status,200);assert.equal(replay.comment.id,results[index].comment.id);
  assert.equal((await post(f,work,{...accepted.body,body:'Changed'},{key:accepted.key})).error.code,'IDEMPOTENCY_CONFLICT');
  f.database.prepare('UPDATE ft_comments SET created_at=? WHERE id=?').run(new Date(Date.now()-61000).toISOString(),results[index].comment.id);
  assert.equal((await post(f,work,{body:'Window reopened',versionId:work.versionId})).status,201);
});

test('a lost response at full quota replays the committed comment without another slot or credit',async t=>{
  const f=fixture(t),{work}=await f.publish();
  for(let i=0;i<29;i++)await post(f,work,{body:'Quota '+i});
  const key=randomUUID(),body={body:'Last slot',versionId:work.versionId};
  f.faults.afterCommit=true;assert.equal((await post(f,work,body,{key})).status,500);assert.equal(f.count('ft_comments'),30);
  const credits=f.count('ft_contribution_credits'),replay=await post(f,work,body,{key});
  assert.equal(replay.status,200);assert.equal(replay.duplicate,true);assert.equal(f.count('ft_comments'),30);assert.equal(f.count('ft_contribution_credits'),credits);
  assert.equal((await post(f,work,{body:'Over quota'})).status,429);
});
test('concurrent identical replies consume only one last slot',async t=>{
  const f=fixture(t),{work}=await f.publish(),root=(await post(f,work,{body:'Root'})).comment;
  for(let i=0;i<28;i++)await post(f,work,{body:'Quota '+i});
  const key=randomUUID(),body={body:'One reply',parentId:root.id,versionId:work.versionId};
  const results=await Promise.all(Array.from({length:12},()=>post(f,work,body,{key})));
  assert(results.every(result=>[200,201].includes(result.status)));assert.equal(new Set(results.map(result=>result.comment.id)).size,1);assert.equal(f.count('ft_comments'),30);
});
