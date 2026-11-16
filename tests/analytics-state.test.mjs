import test from 'node:test';
import assert from 'node:assert/strict';
import {mountAnalytics} from '../public/analytics.js';
import {setLocale} from '../public/i18n.js';

// A narrow DOM adapter observes module behavior without network fixtures or
// production-only hooks. Browser coverage owns layout and real SVG geometry.
function panelDOM() {
  const nodes=new Map();
  const make=()=>({innerHTML:'',textContent:'',value:'',hidden:false,clientWidth:800,attributes:{},listeners:new Map(),
    classList:{values:new Set(),add(...names){names.forEach(name=>this.values.add(name));},remove(...names){names.forEach(name=>this.values.delete(name));},toggle(name,on){if(on)this.values.add(name);else this.values.delete(name);},contains(name){return this.values.has(name);}},
    setAttribute(key,value){this.attributes[key]=String(value);},removeAttribute(key){delete this.attributes[key];},
    addEventListener(name,handler){this.listeners.set(name,handler);},removeEventListener(name){this.listeners.delete(name);},
    querySelector:selector=>node(selector),querySelectorAll:()=>[],contains:()=>true,focus(){},
  });
  const node=selector=>{if(!nodes.has(selector))nodes.set(selector,make());return nodes.get(selector);};
  const root=make();root.isConnected=true;
  return {root,node,click(attributes){const button={dataset:Object.fromEntries(Object.entries(attributes).map(([key,value])=>[key.replace(/^data-/,'').replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),value])),hasAttribute:key=>key in attributes,closest(){return this;}};root.listeners.get('click')({target:button});}};
}
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const work={id:'work-one',name:'我的游戏',source:'html'};
const response=()=>({meta:{from:'2026-11-10',to:'2026-11-16',previousFrom:'2026-11-03',previousTo:'2026-11-09',granularity:'day'},summary:{pv:0,uv:0,players:0,avgActiveMs:null},previous:{pv:0,uv:0,players:0,avgActiveMs:null},series:[{date:'2026-11-16',pv:0,uv:0,players:0,avgActiveMs:null}],byWork:[{workId:work.id,name:work.name,source:'html',pv:0,uv:0,players:0,avgActiveMs:null}],coverage:{},versions:[]});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('an author with no works sees one publish action without empty statistics or an analytics request',async()=>{
  let calls=0;
  for(const locale of ['zh-CN','en']) {
    setLocale(locale);
    const {root,node}=panelDOM();
    const panel=await mountAnalytics(root,{works:[],esc,api:async()=>{calls++;return response();}});
    const html=node('.an-content').innerHTML;
    assert.equal(root.classList.contains('is-empty'),true);
    assert.match(html,/<svg[^>]+aria-hidden="true"/);
    assert.equal((html.match(/href="#\/publish"/g)||[]).length,1);
    assert.doesNotMatch(html,/an-metrics|an-chart-host/);
    assert.match(html,locale==='en'?/No works yet/:/还没有作品/);
    assert.equal(node('.an-content').attributes['aria-busy'],'false');
    panel.dispose();
  }
  setLocale('zh-CN');assert.equal(calls,0);
});
test('a first request uses a skeleton, then a published work with zero visits keeps real zero metrics and a zero trend',async()=>{
  const {root,node}=panelDOM(),request=deferred();
  const mounting=mountAnalytics(root,{works:[work],esc,api:()=>request.promise});
  assert.match(node('.an-content').innerHTML,/an-loading/);
  assert.equal(node('.an-content').attributes['aria-busy'],'true');
  assert.equal(root.classList.contains('is-loading'),true);
  request.resolve(response());const panel=await mounting;
  assert.equal(root.classList.contains('is-empty'),false);
  assert.match(node('.an-content').innerHTML,/an-metrics/);
  assert.match(node('.an-content').innerHTML,/<strong class="">0<\/strong>/);
  assert.match(node('.an-chart-host').innerHTML,/class="an-trend-dot"/);
  assert.doesNotMatch(node('.an-chart-host').innerHTML,/an-chart-empty/);
  assert.match(node('.an-work-table').innerHTML,/我的游戏/);
  assert.equal(node('.an-content').attributes['aria-busy'],'false');panel.dispose();
});
test('same-query refresh preserves the rendered data; failure provides retry without replacing it',async()=>{
  const {root,node}=panelDOM(),request=deferred();let calls=0;
  const panel=await mountAnalytics(root,{works:[work],esc,api:()=>++calls===1?Promise.resolve(response()):request.promise});
  const prior=node('.an-content').innerHTML;
  const refreshing=panel.refresh();
  assert.equal(node('.an-content').innerHTML,prior);
  assert.equal(node('.an-content').attributes['aria-busy'],'true');
  assert.equal(root.classList.contains('is-loading'),true);
  request.reject(new Error('offline'));await refreshing;
  assert.equal(node('.an-content').innerHTML,prior);
  assert.match(node('.an-request-status').innerHTML,/data-an-retry/);
  assert.match(node('.an-request-status').innerHTML,/上次数据/);
  assert.equal(node('.an-content').attributes['aria-busy'],'false');panel.dispose();
});
test('initial load failure has a retry action and never masquerades as no works',async()=>{
  const {root,node}=panelDOM();
  const panel=await mountAnalytics(root,{works:[work],esc,api:async()=>{throw new Error('offline');}});
  assert.match(node('.an-content').innerHTML,/an-error/);
  assert.match(node('.an-content').innerHTML,/data-an-retry/);
  assert.equal(root.classList.contains('is-empty'),false);
  assert.equal(root.classList.contains('is-loading'),false);panel.dispose();
});
test('changing the reporting scope does not label old data as the newly selected period',async()=>{
  const {root,node,click}=panelDOM(),request=deferred();let calls=0;
  const panel=await mountAnalytics(root,{works:[work],esc,api:()=>++calls===1?Promise.resolve(response()):request.promise});
  click({'data-an-days':'30'});
  assert.match(node('.an-content').innerHTML,/an-loading/);
  assert.doesNotMatch(node('.an-content').innerHTML,/an-metrics/);
  panel.dispose();request.resolve(response());await Promise.resolve();
  assert.match(node('.an-content').innerHTML,/an-loading/); // Disposed response cannot draw over a new route.
});
