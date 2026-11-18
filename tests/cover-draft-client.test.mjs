import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoverDraftController} from '../public/cover-draft.js';
function setup(api,extra={}){let count=0;const jobs=new Map(),timers={setTimeout(fn,delay){const id=++count;jobs.set(id,{fn,delay});return id;},clearTimeout(id){jobs.delete(id);}};const c=createCoverDraftController({api,timers,...extra});return {c,jobs,async tick(){const [id,{fn}]=[...jobs].find(([,v])=>v.delay<45000);jobs.delete(id);return fn();}};}
const candidate=body=>({...body,status:'candidate',imageUrl:'/api/cover-drafts/'+body.id+'/image'});
test('debounces URL typing and requires a selection before publication',async()=>{
 const calls=[],e=setup(async(_,o)=>{calls.push(o.body);return candidate(o.body);});
 e.c.setURL('https://a.com');e.c.setURL('https://b.com');assert.equal(e.jobs.size,1);assert.equal(e.c.canPublish,false);
 await e.tick();assert.equal(calls.length,1);assert.equal(calls[0].url,'https://b.com/');assert.equal(e.c.state.status,'candidate');assert.equal(e.c.canPublish,false);
 e.c.select();assert.equal(e.c.canPublish,true);e.c.dispose();
});
test('URL changes and route disposal discard late responses; manual covers avoid capture',async()=>{
 let done;const e=setup((_,o)=>new Promise(r=>done=()=>r(candidate(o.body))));e.c.setURL('https://a.com');const pending=e.tick();e.c.setURL('https://b.com');done();await pending;assert.equal(e.c.state.url,'https://b.com/');assert.equal(e.c.state.status,'waiting');
 e.c.setURL('https://b.com',{manual:true});assert.equal(e.c.canPublish,true);assert.equal(e.jobs.size,0);e.c.dispose();
});
test('restore reads the existing request and skip stops timers without generating another screenshot',async()=>{
 const saved={url:'https://a.com/',id:crypto.randomUUID(),status:'running'},calls=[],e=setup(async(path,options)=>{calls.push({path,options});return candidate(saved);},{saved});
 e.c.setURL(saved.url);await e.tick();assert.equal(calls[0].options.method,undefined);assert.equal(e.c.state.status,'candidate');e.c.skip();assert.equal(e.c.canPublish,true);assert.equal(e.jobs.size,0);e.c.dispose();
});
