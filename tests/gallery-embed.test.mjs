import test from 'node:test';
import assert from 'node:assert/strict';
import {createGalleryBridge} from '../public/gallery/embed.js';

function setup() {
  const events=new EventTarget(),frame=new EventTarget(),sent=[],statuses=[],pending=new Map();
  let clock=0,nextTimer=0,current=true,navigations=0;
  frame.contentWindow={postMessage(message,origin){sent.push({message,origin});}};
  Object.defineProperty(frame,'src',{get:()=>'/gallery/?lang=en',set:()=>{navigations++;}});
  const timers={setTimeout(fn,delay){const id=++nextTimer;pending.set(id,{at:clock+delay,fn});return id;},clearTimeout(id){pending.delete(id);}};
  const tick=duration=>{const end=clock+duration;for(;;){const next=[...pending].filter(([,value])=>value.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;pending.delete(next[0]);clock=next[1].at;next[1].fn();}clock=end;};
  const emit=(data,overrides={})=>{const event=new Event('message');Object.assign(event,{data,origin:'https://funtrack.test',source:frame.contentWindow,...overrides});events.dispatchEvent(event);};
  const bridge=createGalleryBridge({frame,events,timers,origin:'https://funtrack.test',payload:()=>({works:[{id:'w1'}]}),isCurrent:()=>current,onStatus:state=>statuses.push(state)});
  const ready=documentId=>emit({type:'funtrack:gallery:ready',documentId});
  const ack=(state='rendered',requestId=sent.at(-1).message.requestId,overrides)=>emit({type:'funtrack:gallery:initialized',requestId,state},overrides);
  return {bridge,frame,sent,statuses,tick,ready,ack,pending,get navigations(){return navigations;},leave(){current=false;}};
}

test('a load event cannot declare 3D ready; retries retain one request until child acknowledgement',()=>{
  const env=setup();assert.deepEqual(env.statuses,['loading']);
  env.frame.dispatchEvent(new Event('load'));env.tick(1200);
  assert.equal(new Set(env.sent.map(item=>item.message.requestId)).size,1);
  assert.deepEqual(env.statuses,['loading']);
  env.ack();assert.deepEqual(env.statuses,['loading','rendered']);
  const sent=env.sent.length;env.tick(20000);assert.equal(env.sent.length,sent);assert.equal(env.pending.size,0);
  env.bridge.dispose();
});

test('repeated ready/load messages preserve the current view; a new document gets a new request',()=>{
  const env=setup();env.ready('document-a');env.ack();
  const id=env.sent.at(-1).message.requestId,count=env.sent.length;
  env.ready('document-a');env.frame.dispatchEvent(new Event('load'));assert.equal(env.sent.length,count);
  env.ready('document-b');assert.equal(env.sent.at(-1).message.requestId,id+1);
  env.ack('rendered',id);assert.equal(env.statuses.at(-1),'loading');
  env.ack('fallback');assert.equal(env.statuses.at(-1),'fallback');env.bridge.dispose();
});

test('silent/blocked frames time out, stop retrying, and explicit retry navigates the iframe',()=>{
  const env=setup();env.tick(15000);assert.equal(env.statuses.at(-1),'timeout');assert.equal(env.pending.size,0);
  assert.equal(env.navigations,1,'Only one automatic reload within the original deadline');
  const before=env.sent.length;env.ready('late');env.tick(5000);assert.equal(env.sent.length,before);
  env.bridge.retry();assert.equal(env.navigations,2);assert.equal(env.statuses.at(-1),'loading');
  assert.equal(env.sent.length,before,'Do not initialize the previous document while navigation is pending');
  env.ready('retry-document');env.ack('empty');assert.equal(env.statuses.at(-1),'empty');env.bridge.dispose();
});

test('untrusted/stale acknowledgements are ignored and leaving the route clears the bridge',()=>{
  const env=setup();env.ack('rendered',1,{origin:'https://untrusted.test'});env.ack('rendered',1,{source:{}});env.ack('rendered',99);
  assert.deepEqual(env.statuses,['loading']);
  env.leave();env.tick(600);assert.equal(env.pending.size,0);
  const count=env.sent.length;env.ready('new');env.frame.dispatchEvent(new Event('load'));env.tick(15000);
  assert.equal(env.sent.length,count);assert.deepEqual(env.statuses,['loading']);env.bridge.dispose();
});

test('one automatic reload recovers a silent document and ignores its stale acknowledgement',()=>{
  const env=setup(),oldRequest=env.sent.at(-1).message.requestId;
  env.tick(4999);assert.equal(env.navigations,0);env.tick(1);assert.equal(env.navigations,1);
  env.ack('rendered',oldRequest);assert.deepEqual(env.statuses,['loading']);
  env.ready('recovered-document');assert.equal(env.sent.at(-1).message.requestId,oldRequest+1);
  env.ack();assert.deepEqual(env.statuses,['loading','rendered']);
  const sent=env.sent.length;env.ready('recovered-document');env.tick(30000);
  assert.equal(env.navigations,1);assert.equal(env.sent.length,sent);assert.equal(env.pending.size,0);env.bridge.dispose();
});

test('a ready child awaiting rendering is never automatically reloaded',()=>{
  const env=setup();env.tick(1000);env.ready('slow-renderer');env.tick(13999);
  assert.equal(env.navigations,0);assert.equal(env.statuses.at(-1),'loading');
  const requestId=env.sent.at(-1).message.requestId;env.tick(1);assert.equal(env.statuses.at(-1),'timeout');
  env.ack('rendered',requestId);assert.equal(env.statuses.at(-1),'rendered','A matching late ack can still recover the view');
  env.tick(20000);assert.equal(env.navigations,0);env.bridge.dispose();
});

test('explicit retry gets one recovery budget, and disposal cancels recovery',()=>{
  const env=setup();env.tick(15000);assert.equal(env.navigations,1);
  env.bridge.retry();assert.equal(env.navigations,2);env.tick(5000);assert.equal(env.navigations,3);
  env.tick(10000);assert.equal(env.navigations,3);assert.equal(env.statuses.at(-1),'timeout');
  env.bridge.retry();assert.equal(env.navigations,4);env.bridge.dispose();env.tick(30000);assert.equal(env.navigations,4);assert.equal(env.pending.size,0);
  const fresh=setup();fresh.bridge.dispose();fresh.tick(30000);assert.equal(fresh.navigations,0);assert.equal(fresh.pending.size,0);
});
