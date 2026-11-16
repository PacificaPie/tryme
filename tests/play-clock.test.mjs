import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayClock } from '../public/play-clock.js';
import { sessionEvents } from '../lib/funtrack/rules.mjs';

test('play clock excludes pre-input and hidden time, tolerates duplicate visibility changes',()=>{
  let at=0;const clock=createPlayClock(()=>at);
  at=2000;clock.start();at=3000;clock.setVisible(false);clock.setVisible(false);
  at=9000;clock.setVisible(true);clock.setVisible(true);clock.start();at=11000;
  assert.deepEqual(clock.finish(),{timingVersion:1,activeMs:3000});
  at=20000;clock.setVisible(true);assert.deepEqual(clock.finish(),{timingVersion:1,activeMs:3000});
});
test('unstarted sessions have unknown duration; a hidden start waits until visible',()=>{
  let at=100;const unstarted=createPlayClock(()=>at);at=2000;assert.equal(unstarted.finish(),null);
  unstarted.start();assert.equal(unstarted.finish(),null);
  const clock=createPlayClock(()=>at,false);clock.start();at=5000;clock.setVisible(true);at=5500;
  assert.deepEqual(clock.finish(),{timingVersion:1,activeMs:500});
});
test('clock caps a long session and preserves a measured zero',()=>{
  let at=0;const clock=createPlayClock(()=>at);clock.start();at=7200000;
  assert.equal(clock.finish().activeMs,3600000);
  const zero=createPlayClock(()=>0);zero.start();assert.equal(zero.finish().activeMs,0);
});
test('timing receipts accept bounded metadata without changing legacy end events',()=>{
  const event={id:'timing-event',type:'session_end',seq:2,elapsedMs:10000};
  assert.equal(sessionEvents([{...event,result:{label:'exit'}}])[0].result,null);
  assert.deepEqual(sessionEvents([{...event,result:{timingVersion:1,activeMs:4000,ignored:'x'}}])[0].result,{timingVersion:1,activeMs:4000});
  for(const activeMs of [-1,10001,1.5,'3'])assert.throws(()=>sessionEvents([{...event,result:{timingVersion:1,activeMs}}]),e=>e.status===422);
  assert.throws(()=>sessionEvents([{...event,result:{timingVersion:2,activeMs:2}}]),e=>e.status===422);
  assert.throws(()=>sessionEvents([{...event,elapsedMs:undefined,result:{timingVersion:1,activeMs:2}}]),e=>e.status===422);
});
