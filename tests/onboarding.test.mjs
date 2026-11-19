import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, OWNER, OTHER, handleAPI } from './helpers/router-fixture.mjs';
import { onboardingRoute, onboardingNext } from '../public/onboarding.js';
import { shouldPlayOpening } from '../public/opening.js';
import { renderCardDraftStart } from '../public/card-draft-flow.js';

const newUser = 'clerk:user_new';
const newOptions = () => ({owner:newUser,extraHeaders:{'oai-authenticated-user-created-at':String(Date.now())}});
const save = (f,body,options={}) => f.api('/api/me/onboarding',{method:'POST',body,...options});

test('onboarding applies only to new verified accounts; existing users and existing creators keep their route', async t => {
  const f=fixture(t);
  const legacy=await f.api('/api/me');assert.equal(legacy.onboarding.required,false);
  const fresh=await f.api('/api/me',newOptions());assert.equal(fresh.onboarding.required,true);
  for(const createdAt of ['', '0', 'NaN', '1000000000000',String(Date.now()+120000)]){
    const me=await f.api('/api/me',{owner:newUser,extraHeaders:{'oai-authenticated-user-created-at':createdAt}});
    assert.equal(me.onboarding.required,false,createdAt);
  }
  await f.publish({owner:newUser});
  const established=await f.api('/api/me',newOptions());assert.equal(established.onboarding.required,false);assert.equal(established.onboarding.creatorReady,true);
});

test('preference persists per account, can change, and never changes publication permission', async t => {
  const f=fixture(t);
  const discover=await save(f,{intent:'discover'},newOptions());assert.equal(discover.status,200);assert.equal(discover.onboarding.required,false);assert.equal(discover.onboarding.needsCreatorProfile,true);
  const reload=await f.api('/api/me',newOptions());assert.equal(reload.onboarding.intent,'discover');assert.equal(reload.onboarding.required,false);
  const other=await f.api('/api/me',{owner:OTHER});assert.equal(other.onboarding.intent,null);
  const created=await save(f,{intent:'create',name:'Public nickname'},newOptions());assert.equal(created.user.name,'Public nickname');assert.equal(created.onboarding.creatorReady,true);
  await save(f,{intent:'discover'},newOptions());
  const changed=await f.api('/api/me',newOptions());assert.equal(changed.onboarding.intent,'discover');assert.equal(changed.onboarding.creatorReady,true);assert.equal(changed.user.name,'Public nickname');
  assert.equal((await f.publish({owner:newUser})).status,201);
});

test('nickname and creator preference commit together, preserve profile fields and retry after lost acknowledgement', async t => {
  const f=fixture(t);
    await f.api('/api/me/profile',{method:'POST',body:{name:'Old name',bio:'Keep this',headline:'Artist'}});
  f.faults.beforeCommit=true;
  assert.equal((await save(f,{intent:'create',name:'New name'})).status,500);
  assert.equal(f.count('ft_onboarding'),0);assert.equal((await f.api('/api/me')).user.name,'Old name');
  f.faults.afterCommit=true;assert.equal((await save(f,{intent:'create',name:'New name'})).status,500);
  const retry=await save(f,{intent:'create',name:'New name'});assert.equal(retry.status,200);assert.equal(f.count('ft_onboarding'),1);assert.equal(retry.user.bio,'Keep this');assert.equal(retry.user.headline,'Artist');
});

test('onboarding rejects anonymous, CSRF, cross-account and invalid writes without creating a profile', async t => {
  const f=fixture(t);
  assert.equal((await handleAPI(new Request('https://site.test/api/me/onboarding',{method:'POST'}))).status,401);
  assert.equal((await save(f,{intent:'create',name:'No'}, {extraHeaders:{Origin:'https://other.test'}})).status,403);
  assert.equal((await save(f,{intent:'create',name:'No'}, {extraHeaders:{'X-Funtrack-Expected-User':OTHER}})).status,409);
  for(const body of [{intent:'admin'},{intent:'create'},{intent:'create',name:'   '},{intent:'create',name:'x'.repeat(81)}])assert.equal((await save(f,body)).status,422);
  assert.equal(f.count('ft_onboarding'),0);assert.equal(f.count('ft_profiles'),0);
});

test('deep work/card/version links return first; creator intent bypasses the choice; redirect targets are bounded', () => {
  const pending={required:true,needsCreatorProfile:true};
  for(const path of ['/work/work-one','/card/card-one','/studio/works/work-one/versions/version-one','/author/person','/notifications'])assert.equal(onboardingRoute(pending,path),null);
  assert.equal(onboardingRoute(pending,'/feed'),'/welcome');
  assert.match(onboardingRoute(pending,'/publish'),/^\/welcome\?intent=create/);
  assert.equal(onboardingRoute({...pending,required:false,needsCreatorProfile:false},'/feed'),null);
  for(const next of ['https://evil.test','//evil.test','/work/work-one','/cards/me?editCard=old'])assert.equal(onboardingNext(next,{hasWorks:true}),'/publish');
  assert.equal(onboardingNext('/cards/me',{hasWorks:true}),'/cards/me');assert.equal(onboardingNext('/cards/me',{hasWorks:false}),'/publish');
});

test('opening is first home visit only and fails closed for uncertain authentication, reduced motion and returning users', () => {
  const first={path:'/feed',authenticated:false,checked:true,seen:false,reduced:false};assert.equal(shouldPlayOpening(first),true);
  for(const change of [{path:'/welcome'},{path:'/work/example'},{authenticated:true},{checked:false},{seen:true},{reduced:true}])assert.equal(shouldPlayOpening({...first,...change}),false);
});

test('first card carries the published real work into city; no snapshot or competing draft is overwritten', async () => {
  const work={id:'work-12345678',authorId:OWNER,name:'A real work'}, r={params:new URLSearchParams({addWork:work.id})};
  let draft,route,rendered=false;
  const base={api:async()=>({card:null}),readMine:async()=>[work],owner:OWNER,current:()=>true,getDraft:()=>({ids:[],template:'wall'}),getPreview:()=>null,commit:value=>draft=value,render:()=>{rendered=true;return false;},esc:x=>x,notify:()=>{},go:value=>route=value};
  await renderCardDraftStart(r,base);assert.deepEqual(draft.ids,[work.id]);assert.equal(draft.template,'city');assert.equal(route,'/cards/me/template');assert.equal(rendered,false);
  draft=route=null;
  await renderCardDraftStart(r,{...base,getDraft:()=>({ids:[work.id],template:'fold'})});assert.equal(draft,null);assert.equal(route,null);assert.equal(rendered,true);
});
