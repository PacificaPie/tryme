import test from 'node:test';
import assert from 'node:assert/strict';
import {mountDiscovery,clearDiscovery} from '../public/discovery.js';

// Minimal nodes for the real loading/empty/error branches. No masonry, network
// or fake production APIs are needed to exercise request races and teardown.
class Element {
  attributes=new Map();dataset={};listeners=new Map();nodes=[];textContent='';value='';hidden=false;disabled=false;isConnected=true;_html='';
  constructor(tag='div',attributes=''){
    this.tag=tag;this.classes=new Set();
    this.classList={toggle:(name,enabled)=>enabled?this.classes.add(name):this.classes.delete(name)};
    for(const match of attributes.matchAll(/([^\s=/>]+)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)')?/g))this.setAttribute(match[1],match[2]??match[3]??'');
    this.hidden=this.attributes.has('hidden');this.disabled=this.attributes.has('disabled');this.value=this.attributes.get('value')||'';
  }
  setAttribute(name,value){this.attributes.set(name,String(value));if(name==='class')this.classes=new Set(String(value).split(/\s+/));if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}
  focus(){this.focused=true;}
  getAttribute(name){return this.attributes.get(name)??null;}
  set innerHTML(value){this._html=value;this.nodes=this.parse(value);}
  get innerHTML(){return this._html;}
  parse(html){return [...html.matchAll(/<([a-z][\w:-]*)(\s[^>]*|)>/gi)].map(match=>new Element(match[1],match[2]));}
  insertAdjacentHTML(_position,html){this._html+=html;this.nodes.push(...this.parse(html));}
  matches(selector){return selector[0]==='#'?this.attributes.get('id')===selector.slice(1):selector[0]==='.'?this.classes.has(selector.slice(1)):selector[0]==='['?this.attributes.has(selector.slice(1,-1)):this.tag===selector;}
  closest(selector){return this.matches(selector)?this:null;}
  querySelectorAll(selector){return this.nodes.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(handler);}
  fire(type,target=this){for(const handler of this.listeners.get(type)||[])handler({target});}
}
const settle=async()=>{for(let i=0;i<4;i++)await Promise.resolve();};
const empty=()=>({works:[],nextCursor:null,total:0});
function fixture(t){
  clearDiscovery();
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
  let now=0,sequence=0;const timers=new Map(),calls=[],queries=[],social=[],root=new Element();
  globalThis.setTimeout=(callback,delay)=>{const id=++sequence;timers.set(id,{callback,at:now+delay});return id;};
  globalThis.clearTimeout=id=>timers.delete(id);
  t.after(()=>{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;clearDiscovery();});
  function tick(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}}
  const api=(url,options)=>new Promise((resolve,reject)=>calls.push({url,signal:options.signal,resolve,reject}));
  const mount=()=>mountDiscovery(root,{api,esc:String,workTile:()=>{throw Error('These tests only render empty results');},syncSocial:work=>social.push(work),userId:'loading-test',onQuery:query=>queries.push({...query}),restoreScroll(){}});
  const results=()=>root.querySelector('#discovery-results'),status=()=>root.querySelector('.feed-status'),retry=()=>results().querySelector('[data-retry]'),refresh=()=>root.querySelector('.feed-refresh');
  return{root,calls,queries,social,timers,tick,mount,results,status,retry,refresh};
}

test('first request does not delay disposal; disposing aborts it and ignores its late rejection and timeout',async t=>{
  const f=fixture(t);let panel;
  const mounted=f.mount().then(value=>{panel=value;});
  await settle();
  assert.equal(f.calls.length,1);assert.equal(typeof panel?.dispose,'function','Disposal must be available before the API response');
  await mounted;
  const request=f.calls[0],lateTimeout=[...f.timers.values()][0].callback,html=f.results().innerHTML,status=f.status().textContent;
  assert.equal(request.signal.aborted,false);panel.dispose();
  assert.equal(request.signal.aborted,true);assert.equal(f.timers.size,0);
  request.reject(new Error('The old request failed after leaving Feed'));lateTimeout();await settle();
  assert.equal(f.results().innerHTML,html);assert.equal(f.status().textContent,status);
});

test('a pending request becomes retryable at 6.5 seconds, and successful completion clears the slow timer',async t=>{
  const f=fixture(t),panel=await f.mount();t.after(()=>panel.dispose());
  assert.equal(f.retry().hidden,true);assert.equal(f.refresh().disabled,true);assert.equal(f.results().getAttribute('aria-busy'),'true');
  f.tick(6499);assert.equal(f.retry().hidden,true);assert.equal(f.refresh().disabled,true);
  f.tick(1);assert.equal(f.retry().hidden,false);assert.equal(f.refresh().disabled,false);assert.match(f.status().textContent,/重试/);
  f.calls[0].resolve(empty());await settle();
  assert.equal(f.results().getAttribute('aria-busy'),'false');assert.equal(f.retry(),null);assert.equal(f.status().textContent,'');assert.equal(f.timers.size,0);
  assert.match(f.results().innerHTML,/还没有作品/);
});

test('retry aborts the old request; its late error cannot replace the new successful empty result',async t=>{
  const f=fixture(t),panel=await f.mount();t.after(()=>panel.dispose());
  const old=f.calls[0],oldTimeout=[...f.timers.values()][0].callback;
  f.tick(6500);f.results().fire('click',f.retry());
  assert.equal(old.signal.aborted,true);assert.equal(f.calls.length,2);assert.equal(f.calls[1].signal.aborted,false);
  assert.equal(f.retry().hidden,true);assert.equal(f.refresh().disabled,true);
  f.calls[1].resolve(empty());await settle();const html=f.results().innerHTML;
  old.reject(new Error('Obsolete retry error'));oldTimeout();await settle();f.tick(6500);
  assert.equal(f.results().innerHTML,html);assert.equal(f.status().textContent,'');assert.equal(f.results().getAttribute('aria-busy'),'false');assert.equal(f.timers.size,0);
});

test('changing a filter aborts the prior query; its late success cannot overwrite the new query error',async t=>{
  const f=fixture(t),panel=await f.mount();t.after(()=>panel.dispose());
  const old=f.calls[0],filter=f.root.querySelectorAll('[data-filter]').find(button=>button.dataset.filter==='url');
  filter.fire('click');
  assert.equal(old.signal.aborted,true);assert.equal(f.calls.length,2);
  assert.equal(new URL(f.calls[1].url,'https://funtrack.test').searchParams.get('source'),'url');assert.equal(f.queries.at(-1).source,'url');assert.equal(filter.getAttribute('aria-pressed'),'true');
  f.calls[1].reject(new Error('Only the new filter failed'));await settle();
  const html=f.results().innerHTML,status=f.status().textContent;
  assert.equal(status,'Only the new filter failed');assert.match(html,/暂时没能加载作品/);assert(f.retry());
  old.resolve(empty());await settle();
  assert.equal(f.results().innerHTML,html);assert.equal(f.status().textContent,status);assert.equal(f.results().getAttribute('aria-busy'),'false');assert.equal(f.timers.size,0);
});


test('sort selection updates its label and URL once, retains filters, and ignores a late previous response',async t=>{
  const f=fixture(t),panel=await f.mount();t.after(()=>panel.dispose());
  const search=f.root.querySelector('#work-search');search.value=' rain ';
  f.root.querySelectorAll('[data-filter]').find(b=>b.dataset.filter==='html').fire('click');
  const previous=f.calls.at(-1),sort=f.root.querySelectorAll('[data-sort]').find(b=>b.dataset.sort==='likes');
  sort.fire('click');
  const current=f.calls.at(-1),params=new URL(current.url,'https://funtrack.test').searchParams;
  assert.equal(previous.signal.aborted,true);assert.equal(params.get('sort'),'likes');assert.equal(params.get('q'),'rain');assert.equal(params.get('source'),'html');
  assert.equal(f.queries.at(-1).sort,'likes');assert.equal(f.root.querySelector('#work-sort-label').textContent,'最多点赞');
  assert.equal(sort.getAttribute('aria-pressed'),'true');assert.equal(f.root.querySelectorAll('[data-sort]').filter(b=>b.getAttribute('aria-pressed')==='true').length,1);
  assert.equal(f.root.querySelector('.feed-sort-menu').open,false);assert.equal(f.root.querySelector('#work-sort').focused,true);
  const count=f.calls.length;sort.fire('click');assert.equal(f.calls.length,count);
  current.resolve(empty());await settle();const html=f.results().innerHTML;
  previous.reject(new Error('Late obsolete sorting error'));await settle();assert.equal(f.results().innerHTML,html);assert.equal(f.status().textContent,'');
});
