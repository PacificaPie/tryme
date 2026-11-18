import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,OWNER,OTHER,handleAPI} from './helpers/router-fixture.mjs';
import {createPublicSharingService} from '../lib/funtrack/public-sharing.mjs';

const edit=(f,body,owner=OWNER)=>f.api('/api/me/profile',{method:'POST',body,owner});
const identity=card=>Object.fromEntries(['name','bio','headline','website','avatarUrl'].map(key=>[key,card[key]]));
const content=card=>({id:card.id,template:card.template,signature:card.signature,backStyle:card.backStyle,workIds:card.workIds,createdAt:card.createdAt,works:card.works.map(({authorName,authorAvatarUrl,...work})=>work)});
const publicRead=async id=>(await handleAPI(new Request('https://site.test/api/public/cards/'+id))).json();
const sharing=f=>createPublicSharingService({db:()=>f.db,bucket:()=>f.bucket,origin:()=>'https://share.funtrack.test'});

test('all saved-card reads and idempotent replies resolve current profile identity while keeping selected content fixed',async t=>{
  const f=fixture(t),{work}=await f.publish({cover:true});
  await edit(f,{name:'Before',bio:'Before bio',headline:'Before role',website:'https://before.example/',avatarPreset:'sun'});
  const body={name:'Old snapshot',bio:'Old snapshot bio',headline:'Old snapshot role',website:'https://snapshot.example/',avatarUrl:'/avatars/sun.svg',signature:'Per-card signature',backStyle:'cobalt',template:'filmstrip',workIds:[work.id],workRefs:[{workId:work.id,versionId:work.versionId,metadataId:work.metadataId}]},key=randomUUID();
  const created=await f.api('/api/cards',{method:'POST',body,key});assert.equal(created.status,201);
  const id=created.card.id,stored=f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(id).snapshot_json;
  const publicBefore=(await publicRead(id)).card;
  const next={name:'Current <name>',bio:'Current "bio" & details',headline:'Current role',website:'https://current.example/',avatarPreset:'moon'};
  await edit(f,next);await edit(f,{name:'Different person',bio:'Not this card',avatarPreset:'wave'},OTHER);
  await f.version(work.id,{bytes:'<html><body>New game version</body></html>'});
  const expected={name:next.name,bio:next.bio,headline:next.headline,website:next.website,avatarUrl:'/avatars/moon.svg'};
  const reads=[
    (await f.api('/api/cards/me')).card,
    (await f.api('/api/cards/'+id)).card,
    (await f.api('/api/cards/'+id,{owner:OTHER})).card,
    (await f.api('/api/cards')).cards.find(card=>card.id===id),
    (await f.api('/api/creators/'+encodeURIComponent(OWNER))).card,
    (await f.api('/api/cards',{method:'POST',body,key})).card,
  ];
  for(const card of reads){
    assert.deepEqual(identity(card),expected);assert.deepEqual(content(card),content(created.card));
    assert.equal(card.works[0].authorName,next.name);assert.equal(card.works[0].authorAvatarUrl,'/avatars/moon.svg');
  }
  const publicAfter=(await publicRead(id)).card;assert.deepEqual(identity(publicAfter),expected);
  assert.equal(publicAfter.works[0].authorName,next.name);assert.equal(publicAfter.works[0].authorAvatarUrl,'/avatars/moon.svg');
  assert.deepEqual(content(publicAfter),content(publicBefore));
  const raw=JSON.stringify(publicAfter);
  for(const forbidden of [OWNER,OTHER,'authorId','owner_id','avatar_url','object_key','email','followingCount','request_hash'])assert(!raw.includes(forbidden),forbidden);
  assert.equal(f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(id).snapshot_json,stored);
  const page=await sharing(f).page(new Request('https://site.test/c/'+id),id),html=await page.text();
  assert.equal(page.headers.get('cache-control'),'no-store');
  assert(html.includes('<title>Current &lt;name&gt; · Funtrack</title>'));
  assert(html.includes('property="og:description" content="Current &quot;bio&quot; &amp; details"'));
  assert(html.includes('<noscript><article><h1>Current &lt;name&gt;</h1>'));
  assert(!html.includes('Old snapshot'));assert(!html.includes('Different person'));
  assert.equal(f.count('ft_cards'),1);
});

test('cleared current profile fields stay cleared and legacy snapshots are used only if the profile row is absent',async t=>{
  const f=fixture(t),{work}=await f.publish();
  const body={name:'Legacy name',bio:'Legacy bio',headline:'Legacy headline',website:'https://legacy.example/',signature:'Keep signature',backStyle:'ivory',template:'wall',workIds:[work.id]};
  const {card}=await f.api('/api/cards',{method:'POST',body});
  await edit(f,{name:'Current name',bio:'',headline:'',website:'',avatarPreset:null});
  // Empty values are authoritative, not a request to recover old card text.
  f.database.prepare("UPDATE ft_profiles SET name='' WHERE id=?").run(OWNER);
  for(const projected of [(await f.api('/api/cards/me')).card,(await f.api('/api/creators/'+OWNER)).card,(await publicRead(card.id)).card]){
    assert.deepEqual(identity(projected),{name:'',bio:'',headline:'',website:'',avatarUrl:''});
    assert.equal(projected.signature,'Keep signature');assert.equal(projected.backStyle,'ivory');assert.equal(projected.works[0].authorName,'');
  }
  const emptyHTML=await (await sharing(f).page(new Request('https://site.test/c/'+card.id),card.id)).text();
  assert(!emptyHTML.includes('Legacy name'));assert(!emptyHTML.includes('Legacy bio'));assert(!emptyHTML.includes('Legacy headline'));
  f.database.prepare('DELETE FROM ft_profiles WHERE id=?').run(OWNER);
  const fallback=(await f.api('/api/cards/me')).card;
  assert.equal(fallback.name,'Legacy name');assert.equal(fallback.bio,'Legacy bio');assert.equal(fallback.headline,'Legacy headline');assert.equal(fallback.website,'https://legacy.example/');
  assert.equal((await publicRead(card.id)).card.name,'Legacy name');
});

test('profile projection trusts the persisted card owner instead of identity fields injected into snapshot JSON',async t=>{
  const f=fixture(t),{work}=await f.publish();await edit(f,{name:'Real owner',avatarPreset:'sprout'});await edit(f,{name:'Other owner',avatarPreset:'wave'},OTHER);
  const {card}=await f.api('/api/cards',{method:'POST',body:{name:'Snapshot',template:'fold',workIds:[work.id]}});
  const row=f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id),snapshot=JSON.parse(row.snapshot_json);
  snapshot.authorId=OTHER;snapshot.id=randomUUID();snapshot.email='not-public@example.test';
  f.database.prepare('UPDATE ft_cards SET snapshot_json=? WHERE id=?').run(JSON.stringify(snapshot),card.id);
  const privateCard=(await f.api('/api/cards/'+card.id)).card,publicCard=(await publicRead(card.id)).card;
  assert.equal(privateCard.id,card.id);assert.equal(privateCard.authorId,OWNER);assert.equal(privateCard.name,'Real owner');
  assert.equal(publicCard.id,card.id);assert.equal(publicCard.name,'Real owner');assert.equal(publicCard.avatarUrl,'/avatars/sprout.svg');
  assert(!JSON.stringify(publicCard).includes('not-public'));assert(!Object.hasOwn(publicCard,'authorId'));
});
