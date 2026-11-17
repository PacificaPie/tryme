import test from 'node:test';
import assert from 'node:assert/strict';
import { beginRouteLoading } from '../public/experience.js';

function fixture() {
  let now=0,id=0;
  const tasks=new Map(), attributes=new Map(), classes=new Set();
  const status={textContent:''}, retry={textContent:'',hidden:true};
  const root={inert:false,innerHTML:'current page',classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},setAttribute:(k,v)=>attributes.set(k,v),removeAttribute:k=>attributes.delete(k),querySelector:s=>s==='.loading-status'?status:retry};
  const timers={setTimeout(fn,delay){const key=++id;tasks.set(key,{fn,at:now+delay});return key;},clearTimeout:key=>tasks.delete(key)};
  function tick(ms){now+=ms;for(const [key,task] of [...tasks])if(task.at<=now){tasks.delete(key);task.fn();}}
  const begin=()=>beginRouteLoading(root,{html:'skeleton',slowText:'still loading',retryText:'retry',timers});
  return {root,status,retry,tasks,attributes,classes,tick,begin};
}
test('quick route results never flash a skeleton and release the old controls',()=>{
  const f=fixture(),finish=f.begin();
  assert.equal(f.root.inert,true);f.tick(100);finish();f.root.innerHTML='new page';f.tick(10000);
  assert.equal(f.root.innerHTML,'new page');assert.equal(f.root.inert,false);assert.equal(f.tasks.size,0);assert.equal(f.attributes.has('aria-busy'),false);
});
test('slow route shows a matching skeleton then a retry without a fictitious percentage',()=>{
  const f=fixture(),finish=f.begin();f.tick(160);
  assert.equal(f.root.innerHTML,'skeleton');assert.equal(f.root.inert,false);assert.equal(f.retry.hidden,true);
  f.tick(6340);assert.equal(f.status.textContent,'still loading');assert.equal(f.retry.hidden,false);assert.equal(f.retry.textContent,'retry');
  finish();assert.equal(f.classes.has('route-pending'),false);
});
test('disposing a route makes already queued callbacks harmless to its successor',()=>{
  const f=fixture(),finish=f.begin(),late=[...f.tasks.values()].map(task=>task.fn);
  finish();const finishNext=f.begin();f.root.innerHTML='next page waiting';
  late.forEach(fn=>fn());finish();assert.equal(f.root.innerHTML,'next page waiting');assert.equal(f.root.inert,true);
  finishNext();assert.equal(f.root.inert,false);
});
