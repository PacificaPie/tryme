import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedMediaRefresh, mergeGeneratedMedia, needsGeneratedMedia } from '../public/feed-media-refresh.js';

const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function fixture(options={}) {
  let works=options.works||[{id:'work',source:'html',versionId:'v1',coverUrl:''}],shown=true,sequence=0;
  const tasks=new Map(),calls=[];
  const timers={setTimeout(fn,ms){const id=++sequence;tasks.set(id,{fn,ms});return id;},clearTimeout(id){tasks.delete(id);}};
  const control=createFeedMediaRefresh({api:(url,{signal})=>new Promise((resolve,reject)=>calls.push({url,signal,resolve,reject})),getWorks:()=>works,onMedia:fresh=>{works=works.map(work=>mergeGeneratedMedia(work,fresh.find(item=>item.id===work.id)));},visible:()=>shown,timers,...options});
  const tick=()=>{const entry=[...tasks].find(([,task])=>task.ms===15000);if(entry){tasks.delete(entry[0]);entry[1].fn();}};
  return {control,calls,tasks,tick,get works(){return works;},hide(){shown=false;},show(){shown=true;control.wake();}};
}
test('generated media fills independently without replacing covers, social state or a newer version',()=>{
  const original={id:'w',source:'html',versionId:'v1',coverUrl:'',name:'Current title',likesCount:7};
  assert.equal(mergeGeneratedMedia(original,{...original,coverUrl:''}),original);
  const covered=mergeGeneratedMedia(original,{...original,coverUrl:'/cover',likesCount:0,name:'Stale title'});
  assert.equal(covered.coverUrl,'/cover');assert.equal(covered.likesCount,7);assert.equal(covered.name,'Current title');
  const preview={url:'/preview'};
  const ready=mergeGeneratedMedia(covered,{...original,coverUrl:'/different',preview});
  assert.equal(ready.coverUrl,'/cover');assert.deepEqual(ready.preview,preview);assert.equal(needsGeneratedMedia(ready),false);
  assert.equal(mergeGeneratedMedia(original,{...original,versionId:'v2',coverUrl:'/wrong-version'}),original);
  assert.equal(needsGeneratedMedia({...original,source:'url'}),true);
});
test('visible pending work gains cover then video and stops polling when both exist',async()=>{
  const f=fixture();f.control.watch('/api/public/discover?limit=12',f.works);
  f.tick();assert.equal(f.calls.length,1);
  f.calls[0].resolve({works:[{...f.works[0],coverUrl:'/cover'}]});await settle();assert.equal(f.works[0].coverUrl,'/cover');
  f.tick();f.calls[1].resolve({works:[{...f.works[0],preview:{url:'/preview'}}]});await settle();
  assert.equal(f.tasks.size,0);assert.equal(f.works[0].preview.url,'/preview');f.control.dispose();
});
test('failed jobs and network errors stop after the bounded number of attempts',async()=>{
  const f=fixture({maxAttempts:2});f.control.watch('/api/discover',f.works);
  f.tick();f.calls[0].reject(Error('offline'));await settle();
  f.tick();f.calls[1].resolve({works:f.works});await settle();
  f.tick();assert.equal(f.calls.length,2);assert.equal(f.tasks.size,0);f.control.dispose();
});
test('hidden tabs make no requests and resume when visible; disposal aborts and rejects a late result',async()=>{
  const f=fixture();f.control.watch('/api/discover',f.works);f.hide();f.tick();assert.equal(f.calls.length,0);
  f.show();f.tick();assert.equal(f.calls.length,1);f.control.dispose();assert.equal(f.calls[0].signal.aborted,true);
  f.calls[0].resolve({works:[{...f.works[0],coverUrl:'/late'}]});await settle();assert.equal(f.works[0].coverUrl,'');assert.equal(f.tasks.size,0);
});
test('a new query cancels old media refresh and never merges the old response',async()=>{
  const f=fixture();f.control.watch('/api/discover?q=old',f.works);f.tick();f.control.reset();
  assert.equal(f.calls[0].signal.aborted,true);f.control.watch('/api/discover?q=new',f.works);f.tick();
  f.calls[0].resolve({works:[{...f.works[0],coverUrl:'/old'}]});await settle();assert.equal(f.works[0].coverUrl,'');
  f.calls[1].resolve({works:[{...f.works[0],coverUrl:'/new'}]});await settle();assert.equal(f.works[0].coverUrl,'/new');f.control.dispose();
});
test('pagination uses the original public page URLs and external works with a confirmed cover do not wait for unsupported videos',async()=>{
  const f=fixture({works:[{id:'first',source:'html'},{id:'second',source:'html'},{id:'external',source:'url',coverUrl:'/cover'}]});
  f.control.watch('/api/public/discover?limit=12',f.works.slice(0,1));f.control.watch('/api/public/discover?cursor=next',f.works.slice(1,2));f.control.watch('/external',f.works.slice(2));
  f.tick();f.calls[0].resolve({works:[]});await settle();f.tick();
  assert.deepEqual(f.calls.map(call=>call.url),['/api/public/discover?limit=12','/api/public/discover?cursor=next']);f.control.dispose();
});

test('an external work picks up its confirmed cover and then stops polling',async()=>{
 const f=fixture({works:[{id:'external',source:'url',coverUrl:''}]});f.control.watch('/api/public/discover',f.works);f.tick();
 f.calls[0].resolve({works:[{...f.works[0],coverUrl:'/confirmed'}]});await settle();assert.equal(f.works[0].coverUrl,'/confirmed');assert.equal(f.tasks.size,0);f.control.dispose();
});
