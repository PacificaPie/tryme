import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,OWNER,OTHER,handleAPI,html} from './helpers/router-fixture.mjs';
const expected=id=>({'X-Funtrack-Expected-User':id});
const png=new Uint8Array([137,80,78,71,13,10,26,10,99,88,77]);
const draftForm=(bytes=html('Release integration'))=>{const form=new FormData();form.set('id',randomUUID());form.set('source','html');form.set('file',new File([bytes],'release.html',{type:'text/html'}));return form;};
const publicCard=async id=>{const response=await handleAPI(new Request('https://site.test/api/public/cards/'+id));assert.equal(response.status,200);return (await response.json()).card;};

test('private publication → pinned card → versioned comment → cover update preserves all three contracts',async t=>{
  const f=fixture(t,{prepublish:true}),bytes=html('Release integration'),headers=expected(OWNER);
  const draft=await f.api('/api/publish-drafts',{method:'POST',body:draftForm(bytes),extraHeaders:headers});assert.equal(draft.status,200);
  assert.equal(f.count('ft_works'),0);assert.deepEqual(await f.feed(),[]);
  assert.equal((await f.publish({bytes})).error.code,'MEDIA_REVIEW_REQUIRED');
  const publication=await f.publish({bytes,name:'Published without cover',extra:{draftId:draft.id,coverChoice:'skip',videoChoice:'skip'}});assert.equal(publication.status,201);const work=publication.work;
  assert.deepEqual(await f.feed(),[work.id]);
  const cardResult=await f.api('/api/cards',{method:'POST',body:{name:'Creator',template:'city',workIds:[work.id]},extraHeaders:headers});assert.equal(cardResult.status,201);const card=cardResult.card;
  const original=f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json;
  const comment=await f.api('/api/works/'+work.id+'/comments',{method:'POST',owner:OTHER,extraHeaders:expected(OTHER),body:{body:'On the saved version',versionId:work.versionId,expectedAuthorId:OTHER}});assert.equal(comment.status,201);
  assert.equal((await f.version(work.id)).status,201);
  const current=(await f.get(work.id)).work,edit=new FormData();edit.set('name','New title');edit.set('desc','New description');edit.set('expectedRevision',String(current.revision));edit.set('cover',new File([png],'cover.png',{type:'image/png'}));
  assert.equal((await f.api('/api/works/'+work.id,{method:'PATCH',body:edit,extraHeaders:headers})).status,200);
  const path='/api/cards/'+card.id+'/cover-updates',preview=await f.api(path,{extraHeaders:headers});assert.equal(preview.status,200);assert.equal(preview.updates.length,1);
  const body={updates:preview.updates.map(({workId,metadataId})=>({workId,metadataId}))},key=randomUUID();
  const rejected=await f.api(path,{method:'POST',owner:OTHER,body,key,extraHeaders:headers});assert.equal(rejected.status,409);assert.equal(rejected.error.code,'AUTH_SESSION_CHANGED');assert.equal(f.count('ft_cards'),1);
  const next=await f.api(path,{method:'POST',body,key,extraHeaders:headers});assert.equal(next.status,201);
  assert.equal((await f.api(path,{method:'POST',body,key,extraHeaders:headers})).card.id,next.card.id);
  assert.equal(f.count('ft_cards'),2);assert.equal(f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json,original);
  const oldPublic=await publicCard(card.id),newPublic=await publicCard(next.card.id);
  assert.equal(oldPublic.works[0].coverUrl,'');assert(newPublic.works[0].coverUrl);
  for(const field of ['id','versionId','name','desc'])assert.equal(newPublic.works[0][field],oldPublic.works[0][field],field);
  const cover=await handleAPI(new Request('https://site.test'+newPublic.works[0].coverUrl));assert.equal(cover.status,200);assert.deepEqual(new Uint8Array(await cover.arrayBuffer()),png);
  const listed=await f.api('/api/works/'+work.id+'/comments');assert.equal(listed.comments[0].versionId,work.versionId);assert.equal(listed.comments[0].id,comment.comment.id);
});

test('expected-account guard precedes private draft and card-cover services, including replay',async t=>{
  const f=fixture(t,{prepublish:true}),form=draftForm(),headers=expected(OWNER);
  const rejected=await f.api('/api/publish-drafts',{method:'POST',owner:OTHER,body:form,extraHeaders:headers});assert.equal(rejected.status,409);assert.equal(rejected.error.code,'AUTH_SESSION_CHANGED');assert.equal(f.count('ft_publish_drafts'),0);assert.equal(f.objects.size,0);
  const accepted=await f.api('/api/publish-drafts',{method:'POST',body:form,extraHeaders:headers});assert.equal(accepted.status,200);assert.equal(f.count('ft_publish_drafts'),1);
  const replay=await f.api('/api/publish-drafts',{method:'POST',owner:OTHER,body:form,extraHeaders:headers});assert.equal(replay.status,409);assert.equal(f.count('ft_publish_drafts'),1);
  // A route-owned 404 would hide a lost/misordered guard; require the common
  // stale-account rejection even before the new card service reads a source.
  for(const method of ['GET','POST']){
    const result=await f.api('/api/cards/'+randomUUID()+'/cover-updates',{method,owner:OTHER,body:{updates:[]},extraHeaders:headers});assert.equal(result.status,409);assert.equal(result.error.code,'AUTH_SESSION_CHANGED');
  }
});
