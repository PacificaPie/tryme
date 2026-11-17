import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mountFeedImpressions} from '../public/feed-impressions.js';

function harness({count=1,userId=randomUUID(),sort='recommended',api:implementation}={}){
  let time=Date.parse('2026-11-16T15:00:00.000Z'),serial=0;
  const tasks=new Map(),listeners=new Map(),observers=[],detachers=[],calls=[];
  const document={visibilityState:'visible',documentElement:{clientWidth:1000,clientHeight:1000},
    addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);}};
  const card=id=>({dataset:{workId:id},isConnected:true,bounds:{left:0,top:0,right:100,bottom:100,width:100,height:100},getBoundingClientRect(){return this.bounds;}});
  const container={isConnected:true,parentNode:{},children:Array.from({length:count},()=>card(randomUUID()))};
  class IO{constructor(callback){this.callback=callback;this.observed=new Set();this.disconnected=false;observers.push(this);}observe(el){this.observed.add(el);}unobserve(el){this.observed.delete(el);}disconnect(){this.observed.clear();this.disconnected=true;}emit(el,ratio=1){this.callback([{target:el,isIntersecting:ratio>0,intersectionRatio:ratio}]);}}
  class MO{constructor(callback){this.callback=callback;this.disconnected=false;detachers.push(this);}observe(){}disconnect(){this.disconnected=true;}}
  const environment={document,IntersectionObserver:IO,MutationObserver:MO,setTimeout(fn,delay){const id=++serial;tasks.set(id,{at:time+delay,fn});return id;},clearTimeout(id){tasks.delete(id);},now:()=>time,randomUUID};
  const api=async(path,options)=>{calls.push({path,options});return implementation?implementation(path,options,calls.length):{accepted:options.body.impressions,duplicates:[],ignored:[]};};
  const mount=()=>mountFeedImpressions(container,{api,userId,sort,environment});let mounted=mount();
  async function advance(ms){const end=time+ms;for(;;){const due=[...tasks].filter(([,task])=>task.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;tasks.delete(due[0]);time=due[1].at;due[1].fn();await new Promise(resolve=>setImmediate(resolve));}time=end;await new Promise(resolve=>setImmediate(resolve));}
  function visibility(state){document.visibilityState=state;listeners.get('visibilitychange')?.();}
  return {document,container,card,observers,detachers,calls,tasks,listeners,environment,userId,api,advance,visibility,get mounted(){return mounted;},remount(){mounted=mount();return mounted;},emitAll(ratio=1){for(const element of container.children)observers.at(-1).emit(element,ratio);}};
}

test('exposure requires at least half the card visible continuously for one second, not merely mounted',async()=>{
  const f=harness();await f.advance(5000);assert.equal(f.calls.length,0);
  f.emitAll(.49);await f.advance(2000);assert.equal(f.calls.length,0);
  f.emitAll(.5);await f.advance(999);assert.equal(f.calls.length,0);f.emitAll(.4);await f.advance(2000);assert.equal(f.calls.length,0);
  f.emitAll(.5);await f.advance(1120);assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/api/feed/impressions');assert.equal(f.calls[0].options.body.impressions[0].workId,f.container.children[0].dataset.workId);
  f.emitAll(0);f.emitAll(1);await f.advance(3000);assert.equal(f.calls.length,1,'Scrolling out and back must not create another impression');f.mounted.dispose();
});

test('background-tab time never completes an impression and resuming requires a fresh visible observation',async()=>{
  const f=harness();f.emitAll();await f.advance(800);f.visibility('hidden');await f.advance(5000);assert.equal(f.calls.length,0);
  f.visibility('visible');await f.advance(5000);assert.equal(f.calls.length,0,'A stale pre-background intersection ratio is insufficient');
  f.emitAll();await f.advance(1120);assert.equal(f.calls.length,1);f.mounted.dispose();
});

test('the timer checks current geometry and connection before reporting an impression',async()=>{
  const f=harness({count:2});f.emitAll();
  f.container.children[0].bounds={left:0,top:960,right:100,bottom:1060,width:100,height:100};f.container.children[1].isConnected=false;
  await f.advance(1120);assert.equal(f.calls.length,0);f.mounted.dispose();
});

test('route disposal cancels incomplete impressions, disconnects observers and removes listeners',async()=>{
  const f=harness();f.emitAll();await f.advance(800);f.mounted.dispose();await f.advance(5000);
  assert.equal(f.calls.length,0);assert.equal(f.tasks.size,0);assert.equal(f.listeners.size,0);assert(f.observers[0].disconnected);assert(f.detachers[0].disconnected);
});

test('qualified observations flush on route disposal and cached remounts do not double-count',async()=>{
  const f=harness();f.emitAll();await f.advance(1000);assert.equal(f.calls.length,0);f.mounted.dispose();await f.advance(0);assert.equal(f.calls.length,1);
  f.remount();f.emitAll();await f.advance(5000);assert.equal(f.calls.length,1);f.mounted.dispose();
});

test('append and card replacement preserve per-work deduplication and batch at most 24 observations',async()=>{
  const f=harness({count:25});f.emitAll();await f.advance(1240);assert.deepEqual(f.calls.map(c=>c.options.body.impressions.length),[24,1]);
  const first=f.container.children[0];first.isConnected=false;f.container.children[0]=f.card(first.dataset.workId);const appended=f.card(randomUUID());f.container.children.push(appended);f.mounted.refresh();f.emitAll();await f.advance(1240);
  assert.equal(f.calls.length,3);assert.deepEqual(f.calls[2].options.body.impressions.map(i=>i.workId),[appended.dataset.workId]);f.mounted.dispose();
});

test('transient failures retry the exact event IDs with bounded backoff; permanent failures settle',async()=>{
  const f=harness({api:async()=>{throw Object.assign(Error('Offline'),{status:503});}});f.emitAll();await f.advance(8120);
  assert.equal(f.calls.length,4);const ids=f.calls.map(c=>c.options.body.impressions[0].eventId);assert.equal(new Set(ids).size,1);await f.advance(60000);assert.equal(f.calls.length,4);f.mounted.dispose();
  const permanent=harness({api:async()=>{throw Object.assign(Error('Invalid'),{status:422});}});permanent.emitAll();await permanent.advance(10000);assert.equal(permanent.calls.length,1);permanent.mounted.dispose();
});

test('server-ignored stale cards settle without retry and disconnected hosts stop observation',async()=>{
  const f=harness({api:async(_path,options)=>({accepted:[],duplicates:[],ignored:options.body.impressions.map(x=>x.eventId)})});f.emitAll();await f.advance(5000);assert.equal(f.calls.length,1);
  f.container.isConnected=false;f.detachers[0].callback();assert(f.observers[0].disconnected);assert.equal(f.listeners.size,0);assert.equal(f.tasks.size,0);
});

test('the UTC-day ledger resets without reusing yesterday’s event ID',async()=>{
  const f=harness();f.emitAll();await f.advance(1120);f.mounted.dispose();const first=f.calls[0].options.body.impressions[0].eventId;
  await f.advance(86400000);f.remount();f.emitAll();await f.advance(1120);assert.equal(f.calls.length,2);assert.notEqual(f.calls[1].options.body.impressions[0].eventId,first);f.mounted.dispose();
});

test('exposure batches bind the expected actor and retry malformed acknowledgements with the same IDs',async()=>{
  for(const response of [()=>({}),()=>({accepted:'bad',duplicates:[],ignored:[]}),items=>({accepted:[{eventId:items[0].eventId,workId:'different-work'}],duplicates:[],ignored:[]})]){
    const f=harness({api:async(_path,options)=>response(options.body.impressions)});f.emitAll();await f.advance(8120);
    assert.equal(f.calls.length,4,'A successful HTTP status without a matching receipt is not a settled impression');
    assert.equal(new Set(f.calls.map(c=>c.options.body.impressions[0].eventId)).size,1);
    assert(f.calls.every(c=>c.options.body.expectedActorId===f.userId));f.mounted.dispose();
  }
});

test('partial acknowledgements retry only unacknowledged impressions, preserving their event IDs',async()=>{
  const f=harness({count:2,api:async(_path,options,attempt)=>({accepted:attempt===1?[options.body.impressions[0]]:options.body.impressions,duplicates:[],ignored:[]})});
  f.emitAll();await f.advance(2120);assert.equal(f.calls.length,2);const first=f.calls[0].options.body.impressions,second=f.calls[1].options.body.impressions;
  assert.equal(first.length,2);assert.deepEqual(second,[first[1]]);await f.advance(10000);assert.equal(f.calls.length,2);f.mounted.dispose();
});
