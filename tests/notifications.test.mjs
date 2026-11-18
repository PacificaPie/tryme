import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,OWNER,OTHER,REVIEWER,handleAPI} from './helpers/router-fixture.mjs';

const list=(f,owner=OWNER,query='')=>f.api('/api/notifications?expectedRecipientId='+encodeURIComponent(owner)+query,{owner});
const summary=(f,owner=OWNER)=>f.api('/api/notifications/summary?expectedRecipientId='+encodeURIComponent(owner),{owner});
const like=(f,id,liked=true,owner=OTHER)=>f.api('/api/works/'+id+'/like',{method:'POST',owner,body:{liked}});
const comment=(f,id,body='A comment',owner=OTHER,parentId=null,key=randomUUID())=>f.api('/api/works/'+id+'/comments',{method:'POST',owner,key,body:{body,parentId}});
const follow=(f,following=true,owner=OTHER)=>f.api('/api/creators/'+OWNER+'/follow',{method:'POST',owner,body:{following}});
const read=(f,id,owner=OWNER,extra={})=>f.api('/api/notifications/'+id+'/read',{method:'POST',owner,body:{expectedRecipientId:owner,...extra}});
const all=(f,through,owner=OWNER)=>f.api('/api/notifications/read-all',{method:'POST',owner,body:{expectedRecipientId:owner,through}});

test('migration leaves old interactions untouched and only future successful source writes notify',async t=>{
  const f=fixture(t,{through:18}),w=f.seed();
  assert.equal((await like(f,w.id)).status,200);
  assert.equal((await comment(f,w.id)).status,201);
  assert.equal((await follow(f)).status,200);
  const before=['ft_work_likes','ft_comments','ft_creator_follows'].map(table=>f.database.prepare('SELECT * FROM '+table).all());
  f.migrate();
  assert.equal(f.count('ft_notifications'),0);
  assert.deepEqual(['ft_work_likes','ft_comments','ft_creator_follows'].map(table=>f.database.prepare('SELECT * FROM '+table).all()),before);
  assert.equal((await list(f)).items.length,0);
  await like(f,w.id,true,REVIEWER);assert.equal((await list(f)).items.length,1);
});

test('recipients are owners and root authors, deduplicated with self actions suppressed',async t=>{
  const f=fixture(t),{work}=await f.publish();
  await like(f,work.id,true,OWNER);assert.equal(f.count('ft_notifications'),0);
  const root=(await comment(f,work.id,'Owner root',OWNER)).comment;
  const reply=(await comment(f,work.id,'Direct reply',OTHER,root.id)).comment;
  assert.deepEqual((await list(f)).items.map(n=>[n.kind,n.commentId]),[['reply',reply.id]]);
  const foreignRoot=(await comment(f,work.id,'Reader root',OTHER)).comment;
  const foreignReply=(await comment(f,work.id,'Third reader reply',REVIEWER,foreignRoot.id)).comment;
  assert.equal((await list(f)).items.filter(n=>n.commentId===foreignReply.id).length,1);
  assert.equal((await list(f,OTHER)).items.find(n=>n.commentId===foreignReply.id).kind,'reply');
  await f.api('/api/comments/'+foreignRoot.id+'/like',{method:'POST',owner:REVIEWER,body:{liked:true}});
  assert.equal((await list(f,OTHER)).items[0].kind,'comment_like');
  assert.equal((await list(f)).items.some(n=>n.kind==='comment_like'),false);
  await comment(f,work.id,'Owner replies to reader',OWNER,foreignRoot.id);
  assert.equal((await list(f,OTHER)).items[0].kind,'reply');
  assert.equal((await list(f)).items.some(n=>n.actor.id===OWNER),false);
});

test('source write retries and lost responses cannot duplicate inbox events; rollbacks do not notify',async t=>{
  const f=fixture(t),{work}=await f.publish(),key=randomUUID();
  f.faults.beforeCommit=true;assert.equal((await comment(f,work.id,'Rollback',OTHER,null,key)).status,500);
  assert.equal(f.count('ft_notifications'),0);assert.equal(f.count('ft_comments'),0);
  f.faults.afterCommit=true;assert.equal((await comment(f,work.id,'Rollback',OTHER,null,key)).status,500);
  assert.equal(f.count('ft_notifications'),1);assert.equal(f.count('ft_comments'),1);
  assert.equal((await comment(f,work.id,'Rollback',OTHER,null,key)).status,200);
  assert.equal(f.count('ft_notifications'),1);
  await Promise.all([like(f,work.id),like(f,work.id)]);
  assert.equal((await list(f)).items.filter(n=>n.kind==='work_like').length,1);
});

test('cancelled likes/follows retract and reactivation never creates fresh unread or changes ordering',async t=>{
  const f=fixture(t),{work}=await f.publish();await like(f,work.id);await follow(f);
  const initial=await list(f);assert(initial.hasUnread);assert.equal(initial.items.length,2);
  await like(f,work.id,false);await follow(f,false);
  assert.equal((await list(f)).items.length,0);assert.equal((await summary(f)).hasUnread,false);
  await like(f,work.id);await follow(f);
  const restored=await list(f);assert.equal(restored.items.length,2);assert.equal(restored.hasUnread,false);
  assert.deepEqual(restored.items.map(n=>[n.id,n.createdAt]),initial.items.map(n=>[n.id,n.createdAt]));
});

test('likes group by target and UTC day; every actor remains inspectable via bounded pagination',async t=>{
  const f=fixture(t),{work}=await f.publish();
  for(let i=0;i<24;i++){
    const owner='reader-'+i;
    await f.api('/api/me/profile',{method:'POST',owner,body:{name:'Reader '+i,avatarPreset:'moon'}});
    assert.equal((await like(f,work.id,true,owner)).status,200);
  }
  const page=await list(f);assert.equal(page.items.length,1);assert.equal(page.items[0].actorCount,24);
  const id=page.items[0].id,base='/api/notifications/'+id+'/actors?expectedRecipientId='+OWNER;
  const one=await f.api(base),two=await f.api(base+'&cursor='+one.nextCursor);
  assert.equal(one.actors.length,20);assert.equal(two.actors.length,4);assert.equal(two.nextCursor,null);
  assert.equal(new Set([...one.actors,...two.actors].map(a=>a.id)).size,24);
  assert(one.actors.every(a=>a.available&&a.name&&a.avatarUrl==='/avatars/moon.svg'));
  f.database.prepare("UPDATE ft_notifications SET created_at='2026-01-01T00:00:00.000Z' WHERE actor_id='reader-0'").run();
  assert.equal((await list(f)).items.length,2);
});

test('reads are owner scoped, idempotent and never clear arrivals after a list snapshot or group anchor',async t=>{
  const f=fixture(t),{work}=await f.publish();await like(f,work.id);
  const old=await list(f);await like(f,work.id,true,REVIEWER);
  assert.equal((await read(f,old.items[0].id)).hasUnread,true,'New actor in an old group stays unread');
  assert.equal((await all(f,old.snapshot)).hasUnread,true);
  assert.equal((await read(f,old.items[0].id,OTHER)).status,404);
  const current=await list(f);assert.equal(current.items[0].unread,true);
  assert.equal((await read(f,current.items[0].id)).hasUnread,false);
  const readAt=f.database.prepare('SELECT read_at FROM ft_notifications WHERE seq=?').get(current.items[0].id).read_at;
  await read(f,current.items[0].id);
  assert.equal(f.database.prepare('SELECT read_at FROM ft_notifications WHERE seq=?').get(current.items[0].id).read_at,readAt);
  assert.equal((await list(f)).items[0].unread,false);
});

test('unauthenticated and stale-account requests reveal no inbox data and cannot mark another account read',async t=>{
  const f=fixture(t),{work}=await f.publish();await like(f,work.id);const current=await list(f);
  const anon=await handleAPI(new Request('https://site.test/api/notifications?expectedRecipientId='+OWNER));assert.equal(anon.status,401);
  for(const path of ['/api/notifications','/api/notifications/summary','/api/notifications/'+current.items[0].id+'/actors']){
    const switched=await f.api(path+'?expectedRecipientId='+OWNER,{owner:OTHER});assert.equal(switched.status,409);assert.equal(switched.items,undefined);
  }
  assert.equal((await read(f,current.items[0].id,OTHER,{expectedRecipientId:OWNER})).status,409);
  assert.equal((await summary(f)).hasUnread,true);
  const csrf=await f.api('/api/notifications/read-all',{method:'POST',body:{through:current.snapshot,expectedRecipientId:OWNER},extraHeaders:{'X-Funtrack-CSRF':''}});assert.equal(csrf.status,403);
  assert.equal((await list(f,OTHER)).items.length,0);
});

test('pagination stays bounded and does not repeat a previously shown group when its newest like is retracted',async t=>{
  const f=fixture(t),{work}=await f.publish();await like(f,work.id);
  await comment(f,work.id,'Between');await like(f,work.id,true,REVIEWER);
  const page=await list(f,OWNER,'&limit=1');assert.equal(page.items[0].kind,'work_like');
  await like(f,work.id,false,REVIEWER);await follow(f);
  const next=await list(f,OWNER,'&limit=1&cursor='+page.nextCursor);
  assert.equal(next.items.length,1);assert.equal(next.items[0].kind,'comment');assert.equal(next.nextCursor,null);
  assert.equal((await list(f,OWNER,'&filter=like&cursor='+page.nextCursor)).status,422);
  assert.equal((await list(f,OTHER,'&cursor='+page.nextCursor)).status,422);
  assert.equal((await list(f,OWNER,'&filter=unknown')).status,422);
  assert.equal((await list(f,OWNER,'&limit=-1')).status,422);
});

test('live profiles and comment versions are projected without inventing version history or disclosing unavailable text',async t=>{
  const f=fixture(t),{work}=await f.publish();
  const posted=await f.api('/api/works/'+work.id+'/comments',{method:'POST',owner:OTHER,body:{body:'Version-specific',versionId:work.versionId}});
  await f.api('/api/me/profile',{method:'POST',owner:OTHER,body:{name:'Updated name',avatarPreset:'sprout'}});
  let row=(await list(f)).items[0];assert.equal(row.actor.name,'Updated name');assert.equal(row.versionId,work.versionId);
  const ownerRoot=(await comment(f,work.id,'Own root',OWNER)).comment;
  await comment(f,work.id,'Unknown version',OTHER,ownerRoot.id);row=(await list(f)).items[0];assert.equal(row.versionId,null);assert.equal(row.version,null);
  f.database.prepare('DELETE FROM ft_comments WHERE id=?').run(posted.comment.id);
  row=(await list(f)).items.find(n=>n.kind==='comment');assert.equal(row.available,false);assert.equal(row.body,null);assert.equal(row.workId,null);
  const foreign=(await f.publish({owner:REVIEWER,bytes:'<!doctype html><body>Other work</body>'})).work;
  const root=(await comment(f,foreign.id,'My comment elsewhere',OWNER)).comment;
  await comment(f,foreign.id,'Private once archived',OTHER,root.id);
  f.database.prepare('UPDATE ft_works SET archived_at=? WHERE id=?').run(new Date().toISOString(),foreign.id);
  row=(await list(f)).items.find(n=>n.actor.id===OTHER&&n.kind==='reply'&&n.id>3);
  assert(row);assert.equal(row.available,false);assert.equal(row.body,null);
});
