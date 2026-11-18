import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,handleAPI,gameResponse,html} from './helpers/router-fixture.mjs';
import {createStandaloneHandler} from '../lib/funtrack/standalone-auth.mjs';

const env={APP_ORIGIN:'https://site.test',CLERK_PUBLISHABLE_KEY:'pk_live_'+Buffer.from('clerk.site.test$').toString('base64'),CLERK_SECRET_KEY:'sk_live_test_fixture'};
function guest(){
  let checks=0;
  const handler=createStandaloneHandler({
    fetch:request=>new URL(request.url).pathname.startsWith('/game/')?gameResponse(request,new URL(request.url).pathname.split('/')[2]):handleAPI(request),
    createClerkClient:()=>({authenticateRequest:async()=>{checks++;return {status:'signed-out',isAuthenticated:false,tokenType:'session_token',toAuth:()=>null};}}),
  });
  const request=(path,init={})=>handler(new Request(env.APP_ORIGIN+path,init),env);
  const read=async path=>{const response=await request(path);assert.equal(response.status,200,await response.clone().text());return response.json();};
  return {request,read,get checks(){return checks;}};
}

test('anonymous discovery uses real visibility, sorting/search/pagination and a minimal public DTO without writing analytics',async t=>{
  const f=fixture(t),g=guest();
  const a=(await f.publish({name:'Public rain',cover:true})).work;
  const b=(await f.publish({name:'Public garden',source:'url',url:'https://external.example/private-launch-url'})).work;
  const hidden=(await f.publish({name:'Hidden rain',bytes:html('hidden')})).work;await f.discovery(hidden.id,'hide');
  const archived=(await f.publish({name:'Archived rain',bytes:html('archived')})).work;f.database.prepare('UPDATE ft_works SET archived_at=? WHERE id=?').run(new Date().toISOString(),archived.id);
  const tables=['ft_profiles','ft_events','ft_feed_impressions','ft_play_sessions'];const before=tables.map(name=>f.count(name));
  for(const sort of ['recommended','newest','likes','comments']){
    const page=await g.read('/api/public/discover?limit=1&sort='+sort);
    assert.equal(page.total,2);assert.equal(page.works.length,1);assert(page.nextCursor);
    const second=await g.read('/api/public/discover?limit=1&sort='+sort+'&cursor='+encodeURIComponent(page.nextCursor));
    assert.equal(second.nextCursor,null);assert.deepEqual(new Set([...page.works,...second.works].map(w=>w.id)),new Set([a.id,b.id]));
  }
  const page=await g.read('/api/public/discover?q=rain&source=html');
  assert.deepEqual(page.works.map(w=>w.id),[a.id]);
  assert.deepEqual(Object.keys(page.works[0]).sort(),['id','name','desc','source','category','authorName','authorAvatarUrl','coverUrl','likesCount','commentsCount'].sort());
  assert.equal(page.works[0].coverUrl,`/api/public/works/${a.id}/cover`);
  assert(!JSON.stringify(await g.read('/api/public/discover')).includes('private-launch-url'));
  assert.deepEqual(tables.map(name=>f.count(name)),before);assert.equal(g.checks,0);
  const head=await g.request('/api/public/discover',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.match(head.headers.get('cache-control'),/no-store/);
  assert.equal((await f.api('/api/discover')).works.find(w=>w.id===a.id).versionId,a.versionId,'Authenticated discovery retains playable data');
});

test('public cover GET/HEAD follows current visibility and cannot disclose withdrawn, archived or arbitrary stored assets',async t=>{
  const f=fixture(t),g=guest(),work=(await f.publish({cover:true})).work,path=`/api/public/works/${work.id}/cover`;
  for(const method of ['GET','HEAD']){const response=await g.request(path,{method});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.match(response.headers.get('cache-control'),/no-store/);assert.equal((await response.arrayBuffer()).byteLength>0,method==='GET');}
  await f.discovery(work.id,'hide');assert.equal((await g.request(path)).status,404);
  await f.discovery(work.id,'restore');assert.equal((await g.request(path)).status,200);
  f.database.prepare('UPDATE ft_works SET archived_at=? WHERE id=?').run(new Date().toISOString(),work.id);assert.equal((await g.request(path)).status,404);
  assert.equal((await g.request('/api/public/works/'+work.versionId+'/cover')).status,404);
});

test('anonymous Feed cannot become a private query, game, publishing, session or identity endpoint, including with forged headers',async t=>{
  const f=fixture(t),g=guest(),work=(await f.publish({cover:true})).work;
  const publicPage=await g.read('/api/public/discover');assert.equal(publicPage.works.length,1);
  for(const query of ['mine=1','state=all','author=publication-owner','following=1'])assert.equal((await g.request('/api/public/discover?'+query)).status,422);
  for(const path of ['/api/me','/api/discover','/api/works','/api/works/'+work.id,'/game/'+work.versionId,'/media/'+work.versionId,'/api/cards/me','/api/analytics','/api/public/works/'+work.id+'/game','/api/public/discover/extra']){
    const response=await g.request(path,{headers:{'oai-authenticated-user-id':'publication-owner','oai-authenticated-user-email':'publication-owner@example.test','x-clerk-auth-user-id':'user_forged'}});
    assert.equal(response.status,401,path);
  }
  for(const path of ['/api/works','/api/cards','/api/sessions','/api/events','/api/feed/impressions','/api/public/discover','/api/public/works/'+work.id+'/cover']){
    for(const method of ['POST','PATCH','DELETE'])assert.equal((await g.request(path,{method,body:'{}'})).status,401,method+' '+path);
  }
  await f.publish({name:'Second work',bytes:html('second')});
  const privatePage=await f.api('/api/discover?limit=1&sort=newest');assert(privatePage.nextCursor);
  assert.equal((await g.request('/api/public/discover?limit=1&sort=newest&cursor='+encodeURIComponent(privatePage.nextCursor))).status,400);
  const fresh=await g.read('/api/public/discover?limit=1&sort=newest');
  assert.equal((await f.api('/api/discover?limit=1&sort=newest&cursor='+encodeURIComponent(fresh.nextCursor))).status,400);
});
