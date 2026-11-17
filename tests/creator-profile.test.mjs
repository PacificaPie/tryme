import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,OWNER,OTHER,REVIEWER,handleAPI} from './helpers/router-fixture.mjs';
import {AVATAR_MAX_BYTES,avatarImage,safeAvatarURL} from '../lib/funtrack/avatar-rules.mjs';

const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=','base64'));
const creator=(f,id,options)=>f.api('/api/creators/'+encodeURIComponent(id),options);
const follow=(f,id,following,options={})=>f.api('/api/creators/'+encodeURIComponent(id)+'/follow',{method:'POST',body:{following},...options});
const profile=(f,body,options={})=>f.api('/api/me/profile',{method:'POST',body,...options});
const upload=(f,{bytes=png,mime='image/png',...options}={})=>{const form=new FormData();form.set('avatar',new File([bytes],'avatar.png',{type:mime}));return f.api('/api/me/avatar',{method:'POST',body:form,...options});};
const save=(f,work,options={})=>f.api('/api/cards',{method:'POST',body:{name:'Creator',bio:'Games',template:'fold',workIds:[work.id]},...options});
const publicRead=(path,method='GET')=>handleAPI(new Request('https://site.test'+path,{method}));

test('creator identities work without a card, and deleted current cards never expose an earlier edition',async t=>{
  const f=fixture(t),self=await creator(f,OWNER);
  assert.equal(self.status,200);assert.equal(self.creator.name,OWNER);assert.equal(self.creator.worksCount,0);assert.equal(self.card,null);
  assert.equal((await creator(f,'unknown-person')).status,404);
  const {work}=await f.publish(),{card:old}=await save(f,work),{card}=await save(f,work);
  assert.equal((await creator(f,OWNER)).card.id,card.id);
  await f.api('/api/cards/'+card.id+'/delete',{method:'POST'});
  const current=await creator(f,OWNER);assert.equal(current.card,null);assert.equal(current.creator.worksCount,1);
  assert.equal((await f.api('/api/cards/'+old.id)).status,200);
  assert.equal((await creator(f,OWNER,{owner:OTHER})).creator.followedByMe,false);
});

test('follow desired state is idempotent, account-scoped and protected against forged or self targets',async t=>{
  const f=fixture(t);await f.publish({owner:OTHER});
  assert.deepEqual(await follow(f,OTHER,true),{status:200,creatorId:OTHER,following:true,followersCount:1});
  assert.equal((await follow(f,OTHER,true)).followersCount,1);assert.equal(f.count('ft_creator_follows'),1);
  assert.equal((await creator(f,OTHER)).creator.followedByMe,true);
  assert.equal((await creator(f,OTHER,{owner:REVIEWER})).creator.followedByMe,false);
  assert.equal((await creator(f,OWNER)).creator.followingCount,1);
  assert.equal((await follow(f,OWNER,true)).error.code,'SELF_FOLLOW');
  assert.equal((await follow(f,'missing-person',true)).status,404);
  assert.equal((await follow(f,OTHER,'yes')).status,422);
  assert.equal((await follow(f,OTHER,false,{extraHeaders:{Origin:'https://elsewhere.test'}})).status,403);
  assert.equal((await handleAPI(new Request('https://site.test/api/creators/'+OTHER+'/follow',{method:'POST'}))).status,401);
  assert.equal((await follow(f,OTHER,false)).followersCount,0);assert.equal((await follow(f,OTHER,false)).followersCount,0);
});

test('following Feed preserves filters, excludes hidden and archived works, and rejects another viewer or filter cursor',async t=>{
  const f=fixture(t);
  const {work:a}=await f.publish({owner:OTHER,name:'Rain One'}),{work:b}=await f.publish({owner:OTHER,name:'Rain Two',bytes:'<html><body>two</body></html>'});
  const {work:hidden}=await f.publish({owner:OTHER,name:'Rain Hidden',bytes:'<html><body>hidden</body></html>'});
  const {work:archived}=await f.publish({owner:OTHER,name:'Rain Archive',bytes:'<html><body>archived</body></html>'});
  await f.publish({owner:REVIEWER,name:'Rain Stranger'});
  f.database.prepare("UPDATE ft_work_discovery SET visibility='unlisted' WHERE work_id=?").run(hidden.id);
  f.database.prepare('UPDATE ft_works SET archived_at=? WHERE id=?').run(new Date().toISOString(),archived.id);
  await follow(f,OTHER,true);
  const query='/api/discover?following=1&source=html&q=Rain&sort=newest&limit=1',first=await f.api(query);
  assert.equal(first.status,200);assert.equal(first.total,2);assert(first.nextCursor);
  const second=await f.api(query+'&cursor='+first.nextCursor);
  assert.deepEqual(new Set([...first.works,...second.works].map(w=>w.id)),new Set([a.id,b.id]));
  assert.equal((await f.api(query+'&cursor='+first.nextCursor,{owner:REVIEWER})).status,400);
  assert.equal((await f.api(query.replace('following=1','following=0')+'&cursor='+first.nextCursor)).status,400);
  const ordinary=await f.api('/api/discover?sort=newest&limit=1');assert(ordinary.nextCursor);
  assert.equal((await f.api('/api/discover?following=1&sort=newest&limit=1&cursor='+ordinary.nextCursor)).status,400);
  assert.equal((await f.api('/api/discover?following=wat')).status,422);
  await follow(f,OTHER,false);assert.equal((await f.api(query)).total,0);
});

test('creator directory paginates stable identities and following membership independently of cards',async t=>{
  const f=fixture(t);await f.publish({owner:OTHER});await profile(f,{name:'Reviewer'},{owner:REVIEWER});
  await follow(f,OTHER,true);await follow(f,REVIEWER,true);
  const first=await f.api('/api/creators?following=1&limit=1');assert.equal(first.creators.length,1);assert(first.nextAfter);
  const second=await f.api('/api/creators?following=1&limit=1&after='+encodeURIComponent(first.nextAfter));
  assert.deepEqual(new Set([...first.creators,...second.creators].map(c=>c.id)),new Set([OTHER,REVIEWER]));
  assert(first.creators.every(c=>c.followedByMe));assert.equal(second.nextAfter,null);
  assert.equal((await f.api('/api/creators?following=1',{owner:REVIEWER})).creators.length,0);
  assert.equal((await f.api('/api/creators?limit=1000')).status,422);
});

test('a person followed from a discussion appears in following even without a card, work or edited profile',async t=>{
  const f=fixture(t),{work}=await f.publish();
  await f.api('/api/works/'+work.id+'/comments',{method:'POST',body:{body:'Hello'},owner:OTHER});
  assert.equal((await creator(f,OTHER)).creator.name,OTHER);
  await follow(f,OTHER,true);
  const directory=await f.api('/api/creators?following=1');
  assert.deepEqual(directory.creators.map(c=>c.id),[OTHER]);assert.equal(directory.creators[0].worksCount,0);
  assert.equal((await creator(f,OWNER,{owner:REVIEWER})).status,200);
});

test('profile edits update live identity while avatar presets, comments and card snapshots preserve their intended scopes',async t=>{
  const f=fixture(t),{work}=await f.publish();
  const before=await profile(f,{name:'New name',bio:'Play slowly',headline:'Maker',website:'https://example.com',avatarPreset:'sprout'});
  assert.equal(before.status,200);assert.equal(before.user.avatarUrl,'/avatars/sprout.svg');
  const {card}=await save(f,work),saved=f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json;
  assert.equal(card.avatarUrl,'/avatars/sprout.svg');
  const comment=await f.api('/api/works/'+work.id+'/comments',{method:'POST',body:{body:'Hello'}});assert.equal(comment.status,201);
  await profile(f,{name:'Renamed',avatarPreset:'moon'});
  const feed=await f.api('/api/discover');assert.equal(feed.works[0].authorAvatarUrl,'/avatars/moon.svg');assert.equal(feed.works[0].authorName,'Renamed');
  const comments=await f.api('/api/works/'+work.id+'/comments');assert.equal(comments.comments[0].authorAvatarUrl,'/avatars/moon.svg');assert.equal(comments.comments[0].authorName,'Renamed');
  const versions=await f.api('/api/works/'+work.id+'/versions');assert.equal(versions.work.authorAvatarUrl,'/avatars/moon.svg');assert.equal(versions.work.authorName,'Renamed');
  assert.equal(f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json,saved);
  assert.equal((await (await publicRead('/api/public/cards/'+card.id)).json()).card.avatarUrl,'/avatars/sprout.svg');
  const changed=await profile(f,{bio:'Updated',avatarUrl:'https://attacker.test/avatar.svg'});assert.equal(changed.user.avatarUrl,'/avatars/moon.svg');
  assert.equal((await profile(f,{avatarPreset:'unsupported'})).status,422);
  assert.equal((await profile(f,{avatarPreset:null})).user.avatarUrl,'');
  assert.equal((await profile(f,{website:'javascript:alert(1)'})).status,422);
  assert.equal((await profile(f,{name:'Other'},{extraHeaders:{Origin:'https://elsewhere.test'}})).status,403);
});

test('uploaded avatars are validated immutable public images, and changing avatar does not break saved cards',async t=>{
  const f=fixture(t),{work}=await f.publish(),first=await upload(f);assert.equal(first.status,200,JSON.stringify(first));
  const url=first.user.avatarUrl;assert.match(url,/^\/api\/public\/avatars\/[a-f0-9-]+$/);
  const response=await publicRead(url);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
  assert.match(response.headers.get('cache-control'),/immutable/);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),png);
  assert.equal((await publicRead(url,'HEAD')).status,200);
  const {card}=await save(f,work);assert.equal(card.avatarUrl,url);
  await profile(f,{avatarPreset:'sun'});assert.equal((await publicRead(url)).status,200);
  assert.equal((await (await publicRead('/api/public/cards/'+card.id)).json()).card.avatarUrl,url);
  const second=await upload(f,{owner:OTHER});assert.notEqual(second.user.avatarUrl,url);
  assert.equal((await f.api('/api/me')).user.avatarUrl,'/avatars/sun.svg');
  assert.equal((await publicRead('/api/public/avatars/'+randomUUID())).status,404);
  for(const attempt of [{bytes:new Uint8Array([1,2,3])},{mime:'image/jpeg'},{bytes:png.slice(0,36)},{bytes:new Uint8Array(AVATAR_MAX_BYTES+1)}])assert.notEqual((await upload(f,attempt)).status,200);
  assert.equal((await upload(f,{extraHeaders:{Origin:'https://elsewhere.test'}})).status,403);
  assert.equal(f.count('ft_profile_avatars'),2);
  assert.equal(safeAvatarURL('https://attacker.test/a.png'),'');assert.equal(safeAvatarURL('/api/public/avatars/../../secret'),'');
});

test('saving an old card preview preserves the live profile and keeps its own requested snapshot identity',async t=>{
  const f=fixture(t),{work}=await f.publish();
  const current=await profile(f,{name:'Current name',bio:'Current bio',headline:'Current role',website:'https://current.example/',avatarPreset:'wave'});
  const {card}=await f.api('/api/cards',{method:'POST',body:{name:'Old preview name',bio:'Old preview bio',headline:'Old role',website:'https://old.example/',template:'fold',workIds:[work.id]}});
  assert.equal(card.name,'Old preview name');assert.equal(card.bio,'Old preview bio');assert.equal(card.avatarUrl,'/avatars/wave.svg');
  assert.deepEqual((await f.api('/api/me')).user,current.user);
  assert.equal((await creator(f,OWNER)).creator.name,'Current name');
  assert.equal((await f.api('/api/discover?q=Current%20name')).total,1);
});

test('saved cards pin their approved avatar across live changes and bind explicit avatar to idempotency',async t=>{
  const f=fixture(t),{work}=await f.publish(),owned=await upload(f);
  const body={name:'Pinned',bio:'',template:'fold',workIds:[work.id],avatarUrl:owned.user.avatarUrl},key=randomUUID();
  await profile(f,{avatarPreset:'moon'});
  const saved=await f.api('/api/cards',{method:'POST',body,key});assert.equal(saved.status,201);assert.equal(saved.card.avatarUrl,owned.user.avatarUrl);
  await profile(f,{avatarPreset:'sprout'});
  const replay=await f.api('/api/cards',{method:'POST',body,key});assert.equal(replay.status,200);assert.deepEqual(replay.card,saved.card);
  assert.equal((await f.api('/api/cards',{method:'POST',body:{...body,avatarUrl:'/avatars/moon.svg'},key})).error.code,'IDEMPOTENCY_CONFLICT');
  assert.equal((await f.api('/api/cards',{method:'POST',body:{...body,avatarUrl:''}})).card.avatarUrl,'');
  assert.equal((await f.api('/api/cards',{method:'POST',body:{...body,avatarUrl:'/avatars/sun.svg'}})).card.avatarUrl,'/avatars/sun.svg');
  const legacyKey=randomUUID(),legacyBody={...body};delete legacyBody.avatarUrl;
  const legacy=await f.api('/api/cards',{method:'POST',body:legacyBody,key:legacyKey});assert.equal(legacy.card.avatarUrl,'/avatars/sprout.svg');
  await profile(f,{avatarPreset:'wave'});
  assert.deepEqual((await f.api('/api/cards',{method:'POST',body:legacyBody,key:legacyKey})).card,legacy.card);
});

test('card avatar inputs reject another account upload, nonexistent assets and unsafe URLs',async t=>{
  const f=fixture(t),{work}=await f.publish(),foreign=await upload(f,{owner:OTHER});
  const body={name:'Card',bio:'',template:'fold',workIds:[work.id]};
  for(const avatarUrl of [foreign.user.avatarUrl,'/api/public/avatars/'+randomUUID(),'https://other.test/avatar.png','/avatars/unknown.svg',null,123]){
    const response=await f.api('/api/cards',{method:'POST',body:{...body,avatarUrl}});
    assert.equal(response.status,422);assert.equal(response.error.code,'INVALID_CARD_AVATAR');
  }
  assert.equal(f.count('ft_cards'),0);
});

test('a partial profile save cannot overwrite text committed after it read the profile',async t=>{
  const f=fixture(t);await profile(f,{name:'Before',bio:'Before bio'});
  const prepare=f.db.prepare.bind(f.db);let release,started;
  const readStarted=new Promise(resolve=>started=resolve),hold=new Promise(resolve=>release=resolve);let held=false;
  f.db.prepare=query=>{const statement=prepare(query),first=statement.first.bind(statement);statement.first=async()=>{const result=await first();if(query==='SELECT * FROM ft_profiles WHERE id=?'&&!held){held=true;started();await hold;}return result;};return statement;};
  const delayed=profile(f,{avatarPreset:'sun'});await readStarted;
  await profile(f,{name:'Concurrent',bio:'Concurrent bio'});release();await delayed;
  const result=await f.api('/api/me');assert.equal(result.user.name,'Concurrent');assert.equal(result.user.bio,'Concurrent bio');assert.equal(result.user.avatarUrl,'/avatars/sun.svg');
});

test('an avatar upload whose commit acknowledgement is lost retains its referenced file',async t=>{
  const f=fixture(t);f.faults.afterCommit=true;
  const result=await upload(f);assert.equal(result.status,200);assert.equal((await publicRead(result.user.avatarUrl)).status,200);
  assert.equal(f.count('ft_profile_avatars'),1);assert.equal(f.deleted.length,0);
});

test('avatar dimension validation rejects oversized decoded images before storage',()=>{
  assert.deepEqual(avatarImage(png,'image/png'),{mime:'image/png',width:1,height:1});
  const huge=png.slice();new DataView(huge.buffer).setUint32(16,5000);
  assert.throws(()=>avatarImage(huge,'image/png'),e=>e.code==='AVATAR_DIMENSIONS');
});

test('profile migration is additive and preserves existing cards, author fields and artwork bytes',async t=>{
  const f=fixture(t,{through:12}),{work}=await f.publish(),{card}=await save(f,work);
  const before=f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json;
  const stored=[...f.objects.entries()].map(([key,bytes])=>[key,Buffer.from(bytes).toString('hex')]);
  f.migrate();assert.equal(f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json,before);
  assert.deepEqual([...f.objects.entries()].map(([key,bytes])=>[key,Buffer.from(bytes).toString('hex')]),stored);
  assert.equal((await f.api('/api/me')).user.avatarUrl,'');assert.equal(f.count('ft_creator_follows'),0);assert.equal(f.count('ft_profile_avatars'),0);
});
