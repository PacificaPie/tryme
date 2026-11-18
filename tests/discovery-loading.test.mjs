import test from 'node:test';
import assert from 'node:assert/strict';
import {mountDiscovery,clearDiscovery} from '../public/discovery.js';

// Minimal nodes for request races and page composition. Layout has zero width,
// so these tests use the real loading/rendering code without simulating pixels.
class Element {
  attributes=new Map();dataset={};listeners=new Map();nodes=[];textContent='';value='';hidden=false;disabled=false;isConnected=true;_html='';style={setProperty(){}};
  constructor(tag='div',attributes=''){
    this.tag=tag;this.classes=new Set();
    this.classList={toggle:(name,enabled)=>enabled?this.classes.add(name):this.classes.delete(name),add:name=>this.classes.add(name)};
    for(const match of attributes.matchAll(/([^\s=/>]+)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)')?/g))this.setAttribute(match[1],match[2]??match[3]??'');
    this.hidden=this.attributes.has('hidden');this.disabled=this.attributes.has('disabled');this.value=this.attributes.get('value')||'';
  }
  setAttribute(name,value){this.attributes.set(name,String(value));if(name==='class')this.classes=new Set(String(value).split(/\s+/));if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}
  focus(){this.focused=true;}
  getAttribute(name){return this.attributes.get(name)??null;}
  set innerHTML(value){this._html=value;this.nodes=this.parse(value);}
  get innerHTML(){return this._html;}
  get children(){return this.nodes;}
  get content(){return {firstElementChild:this.nodes[0]||null};}
  insertBefore(node,before){node.remove();const index=this.nodes.indexOf(before);this.nodes.splice(index<0?this.nodes.length:index,0,node);node.parentNode=this;}
  remove(){if(this.parentNode){const nodes=this.parentNode.nodes;nodes.splice(nodes.indexOf(this),1);this.parentNode=null;}}
  replaceWith(node){if(this.parentNode){const parent=this.parentNode,index=parent.nodes.indexOf(this);parent.nodes[index]=node;node.parentNode=parent;this.parentNode=null;}}
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
  const originalDOM=Object.fromEntries(['document','window','requestAnimationFrame','cancelAnimationFrame'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let now=0,sequence=0;const timers=new Map(),frames=new Map(),calls=[],queries=[],social=[],panels=[],root=new Element();
  globalThis.document={createElement:tag=>new Element(tag)};
  globalThis.window={addEventListener(){},removeEventListener(){}};
  globalThis.requestAnimationFrame=callback=>{const id=++sequence;frames.set(id,callback);return id;};
  globalThis.cancelAnimationFrame=id=>frames.delete(id);
  globalThis.setTimeout=(callback,delay)=>{const id=++sequence;timers.set(id,{callback,at:now+delay});return id;};
  globalThis.clearTimeout=id=>timers.delete(id);
  t.after(()=>{panels.forEach(panel=>panel.dispose());globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;for(const [key,descriptor]of Object.entries(originalDOM)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}clearDiscovery();});
  function tick(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}}
  const api=(url,options)=>new Promise((resolve,reject)=>calls.push({url,signal:options.signal,resolve,reject}));
  const mount=async(options={},target=root)=>{const panel=await mountDiscovery(target,{api,esc:String,workTile:work=>`<article data-rendered-work="${work.id}"></article>`,syncSocial:work=>social.push(work),userId:'loading-test',onQuery:query=>queries.push({...query}),restoreScroll(){},...options});panels.push(panel);return panel;};
  const results=()=>root.querySelector('#discovery-results'),status=()=>root.querySelector('.feed-status'),retry=()=>results().querySelector('[data-retry]'),refresh=()=>root.querySelector('.feed-refresh');
  return{root,calls,queries,social,timers,frames,tick,mount,results,status,retry,refresh};
}

test('Feed automatically fills a completed cover and retains pagination, likes, title and restored cache',async t=>{
  const f=fixture(t),rendered=[];
  const options={userId:null,workTile:work=>{rendered.push({...work});return `<article data-rendered-work="${work.id}"></article>`;}};
  const panel=await f.mount(options);
  const work={id:'pending-cover',source:'html',coverUrl:'',name:'Current name',likesCount:4};
  f.calls[0].resolve({works:[work],total:20,nextCursor:'page-two'});await settle();
  f.tick(15000);assert.equal(f.calls.length,2);assert(f.calls[1].url.startsWith('/api/public/discover?'));
  f.calls[1].resolve({works:[{...work,coverUrl:'/api/public/works/pending-cover/cover',name:'Stale name',likesCount:0}],total:1,nextCursor:null});await settle();
  assert.equal(rendered.at(-1).coverUrl,'/api/public/works/pending-cover/cover');assert.equal(rendered.at(-1).name,'Current name');assert.equal(rendered.at(-1).likesCount,4);
  assert.equal(f.root.querySelector('#load-works').hidden,false);assert.equal(f.status().textContent,'');
  panel.dispose();await f.mount(options,new Element());assert.equal(f.calls.length,2);assert.equal(rendered.at(-1).coverUrl,'/api/public/works/pending-cover/cover');
});

test('guest Feed uses public reads, keeps search/sort/pagination and gates following without private or impression calls',async t=>{
  const f=fixture(t),tiles=[];let prompts=0;
  await f.mount({userId:null,onSignIn:()=>prompts++,workTile:(work,options)=>{tiles.push(options);return `<article data-rendered-work="${work.id}"></article>`;}});
  assert(f.calls[0].url.startsWith('/api/public/discover?'));assert(!f.calls[0].url.includes('following='));
  f.calls[0].resolve({works:[{id:'public-work-1',name:'Public game'}],nextCursor:'page-two',total:2});await settle();
  assert.deepEqual(tiles,[{social:false}]);assert.deepEqual(f.social,[]);assert.equal(f.timers.size,0,'Guest views do not start impression timers');
  f.root.querySelectorAll('[data-feed-scope]').find(b=>b.dataset.feedScope==='1').fire('click');
  assert.equal(prompts,1);assert.equal(f.calls.length,1);assert.deepEqual(f.queries,[]);
  f.root.querySelector('#load-works').fire('click');assert(f.calls[1].url.includes('cursor=page-two'));
  f.calls[1].resolve({works:[{id:'public-work-2'}],nextCursor:null,total:2});await settle();
  const search=f.root.querySelector('#work-search');search.value='rain';
  f.root.querySelectorAll('[data-sort]').find(b=>b.dataset.sort==='newest').fire('click');
  const query=new URL(f.calls[2].url,'https://site.test');assert.equal(query.pathname,'/api/public/discover');assert.equal(query.searchParams.get('q'),'rain');assert.equal(query.searchParams.get('sort'),'newest');
  f.calls[2].resolve(empty());await settle();assert(f.calls.every(call=>call.url.startsWith('/api/public/discover?')));
});

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

test('switching Feed scope retains search/type/sort, cancels debounced search, and ignores the old scope response',async t=>{
  const f=fixture(t);await f.mount({initial:{q:'old',source:'html',sort:'comments'}});
  const old=f.calls[0],search=f.root.querySelector('#work-search');search.value=' rain ';search.fire('input');
  const scopes=f.root.querySelectorAll('[data-feed-scope]'),followed=scopes.find(button=>button.dataset.feedScope==='1');
  followed.fire('click');
  const params=new URL(f.calls[1].url,'https://funtrack.test').searchParams;
  assert.deepEqual(Object.fromEntries(params),{q:'rain',source:'html',sort:'comments',following:'1',limit:'12'});
  assert.equal(old.signal.aborted,true);assert.deepEqual(f.queries.at(-1),{q:'rain',source:'html',sort:'comments',following:'1'});
  assert.equal(followed.getAttribute('aria-pressed'),'true');assert.equal(scopes.filter(button=>button.getAttribute('aria-pressed')==='true').length,1);
  followed.fire('click');f.tick(250);assert.equal(f.calls.length,2,'A pending search or reselected scope must not issue another request');
  f.calls[1].resolve(empty());await settle();const html=f.results().innerHTML;
  old.resolve({works:[{id:'unfollowed-author-work'}],total:1,nextCursor:null});await settle();
  assert.equal(f.results().innerHTML,html);assert.equal(f.social.length,0,'Stale discovery results must not enter following state');
});

test('following empty state leads to creators; clearing filters retains following and the chosen order',async t=>{
  const f=fixture(t);await f.mount({initial:{following:'1',q:'rain',source:'url',sort:'likes'}});
  f.calls[0].resolve(empty());await settle();
  assert.match(f.results().innerHTML,/没有找到作品/);assert.doesNotMatch(f.results().innerHTML,/href="#\/publish"/);
  f.results().fire('click',f.results().querySelector('[data-clear]'));
  const params=new URL(f.calls[1].url,'https://funtrack.test').searchParams;
  assert.equal(params.get('following'),'1');assert.equal(params.get('q'),'');assert.equal(params.get('source'),'all');assert.equal(params.get('sort'),'likes');
  assert.equal(f.root.querySelector('#work-search').value,'');
  f.calls[1].resolve(empty());await settle();
  assert.match(f.results().innerHTML,/关注的人还没有公开作品/);assert.match(f.results().innerHTML,/href="#\/feed"/);assert.match(f.results().innerHTML,/发现作品/);
  assert.doesNotMatch(f.results().innerHTML,/href="#\/publish"/);
  f.root.querySelectorAll('[data-sort]').find(button=>button.dataset.sort==='newest').fire('click');
  f.root.querySelectorAll('[data-filter]').find(button=>button.dataset.filter==='html').fire('click');
  const changed=new URL(f.calls.at(-1).url,'https://funtrack.test').searchParams;
  assert.equal(changed.get('following'),'1');assert.equal(changed.get('sort'),'newest');assert.equal(changed.get('source'),'html');
});

test('Feed visit cache separates public/following scope and user identity, then restores the matching view',async t=>{
  const f=fixture(t);const publicPanel=await f.mount();
  f.calls[0].resolve(empty());await settle();publicPanel.dispose();
  const followingRoot=new Element(),followingPanel=await f.mount({initial:{following:'1'}},followingRoot);
  assert.equal(f.calls.length,2,'The public visit cannot populate a followed Feed');
  f.calls[1].resolve(empty());await settle();followingPanel.dispose();
  const otherRoot=new Element(),otherPanel=await f.mount({initial:{following:'1'},userId:'another-user'},otherRoot);
  assert.equal(f.calls.length,3,'Followed Feed cache is private to its user');otherPanel.dispose();
  let restores=0;const restoredRoot=new Element();await f.mount({initial:{following:'1'},restoreScroll:()=>restores++},restoredRoot);
  assert.equal(f.calls.length,3);assert.match(restoredRoot.querySelector('#discovery-results').innerHTML,/关注的人还没有公开作品/);
  for(const callback of f.frames.values())callback();assert.equal(restores,1);
});

test('worksOnly renders complete author results and cached results without Feed controls or duplicate creator heading',async t=>{
  const f=fixture(t),options={authorId:'creator one',worksOnly:true,initial:{following:'1'}};
  const panel=await f.mount(options);
  const params=new URL(f.calls[0].url,'https://funtrack.test').searchParams;
  assert.equal(params.get('author'),'creator one');assert.equal(params.get('following'),'0');assert.equal(params.get('sort'),'newest');
  for(const selector of ['#author-name','.author-heading','.feed-heading','.feed-scope','#work-search','[data-sort]','[data-filter]'])assert.equal(f.root.querySelector(selector),null,selector);
  const works=[{id:'first',authorName:'Saved creator'},{id:'not-featured-on-card',authorName:'Saved creator'}];
  f.calls[0].resolve({works,total:2,nextCursor:null});await settle();
  assert.equal(f.status().textContent,'');assert.deepEqual(f.social,works);
  assert.match(f.results().innerHTML,/全部作品/);assert.deepEqual(f.root.querySelector('.feed-grid').children.map(tile=>tile.dataset.workId),works.map(work=>work.id));
  assert.equal(f.root.querySelector('.feed-grid').children[1].getAttribute('aria-setsize'),'2');
  panel.dispose();const restoredRoot=new Element();await f.mount(options,restoredRoot);
  assert.equal(f.calls.length,1,'Returning to the creator restores the complete author query');
  assert.equal(restoredRoot.querySelector('.feed-status').textContent,'');assert.equal(restoredRoot.querySelector('#author-name'),null);
  assert.deepEqual(restoredRoot.querySelector('.feed-grid').children.map(tile=>tile.dataset.workId),['first','not-featured-on-card']);
});

test('empty worksOnly author view remains a clean public portfolio empty state',async t=>{
  const f=fixture(t);await f.mount({authorId:'empty-creator',worksOnly:true,initial:{following:'1'}});
  f.calls[0].resolve(empty());await settle();
  assert.match(f.results().innerHTML,/还没有公开作品/);assert.doesNotMatch(f.results().innerHTML,/发布作品|发现创作者|关注的人/);
  assert.equal(f.root.querySelector('#load-works').hidden,true);assert.equal(f.results().getAttribute('aria-busy'),'false');
});
