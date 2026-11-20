import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,OWNER,OTHER,handleAPI} from './helpers/router-fixture.mjs';

const publicGet=async path=>{const response=await handleAPI(new Request('https://site.test'+path));return {status:response.status,...await response.json()};};
const path='/api/public/discover?type=all&sort=recommended';
const key=item=>item.type+':'+item.id;
async function save(f,work,owner=OWNER,extra={}){
  const result=await f.api('/api/cards',{method:'POST',owner,body:{name:'Creator '+owner,bio:'Selected portfolio',template:'editorial',workIds:[work.id],...extra}});
  assert.equal(result.status,201,JSON.stringify(result));return result.card;
}
async function choose(f,card,listed=true,owner=OWNER,revision){
  if(revision===undefined)revision=(await f.api('/api/cards/'+card.id+'/discovery',{owner})).discovery.revision;
  return f.api('/api/cards/'+card.id+'/discovery',{method:'PATCH',owner,body:{listed,expectedRevision:revision}});
}
async function seed(f,count=12){
  const cards=[],works=[];
  for(let i=0;i<count;i++){
    const owner='creator-'+i,{work}=await f.publish({owner,name:'Public work '+i,bytes:'<!doctype html><body>Unique game '+i+'</body>',cover:true});
    assert(work);works.push(work);const card=await save(f,work,owner);cards.push(card);assert.equal((await choose(f,card,true,owner)).status,200);
  }
  return {cards,works};
}
async function walk(url,first=null){
  let page=first||await publicGet(url),all=[],pages=0;
  while(true){assert.equal(page.status,200,JSON.stringify(page));all.push(...page.items);assert(++pages<100);if(!page.nextCursor)return all;page=await publicGet(url+'&cursor='+page.nextCursor);}
}

test('cards require explicit owner consent, use one selection per creator, and never fall back after withdrawal/deletion',async t=>{
  const f=fixture(t),{work}=await f.publish({cover:true}),first=await save(f,work),second=await save(f,work);
  assert.deepEqual((await publicGet(path)).items.map(x=>x.type),['work']);
  assert.equal((await choose(f,first,true,OTHER,0)).status,404);
  const anonymous=await handleAPI(new Request('https://site.test/api/cards/'+first.id+'/discovery',{method:'PATCH',body:'{}'}));assert.equal(anonymous.status,401);
  const listed=await choose(f,first);assert.equal(listed.status,200);assert.equal(listed.discovery.eligible,true);
  assert.equal((await choose(f,second,true,OWNER,0)).status,409,'stale selection must not replace a newer choice');
  assert.equal((await choose(f,second)).status,200);
  assert.deepEqual((await publicGet(path)).items.filter(x=>x.type==='card').map(x=>x.id),[second.id]);
  assert.equal((await choose(f,second,false)).status,200);
  assert.equal((await publicGet(path)).items.filter(x=>x.type==='card').length,0);
  await choose(f,second);await f.api('/api/cards/'+second.id+'/delete',{method:'POST'});
  assert.equal((await publicGet(path)).items.filter(x=>x.type==='card').length,0);
  assert.equal((await f.api('/api/cards/'+second.id+'/discovery')).status,404);
  assert.equal((await publicGet('/api/public/cards/'+first.id)).status,200,'original share link remains independent');
});

test('Feed card metadata and covers are fail-closed for hidden, archived, missing, foreign and unselected works',async t=>{
  const f=fixture(t),{work}=await f.publish({cover:true}),card=await save(f,work);await choose(f,card);
  const item=(await publicGet(path)).items.find(x=>x.type==='card'),cover=item.works[0].coverUrl;
  assert.equal((await handleAPI(new Request('https://site.test'+cover))).status,200);
  const head=await handleAPI(new Request('https://site.test'+cover,{method:'HEAD'}));assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('cache-control'),'no-store');
  await f.discovery(work.id,'hide');assert.deepEqual((await publicGet(path)).items,[]);assert.equal((await handleAPI(new Request('https://site.test'+cover))).status,404);
  await f.discovery(work.id,'restore');assert.equal((await publicGet(path)).items.length,2);
  await f.api('/api/works/'+work.id+'/archive',{method:'POST',body:{action:'archive',expectedRevision:work.revision}});
  assert.deepEqual((await publicGet(path)).items,[]);assert.equal((await handleAPI(new Request('https://site.test'+cover))).status,404);
  const current=(await f.get(work.id)).work;await f.api('/api/works/'+work.id+'/archive',{method:'POST',body:{action:'restore',expectedRevision:current.revision}});
  await f.discovery(work.id,'restore');
  const {work:foreign}=await f.publish({owner:OTHER,bytes:'<html>Foreign</html>',cover:true});
  assert.equal((await handleAPI(new Request('https://site.test'+cover.replace(work.id,foreign.id)))).status,404);
  const stored=f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json;
  for(const id of [foreign.id,randomUUID()]){
    const bad=JSON.parse(stored);bad.works.push({...bad.works[0],id});f.database.prepare('UPDATE ft_cards SET snapshot_json=? WHERE id=?').run(JSON.stringify(bad),card.id);
    assert.equal((await publicGet(path)).items.filter(x=>x.type==='card').length,0);assert.equal((await handleAPI(new Request('https://site.test'+cover))).status,404);
  }
  f.database.prepare('UPDATE ft_cards SET snapshot_json=? WHERE id=?').run(stored,card.id);
  await choose(f,card,false);assert.equal((await handleAPI(new Request('https://site.test'+cover))).status,404);
  assert.equal((await publicGet('/api/public/discover?type=cards&author='+OWNER)).status,422);
});

test('Feed projection keeps saved work names, versions and cover bytes, but resolves the current profile',async t=>{
  const f=fixture(t),{work}=await f.publish({cover:true}),card=await save(f,work);await choose(f,card);
  const before=(await publicGet(path)).items.find(x=>x.type==='card');
  const beforeCover=await (await handleAPI(new Request('https://site.test'+before.works[0].coverUrl))).arrayBuffer();
  await f.api('/api/me/profile',{method:'POST',body:{name:'Live identity',bio:'Current bio',headline:'Current role',avatarPreset:'moon'}});
  await f.version(work.id,{cover:true});
  const after=(await publicGet(path)).items.find(x=>x.type==='card');
  assert.equal(after.name,'Live identity');assert.equal(after.bio,'Current bio');assert.equal(after.headline,'Current role');assert.deepEqual(after.works,before.works);
  assert.deepEqual(await (await handleAPI(new Request('https://site.test'+after.works[0].coverUrl))).arrayBuffer(),beforeCover);
  const raw=JSON.stringify(await publicGet(path));
  for(const forbidden of [OWNER,'authorId','metadataId','versionId','game_key','request_hash','email','likedByMe','provenance','discovery','/media/'])assert(!raw.includes(forbidden),forbidden);
  const stored=JSON.parse(f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json);assert.equal(stored.works[0].versionId,work.versionId);
});

test('two keyset streams preserve exact order across every page size, ties and filter scope; legacy discover remains works-only',async t=>{
  const f=fixture(t);await seed(f,13);
  f.database.prepare("UPDATE ft_works SET created_at='2026-01-01T00:00:00.000Z'").run();
  for(const sort of ['recommended','newest']){
    const url='/api/public/discover?type=all&sort='+sort,expected=await walk(url+'&limit=48');
    assert.deepEqual(expected.slice(0,12).map(x=>x.type),['work','work','work','card','work','work','work','card','work','work','work','card']);
    assert.equal(new Set(expected.map(key)).size,26);
    for(const limit of [1,2,3,4,5,12])assert.deepEqual((await walk(url+'&limit='+limit)).map(key),expected.map(key),'limit '+limit);
    const first=await publicGet(url+'&limit=2');
    for(const changed of ['type=cards&sort='+sort,'type=all&sort='+sort+'&q=different','type=all&sort='+(sort==='newest'?'recommended':'newest')])assert.equal((await publicGet('/api/public/discover?'+changed+'&cursor='+first.nextCursor)).status,400);
    assert.equal((await f.api('/api/discover?type=all&sort='+sort+'&cursor='+first.nextCursor)).status,400);
  }
  assert.equal((await publicGet('/api/public/discover?type=cards&limit=48')).items.length,13);
  assert.equal((await publicGet('/api/public/discover')).works.length,12);assert(!Object.hasOwn(await publicGet('/api/public/discover'),'items'));
  for(const suffix of ['type=oops','type=all&sort=likes','type=cards&category=game','type=all&source=html','type=cards&following=1'])assert.equal((await publicGet('/api/public/discover?'+suffix)).status,422,suffix);
});

test('mid-traversal insertions, replaced selections and visibility changes cannot duplicate or skip unaffected rows',async t=>{
  const f=fixture(t),{cards,works}=await seed(f,10),url=path+'&limit=4',first=await publicGet(url),baseline=await walk(url,first);
  const hidden=works.find(work=>!first.items.some(item=>item.type==='work'&&item.id===work.id));
  await f.api('/api/works/'+hidden.id+'/discovery',{method:'PATCH',owner:hidden.authorId,body:{action:'hide',expectedRevision:hidden.discovery.revision}});
  const cardToReplace=cards.find(card=>!first.items.some(item=>item.type==='card'&&item.id===card.id)&&card.workIds[0]!==hidden.id);
  const replacement=await save(f,works.find(w=>w.id===cardToReplace.workIds[0]),cardToReplace.authorId);await choose(f,replacement,true,cardToReplace.authorId);
  const {work:newWork}=await f.publish({name:'Inserted later',bytes:'<html>New</html>'});const newCard=await save(f,newWork);await choose(f,newCard);
  // Backdate the new row to exercise the database high-water mark as well as asOf.
  f.database.prepare("UPDATE ft_works SET created_at='2026-01-01T00:00:00.000Z' WHERE id=?").run(newWork.id);
  const after=await walk(url,first),removedCards=cards.filter(c=>c.workIds.includes(hidden.id)||c.id===cardToReplace.id).map(c=>c.id);
  const expected=baseline.filter(item=>first.items.some(x=>key(x)===key(item))||!(item.type==='work'?item.id===hidden.id:removedCards.includes(item.id)));
  assert.deepEqual(new Set(after.map(key)),new Set(expected.map(key)));assert.equal(new Set(after.map(key)).size,after.length);
  assert(!after.some(x=>[replacement.id,newWork.id,newCard.id].includes(x.id)));
});

test('card search uses live identity and authenticated following applies equally to both types',async t=>{
  const f=fixture(t),{cards,works}=await seed(f,3),target=works[1].authorId;
  await f.api('/api/me/profile',{method:'POST',owner:target,body:{name:'Unique current profile',bio:'New identity text'}});
  assert.deepEqual((await publicGet('/api/public/discover?type=cards&q=Unique')).items.map(x=>x.id),[cards[1].id]);
  const follow=await f.api('/api/creators/'+target+'/follow',{method:'POST',body:{following:true}});assert.equal(follow.status,200,JSON.stringify(follow));
  const response=await f.api('/api/discover?type=all&following=1&sort=newest');assert.equal(response.status,200);assert.deepEqual(new Set(response.items.map(x=>x.id)),new Set([works[1].id,cards[1].id]));
  const responseHead=await handleAPI(new Request('https://site.test'+path,{method:'HEAD'}));assert.equal(responseHead.status,200);assert.equal(await responseHead.text(),'');
});

test('0023 upgrades existing data without opting in old cards or changing old migration history',async t=>{
  const f=fixture(t,{through:22}),{work}=await f.publish(),card=await save(f,work);
  const stored=f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json;
  f.migrate();assert.equal(f.count('ft_card_feed_selections'),0);
  assert.equal(f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json,stored);
  assert.deepEqual((await publicGet(path)).items.map(x=>x.type),['work']);
  assert.deepEqual((await f.api('/api/cards/'+card.id+'/discovery')).discovery,{listed:false,eligible:false,revision:0});
});

test('card selection writes retain CSRF and expected-account guards; malformed mixed cursors fail closed',async t=>{
  const f=fixture(t),{work}=await f.publish(),card=await save(f,work),endpoint='/api/cards/'+card.id+'/discovery';
  for(const extraHeaders of [{'X-Funtrack-CSRF':''},{Origin:'https://other.test'},{'X-Funtrack-Expected-User':OTHER}]){
    const result=await f.api(endpoint,{method:'PATCH',body:{listed:true,expectedRevision:0},extraHeaders});assert([403,409].includes(result.status),JSON.stringify(result));
  }
  assert.equal(f.count('ft_card_feed_selections'),0);
  for(const value of ['broken','A'.repeat(8193),Buffer.from(JSON.stringify({v:2,scope:'guest',filters:{type:'all',q:'',sort:'recommended',following:false}})).toString('base64url')])assert.equal((await publicGet(path+'&cursor='+value)).status,400);
});
