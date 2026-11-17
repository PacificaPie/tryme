import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_TEMPLATES } from '../public/card-templates.js';
import { createRemixDraft, remixStyle, cardRemixPath } from '../public/card-remix.js';
import { creatorCardPreview, creatorHomeMarkup, mountCreatorHome, updateCreatorFollow } from '../public/creator-home.js';
import { setLocale } from '../public/i18n.js';

const creator = { id:'author-one', name:'A creator', bio:'Small games', headline:'Maker', website:'https://example.com/', avatarUrl:'/avatars/sprout.svg', worksCount:4, followersCount:2, followingCount:1, followedByMe:false };
const card = { id:'f5a5d89f-8530-4c1b-8c04-cd6104036c24', authorId:creator.id, name:'Saved name', bio:'Saved bio', avatarUrl:'/avatars/moon.svg', template:'fold', backStyle:'ivory', works:[{id:'work-one',name:'First game',coverUrl:'/media/version-one'}] };

test('same-template creation keeps only allowlisted visual choices and the current creator’s own profile', () => {
  const current = { id:'my-id', name:'My name', bio:'My bio', signature:'My signature', headline:'My role', website:'https://mine.example/', avatarUrl:'/avatars/sun.svg' };
  for (const template of CARD_TEMPLATES) {
    const source = { ...card, template:template.id, signature:'Their signature', website:'https://theirs.example', workIds:['foreign-work'], saveKey:'foreign-save', authorId:'someone-else', customHTML:'<script>bad</script>' };
    const before = structuredClone(source), draft = createRemixDraft(source,current);
    assert.deepEqual(draft,{ids:[],template:template.id,backStyle:'ivory',name:current.name,bio:current.bio,signature:current.signature,headline:current.headline,website:current.website});
    assert.deepEqual(source,before);assert(!('id' in draft));assert(!('saveKey' in draft));assert(!('works' in draft));assert(!('avatarUrl' in draft));
  }
  assert.deepEqual(remixStyle({template:'<script>',backStyle:'url(evil)'}),{template:'wall',backStyle:'ink'});
  assert.equal(createRemixDraft(card,{website:'javascript:alert(1)'}).website,'');
  assert.equal(createRemixDraft(card,{website:'https://u:p@example.com/'}).website,'');
  assert.equal(cardRemixPath('a/b?c'),'/cards/me?templateFrom=a%2Fb%3Fc');
});

test('every card template uses the same cover entry without embedding template-specific navigation', () => {
  for (const template of CARD_TEMPLATES) {
    const html = creatorHomeMarkup({creator,card:{...card,template:template.id},me:{id:'visitor'}});
    assert(html.includes('creator-card-stage'));assert(html.includes('#/card/'+card.id));assert(html.includes('data-creator-works'));
    assert(!html.includes('<iframe'));assert(!html.includes('#/work/'));assert(!html.includes('data-delete-card'));
  }
  const original=structuredClone(card);creatorCardPreview(card);assert.deepEqual(card,original);
});

test('the visitor card caption offers direct template reuse while owner management and empty profiles stay distinct', () => {
  const visitor=creatorHomeMarkup({creator,card,me:{id:'visitor'}});
  assert(visitor.includes('creator-card-visitor-actions'));assert(visitor.includes(`href="#${cardRemixPath(card.id)}">用同款制作</a>`));
  assert(visitor.indexOf('creator-card-visitor-actions')>visitor.indexOf('creator-card-caption'));
  for(const html of [creatorHomeMarkup({creator,card,me:{id:creator.id}}),creatorHomeMarkup({creator,card:null,me:{id:'visitor'}})])assert(!html.includes('templateFrom='));
  const encoded=creatorHomeMarkup({creator,card:{...card,id:'a/b?c'},me:{id:'visitor'}});
  assert(encoded.includes('href="#/cards/me?templateFrom=a%2Fb%3Fc"'));
});

test('homepage card actions avoid the legacy hover-only card action class', () => {
  for(const me of [{id:'visitor'},{id:creator.id}]){
    const html=creatorHomeMarkup({creator,card,me});
    const classes=[...html.matchAll(/class="([^"]*)"/g)].flatMap(match=>match[1].split(/\s+/));
    assert(classes.includes('creator-home-card-actions'));
    assert(!classes.includes('creator-card-actions'),'The legacy class hides actions outside its hover-card parent');
  }
});

test('profile back navigation stays generic and only the owner’s following count opens their following list', () => {
  const visitor=creatorHomeMarkup({creator,card,me:{id:'visitor'}}),owner=creatorHomeMarkup({creator,card,me:{id:creator.id}});
  assert(visitor.startsWith('<a class="back" href="#/feed">← 返回</a>'));
  assert(!visitor.includes('creator-home-following'));assert(!visitor.includes('href="#/cards">← 创作者'));
  assert(owner.includes('<a class="creator-home-following" href="#/following"><strong>1</strong> 正在关注</a>'));
  const fromFollowing=creatorHomeMarkup({creator,card,me:{id:'visitor'},backHref:'#/following'});
  assert(fromFollowing.startsWith('<a class="back" href="#/following">← 返回</a>'));assert(!fromFollowing.includes('creator-home-following'));
  for(const backHref of ['https://example.com/','javascript:alert(1)',null])assert(creatorHomeMarkup({creator,card,backHref}).startsWith('<a class="back" href="#/feed">'));
});

test('home markup escapes profile and saved-card content, bounds images, and rejects external cover URLs', () => {
  const hostile = { ...creator, name:'<img onerror="x">', bio:'<script>alert(1)</script>', headline:'<svg onload="x">', website:'javascript:alert(1)' };
  const html = creatorHomeMarkup({creator:hostile,card:{...card,name:'<b>bad</b>',works:[{name:'<i>bad</i>',coverUrl:'https://evil.test/track'}]},me:{id:'visitor'},profileURL:'https://funtrack.test/site#/author/author-one'});
  assert(!html.includes('<script>'));assert(!html.includes('<img onerror'));assert(!html.includes('<svg onload'));assert(!html.includes('href="javascript:'));assert(!html.includes('https://evil.test'));
  assert(html.includes('&lt;script&gt;'));assert(html.includes('&lt;b&gt;bad&lt;/b&gt;'));assert(html.includes('/avatars/sprout.svg'));
  const many=creatorCardPreview({...card,works:Array.from({length:10},(_,index)=>({name:'Game '+index,coverUrl:'/media/version-'+index}))});
  assert.equal((many.match(/loading="lazy"/g)||[]).length,3);
});

test('empty-card ownership changes only card management, never availability of the full works region', () => {
  const mine=creatorHomeMarkup({creator,card:null,me:{id:creator.id}}),visitor=creatorHomeMarkup({creator,card:null,me:{id:'visitor'}});
  assert(mine.includes('creator-home-card-empty'));assert(mine.includes('制作我的名片'));assert(mine.includes('data-edit-profile'));assert(!mine.includes('data-creator-follow aria-pressed'));
  assert(!visitor.includes('creator-home-card-empty'));assert(visitor.includes('without-card'));assert(visitor.includes('data-creator-follow aria-pressed'));
  for(const html of [mine,visitor])assert(html.includes('data-creator-works'));
  const saved=creatorHomeMarkup({creator,card,me:{id:creator.id}});assert(saved.includes('data-delete-card="'+card.id+'"'));
});

test('profile and card controls translate without translating creator content', () => {
  setLocale('en');
  try {
    const html=creatorHomeMarkup({creator:{...creator,name:'创作者'},card,me:{id:'visitor'},profileURL:'https://funtrack.test/'});
    assert(html.includes('<h1>创作者</h1>'));assert(html.includes('View card'));assert(html.includes('Share profile'));assert(html.includes('Following'));assert(html.includes('Card cover'));assert(html.includes('Use this template'));assert(!html.includes('用同款制作'));
  } finally {setLocale('zh-CN');}
});

test('follow writes desired state to the creator ID and rejects ambiguous or mismatched replies', async () => {
  let request;
  const result=await updateCreatorFollow(async(path,options)=>{request={path,...options};return {creatorId:'a/b',following:true,followersCount:4};},'a/b',true);
  assert.equal(request.path,'/api/creators/a%2Fb/follow');assert.equal(request.method,'POST');assert.deepEqual(request.body,{following:true});assert(request.signal instanceof AbortSignal);assert.equal(result.followersCount,4);
  for(const reply of [{creatorId:'wrong',following:true,followersCount:1},{creatorId:'same',following:false,followersCount:1},{creatorId:'same',following:true,followersCount:-1},{creatorId:'same',following:true,followersCount:'1'}])await assert.rejects(updateCreatorFollow(async()=>reply,'same',true));
});

class Element {
  attributes=new Map();classes=new Set();listeners=new Map();nodes=[];hidden=false;disabled=false;isConnected=true;textContent='';_html='';
  classList={add:name=>this.classes.add(name),toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};
  constructor(tag='div',attributes=''){this.tag=tag;for(const match of attributes.matchAll(/([^\s=/>]+)(?:\s*=\s*"([^"]*)")?/g))this.setAttribute(match[1],match[2]??'');this.hidden=this.attributes.has('hidden');}
  setAttribute(name,value){this.attributes.set(name,String(value));if(name==='class')this.classes=new Set(String(value).split(/\s+/));}
  getAttribute(name){return this.attributes.get(name);}
  set innerHTML(value){this._html=value;this.nodes=[...value.matchAll(/<([a-z][\w:-]*)(\s[^>]*|)>/gi)].map(match=>new Element(match[1],match[2]));}
  get innerHTML(){return this._html;}
  matches(selector){return selector.startsWith('.')?this.classes.has(selector.slice(1)):selector.startsWith('[')?this.attributes.has(selector.slice(1,-1)):this.tag===selector;}
  closest(selector){return this.matches(selector)?this:null;}
  querySelector(selector){return this.nodes.find(node=>node.matches(selector))||null;}
  addEventListener(type,callback){this.listeners.set(type,callback);}
  removeEventListener(type,callback){if(this.listeners.get(type)===callback)this.listeners.delete(type);}
  fire(target){return this.listeners.get('click')?.({target});}
}
function uiFixture(){
  const root=new Element(),calls=[],changed=[];
  const panel=mountCreatorHome(root,{creator,card,me:{id:'visitor'},api:(path,options)=>new Promise((resolve,reject)=>calls.push({path,options,resolve,reject})),onFollowChange:value=>changed.push(value)});
  return {root,panel,calls,changed,button:root.querySelector('[data-creator-follow]'),status:root.querySelector('.creator-follow-status'),followers:root.querySelector('[data-creator-followers]')};
}

test('follow UI waits for confirmation, ignores repeat clicks, and retries the same desired state after an uncertain response', async () => {
  const f=uiFixture(),first=f.root.fire(f.button);assert.equal(f.calls.length,1);assert(f.button.disabled);assert.equal(f.button.getAttribute('aria-pressed'),'false');
  await f.root.fire(f.button);assert.equal(f.calls.length,1);
  f.calls[0].reject(new Error('Network interrupted'));await first;
  assert(!f.button.disabled);assert.equal(f.button.getAttribute('aria-pressed'),'false');assert(!f.status.hidden);assert.equal(f.changed.length,0);
  const retry=f.root.fire(f.button);assert.deepEqual(f.calls[1].options.body,{following:true});
  f.calls[1].resolve({creatorId:creator.id,following:true,followersCount:3});await retry;
  assert.equal(f.button.getAttribute('aria-pressed'),'true');assert.equal(f.followers.textContent,'3');assert.equal(f.changed.length,1);
  const unfollow=f.root.fire(f.button);assert.deepEqual(f.calls[2].options.body,{following:false});
  f.calls[2].resolve({creatorId:creator.id,following:false,followersCount:2});await unfollow;
  assert.equal(f.button.getAttribute('aria-pressed'),'false');assert.equal(f.followers.textContent,'2');f.panel.dispose();
});

test('leaving the creator page prevents stale DOM updates but still reports a confirmed follow for cache invalidation', async () => {
  const f=uiFixture(),pending=f.root.fire(f.button);f.panel.dispose();f.root.isConnected=false;
  f.calls[0].resolve({creatorId:creator.id,following:true,followersCount:3});await pending;
  assert.equal(f.followers.textContent,'');assert.equal(f.changed.length,1);assert.equal(f.root.listeners.size,0);
  const before=f.calls.length;await f.root.fire(f.button);assert.equal(f.calls.length,before);
});
