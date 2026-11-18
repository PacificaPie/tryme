import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,OWNER,OTHER} from './helpers/router-fixture.mjs';

test('notifications follow only accepted comments under the deployed atomic quota and receipt contract',async t=>{
  const f=fixture(t),{work}=await f.publish(),path='/api/works/'+work.id+'/comments';
  const post=(body,key=randomUUID())=>f.api(path,{method:'POST',owner:OTHER,key,body:{body,versionId:work.versionId,expectedAuthorId:OTHER},extraHeaders:{'X-Funtrack-Expected-User':OTHER}});
  for(let i=0;i<29;i++)assert.equal((await post('Existing '+i)).status,201);
  const key=randomUUID(),accepted=await post('Last slot',key);assert.equal(accepted.status,201);
  const replies=await Promise.all(Array.from({length:8},(_,i)=>post('Over quota '+i)));
  assert(replies.every(r=>r.status===429));assert.equal(f.count('ft_comments'),30);assert.equal(f.count('ft_notifications'),30);
  assert.equal((await post('Last slot',key)).comment.id,accepted.comment.id);assert.equal(f.count('ft_notifications'),30);
  const inbox=await f.api('/api/notifications?expectedRecipientId='+OWNER);assert.equal(inbox.status,200);assert(inbox.hasUnread);
  assert(inbox.items.every(n=>n.versionId===work.versionId&&n.actor.id===OTHER));
  const switched=await f.api('/api/notifications/read-all',{method:'POST',owner:OTHER,body:{expectedRecipientId:OTHER,through:inbox.snapshot},extraHeaders:{'X-Funtrack-Expected-User':OWNER}});
  assert.equal(switched.status,409);assert.equal(f.database.prepare('SELECT COUNT(*) n FROM ft_notifications WHERE read_at IS NOT NULL').get().n,0);
  assert.equal((await f.api('/api/notifications/read-all',{method:'POST',body:{expectedRecipientId:OWNER,through:inbox.snapshot},extraHeaders:{'X-Funtrack-Expected-User':OWNER}})).hasUnread,false);
});
