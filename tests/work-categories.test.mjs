import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,OTHER,html} from './helpers/router-fixture.mjs';

test('categories filter by content across URL and HTML with matching totals and pagination',async t=>{
  const f=fixture(t),urlGame=(await f.publish({source:'url',url:'https://example.com/game',category:'game'})).work;
  const htmlGame=(await f.publish({bytes:html('game'),category:'game'})).work;
  const website=(await f.publish({bytes:html('portfolio'),category:'website'})).work;
  const legacy=(await f.publish({source:'url',url:'https://example.com/unclassified'})).work;
  assert.equal(legacy.category,'other');
  const a=await f.api('/api/public/discover?category=game&sort=newest&limit=1',{owner:null});
  assert.equal(a.status,200);assert.equal(a.total,2);assert(a.nextCursor);assert.equal(a.works[0].category,'game');
  const b=await f.api('/api/public/discover?category=game&sort=newest&limit=1&cursor='+a.nextCursor,{owner:null});
  assert.deepEqual(new Set([...a.works,...b.works].map(w=>w.id)),new Set([urlGame.id,htmlGame.id]));assert.equal(b.nextCursor,null);
  assert.equal((await f.api('/api/public/discover?category=website&sort=newest&limit=1&cursor='+a.nextCursor,{owner:null})).error.code,'INVALID_CURSOR');
  const page=await f.api('/api/public/discover?category=website',{owner:null});assert.deepEqual(page.works.map(w=>w.id),[website.id]);
  const searched=await f.api('/api/public/discover?category=game&q=no-match',{owner:null});assert.equal(searched.total,0);
  assert.equal((await f.api('/api/public/discover?category=invalid',{owner:null})).error.code,'INVALID_CATEGORY');
});

test('category is validated and participates in publish idempotency without breaking legacy replay',async t=>{
  const f=fixture(t),key=randomUUID();
  assert.equal((await f.publish({key,category:'game'})).status,201);
  assert.equal((await f.publish({key,category:'game'})).status,200);
  assert.equal((await f.publish({key,category:'website'})).error.code,'IDEMPOTENCY_CONFLICT');
  assert.equal((await f.publish({bytes:html('new'),category:'html'})).error.code,'INVALID_CATEGORY');
  const oldKey=randomUUID();assert.equal((await f.publish({key:oldKey,bytes:html('legacy')})).status,201);
  assert.equal((await f.publish({key:oldKey,bytes:html('legacy')})).status,200);
});

test('only the owner can change category; stale changes conflict without altering visibility, versions or cards',async t=>{
  const f=fixture(t),{work}=await f.publish({category:'game'});
  await f.api('/api/cards',{method:'POST',body:{template:'fold',name:'Creator',workIds:[work.id]}});
  const tables=['ft_works','ft_work_versions','ft_work_metadata','ft_cards'];
  const before=tables.map(table=>f.database.prepare('SELECT * FROM '+table).all());
  const path='/api/works/'+work.id+'/discovery',body={action:'categorize',category:'website',expectedRevision:1};
  assert.equal((await f.api(path,{method:'PATCH',owner:OTHER,body})).status,403);
  const changed=await f.api(path,{method:'PATCH',body});assert.equal(changed.status,200);assert.equal(changed.work.category,'website');assert.equal(changed.work.discovery.visibility,'listed');
  assert.equal((await f.api(path,{method:'PATCH',body})).error.code,'DISCOVERY_CONFLICT');
  tables.forEach((table,i)=>assert.deepEqual(f.database.prepare('SELECT * FROM '+table).all(),before[i]));
  await f.discovery(work.id,'hide');await f.discovery(work.id,'categorize',{category:'game'});
  assert.equal((await f.get(work.id)).work.discovery.visibility,'unlisted');assert.equal((await f.api('/api/public/discover?category=game',{owner:null})).total,0);
  f.database.prepare('UPDATE ft_works SET archived_at=? WHERE id=?').run(new Date().toISOString(),work.id);
  assert.equal((await f.discovery(work.id,'categorize',{category:'other'})).error.code,'WORK_ARCHIVED');
});

test('migration does not infer categories from source; only prior declared games are carried forward',async t=>{
  const f=fixture(t,{through:16}),game=f.seed(),url=f.seed({source:'url',url:'https://example.com'});
  f.database.prepare("UPDATE ft_work_discovery SET kind='game' WHERE work_id=?").run(game.id);
  f.migrate();assert.equal((await f.get(game.id)).work.category,'game');assert.equal((await f.get(url.id)).work.category,'other');
});
