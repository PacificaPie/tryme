import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,OWNER,OTHER,handleAPI} from './helpers/router-fixture.mjs';
import {createPublicSharingService} from '../lib/funtrack/public-sharing.mjs';
import {deleteCard,hasPendingCardDeletion} from '../public/card-actions.js';
import {cardShareText,shareMessage} from '../public/sharing.js';
import {setLocale} from '../public/i18n.js';

const save=(f,work,key=randomUUID())=>f.api('/api/cards',{method:'POST',key,body:{name:'Creator',bio:'Games',template:'wall',workIds:[work.id]}});
const remove=(f,id,options={})=>f.api('/api/cards/'+id+'/delete',{method:'POST',...options});
const publicRead=path=>handleAPI(new Request('https://site.test'+path));

test('only the card owner can delete; anonymous and CSRF failures leave it available',async t=>{
  const f=fixture(t),{work}=await f.publish(),{card}=await save(f,work);
  assert.equal((await remove(f,card.id,{owner:OTHER})).status,404);
  assert.equal((await remove(f,card.id,{extraHeaders:{Origin:'https://other.test'}})).status,403);
  assert.equal((await handleAPI(new Request('https://site.test/api/cards/'+card.id+'/delete',{method:'POST'}))).status,401);
  assert.equal((await f.api('/api/cards/'+card.id)).status,200);
});

test('deletion revokes all card reads and covers while preserving snapshots, works, events and other cards',async t=>{
  const f=fixture(t),{work}=await f.publish({cover:true}),{card:old}=await save(f,work),key=randomUUID(),{card}=await save(f,work,key);
  await f.api('/api/events',{method:'POST',body:{eventId:randomUUID(),type:'card_view',cardId:card.id}});
  const before=f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json;
  const publicPath='/api/public/cards/'+card.id,read=await publicRead(publicPath),dto=await read.json(),cover=dto.card.works[0].coverUrl;
  const counts=['ft_works','ft_work_versions','ft_events','ft_cards'].map(table=>f.count(table));
  assert.deepEqual(await remove(f,card.id),{status:200,cardId:card.id,deleted:true});
  assert.deepEqual(await remove(f,card.id),{status:200,cardId:card.id,deleted:true});
  assert.equal((await f.api('/api/cards/'+card.id)).status,404);
  assert.equal((await f.api('/api/cards/me')).status,404,'Deleting latest must not silently republish an older card');
  assert.equal((await f.api('/api/cards')).cards.length,0);
  for(const path of [publicPath,cover])assert.equal((await publicRead(path)).status,404);
  const service=createPublicSharingService({db:()=>f.db,bucket:()=>f.bucket});
  assert.equal((await service.page(new Request('https://site.test/c/'+card.id),card.id)).status,404);
  assert.equal((await f.api('/api/cards/'+old.id)).status,200);
  assert.equal((await f.get(work.id)).status,200);
  assert.deepEqual(['ft_works','ft_work_versions','ft_events','ft_cards'].map(table=>f.count(table)),counts);
  assert.equal(f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json,before);
  assert.equal((await save(f,work,key)).error.code,'CARD_DELETED');
  const next=await save(f,work);assert.equal(next.status,201);
  assert.deepEqual((await f.api('/api/cards')).cards.map(c=>c.id),[next.card.id]);
});

test('revocable public card pages, JSON and covers are not retained in a shared cache',async t=>{
  const f=fixture(t),{work}=await f.publish({cover:true}),{card}=await save(f,work);
  const path='/api/public/cards/'+card.id,read=await publicRead(path);assert.equal(read.headers.get('cache-control'),'no-store');
  const dto=await read.json();assert.equal((await publicRead(dto.card.works[0].coverUrl)).headers.get('cache-control'),'no-store');
  const service=createPublicSharingService({db:()=>f.db,bucket:()=>f.bucket});
  assert.equal((await service.page(new Request('https://site.test/c/'+card.id),card.id)).headers.get('cache-control'),'no-store');
});

test('client deletion deduplicates clicks and requires a matching server receipt before success',async()=>{
  let resolve,calls=0;const gate=new Promise(r=>resolve=r),api=()=>{calls++;return gate;};
  const first=deleteCard('card-a',api),again=deleteCard('card-a',api);assert.strictEqual(first,again);assert(hasPendingCardDeletion());
  await Promise.resolve();assert.equal(calls,1);resolve({cardId:'card-a',deleted:true});await first;assert(!hasPendingCardDeletion());
  await assert.rejects(deleteCard('card-a',async()=>({cardId:'different-card',deleted:true})));assert(!hasPendingCardDeletion());
  assert.equal((await deleteCard('card-a',async()=>({cardId:'card-a',deleted:true}))).deleted,true);
});

test('sharing combines an invitation and URL and does not claim someone else’s card as mine',()=>{
  for(const locale of ['zh-CN','en']){
    setLocale(locale);const mine=cardShareText({name:'Maker'},true),other=cardShareText({name:'Maker'},false);
    assert.match(other,/Maker/);assert.notEqual(mine,other);assert.equal(shareMessage(mine,'https://site.test/c/a'),mine+'\nhttps://site.test/c/a');
    assert.equal(shareMessage('','https://site.test/work/a'),'https://site.test/work/a');
  }setLocale('zh-CN');
});
