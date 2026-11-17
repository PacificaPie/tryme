import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForPendingPlayStart} from '../public/play-start-order.js';

function clock(){
  let time=10000,serial=0;const timers=new Map();
  return {timers,environment:{now:()=>time,setTimeout(fn,delay){const id=++serial;timers.set(id,{at:time+delay,fn});return id;},clearTimeout(id){timers.delete(id);}},
    async advance(ms){const end=time+ms;for(;;){const due=[...timers].filter(([,item])=>item.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;time=due[1].at;timers.delete(due[0]);due[1].fn();await new Promise(resolve=>setImmediate(resolve));}time=end;await new Promise(resolve=>setImmediate(resolve));}};
}
const queue=extra=>({workId:'work-a',ownerId:'owner-a',expiresAt:20000,pending:[{type:'play_start'}],...extra});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const options=(c,flush,extra={})=>({workId:'work-a',ownerId:'owner-a',flush,environment:c.environment,...extra});

test('qualifying social actions wait for acknowledgement of their own pending play start',async()=>{
  const c=clock(),q=queue(),ack=deferred(),order=[];
  const wait=waitForPendingPlayStart(new Set([q]),options(c,async item=>{order.push('flush');await ack.promise;item.pending=[];order.push('ack');})).then(ready=>{order.push('social');return ready;});
  await c.advance(1500);assert.deepEqual(order,['flush']);q.pending=[];ack.resolve();assert.equal(await wait,true);assert.deepEqual(order,['flush','ack','social']);assert.equal(c.timers.size,0);
});

test('only unexpired starts for the same work and account are awaited, including already closed sessions',async()=>{
  const c=clock(),closed=queue({closed:true}),otherWork=queue({workId:'work-b'}),otherOwner=queue({ownerId:'owner-b'}),expired=queue({expiresAt:10000}),ended=queue({pending:[{type:'session_end'}]}),flushed=[];
  const result=await waitForPendingPlayStart(new Set([closed,otherWork,otherOwner,expired,ended]),options(c,async item=>{flushed.push(item);item.pending=[];}));
  assert.equal(result,true);assert.deepEqual(flushed,[closed]);assert.equal(c.timers.size,0);
});

test('an unrelated or already acknowledged session does not delay an interaction or create a timeout',async()=>{
  const c=clock();let flushes=0;const result=await waitForPendingPlayStart([queue({ownerId:'other'}),queue({workId:'other'}),queue({pending:[]})],options(c,async()=>{flushes++;}));
  assert.equal(result,true);assert.equal(flushes,0);assert.equal(c.timers.size,0);
});

test('a stalled start releases the interaction at two seconds even if a caller requests a longer deadline',async()=>{
  const c=clock(),q=queue(),ack=deferred();let settled=false;
  const result=waitForPendingPlayStart([q],options(c,()=>ack.promise,{timeoutMs:60000})).then(value=>{settled=true;return value;});
  await c.advance(1999);assert.equal(settled,false);await c.advance(1);assert.equal(await result,false);assert.equal(c.timers.size,0);
  q.pending=[];ack.resolve();await c.advance(0);assert.equal(settled,true,'A later analytics receipt must not schedule another interaction');
});

test('rejected flushes and incomplete acknowledgements release the interaction without pretending play was received',async()=>{
  for(const flush of [async()=>{throw Error('Offline');},()=>{throw Error('Synchronous network failure');},async()=>{}]){
    const c=clock();assert.equal(await waitForPendingPlayStart([queue()],options(c,flush)),false);assert.equal(c.timers.size,0);
  }
});

test('simultaneous interaction waits can share an existing flush promise and both require its acknowledgement',async()=>{
  const c=clock(),q=queue(),ack=deferred();let acknowledged=false;
  // flushSession owns network de-duplication. The helper must await the Promise
  // it returns even when it represents an already-running request.
  const inFlight=ack.promise.then(()=>{q.pending=[];acknowledged=true;});const flush=()=>inFlight;
  const first=waitForPendingPlayStart([q],options(c,flush)),second=waitForPendingPlayStart([q],options(c,flush));
  await c.advance(1000);assert.equal(acknowledged,false);ack.resolve();assert.deepEqual(await Promise.all([first,second]),[true,true]);assert.equal(c.timers.size,0);
});
