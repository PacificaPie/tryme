import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {emptyState} from '../public/empty-state.js';
import {mountAnalytics} from '../public/analytics.js';
import {CARD_TEMPLATES} from '../public/card-templates.js';
import {avatarMarkup} from '../public/avatars.js';
import {archivedWorksPath,isArchived} from '../public/archive-controls.js';
import {commentVersionLabel,commentHref} from '../public/discussion.js';
import {t,getLocale,setLocale,registerMessages} from '../public/i18n.js';
import '../public/site.messages.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const unescape=value=>String(value).replace(/&(?:amp|lt|gt|quot|#39);/g,s=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[s]));
const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

// This adapter implements only the DOM used by these renderers. It parses the
// real generated markup, so querying a missing selector returns null instead of
// inventing a node. Geometry and browser visual behavior remain browser checks.
class Element {
  constructor(tag='root',attributes={}){this.tag=tag;this.attributes={...attributes};this.children=[];this.listeners=new Map();this.clientWidth=800;this.isConnected=true;}
  get classList(){const self=this;return {contains:name=>(self.attributes.class||'').split(/\s+/).includes(name),add(...names){const values=new Set((self.attributes.class||'').split(/\s+/).filter(Boolean));names.forEach(n=>values.add(n));self.attributes.class=[...values].join(' ');},remove(...names){self.attributes.class=(self.attributes.class||'').split(/\s+/).filter(n=>!names.includes(n)).join(' ');},toggle(name,on){const next=on??!this.contains(name);next?this.add(name):this.remove(name);return next;}};}
  get dataset(){return Object.fromEntries(Object.entries(this.attributes).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),value]));}
  get hidden(){return Object.hasOwn(this.attributes,'hidden');} set hidden(value){value?this.setAttribute('hidden',''):this.removeAttribute('hidden');}
  get innerHTML(){return this.children.map(child=>typeof child==='string'?child:child.outerHTML).join('');}
  set innerHTML(html){this.children=parseHTML(String(html)).children;}
  get outerHTML(){if(this.tag==='root')return this.innerHTML;const start='<'+this.tag+Object.entries(this.attributes).map(([key,value])=>' '+key+'="'+esc(value)+'"').join('')+'>';return start+(voidTags.has(this.tag)?'':this.innerHTML+'</'+this.tag+'>');}
  get textContent(){return this.children.map(child=>typeof child==='string'?unescape(child):child.textContent).join('');} set textContent(value){this.children=[esc(value)];}
  setAttribute(key,value){this.attributes[key]=String(value);} getAttribute(key){return this.attributes[key]??null;} removeAttribute(key){delete this.attributes[key];} hasAttribute(key){return Object.hasOwn(this.attributes,key);}
  addEventListener(name,handler){this.listeners.set(name,handler);} removeEventListener(name){this.listeners.delete(name);}
  append(child){this.children.push(child);} focus(){} scrollIntoView(){}
  matches(selector){
    const attrs=[...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];let rest=selector.replace(/\[[^\]]+\]/g,'');
    const id=/#([\w-]+)/.exec(rest)?.[1],classes=[...rest.matchAll(/\.([\w-]+)/g)].map(m=>m[1]),tag=/^[\w-]+/.exec(rest)?.[0];
    return (!tag||this.tag===tag)&&(!id||this.attributes.id===id)&&classes.every(name=>this.classList.contains(name))&&attrs.every(([,key,value])=>this.hasAttribute(key)&&(value===undefined||this.attributes[key]===value));
  }
  querySelectorAll(selector){const result=[];for(const child of this.children)if(child instanceof Element){if(child.matches(selector))result.push(child);result.push(...child.querySelectorAll(selector));}return result;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  contains(node){return node===this||this.children.some(child=>child instanceof Element&&child.contains(node));}
}
function parseHTML(html){
  const root=new Element(),stack=[root];
  for(const token of html.match(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|[^<]+|</g)||[]){
    if(token.startsWith('<!--'))continue;
    if(token.startsWith('</')){const tag=/^<\/([\w:-]+)/.exec(token)[1].toLowerCase();for(let i=stack.length-1;i>0;i--)if(stack[i].tag===tag){stack.length=i;break;}continue;}
    if(!/^<[A-Za-z]/.test(token)){stack.at(-1).children.push(token);continue;}
    const [,tag,raw]=/^<([\w:-]+)([\s\S]*?)\/?\s*>$/.exec(token),attributes={};
    for(const match of raw.matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g))attributes[match[1]]=unescape(match[2]??match[3]??match[4]??'');
    const node=new Element(tag.toLowerCase(),attributes);stack.at(-1).children.push(node);
    if(!token.endsWith('/>')&&!voidTags.has(node.tag))stack.push(node);
  }
  return root;
}

// Execute production functions, not copied templates or source-string checks.
// Imports and SPA startup are omitted; auth/network/document are the fixtures.
const site=ts.createSourceFile('site.js',readFileSync(new URL('../public/site.js',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const names=['readMine','empty','studio','cardsPage','cardBuilderTop','head','applyHTML','renderMyWorks','renderBuilder','renderData','renderFeedback'];
const functions=names.map(name=>{const node=site.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert(node,'Missing production renderer '+name);return node.getText(site);}).join('\n');
const messages=site.statements.filter(n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(site)==='registerMessages').map(n=>n.getText(site)).join('\n');
const oldCard={id:'00000000-0000-4000-8000-000000000099',name:'Saved creator',works:[]};
const archivedWork={id:'archived-work-one',name:'Earlier game',source:'html',version:'v1',archivedAt:'2026-11-17T00:00:00Z'};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

function fixture({path='/studio/works',locale='zh-CN',active=[],archived=[],card=null,comments=[],feedback=[],analytics=null,reject=null}={}){
  setLocale(locale);const main=new Element('main',{id:'main'}),calls=[],navigations=[],draft={ids:['stale-work'],template:'wall'},params=new URLSearchParams(path.split('?')[1]||''),route={path:path.split('?')[0],raw:path,params};
  const api=async(url,options={})=>{
    calls.push({url,method:options.method||'GET'});if(reject){const error=reject(url);if(error)throw error;}
    const parsed=new URL(url,'https://fixture.test');
    if(parsed.pathname==='/api/works'){
      assert.equal(parsed.searchParams.get('mine'),'1','Studio requests must remain owner-scoped');
      const state=parsed.searchParams.get('state')||'active',works=state==='all'?[...active,...archived]:state==='archived'?archived:active;
      return {works:structuredClone(works),total:works.length,nextCursor:null};
    }
    if(parsed.pathname==='/api/cards/me'){if(card)return {card:structuredClone(card)};throw Object.assign(new Error('No saved card'),{status:404});}
    if(parsed.pathname==='/api/comments'){assert.equal(parsed.searchParams.get('mine'),'1');return {comments:structuredClone(comments),nextCursor:null};}
    if(parsed.pathname==='/api/feedback')return {feedback:structuredClone(feedback)};
    if(parsed.pathname==='/api/analytics'){assert(analytics,'Zero-upload analytics must not fetch or synthesize statistics');return structuredClone(analytics);}
    throw new Error('Unexpected API request '+url);
  };
  const context=vm.createContext({t,registerMessages,emptyState,mountAnalytics,CARD_TEMPLATES,avatarMarkup,archivedWorksPath,isArchived,commentVersionLabel,commentHref,esc,api,URLSearchParams,structuredClone,
    route:()=>route,routeNumber:1,finishRouteLoading:null,main,scrolls:new Map(),syncNavigation(){},requestAnimationFrame:callback=>callback(),window:{scrollTo(){}},
    $:selector=>main.querySelector(selector),$$:selector=>main.querySelectorAll(selector),cardDraft:draft,saveCardDraft(){},go:value=>navigations.push(value),
    me:{id:'empty-user',name:'New creator'},draftOwner:'empty-user',analyticsPanel:null,currentRoute:path,date:value=>String(value),CSS:{escape:value=>value},
  });
  vm.runInContext(messages+'\n'+functions,context);
  return {main,calls,draft,navigations,context,async render(name){await context[name](route,1);await flush();return main;},dispose(){context.analyticsPanel?.dispose();}};
}
function primary(main){return main.querySelectorAll('.primary').filter(node=>node.tag==='a'||node.tag==='button');}
function noInventedData(main){
  assert.equal(main.querySelectorAll('.work-row').length,0);assert.equal(main.querySelectorAll('.feedback-record').length,0);assert.equal(main.querySelectorAll('.inbox-comment').length,0);
  for(const selector of ['.an-metrics','.an-chart-host','.an-observations','.select-work'])assert.equal(main.querySelector(selector),null,selector);
  assert.doesNotMatch(main.textContent,/undefined|NaN|Infinity/);
}
function artifact(name,main){
  if(process.env.FUNTRACK_WRITE_EMPTY_FIXTURES!=='1')return;
  const shell=readFileSync(new URL('../public/site.html',import.meta.url),'utf8');
  const html=shell.replace(/<script type="module" src="\/site\.js"><\/script>/,'').replace(/<main id="main"[\s\S]*?<\/main>/,main.outerHTML)
    .replace('<title>Funtrack</title>','<title>本地验收 · '+name+' · Funtrack</title>').replace('<html lang="zh-CN">','<html lang="'+getLocale()+'">')
    .replace('<div id="identity"></div>','<div id="identity"><span class="identity-name">本地验收 · Fixture</span></div>');
  mkdirSync('.preview/studio-empty-states',{recursive:true});writeFileSync('.preview/studio-empty-states/'+name+'.html',html);
}

test('zero-upload studio pages execute real renderers with one publish CTA, illustrations and no fabricated data in both languages',async()=>{
  const pages=[['works','renderMyWorks','/studio/works'],['analytics','renderData','/studio/data'],['feedback','renderFeedback','/studio/feedback'],['legacy-feedback','renderFeedback','/studio/feedback?tab=legacy'],['card','renderBuilder','/cards/me']];
  for(const locale of ['zh-CN','en'])for(const [name,renderer,path] of pages){
    const f=fixture({path,locale});try{
      const main=await f.render(renderer),actions=primary(main);assert.equal(actions.length,1,name+' '+locale);assert.equal(actions[0].getAttribute('href'),'#/publish');assert.equal(actions[0].textContent,t('发布作品'));
      assert(main.querySelector('svg[aria-hidden="true"]'),name+' illustration');noInventedData(main);assert(f.calls.every(call=>call.method==='GET'));assert(!f.calls.some(call=>call.url.startsWith('/api/analytics')));
      const mine=f.calls.find(call=>call.url.startsWith('/api/works?'));assert.equal(new URL(mine.url,'https://fixture.test').searchParams.get('state'),['analytics','feedback','legacy-feedback'].includes(name)?'all':'active');
      artifact(name+'-'+locale,main);
    }finally{f.dispose();}
  }
  setLocale('zh-CN');
});

test('an empty archive returns to active works without offering archive actions or creating a work',async()=>{
  const f=fixture({path:'/studio/works?state=archived'});const main=await f.render('renderMyWorks');
  assert.equal(primary(main).length,1);assert.equal(primary(main)[0].getAttribute('href'),'#/studio/works');assert.equal(main.querySelector('[data-work-archive]'),null);noInventedData(main);
  assert.equal(new URL(f.calls[0].url,'https://fixture.test').searchParams.get('state'),'archived');artifact('archive-empty',main);
});

test('with zero active works, saved cards survive every builder entry and archived work is recoverable',async()=>{
  const frozen=structuredClone(oldCard);
  for(const path of ['/cards/me','/cards/me/template','/cards/me/preview']){
    const f=fixture({path,archived:[archivedWork],card:oldCard}),main=await f.render('renderBuilder'),actions=primary(main);
    assert.equal(actions.length,1);assert.equal(actions[0].getAttribute('href'),'#/card/'+oldCard.id);
    assert(main.querySelectorAll('a').some(node=>node.getAttribute('href')==='#'+archivedWorksPath));
    assert(main.querySelector('details').querySelectorAll('a').some(node=>node.getAttribute('href')==='#/publish'));
    assert.deepEqual([...f.draft.ids],[]);assert.deepEqual(f.navigations,[]);noInventedData(main);assert(f.calls.some(call=>call.url==='/api/cards/me'));
    assert.deepEqual(oldCard,frozen);artifact('card-all-archived'+(path.endsWith('preview')?'-preview':''),main);
  }
});

test('an author with only archived works and no saved card is guided to restore rather than reupload',async()=>{
  const f=fixture({path:'/cards/me',archived:[archivedWork]}),main=await f.render('renderBuilder');
  assert.equal(primary(main).length,1);assert.equal(primary(main)[0].getAttribute('href'),'#'+archivedWorksPath);assert.equal(primary(main)[0].textContent,t('前往归档恢复'));
  assert(main.querySelector('details').querySelector('a[href="#/publish"]'));noInventedData(main);artifact('card-restore-first',main);
});

test('zero active works does not erase archived analytics or inbox history',async()=>{
  const metrics={pv:2,uv:1,players:0,avgActiveMs:null,totalActiveMs:null},analytics={meta:{from:'2026-11-16',to:'2026-11-17',previousFrom:'2026-11-14',previousTo:'2026-11-15',granularity:'day'},summary:metrics,previous:{pv:0,uv:0,players:0,avgActiveMs:null},series:[{date:'2026-11-17',...metrics}],byWork:[{workId:archivedWork.id,name:archivedWork.name,source:'html',archivedAt:archivedWork.archivedAt,...metrics}],versions:[],coverage:{}};
  const data=fixture({path:'/studio/data',archived:[archivedWork],analytics});try{
    const main=await data.render('renderData');assert(main.querySelector('.an-metrics'));assert.equal(main.querySelector('[data-an-metric="pv"]').querySelector('strong').textContent,'2');
    assert.equal(main.querySelector('[data-an-metric="avgActiveMs"]').querySelector('strong').textContent,'—');assert(main.querySelector('.an-work-table').textContent.includes(archivedWork.name));assert(main.querySelector('[data-an-work]').textContent.includes(t('已归档')));
    assert(!main.querySelector('.an-no-works'));assert(data.calls.some(call=>call.url.startsWith('/api/analytics?')));
  }finally{data.dispose();}
  const inbox=fixture({path:'/studio/feedback',archived:[archivedWork],comments:[{id:'comment-1',workId:archivedWork.id,workName:archivedWork.name,authorName:'Tester',body:'Existing feedback',createdAt:'2026-11-16T12:00:00Z',isCreator:false,parentId:null}]});
  const main=await inbox.render('renderFeedback');assert.equal(main.querySelectorAll('.inbox-comment').length,1);assert(main.textContent.includes('Existing feedback'));assert(main.querySelector('.work-archived'));assert.equal(primary(main).length,0);
});

test('an unavailable owned-work or saved-card request is not relabeled as a new-user empty state',async()=>{
  for(const [renderer,path,failurePath] of [['renderMyWorks','/studio/works','/api/works'],['renderData','/studio/data','/api/works'],['renderFeedback','/studio/feedback','/api/comments'],['renderBuilder','/cards/me','/api/cards/me']]){
    const outage=Object.assign(new Error('Temporary failure'),{status:503}),f=fixture({path,reject:url=>url.startsWith(failurePath)?outage:null});
    await assert.rejects(f.render(renderer),error=>error===outage);assert.equal(f.main.innerHTML,'');assert.equal(primary(f.main).length,0);
  }
});
