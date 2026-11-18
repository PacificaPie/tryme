import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,OWNER,OTHER,handleAPI} from './helpers/router-fixture.mjs';

const png=last=>new Uint8Array([137,80,78,71,13,10,26,10,last,88,77]);
const path=card=>'/api/cards/'+card.id+'/cover-updates';
async function setup(t,{cover=false}={}){
  const f=fixture(t),{work}=await f.publish({cover});
  const result=await f.api('/api/cards',{method:'POST',body:{name:'Creator',template:'city',workIds:[work.id],signature:'Saved signature',backStyle:'ivory'}});
  assert.equal(result.status,201);return {f,work,card:result.card};
}
async function edit(f,work,last=99,extra={}){
  const current=(await f.get(work.id)).work,body=new FormData();
  body.set('name',extra.name||'New work title');body.set('desc','New work description');body.set('expectedRevision',String(current.revision));
  if(last!==null)body.set('cover',new File([png(last)],'new.png',{type:'image/png'}));
  const result=await f.api('/api/works/'+work.id,{method:'PATCH',body});assert.equal(result.status,200);return result.work;
}
async function preview(f,card){const result=await f.api(path(card));assert.equal(result.status,200);return result.updates.map(({workId,metadataId})=>({workId,metadataId}));}
const save=(f,card,updates,options={})=>f.api(path(card),{method:'POST',body:{updates},...options});
const publicRead=async card=>{const r=await handleAPI(new Request('https://site.test/api/public/cards/'+card.id));assert.equal(r.status,200);return (await r.json()).card;};

test('refresh fills an empty cover in a new card, preserves old links and pinned content, and replays lost replies',async t=>{
  const {f,work,card}=await setup(t),stored=f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json;
  await f.version(work.id);const current=await edit(f,work),updates=await preview(f,card),key=randomUUID();
  const result=await save(f,card,updates,{key});assert.equal(result.status,201);const next=result.card;
  assert.notEqual(next.id,card.id);assert.equal(next.template,card.template);assert.equal(next.signature,card.signature);
  assert.deepEqual(next.works[0],{...card.works[0],coverUrl:'/media/'+current.metadataId,coverMetadataId:current.metadataId});
  assert.equal((await f.api('/api/cards/me')).card.id,next.id);
  assert.equal((await f.api('/api/creators/'+OWNER)).card.id,next.id);
  assert.equal((await publicRead(card)).works[0].coverUrl,'');
  const publicNext=await publicRead(next);assert(!JSON.stringify(publicNext).includes('coverMetadataId'));
  const image=await handleAPI(new Request('https://site.test'+publicNext.works[0].coverUrl));assert.equal(image.status,200);assert.deepEqual(new Uint8Array(await image.arrayBuffer()),png(99));
  assert.equal(f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json,stored);
  assert.equal((await save(f,card,updates,{key})).card.id,next.id);assert.equal(f.count('ft_cards'),2);
  assert.equal((await f.api(path(next))).updates.length,0);
});

test('a preview pins the reviewed cover even if another cover is uploaded before saving',async t=>{
  const {f,work,card}=await setup(t);const first=await edit(f,work,44),updates=await preview(f,card);await edit(f,work,55);
  const result=await save(f,card,updates);assert.equal(result.status,201);assert.equal(result.card.works[0].coverMetadataId,first.metadataId);
  const image=await handleAPI(new Request('https://site.test'+(await publicRead(result.card)).works[0].coverUrl));assert.deepEqual(new Uint8Array(await image.arrayBuffer()),png(44));
  const again=await preview(f,result.card);assert.equal(again.length,1);const latest=await save(f,result.card,again);assert.equal(latest.status,201);
  assert.equal((await publicRead(result.card)).works[0].coverUrl.includes(result.card.id),true);
  assert.equal((await f.api(path(latest.card))).updates.length,0);
});

test('refresh stays owner-only, enforces CSRF and rejects unrelated or fabricated cover references',async t=>{
  const {f,work,card}=await setup(t);await edit(f,work);const updates=await preview(f,card);
  assert.equal((await f.api(path(card),{owner:OTHER})).status,404);
  assert.equal((await save(f,card,updates,{owner:OTHER})).status,404);
  assert.equal((await handleAPI(new Request('https://site.test'+path(card)))).status,401);
  assert.equal((await save(f,card,updates,{extraHeaders:{Origin:'https://evil.test'}})).status,403);
  const other=(await f.publish({owner:OTHER,cover:true,bytes:'<html>other</html>'})).work;
  for(const invalid of [[],[updates[0],updates[0]],[{workId:other.id,metadataId:other.metadataId}],[{workId:work.id,metadataId:other.metadataId}],[{workId:work.id,metadataId:randomUUID()}],[{...updates[0],coverUrl:'https://evil.test'}]])assert.equal((await save(f,card,invalid)).status,422);
  assert.equal(f.count('ft_cards'),1);
});

test('parallel refresh and transport retries create only one edition; changed payload cannot reuse a key',async t=>{
  const {f,work,card}=await setup(t);await edit(f,work);const updates=await preview(f,card),key=randomUUID();
  const results=await Promise.all([save(f,card,updates,{key}),save(f,card,updates,{key})]);
  assert(results.every(r=>[200,201].includes(r.status)),JSON.stringify(results));assert.equal(results[0].card.id,results[1].card.id);assert.equal(f.count('ft_cards'),2);
  assert.equal((await save(f,card,[{...updates[0],metadataId:randomUUID()}],{key})).error.code,'IDEMPOTENCY_CONFLICT');
  await f.api('/api/cards/'+results[0].card.id+'/delete',{method:'POST'});
  assert.equal((await save(f,card,updates,{key})).error.code,'CARD_DELETED');
});

test('a late refresh cannot replace a newly saved template, deleted source or archived work',async t=>{
  for(const action of ['new-card','delete','archive']){
    const {f,work,card}=await setup(t);await edit(f,work);const updates=await preview(f,card);
    if(action==='new-card')await f.api('/api/cards',{method:'POST',body:{name:'Creator',template:'filmstrip',workIds:[work.id]}});
    if(action==='delete')await f.api('/api/cards/'+card.id+'/delete',{method:'POST'});
    if(action==='archive')await f.api('/api/works/'+work.id+'/archive',{method:'POST',body:{action:'archive',expectedRevision:(await f.get(work.id)).work.revision}});
    const count=f.count('ft_cards'),result=await save(f,card,updates);assert([404,409].includes(result.status),JSON.stringify(result));assert.equal(f.count('ft_cards'),count);
    if(action==='new-card')assert.equal((await f.api('/api/cards/me')).card.template,'filmstrip');
  }
});

test('metadata-only edits do not invent cover updates; an unchanged image is rejected',async t=>{
  const {f,work,card}=await setup(t,{cover:true});await edit(f,work,null);
  assert.equal((await f.api(path(card))).updates.length,0);
  assert.equal((await save(f,card,[{workId:work.id,metadataId:work.metadataId}])).error.code,'NO_COVER_UPDATES');
  assert.equal(f.count('ft_cards'),1);
});
