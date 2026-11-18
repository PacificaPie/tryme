import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,OWNER,OTHER,html,handleAPI,gameResponse} from './helpers/router-fixture.mjs';
import {createPublicSharingService} from '../lib/funtrack/public-sharing.mjs';

const anonymous=(path,options={})=>new Request('https://site.test'+path,options);
const get=async path=>{const response=await handleAPI(anonymous(path));return {status:response.status,data:await response.json(),headers:response.headers};};
const save=(f,work,template='wall',extra={})=>f.api('/api/cards',{method:'POST',body:{name:'Creator',bio:'A saved profile',template,workIds:[work.id],workRefs:[{workId:work.id,versionId:work.versionId,metadataId:work.metadataId}],...extra}});
const publicPath=card=>'/api/public/cards/'+card.id;
const service=f=>createPublicSharingService({db:()=>({prepare(query){return {bind(...values){return {async first(){return f.database.prepare(query).get(...values)||null;}};}};}}),bucket:()=>({async get(key){const body=f.objects.get(key);return body?{body}:null;}}),origin:()=>'https://share.funtrack.test'});

test('anonymous reads project each saved template without exposing account, moderation, build or unpublished data',async t=>{
  const f=fixture(t),{work}=await f.publish({cover:true});
  const other=(await f.publish({owner:OTHER,bytes:html('unselected')})).work;
  const snapshots=[];
  for(const template of ['wall','fold','collection','editorial','filmstrip']){
    const saved=await save(f,work,template,{signature:'Keep making',headline:'Game maker',website:'https://example.test/about',backStyle:'cobalt'});assert.equal(saved.status,201);
    const path=publicPath(saved.card),result=await get(path);assert.equal(result.status,200);
    const card=result.data.card;
    assert.deepEqual(Object.keys(card).sort(),['id','template','name','bio','headline','signature','website','backStyle','createdAt','avatarUrl','works'].sort());
    assert.equal(card.template,template);assert.equal(card.name,'Creator');assert.equal(card.signature,'Keep making');
    assert.deepEqual(Object.keys(card.works[0]).sort(),['id','name','desc','authorName','authorAvatarUrl','source','version','versionId','coverUrl'].sort());
    assert.equal(card.works[0].versionId,work.versionId);assert.equal(card.works[0].coverUrl,path+'/works/'+work.id+'/cover');
    const raw=JSON.stringify(card);for(const forbidden of [OWNER,OTHER,'authorId','discovery','reviewNote','requestHash','revision','provenance','email'])assert(!raw.includes(forbidden),forbidden);
    assert.equal((await get(path+'/works/'+other.id+'/cover')).status,404);
    snapshots.push(f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(saved.card.id));
  }
  assert.equal(f.count('ft_play_sessions'),0);assert.equal(f.count('ft_events'),0);
  assert.deepEqual(f.database.prepare('SELECT snapshot_json FROM ft_cards ORDER BY rowid').all(),snapshots);
  assert.equal((await get('/api/public/cards/'+randomUUID())).status,404);
});

test('shared card and original cover remain fixed after edits, version updates and archive',async t=>{
  const f=fixture(t),{work}=await f.publish({cover:true}),{card}=await save(f,work,'editorial');
  const before=await get(publicPath(card)),coverURL=before.data.card.works[0].coverUrl;
  const originalCover=await (await handleAPI(anonymous(coverURL))).arrayBuffer();
  const form=new FormData();form.set('name','New live title');form.set('desc','New live description');form.set('expectedRevision','1');form.set('cover',new File([new Uint8Array([137,80,78,71,13,10,26,10,99,88,77])],'new.png',{type:'image/png'}));
  const edited=await f.api('/api/works/'+work.id,{method:'PATCH',body:form});assert.equal(edited.status,200);
  const v2=await f.version(work.id,{revision:edited.work.revision});assert.equal(v2.status,201);
  const current=(await f.get(work.id)).work;
  assert.equal((await f.api('/api/works/'+work.id+'/archive',{method:'POST',body:{action:'archive',expectedRevision:current.revision}})).status,200);
  const after=await get(publicPath(card));assert.deepEqual(after.data,before.data);
  const covered=await handleAPI(anonymous(coverURL));assert.equal(covered.status,200);assert.equal(covered.headers.get('content-type'),'image/png');assert.deepEqual(await covered.arrayBuffer(),originalCover);
  assert.deepEqual((await f.api('/api/cards/'+card.id)).card,card);
  assert.equal(f.count('ft_events'),0);assert.equal(f.count('ft_play_sessions'),0);
});

test('legacy version covers work, but a card cannot expose a cover belonging to an unrelated work',async t=>{
  const f=fixture(t),{work}=await f.publish({cover:true}),other=(await f.publish({owner:OTHER,bytes:html('other'),cover:true})).work;
  const {card}=await save(f,work),legacy=structuredClone(card);legacy.id=randomUUID();delete legacy.works[0].metadataId;legacy.works[0].coverUrl='/media/'+work.versionId;
  f.database.prepare('INSERT INTO ft_cards(id,author_id,snapshot_json,created_at) VALUES(?,?,?,?)').run(legacy.id,OWNER,JSON.stringify(legacy),card.createdAt);
  const read=await get(publicPath(legacy));assert.equal(read.status,200);assert.equal((await handleAPI(anonymous(read.data.card.works[0].coverUrl))).status,200);
  const malformed=structuredClone(legacy);malformed.id=randomUUID();malformed.works[0].metadataId=other.metadataId;malformed.works[0].coverUrl='/media/'+other.metadataId;
  f.database.prepare('INSERT INTO ft_cards(id,author_id,snapshot_json,created_at) VALUES(?,?,?,?)').run(malformed.id,OWNER,JSON.stringify(malformed),card.createdAt);
  const forbidden=await get(publicPath(malformed)+'/works/'+work.id+'/cover');assert.equal(forbidden.status,404);
  const external=structuredClone(legacy);external.id=randomUUID();external.works[0].coverUrl='https://evil.test/track.png';external.avatarUrl='https://evil.test/avatar.svg';external.website='javascript:alert(1)';external.email='private@example.test';external.works[0].url='https://unselected.test/game';
  f.database.prepare('INSERT INTO ft_cards(id,author_id,snapshot_json,created_at) VALUES(?,?,?,?)').run(external.id,OWNER,JSON.stringify(external),card.createdAt);
  const projected=(await get(publicPath(external))).data.card;assert.equal(projected.website,'');assert.equal(projected.avatarUrl,'');assert.equal(projected.works[0].coverUrl,'');assert(!JSON.stringify(projected).includes('private@example'));assert(!Object.hasOwn(projected.works[0],'url'));
});

test('public sharing opens no games, sessions, events, account data, lists or mutations',async t=>{
  const f=fixture(t),{work}=await f.publish({cover:true}),{card}=await save(f,work);
  for(const path of ['/api/me','/api/cards','/api/cards/me','/api/works?mine=1','/api/works/'+work.id,'/api/analytics','/api/media/'+work.metadataId,publicPath(card)+'/works/'+work.id+'/game',publicPath(card)+'/sessions',publicPath(card)+'/events']){
    assert.equal((await handleAPI(anonymous(path))).status,401,path);
  }
  for(const path of ['/api/events','/api/sessions',publicPath(card),publicPath(card)+'/events',publicPath(card)+'/sessions'])assert.equal((await handleAPI(anonymous(path,{method:'POST',headers:{Origin:'https://site.test','X-Funtrack-CSRF':'1','Content-Type':'application/json'},body:'{}'}))).status,401,path);
  assert.equal((await gameResponse(anonymous('/game/'+work.versionId),work.versionId)).status,401);
  assert.equal(f.count('ft_play_sessions'),0);assert.equal(f.count('ft_events'),0);
  const head=await handleAPI(anonymous(publicPath(card),{method:'HEAD'}));assert.equal(head.status,200);assert.equal(await head.text(),'');
  const coverHead=await handleAPI(anonymous(publicPath(card)+'/works/'+work.id+'/cover',{method:'HEAD'}));assert.equal(coverHead.status,200);assert.equal(await coverHead.text(),'');
});

test('share HTML serves escaped card-specific OG metadata and no-script content without authentication or telemetry',async t=>{
  const f=fixture(t),{work}=await f.publish({cover:true}),{card}=await save(f,work,'filmstrip',{name:'Rain <script>alert(1)</script>',bio:'A "quiet" game & room'}),sharing=service(f);
  const page=await sharing.page(anonymous('/c/'+card.id),card.id);assert.equal(page.status,200);const markup=await page.text();
  assert(markup.includes('<title>Rain &lt;script&gt;alert(1)&lt;/script&gt; · TryMe</title>'));
  assert(markup.includes('<link rel="canonical" href="https://share.funtrack.test/c/'+card.id+'">'));
  assert(markup.includes('property="og:image" content="https://share.funtrack.test/api/public/cards/'+card.id+'/works/'+work.id+'/cover"'));
  assert(markup.includes('A &quot;quiet&quot; game &amp; room'));assert(!markup.includes('<script>alert(1)</script>'));
  assert(markup.includes('<noscript><article>'));assert(markup.includes(work.name));assert(markup.includes('id="public-card-root"'));assert(markup.includes('data-theme-control'));assert(markup.includes('/public-card.js'));assert(!markup.includes('src="/site.js"'));
  assert.equal(page.headers.has('set-cookie'),false);assert.equal(f.count('ft_events'),0);assert.equal(f.count('ft_play_sessions'),0);
  const head=await sharing.page(anonymous('/c/'+card.id,{method:'HEAD'}),card.id);assert.equal(head.status,200);assert.equal(await head.text(),'');
  const absent=await sharing.page(anonymous('/c/'+randomUUID()),randomUUID());assert.equal(absent.status,404);assert((await absent.text()).includes('名片不存在'));
  const method=await sharing.page(anonymous('/c/'+card.id,{method:'POST'}),card.id);assert.equal(method.status,405);
});
