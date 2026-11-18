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
function fakeTimers(){
  let now=0,next=0;const pending=new Map();
  return {pending,setTimeout(callback,delay){const id=++next;pending.set(id,{callback,at:now+delay});return id;},clearTimeout(id){pending.delete(id);},advance(ms){now+=ms;for(const [id,item] of [...pending])if(item.at<=now){pending.delete(id);item.callback();}}};
}

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
test('the visible play summary distinguishes no visitors, missing duration and unfinished sessions',async()=>{
  const {root,node}=panelDOM();
  const data=response();
  data.funnel={supported:true,visitors:0,opened:0,started:0};
  data.coverage={durationSamples:0,endedStarts:3,durationCoverage:0,unendedStarts:2};
  const panel=await mountAnalytics(root,{works:[work],esc,api:async()=>data});
  const html=node('.an-content').innerHTML;
  assert.match(html,/访客与试玩/);
  assert.match(html,/0 \/ 3 局已结束试玩/);
  assert.match(html,/另有 2 局尚未结束/);
  assert.match(html,/时长待采集/);
  assert.doesNotMatch(html,/% 的访客/); // A zero denominator does not become a claimed conversion rate.
  assert.match(html,/<strong class="an-duration-value">—<\/strong>/);
  panel.dispose();
});
test('a recorded zero play duration remains a measured sample, not missing duration',async()=>{
  const {root,node}=panelDOM();
  const data=response();data.summary.avgActiveMs=0;
  data.funnel={supported:true,visitors:1,opened:1,started:1};
  data.coverage={durationSamples:1,endedStarts:1,durationCoverage:1,unendedStarts:0};
  const panel=await mountAnalytics(root,{works:[work],esc,api:async()=>data});
  const html=node('.an-content').innerHTML;
  assert.match(html,/<strong class="an-duration-value">0 秒<\/strong>/);
  assert.match(html,/1 局样本/);assert.match(html,/1 \/ 1 局已结束试玩/);
  assert.doesNotMatch(html,/时长待采集/);
  panel.dispose();
});
test('external-only portfolios show outbound clicks without a fabricated play funnel',async()=>{
  const {root,node}=panelDOM();
  const data=response();data.byWork[0].source='url';data.summary.outboundClicks=4;
  data.funnel={supported:false,visitors:0,opened:0,started:0};
  const panel=await mountAnalytics(root,{works:[{...work,source:'url'}],esc,api:async()=>data});
  const html=node('.an-content').innerHTML;
  assert.match(html,/an-external-summary/);assert.match(html,/外链试玩数据未接入/);
  assert.doesNotMatch(html,/class="an-funnel"/);assert.doesNotMatch(html,/时长待采集/);
  panel.dispose();
});
test('a hanging initial request can be disposed before its response and leaves no slow-loading timer',async()=>{
  const {root,node}=panelDOM(),request=deferred(),timers=fakeTimers();let signal;
  const panel=await mountAnalytics(root,{works:[work],esc,timers,api:(_path,options)=>{signal=options.signal;return request.promise;}});
  assert.match(node('.an-content').innerHTML,/an-loading/);
  assert.equal(signal.aborted,false);assert.equal(timers.pending.size,1);
  panel.dispose();assert.equal(signal.aborted,true);assert.equal(timers.pending.size,0);
  request.resolve(response());await Promise.resolve();
  assert.match(node('.an-content').innerHTML,/an-loading/);
  assert.doesNotMatch(node('.an-content').innerHTML,/an-metrics/);
});
test('slow loading offers retry and an older response cannot replace the retried result',async()=>{
  const {root,node,click}=panelDOM(),first=deferred(),second=deferred(),timers=fakeTimers(),signals=[];
  const panel=await mountAnalytics(root,{works:[work],esc,timers,api:(_path,options)=>{signals.push(options.signal);return signals.length===1?first.promise:second.promise;}});
  timers.advance(6499);assert.doesNotMatch(node('.an-request-status').innerHTML,/data-an-retry/);
  timers.advance(1);assert.match(node('.an-request-status').innerHTML,/data-an-retry/);
  assert.match(node('.an-request-status').innerHTML,/仍|还在加载/);assert.equal(root.classList.contains('is-loading'),true);
  click({'data-an-retry':''});assert.equal(signals.length,2);assert.equal(signals[0].aborted,true);
  const latest=response();latest.summary.pv=19;second.resolve(latest);await Promise.resolve();
  assert.match(node('.an-content').innerHTML,/<strong class="">19<\/strong>/);
  const stale=response();stale.summary.pv=1000;first.resolve(stale);await Promise.resolve();
  assert.match(node('.an-content').innerHTML,/<strong class="">19<\/strong>/);
  assert.doesNotMatch(node('.an-content').innerHTML,/<strong class="">1,000<\/strong>/);
  assert.equal(timers.pending.size,0);assert.equal(node('.an-content').attributes['aria-busy'],'false');panel.dispose();
});
test('archiving labels a work without hiding its historical analytics or changing the reporting scope',async()=>{
  const {root,node}=panelDOM(),data=response();let requested;
  data.byWork[0].archivedAt='2026-11-17T00:00:00Z';data.byWork[0].pv=12;data.summary.pv=12;
  const panel=await mountAnalytics(root,{works:[{...work,archivedAt:data.byWork[0].archivedAt}],esc,api:async path=>{requested=path;return data;}});
  assert.match(node('[data-an-work]').innerHTML,/我的游戏 · 已归档/);
  assert.match(node('.an-work-table').innerHTML,/work-archived/);
  assert.match(node('.an-content').innerHTML,/<strong class="">12<\/strong>/);
  assert.doesNotMatch(requested,/state=active|archived=/);
  assert.equal(root.classList.contains('is-empty'),false);panel.dispose();
});

test('external drilldown replaces play KPIs and normalizes a bookmarked play metric',async()=>{
  const {root,node}=panelDOM(),queries=[];
  const external={...work,source:'url'},result=response();result.funnel={supported:false};result.summary.outboundClicks=7;result.byWork[0]={...result.byWork[0],source:'url',outboundClicks:7};
  const panel=await mountAnalytics(root,{works:[external],esc,initial:{work:work.id,metric:'avgActiveMs',sort:'players'},onQuery:q=>queries.push(q),api:async()=>result});
  const content=node('.an-content').innerHTML;
  assert.match(content,/data-an-metric="outboundClicks"/);
  assert.doesNotMatch(content,/data-an-metric="players"|option value="avgActiveMs"/);
  assert.doesNotMatch(node('.an-secondary-content').innerHTML,/开始试玩次数/);
  assert.match(node('.an-work-table').innerHTML,/data-an-sort="outboundClicks"/);
  assert.doesNotMatch(node('.an-work-table').innerHTML,/data-an-sort="players"/);
  assert.equal(queries.at(-1).metric,'outboundClicks');assert.equal(queries.at(-1).sort,undefined);
  panel.dispose();
});
