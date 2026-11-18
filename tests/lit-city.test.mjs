import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanCityCard,cityView,PAGE_SIZE} from '../public/lit-city/data.js';
import {fixture,handleAPI} from './helpers/router-fixture.mjs';
const origin='https://trymecard.test';
const payload={author:{name:'A <script>',headline:'Designer',bio:'A biography',website:'https://example.com',avatarUrl:'/avatars/moon.svg'},works:[{id:'one',name:'Work',cover:'/media/one'}]};

test('city media stays same origin and profile links reject credentials or active schemes',()=>{
  const card=cleanCityCard(payload,origin);assert.equal(card.author.name,'A <script>');assert.equal(card.works[0].cover,origin+'/media/one');assert.equal(card.author.website,'https://example.com/');
  for(const url of ['javascript:alert(1)','data:text/html,hello','https://private:password@example.com'])assert.equal(cleanCityCard({...payload,author:{...payload.author,website:url}},origin).author.website,'');
  for(const cover of ['https://outside.test/a.jpg','//outside.test/a.jpg','data:image/png;base64,anything'])assert.equal(cleanCityCard({...payload,works:[{...payload.works[0],cover}]},origin).works[0].cover,'');
  assert.equal(cleanCityCard({...payload,works:[...payload.works,...payload.works]},origin),null);assert.equal(cleanCityCard({works:[]},origin),null);
});
test('city pages preserve access to all thirty works and restore a selected work across reloads',()=>{
  for(const count of [0,1,3,6,9,10,30]){
    const works=Array.from({length:count},(_,i)=>({id:'work-'+i,name:'Work '+i}));assert(cleanCityCard({...payload,works},origin));
    const collected=[];for(let page=0;page<Math.ceil(count/PAGE_SIZE);page++)collected.push(...works.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE));assert.deepEqual(collected,works);
    const last=cityView({face:'back',page:999,focusWorkId:works.at(-1)?.id},works);assert.equal(last.page,Math.max(0,Math.ceil(count/PAGE_SIZE)-1));assert.equal(last.face,'back');
  }
  assert.equal(cleanCityCard({...payload,works:Array.from({length:31},(_,i)=>({id:String(i)}))},origin),null);
});
test('city is saved with immutable work snapshots and projected to anonymous public cards',async t=>{
  const f=fixture(t),{work}=await f.publish({cover:true});
  const saved=await f.api('/api/cards',{method:'POST',body:{name:'Creator',headline:'Game maker',template:'city',workIds:[work.id],backStyle:'ivory'}});
  assert.equal(saved.status,201);const response=await handleAPI(new Request('https://site.test/api/public/cards/'+saved.card.id)),publicCard=await response.json();assert.equal(response.status,200);assert.equal(publicCard.card.template,'city');assert.equal(publicCard.card.works[0].versionId,work.versionId);assert.equal(publicCard.card.works[0].url,undefined);
  await f.version(work.id);assert.equal((await f.api('/api/cards/'+saved.card.id)).card.works[0].versionId,work.versionId);
});
