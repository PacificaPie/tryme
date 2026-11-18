import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {CARD_TEMPLATES,renderPortfolioCard} from '../public/card-templates.js';
import {createTemplateSample,renderTemplateSample} from '../public/card-template-experience.js';
import {avatarMarkup,safeAvatarURL} from '../public/avatars.js';
import {loadingMark} from '../public/empty-state.js';
import {t,getLocale,setLocale,registerMessages} from '../public/i18n.js';
import '../public/site.messages.js';

test('all five experiences use bundled sample works, safe profile presentation, and no copied account or draft state',()=>{
  const catalog=JSON.parse(readFileSync(new URL('../public/examples/catalog.json',import.meta.url),'utf8'));
  const user={id:'real-account',name:'<b>Creator</b>',avatarUrl:'/avatars/sun.svg',website:'https://external.test',workIds:['private-work'],draft:{secret:true}};
  const before=structuredClone(user);
  for(const template of CARD_TEMPLATES){
    const card=createTemplateSample(template,user);
    assert.equal(card.template,template.id);assert.equal(card.authorId,'template-sample');assert.match(card.name,/示例名片/);
    assert.equal(card.avatarUrl,user.avatarUrl);assert.equal(card.website,'');assert.equal(card.works.length,3);
    assert(!JSON.stringify(card).includes('real-account'));assert(!JSON.stringify(card).includes('private-work'));
    for(const work of card.works){const asset=catalog.find(item=>item.id===work.id);assert(asset);assert.equal(work.coverUrl,asset.cover);assert(existsSync(new URL('../public'+work.coverUrl,import.meta.url)));}
    card.works[0].name='Changed';assert.notEqual(createTemplateSample(template,user).works[0].name,'Changed');
  }
  assert.deepEqual(user,before);assert.equal(createTemplateSample('wall',{avatarUrl:'https://foreign.test/a.png'}).avatarUrl,'');
  assert.throws(()=>createTemplateSample('unknown'),TypeError);
});

test('the actual templates render interactive layouts with local sample destinations instead of real-work routes',()=>{
  for(const template of CARD_TEMPLATES){
    const html=renderTemplateSample(createTemplateSample(template,{name:'<script>bad</script>',avatarUrl:'/avatars/moon.svg'}));
    assert.doesNotMatch(html,/<script>|\/api\/|\/game\/|#\/work\//);
    for(const sample of ['arc-hoops','tiles','memory-tide'])assert(html.includes('/examples/'+sample+'.png'));
    if(['fold','collection'].includes(template.id)){
      assert(html.includes('data-template-frame'));assert(html.includes(`src="/${template.id==='fold'?'gallery':'collection'}/?lang=`));assert(html.includes('template-experience-fallback'));
    }else{
      assert(html.includes('&lt;script&gt;'));assert(!html.includes('<iframe'));
      assert(html.includes(`href="#/cards/templates/${template.id}?sample=arc-hoops"`));
    }
    if(template.id==='editorial')assert(html.includes('portfolio-stories'));
    if(template.id==='filmstrip'){assert(html.includes('reel-track'));assert(html.includes('data-reel-next'));assert(html.includes('data-reel-go="2"'));}
  }
});

const source=ts.createSourceFile('card-template-experience.js',readFileSync(new URL('../public/card-template-experience.js',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const executable=source.statements.filter(node=>!ts.isImportDeclaration(node)).map(node=>node.getText(source).replace(/^export\s+/, '')).join('\n');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {resolve,promise};};

function fixture(template='wall',callbacks={}){
  const bridges=[],portfolios=[],bodyNodes=[];
  class Node {
    nodes=[];listeners=new Map();attributes=new Map();style={};dataset={};hidden=false;isConnected=true;disabled=false;textContent='';_html='';
    constructor(tag='div',raw=''){this.tag=tag;for(const match of raw.matchAll(/([\w:-]+)(?:="([^"]*)")?/g))this.setAttribute(match[1],match[2]??'');}
    setAttribute(name,value){this.attributes.set(name,String(value));if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=String(value);if(name==='class')this.className=value;if(name==='hidden')this.hidden=true;}
    getAttribute(name){return this.attributes.get(name)??null;}hasAttribute(name){return this.attributes.has(name);}
    set innerHTML(value){this._html=value;this.nodes=[...value.matchAll(/<([a-z][\w:-]*)(\s[^>]*|)>/gi)].map(match=>new Node(match[1],match[2]));for(const node of this.nodes)node.parent=this;}
    get innerHTML(){return this._html;}
    matches(selector){return selector.split(',').some(value=>value.startsWith('.')?(this.className||'').split(' ').includes(value.slice(1)):value.startsWith('[')?this.hasAttribute(value.slice(1,-1)):this.tag===value);}
    closest(selector){return this.matches(selector)?this:this.parent?.closest(selector)||null;}
    querySelectorAll(selector){return this.nodes.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    contains(node){return this===node||this.nodes.some(child=>child.contains(node));}
    addEventListener(type,callback){const values=this.listeners.get(type)||new Set();values.add(callback);this.listeners.set(type,values);}
    removeEventListener(type,callback){this.listeners.get(type)?.delete(callback);}
    async fire(type,event={}){const dispatched={type,target:this,preventDefault(){this.prevented=true;},...event};await Promise.all([...(this.listeners.get(type)||[])].map(callback=>callback(dispatched)));return dispatched;}
    showModal(){this.open=true;}close(){this.open=false;void this.fire('close');}
    remove(){this.isConnected=false;this.nodes.forEach(node=>{node.isConnected=false;});}
    focus(){document.activeElement=this;}
    getBoundingClientRect(){return {left:0,top:0,right:600,bottom:600};}
  }
  const root=new Node(),events=new Node('window'),document={activeElement:new Node('button'),createElement:tag=>new Node(tag),body:{append:node=>bodyNodes.push(node)}};
  const context=vm.createContext({t,getLocale,registerMessages,CARD_TEMPLATES,renderPortfolioCard,avatarMarkup,safeAvatarURL,loadingMark,document,window:events,location:{origin:'https://funtrack.test'},
    closeDialog:dialog=>{dialog.close();return Promise.resolve();},mountPortfolioCard:(root,key)=>portfolios.push({root,key}),
    createGalleryBridge:options=>{const bridge={options,retries:0,disposed:false,retry(){this.retries++;options.onStatus('loading');},dispose(){this.disposed=true;}};bridges.push(bridge);options.onStatus('loading');return bridge;},
    fetch:()=>assert.fail('Template previews must not request application APIs'),
  });
  vm.runInContext(executable,context);
  const panel=context.mountTemplateExperience(root,{template,user:{name:'Visitor',avatarUrl:'/avatars/moon.svg'},...callbacks});
  return {root,events,document,bodyNodes,bridges,portfolios,panel,get modal(){return bodyNodes.at(-1);},click:target=>root.fire('click',{target})};
}

test('sample cards open an accessible local explanation; closing restores focus and never selects a template',async()=>{
  let uses=0;const f=fixture('wall',{onUse:()=>uses++});
  const link=f.root.querySelector('[data-card-work]');f.document.activeElement=link;
  const event=await f.click(link);assert.equal(event.prevented,true);assert.equal(uses,0);
  assert.equal(f.modal.open,true);assert.equal(f.modal.getAttribute('aria-labelledby'),'template-sample-title');
  assert.match(f.modal.innerHTML,/示例作品，制作时可换成你的作品/);assert.doesNotMatch(f.modal.innerHTML,/<iframe|\/game\/|\/api\//);
  await f.modal.fire('cancel');assert.equal(f.modal.open,false);assert.equal(f.document.activeElement,link);
  await f.click(link);await f.modal.fire('click',{clientX:700,clientY:700});assert.equal(f.modal.open,false);
  f.panel.dispose();assert.equal(f.modal.isConnected,false);
});

test('filmstrip keeps the real portfolio controller and intercepts both cover and caption links',async()=>{
  const f=fixture('filmstrip');assert.equal(f.portfolios.length,1);assert.equal(f.portfolios[0].key,'template-experience:filmstrip');
  const caption=f.root.querySelectorAll('a').find(node=>!node.hasAttribute('data-card-work')&&node.getAttribute('href')?.includes('?sample='));
  assert(caption);const event=await f.click(caption);assert.equal(event.prevented,true);assert.equal(f.modal.open,true);
  await f.modal.fire('cancel');const auxiliary=await f.root.fire('auxclick',{target:caption});assert.equal(auxiliary.prevented,true);assert.equal(f.modal.open,false);
  f.panel.dispose();
});

test('3D samples send only demonstration data, validate frame messages, and keep a usable retry fallback',async()=>{
  for(const template of ['fold','collection']){
    const f=fixture(template),bridge=f.bridges[0],frame=f.root.querySelector('[data-template-frame]');frame.contentWindow={};
    assert.equal(f.portfolios.length,0);const payload=bridge.options.payload();
    assert.equal(payload.author.id,'template-sample');assert.equal(payload.author.avatarUrl,'/avatars/moon.svg');assert.equal(payload.works.length,3);
    assert.equal(payload.open,false);assert.equal(payload.inside,false);assert(payload.works.every(work=>work.cover.startsWith('/examples/')&&!work.url));
    const message={source:frame.contentWindow,origin:'https://funtrack.test',data:{type:'funtrack:gallery:open-work',workId:'arc-hoops',play:true}};
    await f.events.fire('message',{...message,origin:'https://foreign.test'});assert.equal(f.modal,undefined);
    await f.events.fire('message',{...message,source:{}});assert.equal(f.modal,undefined);
    await f.events.fire('message',{...message,data:{...message.data,workId:'real-private-id'}});assert.equal(f.modal,undefined);
    await f.events.fire('message',message);assert.equal(f.modal.open,true);
    await f.events.fire('message',{...message,data:{type:'funtrack:gallery:resize',height:99999}});assert.equal(frame.style.height,'1600px');
    await f.events.fire('message',{...message,data:{type:'funtrack:gallery:state',open:true,inside:true,page:999,yaw:999,focusWorkId:'not-a-sample'}});
    const next=bridge.options.payload();assert.equal(next.page,0);assert.equal(next.yaw,1.3);assert.equal(next.focusWorkId,null);
    bridge.options.onStatus('timeout');assert.equal(frame.hidden,true);assert.equal(f.root.querySelector('.template-experience-fallback').hidden,false);
    await f.click(f.root.querySelector('[data-template-retry]'));assert.equal(bridge.retries,1);assert.equal(frame.hidden,false);
    bridge.options.onStatus('rendered');assert.equal(f.root.querySelector('.gallery-load-status').hidden,true);assert.equal(frame.style.visibility,'');
    const modal=f.modal;f.panel.dispose();assert.equal(bridge.disposed,true);assert.equal(modal.isConnected,false);
    assert.equal(f.events.listeners.get('message').size,0);assert.equal(f.root.listeners.get('click').size,0);
    await f.events.fire('message',message);assert.equal(modal.open,false);
  }
});

test('use is the only selection action, ignores double clicks and stops late UI changes after disposal',async()=>{
  const pending=deferred(),uses=[];let back=0;
  const f=fixture('editorial',{onUse:id=>{uses.push(id);return pending.promise;},onBack:()=>back++});
  const backEvent=await f.click(f.root.querySelector('[data-template-back]'));assert.equal(backEvent.prevented,true);assert.equal(back,1);assert.deepEqual(uses,[]);
  const use=f.root.querySelector('[data-use-template]'),first=f.click(use);assert.equal(use.disabled,true);
  await f.click(use);assert.deepEqual(uses,['editorial']);f.panel.dispose();pending.resolve();await first;
  assert.equal(use.disabled,true);assert.equal(f.root.querySelector('.template-experience-shell').isConnected,false);
  await f.click(use);assert.deepEqual(uses,['editorial']);
});

test('template and sample copy supports English without translating a supplied creator name',()=>{
  setLocale('en');
  try{
    const card=createTemplateSample('filmstrip',{name:'小林'}),html=renderTemplateSample(card);
    assert.equal(card.name,'小林’s sample card');assert.equal(card.works[0].name,'Arc hoops · Demo');
    assert.match(html,/Next work/);assert.doesNotMatch(html,/查看示例作品|模板体验/);
  }finally{setLocale('zh-CN');}
});
