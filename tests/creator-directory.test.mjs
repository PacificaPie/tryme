import test from 'node:test';
import assert from 'node:assert/strict';
import {mountCreatorDirectory} from '../public/creator-directory.js';

// Small event/query surface for the actual directory lifecycle and requests.
class Element {
  attributes=new Map();dataset={};classes=new Set();listeners=new Map();nodes=[];hidden=false;disabled=false;isConnected=true;textContent='';_html='';
  constructor(tag='div',attributes=''){
    this.tag=tag;
    for(const match of attributes.matchAll(/([^\s=/>]+)(?:\s*=\s*"([^"]*)")?/g))this.setAttribute(match[1],match[2]??'');
    this.hidden=this.attributes.has('hidden');
  }
  setAttribute(name,value){this.attributes.set(name,String(value));if(name==='class')this.classes=new Set(String(value).split(/\s+/));if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);}
  getAttribute(name){return this.attributes.get(name)??null;}
  set innerHTML(value){this._html=value;this.nodes=[...value.matchAll(/<([a-z][\w:-]*)(\s[^>]*|)>/gi)].map(match=>new Element(match[1],match[2]));}
  get innerHTML(){return this._html;}
  matches(selector){return selector[0]==='.'?this.classes.has(selector.slice(1)):selector[0]==='['?this.attributes.has(selector.slice(1,-1)):this.tag===selector;}
  closest(selector){return this.matches(selector)?this:null;}
  querySelectorAll(selector){return this.nodes.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(type,handler){this.listeners.set(type,handler);}
  fire(type,target=this){return this.listeners.get(type)?.({target});}
}
const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const settle=async()=>{for(let i=0;i<4;i++)await Promise.resolve();};
const person=(id,patch={})=>({id,name:'Creator '+id,headline:'Makes small things',worksCount:2,avatarUrl:'/avatars/sprout.svg',...patch});
const page=(creators=[],nextAfter=null)=>({creators,nextAfter});
const params=request=>new URL(request.url,'https://funtrack.test').searchParams;
function fixture(t,options={}){
  const root=new Element(),calls=[],queries=[];
  const panel=mountCreatorDirectory(root,{api:(url,options)=>new Promise((resolve,reject)=>calls.push({url,signal:options.signal,resolve,reject})),esc:escape,me:{id:'mine'},onQuery:value=>queries.push(value),...options});
  t.after(()=>panel.dispose());
  const results=()=>root.querySelector('.creator-directory-results'),more=()=>root.querySelector('[data-more]');
  const scope=value=>root.querySelectorAll('[data-creators]').find(button=>button.dataset.creators===value);
  return {root,calls,queries,panel,results,more,scope};
}

test('directory shows creator identities, safe avatars and profile links even without a public card',async t=>{
  const f=fixture(t);
  assert.equal(params(f.calls[0]).get('limit'),'48');assert.equal(params(f.calls[0]).get('following'),null);
  f.calls[0].resolve(page([person('mine'),person('a/b',{name:'<img onerror="bad">',headline:'<script>bad</script>',followedByMe:true}),person('no-card',{worksCount:0,avatarUrl:'https://tracker.test/image',headline:'',bio:'A new maker'})]));await settle();
  const html=f.results().innerHTML;
  assert.equal(f.results().querySelectorAll('.creator-person').length,3);assert.match(html,/href="#\/author\/a%2Fb"/);
  assert.match(html,/&lt;img onerror=&quot;bad&quot;&gt;/);assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>|<img onerror/);
  assert.match(html,/\/avatars\/sprout.svg/);assert.doesNotMatch(html,/tracker.test/);assert.match(html,/我的主页/);assert.match(html,/已关注/);assert.match(html,/A new maker/);
  assert.match(html,/href="#\/author\/no-card"/);assert.equal(f.results().getAttribute('aria-busy'),'false');assert.equal(f.more().hidden,true);
});

test('directory scope changes abort old pagination, clear its cursor, and ignore responses from the old scope',async t=>{
  const f=fixture(t);f.calls[0].resolve(page([person('public')],'all-cursor'));await settle();
  f.more().fire('click');assert.equal(params(f.calls[1]).get('after'),'all-cursor');
  const old=f.calls[1],following=f.scope('following');f.root.fire('click',following);
  assert.equal(old.signal.aborted,true);assert.equal(params(f.calls[2]).get('following'),'1');assert.equal(params(f.calls[2]).get('after'),null);
  assert.deepEqual(f.queries,[true]);assert.equal(following.getAttribute('aria-pressed'),'true');assert.equal(f.scope('all').getAttribute('aria-pressed'),'false');
  f.root.fire('click',following);assert.equal(f.calls.length,3,'Reselecting the active scope must not reload it');
  f.calls[2].resolve(page([person('followed',{followedByMe:true})],'followed-cursor'));await settle();const html=f.results().innerHTML;
  old.resolve(page([person('stale-public')],'stale-cursor'));await settle();assert.equal(f.results().innerHTML,html);
  assert.doesNotMatch(html,/Creator public|stale-public/);assert.match(html,/Creator followed/);
  f.more().fire('click');assert.equal(params(f.calls[3]).get('after'),'followed-cursor');assert.equal(params(f.calls[3]).get('following'),'1');
});

test('directory pagination keeps visible people on failure and retries the same cursor without duplicate creators',async t=>{
  const f=fixture(t,{following:true});f.calls[0].resolve(page([person('first')],'next-page'));await settle();
  f.more().fire('click');f.more().fire('click');assert.equal(f.calls.length,2);assert.equal(f.more().disabled,true);
  f.calls[1].reject(new Error('Connection interrupted <retry>'));await settle();
  assert.match(f.results().innerHTML,/Creator first/);assert.match(f.results().innerHTML,/role="alert"/);assert.match(f.results().innerHTML,/&lt;retry&gt;/);
  assert.equal(f.more().hidden,false);assert.equal(f.more().disabled,false);assert.equal(f.more().textContent,'重试加载');
  f.more().fire('click');assert.equal(params(f.calls[2]).get('after'),'next-page');assert.equal(params(f.calls[2]).get('following'),'1');
  f.calls[2].resolve(page([person('first'),person('second')],null));await settle();
  assert.equal(f.results().querySelectorAll('.creator-person').length,2);assert.equal((f.results().innerHTML.match(/Creator first/g)||[]).length,1);
  assert.match(f.results().innerHTML,/Creator second/);assert.doesNotMatch(f.results().innerHTML,/role="alert"/);assert.equal(f.more().hidden,true);
});

test('empty followed directory can discover everyone; a failed initial load retries in its current scope',async t=>{
  const f=fixture(t,{following:true});assert.equal(f.scope('following').getAttribute('aria-pressed'),'true');
  f.calls[0].reject(new Error('Could not load'));await settle();assert.match(f.results().innerHTML,/暂时没能加载创作者/);
  f.root.fire('click',f.results().querySelector('[data-retry]'));assert.equal(params(f.calls[1]).get('following'),'1');
  f.calls[1].resolve(page());await settle();assert.match(f.results().innerHTML,/还没有关注创作者/);
  f.root.fire('click',f.results().querySelector('[data-discover]'));
  assert.equal(params(f.calls[2]).get('following'),null);assert.deepEqual(f.queries,[false]);
  f.calls[2].resolve(page());await settle();assert.match(f.results().innerHTML,/还没有公开的创作者/);assert.match(f.results().innerHTML,/href="#\/publish"/);
});

test('directory disposal aborts an in-flight load and prevents late completion from changing the old page',async t=>{
  const f=fixture(t),html=f.results().innerHTML;f.panel.dispose();assert.equal(f.calls[0].signal.aborted,true);
  f.calls[0].resolve(page([person('too-late')]));await settle();assert.equal(f.results().innerHTML,html);
});
