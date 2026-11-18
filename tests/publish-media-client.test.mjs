import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublishMediaController,publishSourceKey} from '../public/publish-media.js';
const flush=()=>new Promise(r=>setTimeout(r,2));
async function until(fn){for(let n=0;n<100;n++){if(fn())return;await flush();}assert.fail('state did not settle');}
function setup(extra={}){const calls=[];let persisted;
 const api=async(path,o)=>{calls.push({path,o});if(path==='/api/publish-drafts')return {id:o.body.get('id'),expiresAt:new Date(Date.now()+86400000).toISOString(),cover:null,video:null};const {id,kind}=o.body;return {id,kind,status:'ready',url:path.replace('/capture','/media/'+id)};};
 const c=createPublishMediaController({api,debounceMs:0,onPersist:s=>persisted=s,...extra});return {c,calls,get saved(){return persisted;}};
}
test('same-name same-size replacement revokes prior media using actual bytes',async t=>{
 const a=new File(['AAAA'],'same.html'),b=new File(['BBBB'],'same.html');assert.notEqual(await publishSourceKey({source:'html',file:a}),await publishSourceKey({source:'html',file:b}));
 const e=setup();t.after(()=>e.c.dispose());e.c.sync({source:'html',file:a});await until(()=>e.c.state.video?.status==='ready');e.c.choose('cover','candidate');e.c.choose('video','candidate');assert.equal(e.c.canPublish,true);
 const before=e.c.state.id;e.c.sync({source:'html',file:b});assert.equal(e.c.canPublish,false);await until(()=>e.c.state.video?.status==='ready');assert.notEqual(e.c.state.id,before);assert.equal(e.c.state.coverChoice,'');
});
test('all sources require both choices; external video is an explicit skip',async t=>{
 for(const input of [{source:'html',file:new File(['html'],'a.html')},{source:'github',buildId:crypto.randomUUID()},{source:'url',url:'https://example.com'}]){
  const e=setup();t.after(()=>e.c.dispose());e.c.sync(input);await until(()=>e.c.state.cover?.status==='ready');assert.equal(e.c.canPublish,false);e.c.choose('cover','candidate');assert.equal(e.c.canPublish,false);e.c.choose('video','skip');assert.equal(e.c.canPublish,true);
  if(input.source==='url')assert.equal(e.calls.filter(c=>c.o.body.kind==='video').length,0);
 }
});
test('refresh reuses draft and capture IDs, preserves choices, and does not spend again',async t=>{
 const input={source:'html',file:new File(['html'],'a.html')},first=setup();first.c.sync(input);await until(()=>first.c.state.video?.status==='ready');first.c.choose('cover','candidate');first.c.choose('video','candidate');const saved=first.saved;first.c.dispose();
 const calls=[],next=setup({saved,api:async(path,o)=>{calls.push(path);return {id:o.body.get('id'),expiresAt:saved.expiresAt,cover:saved.cover,video:saved.video};}});t.after(()=>next.c.dispose());next.c.sync({...input,file:new File(['html'],'a.html')});await until(()=>next.c.canPublish);assert.equal(next.c.state.id,saved.id);assert.deepEqual(calls,['/api/publish-drafts']);
});
test('late responses after changing source or cancelling cannot replace the new draft',async t=>{
 let resolve,first=true;const e=setup({api:async(path,o)=>{if(path==='/api/publish-drafts'){const d={id:o.body.get('id'),expiresAt:new Date(Date.now()+86400000).toISOString()};if(first){first=false;return new Promise(r=>resolve=()=>r(d));}return d;}return {...o.body,status:'failed'};}});t.after(()=>e.c.dispose());
 e.c.sync({source:'url',url:'https://a.com'});await until(()=>resolve);e.c.sync({source:'url',url:'https://b.com'});await until(()=>e.c.state.status==='ready');const id=e.c.state.id;resolve();await flush();assert.equal(e.c.state.id,id);assert.equal(e.c.state.key,'url:https://b.com/');e.c.dispose();
});
test('lost create response retries same ID and explicit skips survive delayed captures',async t=>{
 let first=true,finish;const ids=[];const e=setup({api:async(path,o)=>{if(path==='/api/publish-drafts'){ids.push(o.body.get('id'));if(first){first=false;throw Error('response lost');}return {id:ids[0],expiresAt:new Date(Date.now()+86400000).toISOString()};}return new Promise(r=>finish=()=>r({...o.body,status:'ready',url:path.replace('/capture','/media/'+o.body.id)}));}});t.after(()=>e.c.dispose());
 e.c.sync({source:'url',url:'https://example.com'});await until(()=>finish);e.c.choose('cover','skip');e.c.choose('video','skip');finish();await flush();assert.equal(e.c.canPublish,true);assert.equal(e.c.state.coverChoice,'skip');assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
});
