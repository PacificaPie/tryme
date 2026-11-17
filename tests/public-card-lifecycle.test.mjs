import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {CARD_TEMPLATES} from '../public/card-templates.js';
import {renderPublicCard} from '../public/public-card.js';
import {publicCardId,publicCardRemixSignInPath,publicCoverPath,publicPlaySignInPath} from '../public/public-card-links.js';
import {t} from '../public/i18n.js';

const source=ts.createSourceFile('public-card.js',readFileSync(new URL('../public/public-card.js',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const mount=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='mountPublicPage');assert(mount);
const cardId='71160f2c-1946-4d96-a85c-bfdaf5940fe8',origin='https://funtrack.test';
const initial={id:cardId,authorId:'owner',template:'wall',name:'Old identity',bio:'Old bio',avatarUrl:'/avatars/sun.svg',works:[{id:'work-one',name:'Pinned work title',version:'v1',coverUrl:''}]};
const settle=async()=>{for(let index=0;index<6;index++)await Promise.resolve();};
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
class Element {innerHTML='';textContent='';listeners=new Map();attributes=new Map();addEventListener(type,handler){this.listeners.set(type,handler);}setAttribute(name,value){this.attributes.set(name,value);}fire(type,event={}){this.listeners.get(type)?.(event);}}
function fixture(){
  const root=new Element(),localeButton=new Element(),dialog=new Element(),events=new Element(),requests=[],timers=new Map();let locale='zh-CN',sequence=0;
  root.querySelector=selector=>selector==='.public-work-dialog'&&root.innerHTML.includes('public-work-dialog')?dialog:selector==='[data-public-retry]'&&root.innerHTML.includes('data-public-retry')?new Element():null;
  const document={documentElement:{lang:''},title:'',querySelector:selector=>selector==='#public-card-locale'?localeButton:null};
  const context=vm.createContext({t,CARD_TEMPLATES,publicCardId,publicCardRemixSignInPath,publicCoverPath,publicPlaySignInPath,escape,AbortController,URLSearchParams,
    document,window:events,location:{pathname:'/c/'+cardId,origin},getLocale:()=>locale,setLocale:value=>locale=value,
    spinner:()=>'<span class="loading"></span>',joinPath:'/auth/sign-in.html',mountPortfolioCard(){},renderPublicCard:card=>renderPublicCard(card,origin),
    setTimeout:callback=>{const id=++sequence;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),
    fetchPublicCard:(id,options)=>new Promise((resolve,reject)=>requests.push({id,options,resolve,reject})),
  });
  vm.runInContext(mount.getText(source),context);context.mountPublicPage(root);
  return {root,localeButton,events,requests,document,timers};
}

test('restoring a public card from browser history refetches live identity while retaining its saved works',async()=>{
  const f=fixture();assert.equal(f.requests.length,1);f.requests[0].resolve(initial);await settle();assert.match(f.root.innerHTML,/Old identity/);
  f.events.fire('pageshow',{persisted:false});assert.equal(f.requests.length,1);
  f.events.fire('pagehide');f.events.fire('pageshow',{persisted:true});assert.equal(f.requests.length,2);assert.equal(f.requests[0].options.signal.aborted,true);
  assert.match(f.root.innerHTML,/正在加载名片/);assert.doesNotMatch(f.root.innerHTML,/Old identity/);
  f.requests[1].resolve({...initial,name:'Current identity',bio:'',avatarUrl:'/avatars/moon.svg'});await settle();
  assert.match(f.root.innerHTML,/Current identity/);assert.match(f.root.innerHTML,/\/avatars\/moon.svg/);assert.match(f.root.innerHTML,/Pinned work title/);assert.doesNotMatch(f.root.innerHTML,/Old identity|Old bio/);
  assert.equal(f.document.title,'Current identity · Funtrack');assert.equal(f.timers.size,0);
});

test('an unavailable restored card cannot be resurrected by switching language',async()=>{
  const f=fixture();f.requests[0].resolve(initial);await settle();f.events.fire('pageshow',{persisted:true});
  f.requests[1].reject(Object.assign(new Error('Not found'),{status:404}));await settle();
  assert.match(f.root.innerHTML,/名片暂时无法打开/);const unavailable=f.root.innerHTML;
  f.localeButton.fire('click');assert.equal(f.root.innerHTML,unavailable);assert.doesNotMatch(f.root.innerHTML,/Old identity|Pinned work title/);
});

test('a superseded public-card response cannot replace the current identity on a later locale render',async()=>{
  const f=fixture();f.events.fire('pageshow',{persisted:true});assert.equal(f.requests[0].options.signal.aborted,true);
  f.requests[1].resolve({...initial,name:'Current identity'});await settle();f.requests[0].resolve(initial);await settle();f.localeButton.fire('click');
  assert.match(f.root.innerHTML,/Current identity/);assert.doesNotMatch(f.root.innerHTML,/Old identity/);assert.equal(f.document.title,'Current identity · Funtrack');
});
