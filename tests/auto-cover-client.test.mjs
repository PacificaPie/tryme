import test from 'node:test';
import assert from 'node:assert/strict';
import {autoCoverView,createAutoCoverController,mountAutoCover,adoptAutoCoverDraft} from '../public/auto-cover.js';

const work={id:'work-test',authorId:'owner',source:'html',versionId:'version-1',revision:1,name:'Rain',desc:'A game',coverUrl:''};
function setup(responses,options={}){
  const calls=[],states=[],ready=[],scheduled=new Map();let timerId=0;
  const timers={setTimeout(fn){const id=++timerId;scheduled.set(id,fn);return id;},clearTimeout(id){scheduled.delete(id);}};
  const api=async(path,request)=>{calls.push({path,request});const value=responses.shift();if(value instanceof Error)throw value;return {workId:work.id,versionId:work.versionId,revision:1,...value};};
  const controller=createAutoCoverController({api,work,timers,onChange:state=>states.push(state),onReady:state=>ready.push(state),...options});
  return {controller,calls,states,ready,scheduled,async next(){const [id,fn]=scheduled.entries().next().value;scheduled.delete(id);await fn();}};
}

test('queued capture polls only its owner endpoint and stops after a ready cover',async()=>{
  const env=setup([{status:'queued'},{status:'running'},{status:'ready',coverUrl:'/api/media/new',revision:2}]);
  await env.controller.refresh();assert.equal(env.scheduled.size,1);await env.next();await env.next();
  assert.equal(env.controller.state.status,'ready');assert.equal(env.scheduled.size,0);assert.equal(env.ready.length,1);
  assert.equal(env.calls.length,3);assert.ok(env.calls.every(call=>call.path==='/api/works/work-test/auto-cover'&&!call.request.method));env.controller.dispose();
});

test('generate/retry are explicit, deduplicated and always pinned to the displayed version',async()=>{
  const env=setup([{status:'none'},{status:'failed',retryable:true},{status:'queued'}]);
  await env.controller.refresh();assert.equal(await env.controller.generate('retry'),false);
  const first=env.controller.generate();assert.equal(await env.controller.generate(),false);await first;
  assert.deepEqual(env.calls[1].request.body,{action:'generate',versionId:'version-1'});
  await env.controller.generate('retry');assert.deepEqual(env.calls[2].request.body,{action:'retry',versionId:'version-1'});env.controller.dispose();
  for(const retryable of [false,true]){
    const skipped=setup([{status:'skipped',retryable},{status:'queued'}]);await skipped.controller.refresh();
    assert.equal(autoCoverView(skipped.controller.state).action,retryable?'retry':undefined);
    await skipped.controller.generate('retry');assert.equal(skipped.calls.length,retryable?2:1);
    if(retryable)assert.deepEqual(skipped.calls[1].request.body,{action:'retry',versionId:'version-1'});skipped.controller.dispose();
  }
});

test('uncertain mutation does not automatically retry or repeatedly create a task',async()=>{
  const env=setup([{status:'none'},new Error('connection lost')]);await env.controller.refresh();await env.controller.generate();
  assert.equal(env.controller.state.status,'unknown');assert.equal(env.scheduled.size,0);assert.equal(autoCoverView(env.controller.state).action,'refresh');
  assert.equal(await env.controller.generate(),false);assert.equal(env.calls.length,2);env.controller.dispose();
});

test('long-running jobs pause polling and disposal aborts reads without late UI changes',async()=>{
  const env=setup([{status:'queued'},{status:'running'},{status:'running'}],{maxPolls:2});await env.controller.refresh();await env.next();await env.next();
  assert.equal(env.controller.state.paused,true);assert.equal(env.scheduled.size,0);assert.equal(autoCoverView(env.controller.state).action,'refresh');env.controller.dispose();
  let finish,signal,changes=0;
  const controller=createAutoCoverController({work,api:async(_,options)=>{signal=options.signal;return new Promise(resolve=>finish=resolve);},onChange:()=>changes++});
  const request=controller.refresh();await Promise.resolve();const before=changes;controller.dispose();assert.equal(signal.aborted,true);
  finish({status:'ready',workId:work.id});await request;assert.equal(changes,before);
});

test('external works, non-owners and existing covers never mount or fetch auto-cover status',()=>{
  for(const candidate of [{...work,source:'url'},{...work,authorId:'someone-else'},{...work,coverUrl:'/media/custom'}]){
    assert.doesNotThrow(()=>mountAutoCover({}, {work:candidate,owner:'owner',api:()=>assert.fail('No automatic-cover API for this view')}));
  }
  assert.equal(autoCoverView({status:'failed',retryable:false}).action,undefined);
  assert.equal(autoCoverView({status:'unavailable',retryable:false}).action,undefined);
});

test('a known cover-only update preserves typed text and manual image selection; other changes require rebase',()=>{
  const draft={key:'old',expectedRevision:1,base:{name:'Rain',desc:'A game',coverUrl:''},name:'My unsaved title',desc:'My unsaved description',replaceCover:true,attempted:false};
  const latest={...work,revision:2,coverUrl:'/media/generated'};
  const next=adoptAutoCoverDraft(draft,work,latest,{revision:2},'new');
  assert.equal(next.name,draft.name);assert.equal(next.desc,draft.desc);assert.equal(next.replaceCover,true);assert.equal(next.expectedRevision,2);assert.equal(next.base.coverUrl,'/media/generated');assert.equal(draft.base.coverUrl,'');
  for(const changed of [{...latest,name:'Changed elsewhere'},{...latest,versionId:'version-2'},{...latest,revision:3}])assert.equal(adoptAutoCoverDraft(draft,work,changed,{revision:2},'new'),null);
  assert.equal(adoptAutoCoverDraft({...draft,attempted:true},work,latest,{revision:2},'new'),null);
});

test('daily/monthly budget waits stop polling, explain the limit, and resume only after a manual refresh clears it',async()=>{
  for(const reason of ['DAILY_BUDGET','MONTHLY_BUDGET']){
    const env=setup([{status:'queued',reason},{status:'queued'},{status:'ready',revision:2,coverUrl:'/api/media/generated'}]);
    await env.controller.refresh();assert.equal(env.scheduled.size,0);
    const view=autoCoverView(env.controller.state);assert.equal(view.action,'refresh');assert.match(view.message,/使用上限/);assert.doesNotMatch(view.message,/正在截取|仍在处理/);
    assert.equal(await env.controller.generate(),false);assert.equal(env.calls.length,1);
    await env.controller.refresh();assert.equal(env.controller.state.reason,null);assert.equal(env.scheduled.size,1);
    await env.next();assert.equal(env.controller.state.status,'ready');assert.equal(env.scheduled.size,0);env.controller.dispose();
  }
});

test('GET and POST deadlines release pending state even when fetch ignores abort; late results cannot overwrite a refresh',async()=>{
  const scheduled=new Map(),calls=[],late=[];let nextTimer=0;
  const timers={setTimeout(fn,delay){const id=++nextTimer;scheduled.set(id,{fn,delay});return id;},clearTimeout(id){scheduled.delete(id);}};
  const controller=createAutoCoverController({work,timers,api:async(_,options)=>{
    calls.push(options);
    if(calls.length===1||calls.length===3)return new Promise(resolve=>late.push(resolve));
    return {workId:work.id,status:calls.length===2?'none':'ready',revision:3,coverUrl:'/media/new'};
  }});
  async function expire(request){
    await Promise.resolve();assert.equal(controller.state.pending,true);
    const [id,deadline]=[...scheduled.entries()].find(([,value])=>value.delay===15000);scheduled.delete(id);deadline.fn();await request;
    assert.equal(calls.at(-1).signal.aborted,true);assert.equal(controller.state.pending,false);assert.equal(controller.state.status,'unknown');assert.equal(autoCoverView(controller.state).action,'refresh');assert.equal(scheduled.size,0);
  }
  await expire(controller.refresh());await controller.refresh();assert.equal(controller.state.status,'none');
  await expire(controller.generate());assert.equal(calls[2].method,'POST');await controller.refresh();assert.equal(controller.state.status,'ready');
  for(const resolve of late)resolve({workId:work.id,status:'failed',retryable:true});await Promise.resolve();await Promise.resolve();
  assert.equal(controller.state.status,'ready');assert.equal(controller.state.revision,3);assert.equal(scheduled.size,0);controller.dispose();
});
