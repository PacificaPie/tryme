import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createCoverReviewController} from '../public/cover-review.js';
import {heroReadiness} from '../lib/funtrack/external-cover-capture.mjs';
const work={id:'work',versionId:'version',revision:1};
function setup(responses,options={}){
 const calls=[],accepted=[],scheduled=new Map();let id=0;
 const timers={setTimeout(fn,delay){const n=++id;scheduled.set(n,{fn,delay});return n;},clearTimeout(n){scheduled.delete(n);}};
 const controller=createCoverReviewController({work,timers,api:async(path,request)=>{calls.push({path,request});const value=responses.shift();if(value instanceof Error)throw value;return {workId:work.id,versionId:work.versionId,revision:1,...value};},onAccepted:s=>accepted.push(s),...options});
 return {calls,accepted,scheduled,controller,async next(){const [id,{fn}]=scheduled.entries().next().value;scheduled.delete(id);await fn();}};
}
test('candidate polling stops for review; acceptance carries exact candidate and revision',async()=>{
 const e=setup([{status:'queued'},{status:'candidate',candidateId:'image1',candidateUrl:'/private'},{status:'accepted',revision:2}]);
 await e.controller.refresh();await e.next();assert.equal(e.scheduled.size,0);assert.equal(e.accepted.length,0);
 await e.controller.act('accept');assert.deepEqual(e.calls[2].request.body,{action:'accept',versionId:'version',expectedRevision:1,candidateId:'image1'});assert.equal(e.accepted.length,1);e.controller.dispose();
});
test('delay retake is explicit; unsaved edits block every cover mutation',async()=>{
 let blocked=false;const e=setup([{status:'candidate',candidateId:'image1'},{status:'queued'}],{blocked:()=>blocked});await e.controller.refresh();blocked=true;assert.equal(await e.controller.act('accept'),false);assert.equal(e.calls.length,1);
 blocked=false;await e.controller.act('retake',10000);assert.equal(e.calls[1].request.body.waitMs,10000);assert.equal(e.calls[1].request.body.candidateId,'image1');e.controller.dispose();
});
test('unknown outcomes never resubmit acceptance and disposal cancels pending polling',async()=>{
 const e=setup([{status:'candidate',candidateId:'image1'},new Error('network')]);await e.controller.refresh();await e.controller.act('accept');assert.equal(e.controller.state.status,'unknown');assert.equal(e.scheduled.size,0);assert.equal(e.calls.length,2);e.controller.dispose();
 let finish,signal;const c=createCoverReviewController({work,api:async(_,o)=>{signal=o.signal;return new Promise(resolve=>finish=resolve);}});const p=c.refresh();c.dispose();assert.equal(signal.aborted,true);finish({workId:'work',versionId:'version',status:'candidate'});await p;
});
test('budget, max polling and mismatched version do not keep spinning or adopt stale media',async()=>{
 const budget=setup([{status:'queued',reason:'DAILY_BUDGET'}]);await budget.controller.refresh();assert.equal(budget.scheduled.size,0);budget.controller.dispose();
 const e=setup([{status:'queued'},{status:'running'}],{maxPolls:1});await e.controller.refresh();await e.next();assert.equal(e.controller.state.paused,true);assert.equal(e.scheduled.size,0);e.controller.dispose();
 const stale=setup([{status:'candidate',versionId:'other'}]);await stale.controller.refresh();assert.equal(stale.controller.state.status,'unknown');stale.controller.dispose();
});
function readyFixture({intro=false,overlay=false,loadingImage=false,fontLoading=false,blank=false}={}){
 const rect={x:0,y:0,top:0,left:0,right:1200,bottom:700,width:1200,height:700};
 const hero={id:'hero',tagName:'SECTION',getBoundingClientRect:()=>rect};
 const image={complete:!loadingImage,naturalWidth:loadingImage?0:600,getBoundingClientRect:()=>({...rect,width:400,height:400})};
 const document={readyState:'complete',fonts:{status:fontLoading?'loading':'loaded'},documentElement:{dataset:{intro:intro?'running':undefined}},body:{innerText:blank?'':'Bingo product designer',...hero},images:blank?[]:[image],title:'Bingo',querySelectorAll:s=>s.startsWith('.intro')?(overlay?[hero]:[]):[hero],querySelector:()=>null,elementFromPoint:()=>null};
 return vm.runInNewContext('('+heroReadiness.toString()+')()',{document,innerWidth:1200,innerHeight:750,getComputedStyle:()=>({visibility:'visible',display:'block',opacity:'1',position:'static'})});
}
test('hero readiness waits for intro overlay, fonts and visible images rather than mere DOM existence',()=>{
 assert.equal(readyFixture().ready,true);for(const options of [{intro:true},{overlay:true},{loadingImage:true},{fontLoading:true},{blank:true}])assert.equal(readyFixture(options).ready,false,JSON.stringify(options));
});
