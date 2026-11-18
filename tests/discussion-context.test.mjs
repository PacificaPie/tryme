import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mountDiscussion, discussionDraftKey, commentVersionLabel, commentHref } from '../public/discussion.js';
import { getLocale, setLocale } from '../public/i18n.js';

class Node {
  constructor(){this._html='';this.value='';this.style={};this.hidden=false;this.disabled=false;this.isConnected=true;this.scrollHeight=30;this.events=new Map();this.children=new Map();this.classes=new Set();this.classList={add:value=>this.classes.add(value),toggle:(value,on)=>on?this.classes.add(value):this.classes.delete(value)};}
  get innerHTML(){return this._html;}
  set innerHTML(value){if(this.contains(globalThis.document?.activeElement)&&globalThis.document.activeElement!==this)globalThis.document.activeElement=null;for(const child of this.children.values())child.isConnected=false;this.children.clear();this._html=value;}
  contains(node){return node===this||[...this.children.values()].some(child=>child.contains(node));}
  querySelector(selector){if(selector.startsWith('[id=')){const id=selector.match(/\[id="([^"]+)"\]/)?.[1];if(!id||!this.innerHTML.includes(`id="${id}"`))return null;}
    if(!this.children.has(selector)){const child=new Node();child.id=selector.match(/\[id="([^"]+)"\]/)?.[1]||'';this.children.set(selector,child);}return this.children.get(selector);}
  addEventListener(name,handler){const list=this.events.get(name)||[];list.push(handler);this.events.set(name,list);}
  async emit(name,event={}){for(const handler of this.events.get(name)||[])await handler({preventDefault(){},...event});}
  focus(){globalThis.document.activeElement=this;this.focused=true;}
  scrollIntoView(){this.scrolled=true;}
}
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function environment(t){
  const previous={document:globalThis.document,window:globalThis.window,sessionStorage:globalThis.sessionStorage,CSS:globalThis.CSS};
  const saved=new Map();globalThis.document={activeElement:null};globalThis.window={matchMedia:()=>({matches:true})};globalThis.CSS={escape:value=>value};
  globalThis.sessionStorage={getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)};
  t.after(()=>{for(const [key,value]of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;});return saved;
}
function mounted({work,user,api,focusId='',beforeRootSubmit,timers}){
  const element=new Node();const panel=mountDiscussion(element,{work,user,api,esc:escape,focusId,beforeRootSubmit,timers});
  return {panel,element,form:element.querySelector('form'),input:element.querySelector('textarea'),list:element.querySelector('.comment-list'),context:element.querySelector('.comment-context'),more:element.querySelector('.comments-more'),status:element.querySelector('.comment-status')};
}
const user=()=>({id:randomUUID(),name:'Reader'});
const work=()=>({id:randomUUID(),versionId:'version-v1',version:'v1'});
const comment=(w,u,extra={})=>({id:randomUUID(),workId:w.id,authorId:u.id,authorName:u.name,parentId:null,body:'A comment',versionId:w.versionId,version:w.version,createdAt:'2026-11-17T00:00:00.000Z',likesCount:0,likedByMe:false,...extra});
const eventFor=(selector,data)=>({target:{closest:query=>query===selector?{dataset:data}:null}});

test('versioned comments keep profile avatars in the composer, discussion and exact context',async t=>{
  environment(t);const w=work(),u={...user(),avatarUrl:'/avatars/moon.svg'};
  const root=comment(w,u,{authorName:'Current profile',authorAvatarUrl:'/avatars/sprout.svg'});
  const api=async path=>path.endsWith('/context')
    ?{workId:w.id,targetId:root.id,contextOnly:true,thread:{...root,replies:[],repliesNextCursor:null}}
    :{comments:[{...root,replies:[],repliesNextCursor:null}],commentsCount:1,nextCursor:null};
  const view=mounted({work:w,user:u,api,focusId:root.id});await tick();
  assert.match(view.element.innerHTML,/src="\/avatars\/moon\.svg"/);
  for(const markup of [view.list.innerHTML,view.context.innerHTML]){
    assert.match(markup,/src="\/avatars\/sprout\.svg"/);
    assert.match(markup,/class="comment-version"/);assert.match(markup,/>v1<\/span>/);
    assert(markup.includes('#/author/'+u.id));
  }
  assert(view.context.querySelector(`[id="context-comment-${root.id}"]`).focused);
});

test('root comment captures the page version, and a lost response retries the same version/key',async t=>{
  environment(t);const w=work(),u=user(),posted=[];let release;const beforeRootSubmit=()=>new Promise(resolve=>{release=resolve;});
  const api=async(path,options)=>{
    if(!options?.method)return {comments:[],commentsCount:0,nextCursor:null};
    posted.push(options);if(posted.length===1)throw Error('response lost');
    return {comment:comment(w,u,{...options.body,version:'v1'}),commentsCount:1};
  };
  const view=mounted({work:w,user:u,api,beforeRootSubmit});await tick();view.input.value='Fixed old version';await view.form.emit('input');
  const first=view.form.emit('submit');await tick();w.versionId='version-v2';w.version='v2';release();await first;
  assert.deepEqual(posted[0].body,{body:'Fixed old version',parentId:null,versionId:'version-v1',expectedAuthorId:u.id});
  assert.equal(view.input.value,'Fixed old version');
  const second=view.form.emit('submit');await tick();release();await second;
  assert.deepEqual(posted[1].body,posted[0].body);assert.equal(posted[1].headers['Idempotency-Key'],posted[0].headers['Idempotency-Key']);
  assert.equal(view.input.value,'');assert.equal(view.status.textContent,'评论已发布');
});

test('draft text and idempotency state are isolated by account, work and version',async t=>{
  const saved=environment(t),u=user(),w=work();
  saved.set(`funtrack.discussion:${u.id}:${w.id}`,JSON.stringify({text:'legacy unsent',key:'legacy-request-key'}));
  const api=async()=>({comments:[],commentsCount:0,nextCursor:null});
  const v1=mounted({work:w,user:u,api});await tick();assert.equal(v1.input.value,'');
  v1.input.value='Draft for v1';await v1.form.emit('input');const stored=JSON.parse(saved.get(discussionDraftKey(u,w)));
  v1.element.isConnected=false;
  const w2={...w,versionId:'version-v2',version:'v2'},v2=mounted({work:w2,user:u,api});await tick();assert.equal(v2.input.value,'');
  v2.input.value='Draft for v2';await v2.form.emit('input');
  assert.notEqual(JSON.parse(saved.get(discussionDraftKey(u,w2))).key,stored.key);
  v2.element.isConnected=false;const restored=mounted({work:w,user:u,api});await tick();assert.equal(restored.input.value,'Draft for v1');
  assert.equal(JSON.parse(saved.get(discussionDraftKey(u,w))).key,stored.key);
  const another=mounted({work:w,user:user(),api});await tick();assert.equal(another.input.value,'');
});

test('reply records the current page version, independently of its older root',async t=>{
  environment(t);const u=user(),w={...work(),versionId:'version-v2',version:'v2'},root=comment(w,u,{versionId:'version-v1',version:'v1'});let posted;
  const api=async(path,options)=>{if(!options?.method)return {comments:[root],commentsCount:1,nextCursor:null};posted=options.body;return {comment:comment(w,u,{...posted}),commentsCount:2};};
  const view=mounted({work:w,user:u,api});await tick();
  await view.list.emit('click',eventFor('[data-reply]',{reply:root.id}));view.input.value='Reply from v2';await view.form.emit('input');await view.form.emit('submit');
  assert.deepEqual(posted,{body:'Reply from v2',parentId:root.id,versionId:'version-v2',expectedAuthorId:u.id});
  assert.match(view.list.innerHTML,/Comment version|评论版本/);assert.match(view.list.innerHTML,/>v1<.*>v2</s);
});

test('a mismatched version receipt is not shown as saved and preserves the draft/key',async t=>{
  const saved=environment(t),u=user(),w=work();
  const api=async(path,options)=>options?.method?{comment:comment(w,u,{...options.body,versionId:'wrong-version'}),commentsCount:1}:{comments:[],commentsCount:0,nextCursor:null};
  const view=mounted({work:w,user:u,api});await tick();view.input.value='Keep me';await view.form.emit('input');
  const before=saved.get(discussionDraftKey(u,w));await view.form.emit('submit');
  assert.equal(view.input.value,'Keep me');assert.equal(saved.get(discussionDraftKey(u,w)),before);assert.match(view.status.textContent,/重试/);assert(!view.list.innerHTML.includes('Keep me'));
});

test('an account change submits the mounted author guard and preserves their draft for a safe retry',async t=>{
  const saved=environment(t),u=user(),originalAuthor=u.id,w=work(),calls=[];let authenticatedAuthor='another-account';
  const api=async(path,options)=>{
    if(!options?.method)return {comments:[],commentsCount:0,nextCursor:null};
    calls.push(options);
    if(options.body.expectedAuthorId!==authenticatedAuthor)throw Object.assign(new Error('登录状态已变化，请重新登录后重试。'),{status:409,code:'AUTH_SESSION_CHANGED'});
    return {comment:comment(w,{id:originalAuthor,name:u.name},{...options.body}),commentsCount:1};
  };
  const view=mounted({work:w,user:u,api});await tick();view.input.value='Only author A may post this';await view.form.emit('input');
  const draftKey=discussionDraftKey(u,w),before=saved.get(draftKey);u.id='another-account';await view.form.emit('submit');
  assert.equal(calls[0].body.expectedAuthorId,originalAuthor);assert.equal(saved.get(draftKey),before);assert.equal(view.input.value,'Only author A may post this');
  assert.match(view.status.textContent,/登录状态已变化/);assert(!view.list.innerHTML.includes('Only author A may post this'));
  authenticatedAuthor=originalAuthor;await view.form.emit('submit');
  assert.equal(calls[1].body.expectedAuthorId,originalAuthor);assert.equal(calls[1].headers['Idempotency-Key'],calls[0].headers['Idempotency-Key']);assert.equal(view.input.value,'');
});

test('precise context fetch locates an old reply without fetching or changing main pagination',async t=>{
  environment(t);const u=user(),w=work(),root=comment(w,u),target=comment(w,u,{parentId:root.id,body:'Deep reply'}),normal=comment(w,u,{body:'Latest root'}),calls=[];
  const api=async(path,options)=>{calls.push(path);if(path.endsWith('/context'))return {workId:w.id,targetId:target.id,contextOnly:true,thread:{...root,replies:[target],repliesNextCursor:null,replyCount:40}};
    if(path.includes('?cursor='))return {comments:[],commentsCount:43,nextCursor:null};return {comments:[normal],commentsCount:43,nextCursor:'unchanged-cursor'};};
  const view=mounted({work:w,user:u,api,focusId:target.id});await tick();
  assert.equal(calls.length,2);assert.match(view.context.innerHTML,/Deep reply/);assert(!view.list.innerHTML.includes('Deep reply'));assert.match(view.list.innerHTML,/Latest root/);
  assert.equal(view.context.querySelector(`[id="context-comment-${target.id}"]`).focused,true);
  await view.more.emit('click');assert.equal(calls.at(-1),`/api/works/${w.id}/comments?cursor=unchanged-cursor`);
  await view.context.emit('click',eventFor('[data-close-context]',{}));assert.equal(view.context.hidden,true);
});

test('cross-work context and late context on a detached page cannot be rendered',async t=>{
  environment(t);const u=user(),w=work(),root=comment(w,u);let release;
  const view=mounted({work:w,user:u,focusId:root.id,api:async path=>path.endsWith('/context')?{workId:'another-work',targetId:root.id,contextOnly:true,thread:{...root,replies:[]}}:{comments:[],commentsCount:0,nextCursor:null}});await tick();
  assert.match(view.context.innerHTML,/暂时无法定位/);assert(!view.context.innerHTML.includes('A comment'));
  const detached=mounted({work:{...w,id:randomUUID()},user:u,focusId:root.id,api:path=>path.endsWith('/context')?new Promise(resolve=>{release=resolve;}):Promise.resolve({comments:[],commentsCount:0,nextCursor:null})});
  await tick();detached.element.isConnected=false;const before=detached.context.innerHTML;release({workId:detached.id,targetId:root.id,contextOnly:true,thread:root});await tick();assert.equal(detached.context.innerHTML,before);
});

test('context arriving before the ordinary list keeps its target node, highlight and keyboard focus',async t=>{
  environment(t);const u=user(),w=work(),root=comment(w,u);let resolveList;
  const view=mounted({work:w,user:u,focusId:root.id,api:path=>path.endsWith('/context')?Promise.resolve({workId:w.id,targetId:root.id,contextOnly:true,thread:{...root,replies:[]}}):new Promise(resolve=>{resolveList=resolve;})});
  await tick();const selected=view.context.querySelector(`[id="context-comment-${root.id}"]`);
  assert.equal(document.activeElement,selected);assert.match(view.context.innerHTML,/comment-highlight/);
  resolveList({comments:[],commentsCount:1,nextCursor:null});await tick();
  assert.equal(view.context.querySelector(`[id="context-comment-${root.id}"]`),selected);assert.equal(document.activeElement,selected);
  view.input.focus();await view.form.emit('input');
  assert.equal(document.activeElement,view.input,'later refreshes must not steal focus back from the composer');
});

test('comment links target the precise comment on the current work; labels do not infer unknown versions',()=>{
  const before=getLocale();try{setLocale('en');assert.equal(commentVersionLabel({versionId:null,version:'v9'}),'Version unknown');assert.equal(commentVersionLabel({versionId:'id',version:'v1'}),'v1');
    const href=commentHref({id:'reply/one',workId:'work/one',versionId:'old-id'},'/studio/feedback?work=x');
    const route=href.slice(1),params=new URLSearchParams(route.split('?')[1]);assert.equal(route.split('?')[0],'/work/work%2Fone');assert.equal(params.get('comment'),'reply/one');assert.equal(params.get('from'),'/studio/feedback?work=x');assert.equal(params.has('versionId'),false);assert.equal(params.has('play'),false);
  }finally{setLocale(before);}
});

test('list deadline aborts a hung read, retries without losing text, and ignores the late response',async t=>{
  environment(t);let fire,release,calls=0,signal;const timers={setTimeout(fn){fire=fn;return 1;},clearTimeout(){}};
  const w=work(),u=user(),old=comment(w,u,{body:'stale'}),fresh=comment(w,u,{body:'fresh'});
  const api=(path,options)=>{signal=options.signal;calls++;return calls===1?new Promise(resolve=>{release=resolve;}):Promise.resolve({comments:[fresh],commentsCount:1,nextCursor:null});};
  const view=mounted({work:w,user:u,api,timers});view.input.value='Keep my draft';await view.form.emit('input');
  fire();await tick();assert.equal(signal.aborted,true);assert.match(view.status.textContent,/超时/);
  await view.list.emit('click',eventFor('.comments-retry',{}));await tick();assert.match(view.list.innerHTML,/fresh/);
  release({comments:[old],commentsCount:1,nextCursor:null});await tick();assert.doesNotMatch(view.list.innerHTML,/stale/);assert.equal(view.input.value,'Keep my draft');
});
test('remount aborts the previous list read and an old page cannot replace the new page',async t=>{
  environment(t);const w=work(),u=user();let release,oldSignal;
  const a=mounted({work:w,user:u,api:(path,{signal})=>{oldSignal=signal;return new Promise(resolve=>{release=resolve;});}});
  a.element.isConnected=false;
  const b=mounted({work:w,user:u,api:async()=>({comments:[comment(w,u,{body:'new page'})],commentsCount:1,nextCursor:null})});await tick();
  assert.equal(oldSignal.aborted,true);release({comments:[comment(w,u,{body:'old page'})],commentsCount:1,nextCursor:null});await tick();
  assert.match(b.list.innerHTML,/new page/);assert.doesNotMatch(b.list.innerHTML,/old page/);
});

test('route disposal cancels the list request and releases its deadline',async t=>{
  environment(t);let signal,release,cleared=false;const w=work(),u=user();
  const timers={setTimeout(){return 19;},clearTimeout(id){if(id===19)cleared=true;}};
  const view=mounted({work:w,user:u,timers,api:(path,options)=>{signal=options.signal;return new Promise(resolve=>{release=resolve;});}});
  const before=view.list.innerHTML;view.panel.dispose();await tick();assert(signal.aborted);assert(cleared);
  release({comments:[comment(w,u,{body:'Late after exit'})],commentsCount:1,nextCursor:null});await tick();assert.equal(view.list.innerHTML,before);
});
