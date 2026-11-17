import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {avatarMarkup} from '../public/avatars.js';
import {emptyState} from '../public/empty-state.js';
import {cardShareText} from '../public/sharing.js';
import {publicCardPath} from '../public/public-card-links.js';
import {t,setLocale} from '../public/i18n.js';
import '../public/site.messages.js';
import '../public/creator-social.messages.js';

const source=ts.createSourceFile('site.js',readFileSync(new URL('../public/site.js',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const functions=['identity','renderCards','renderFollowing','cardsPage','head','empty','safeCover'].map(name=>{
  const node=source.statements.find(item=>ts.isFunctionDeclaration(item)&&item.name?.text===name);assert(node,name);return node.getText(source);
}).join('\n');
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const ownCard={id:'71160f2c-1946-4d96-a85c-bfdaf5940fe8',authorId:'my/id',name:'My saved card',bio:'Snapshot bio',works:[{coverUrl:'/media/own-work'}]};
const otherCard={id:'81160f2c-1946-4d96-a85c-bfdaf5940fe8',authorId:'someone-else',name:'Other saved card',headline:'Creator',works:[{coverUrl:'https://foreign.test/track'},...Array.from({length:4},(_,i)=>({coverUrl:'/media/work-'+i}))]};

function siteFixture(){
  const requests=[],renders=[],mounts=[],identity={innerHTML:''},directory={isConnected:true},context=vm.createContext({
    t,esc,avatarMarkup,emptyState,cardShareText,publicCardPath,URL,
    me:{id:'my/id',name:'Profile <name>',avatarUrl:'/avatars/moon.svg'},routeNumber:1,creatorPanel:null,
    route:()=>({path:'/cards'}),location:{origin:'https://funtrack.test'},
    api:url=>{const pending=deferred();requests.push({url,...pending});return pending.promise;},
    applyHTML:(html,number)=>{renders.push({html,number});return number===context.routeNumber;},
    $:selector=>selector==='#identity'?identity:selector==='.creator-directory-page'?directory:null,
    mountCreatorDirectory:(root,options)=>{const panel={dispose(){}};mounts.push({root,options,panel});return panel;},
    authURL:(action,target)=>'/auth/'+action+'?return_to='+encodeURIComponent(target),
    getAuthConfig:()=>({provider:'clerk'}),signinURL:()=>'/auth/sign-in',
  });
  vm.runInContext(functions,context);
  return {context,requests,renders,mounts,identity,directory};
}

test('the primary card tab keeps its original card destination and label',()=>{
  const shell=readFileSync(new URL('../public/site.html',import.meta.url),'utf8');
  const nav=/<nav aria-label="主导航">([\s\S]*?)<\/nav>/.exec(shell)?.[1];assert(nav);
  assert.match(nav,/<a href="#\/cards" data-nav="cards">名片<\/a>/);
  assert.doesNotMatch(nav,/>创作者<\/a>/);
});

test('cards browse saved cards, open card views directly, and show management only on the owner’s card',async()=>{
  const f=siteFixture(),pending=f.context.renderCards(1);
  assert.deepEqual(f.requests.map(request=>request.url),['/api/cards']);
  f.requests[0].resolve({cards:[ownCard,otherCard]});await pending;
  assert.equal(f.renders.length,1);
  const html=f.renders[0].html,articles=[...html.matchAll(/<article class="creator-card">([\s\S]*?)<\/article>/g)].map(match=>match[1]);
  assert.equal(articles.length,2);
  for(const [index,card] of [ownCard,otherCard].entries()){
    assert.match(articles[index],new RegExp('class="creator-card-link" href="#/card/'+card.id+'"'));
    assert(articles[index].includes('data-share-url="https://funtrack.test/c/'+card.id+'"'));
    assert(articles[index].includes(card.name));
    assert(!articles[index].includes('#/author/'),'A card entry opens the saved card, not a person directory');
  }
  assert.match(articles[0],/href="#\/cards\/me">重新制作/);
  assert(articles[0].includes('data-delete-card="'+ownCard.id+'"'));
  assert.doesNotMatch(articles[1],/data-delete-card|重新制作/);
  assert.match(html,/href="#\/cards\/me">制作名片/);
  assert.doesNotMatch(html,/foreign\.test|creator-person-link/);
  assert.equal((articles[1].match(/<img /g)||[]).length,2,'Covers remain capped at the first three slots, including missing covers');
});

test('an empty cards page still offers card creation without inventing people or cards',async()=>{
  const f=siteFixture(),pending=f.context.renderCards(1);f.requests[0].resolve({cards:[]});await pending;
  const html=f.renders[0].html;
  assert.match(html,/还没有名片/);assert.match(html,/href="#\/cards\/me">制作名片/);
  assert.doesNotMatch(html,/class="creator-card"|creator-person-link|#\/following/);
});

test('late cards responses cannot replace a newer route or another account’s page',async()=>{
  for(const change of ['route','account','signed-out']){
    const f=siteFixture(),pending=f.context.renderCards(1);
    if(change==='route')f.context.routeNumber=2;
    else if(change==='account')f.context.me={id:'someone-else'};
    else f.context.me=null;
    f.requests[0].resolve({cards:[ownCard,otherCard]});await pending;
    assert.equal(f.renders.length,0,change);
  }
});

test('the avatar menu exposes personal profile and following separately from card browsing',()=>{
  setLocale('zh-CN');const f=siteFixture();f.context.identity();const html=f.identity.innerHTML;
  assert.match(html,/<a href="#\/author\/my%2Fid">个人主页<\/a>/);
  assert.match(html,/<a href="#\/following">关注列表<\/a>/);
  assert.match(html,/data-edit-profile/);assert.match(html,/href="#\/studio\/works"/);
  assert.match(html,/\/avatars\/moon\.svg/);assert.match(html,/Profile &lt;name&gt;/);
  assert.doesNotMatch(html,/#\/cards\?following|#\/creators/);
  f.context.me=null;f.context.identity();assert.doesNotMatch(f.identity.innerHTML,/account-menu|#\/following|#\/author\//);
});

test('the following route mounts its own directory without replacing the card renderer',async()=>{
  const f=siteFixture();await f.context.renderFollowing({path:'/following'},1);
  assert.equal(f.mounts.length,1);assert.equal(f.mounts[0].root,f.directory);
  assert.equal(f.mounts[0].options.me.id,'my/id');assert.equal(f.context.creatorPanel,f.mounts[0].panel);
  assert.deepEqual(f.requests,[],'The following module, not the saved-card endpoint, owns this page');
  const stale=siteFixture();stale.context.routeNumber=2;await stale.context.renderFollowing({path:'/following'},1);
  assert.equal(stale.mounts.length,0);
});

function navigationFixture(){
  const frames=[],listeners=new Map();
  class Node {
    hidden=false;isConnected=true;attributes=new Map();
    style={removeProperty(key){delete this[key];}};
    constructor(rect){this.rect=rect;}
    getBoundingClientRect(){return this.rect;}
    setAttribute(key,value){this.attributes.set(key,value);}
    removeAttribute(key){this.attributes.delete(key);}
  }
  const links=[0,1,2].map(index=>new Node({left:10+index*100,top:5,width:70,height:30}));
  const nav=new Node({left:10,top:0,width:300,height:55});nav.active=links[0];nav.indicator=null;
  nav.querySelector=selector=>selector==='a.active'?nav.active:selector==='.nav-indicator'?nav.indicator:null;
  nav.querySelectorAll=selector=>selector==='a'?links:[];nav.append=node=>{nav.indicator=node;};
  const document={querySelector:selector=>selector==='.site-header nav'?nav:null,createElement:()=>new Node({})};
  const context=vm.createContext({document,window:{addEventListener:(event,handler)=>listeners.set(event,handler)},requestAnimationFrame:callback=>frames.push(callback)});
  vm.runInContext(readFileSync(new URL('../public/navigation.js',import.meta.url),'utf8').replace(/^export /gm,''),context);
  return {context,nav,links,frames,listeners,flush(){while(frames.length)frames.shift()();}};
}

test('personal and following pages hide the old primary indicator and clear aria-current even with a queued transition',()=>{
  const f=navigationFixture();f.context.syncNavigation();const indicator=f.nav.indicator;
  assert.equal(indicator.hidden,false);assert.equal(f.links[0].attributes.get('aria-current'),'page');
  f.nav.active=null;f.context.syncNavigation();
  assert.equal(indicator.hidden,true);assert(f.links.every(link=>!link.attributes.has('aria-current')));
  f.flush();assert.equal(indicator.hidden,true,'A previous animation must not expose a stale underline');
  f.listeners.get('resize')();assert.equal(indicator.hidden,true);
  f.nav.active=f.links[2];f.context.syncNavigation();f.flush();
  assert.equal(f.nav.indicator,indicator);assert.equal(indicator.hidden,false);
  assert.equal(f.links[2].attributes.get('aria-current'),'page');assert(!f.links[0].attributes.has('aria-current'));
  assert.equal(indicator.style.transform,'translate(200px,41px)');
});

test('a direct arrival at a personal page does not create a phantom primary indicator',()=>{
  const f=navigationFixture();f.nav.active=null;f.links[0].setAttribute('aria-current','page');
  f.context.syncNavigation();f.flush();
  assert.equal(f.nav.indicator,null);assert(f.links.every(link=>!link.attributes.has('aria-current')));
});
