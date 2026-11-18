import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {CARD_TEMPLATES,renderPortfolioCard,mountPortfolioCard} from '../public/card-templates.js';
import {cardTemplate} from '../lib/funtrack/rules.mjs';
import {fixture} from './helpers/router-fixture.mjs';
import {setLocale} from '../public/i18n.js';

const helpers={profile:{headline:'Creator',website:'https://example.com/',signature:'Thanks'},safeCover:value=>value||'',workHref:(work,from,cardId)=>`#/work/${work.id}?from=${encodeURIComponent(from)}&card=${cardId}`,from:'/cards/me/preview',cardId:'saved-card'};
function draft(template,count=2){return {id:'preview',name:'A creator',bio:'Games made slowly.',template,works:Array.from({length:count},(_,i)=>({id:`work-${i}`,name:`Game ${i}`,desc:`About ${i}`,coverUrl:i%2?'':`https://funtrack.test/cover/${i}`}))};}

test('every offered template is server-supported and unknown HTML templates remain rejected',()=>{
  for(const choice of CARD_TEMPLATES)assert.equal(cardTemplate(choice.id),choice.id);
  assert.equal(new Set(CARD_TEMPLATES.map(choice=>choice.id)).size,6);
  for(const value of ['<script>','custom-html',null,undefined])assert.throws(()=>cardTemplate(value),{code:'INVALID_TEMPLATE'});
});

test('all templates save pinned snapshots and preserve every earlier card after a work update',async t=>{
  const f=fixture(t),{work}=await f.publish({cover:true});
  const input={name:'Original creator',bio:'Original bio',workIds:[work.id],workRefs:[{workId:work.id,versionId:work.versionId,metadataId:work.metadataId}]};
  const cards=[];
  for(const template of ['fold','wall','collection','city','editorial','filmstrip']){
    const key=randomUUID(),saved=await f.api('/api/cards',{method:'POST',key,body:{...input,template}});
    assert.equal(saved.status,201,JSON.stringify(saved));assert.equal(saved.card.template,template);assert.equal(saved.card.works[0].versionId,work.versionId);cards.push(saved.card);
  }
  const updated=await f.version(work.id);assert.equal(updated.status,201,JSON.stringify(updated));
  for(const card of cards){
    assert.deepEqual((await f.api('/api/cards/'+card.id)).card,card);
    const pinned=await f.api('/api/sessions',{method:'POST',body:{workId:card.works[0].id,versionId:card.works[0].versionId}});
    assert.equal(pinned.status,201,JSON.stringify(pinned));assert.equal(pinned.gameUrl,'/game/'+work.versionId);
  }
  assert.equal(f.count('ft_cards'),6);
  const invalid=await f.api('/api/cards',{method:'POST',body:{...input,template:'html-custom'}});assert.equal(invalid.status,422);assert.equal(f.count('ft_cards'),6);
});

test('portfolio layouts include every selected work in order at all supported layout boundaries',()=>{
  for(const template of ['editorial','filmstrip'])for(const count of [1,2,3,9,10,30]){
    const card=draft(template,count),before=structuredClone(card),html=renderPortfolioCard(card,helpers);
    assert.deepEqual([...html.matchAll(/data-card-work="([^"]+)"/g)].map(match=>match[1]),card.works.map(work=>work.id));
    assert.equal((html.match(/data-card-work=/g)||[]).length,count);
    assert(html.includes('card=saved-card'));assert(html.includes('from=%2Fcards%2Fme%2Fpreview'));
    if(template==='filmstrip')assert.equal(html.includes('data-reel-next'),count>1);
    assert.deepEqual(card,before);
  }
});

test('card profile and work text cannot become markup; Chinese and English controls stay usable',()=>{
  const card=draft('filmstrip');card.name='<script>alert(1)</script>';card.bio='"<img onerror=x>';card.works[0].name='A <button>bad</button>';card.works[0].desc='<svg onload=x>';
  for(const locale of ['zh-CN','en']){
    setLocale(locale);const html=renderPortfolioCard(card,helpers);
    assert(!html.includes('<script>'));assert(!html.includes('<svg onload'));assert(html.includes('&lt;script&gt;'));assert(html.includes('&lt;button&gt;'));
    assert(html.includes(locale==='en'?'Next work':'下一件作品'));
  }
  setLocale('zh-CN');
  assert.equal(renderPortfolioCard(draft('fold'),helpers),'');
});

test('filmstrip controls are bounded, keyboard reachable, restorable and honor reduced motion',t=>{
  const previousRAF=globalThis.requestAnimationFrame,previousMatch=globalThis.matchMedia;
  globalThis.requestAnimationFrame=callback=>callback();globalThis.matchMedia=()=>({matches:true});
  t.after(()=>{globalThis.requestAnimationFrame=previousRAF;globalThis.matchMedia=previousMatch;});
  function setup(key){
    const make=()=>({listeners:{},attrs:{},disabled:false,addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(key,value){this.attrs[key]=value;}});
    const track=make(),previous=make(),next=make(),status={textContent:''},choices=Array.from({length:3},(_,i)=>Object.assign(make(),{dataset:{reelGo:String(i)}}));
    Object.assign(track,{isConnected:true,clientWidth:500,scrollLeft:0,querySelectorAll:()=>[0,1,2].map(i=>({offsetLeft:i*500})),calls:[],scrollTo(options){this.calls.push(options);this.scrollLeft=options.left;}});
    const root={querySelector:selector=>({'.reel-track':track,'[data-reel-prev]':previous,'[data-reel-next]':next,'.reel-status':status}[selector]),querySelectorAll:()=>choices};
    mountPortfolioCard(root,key);return{track,previous,next,status,choices};
  }
  const key=randomUUID(),ui=setup(key);assert.equal(ui.previous.disabled,true);
  ui.next.listeners.click();assert.equal(ui.track.calls.at(-1).left,500);assert.equal(ui.track.calls.at(-1).behavior,'instant');assert.equal(ui.choices[1].attrs['aria-pressed'],'true');
  let prevented=false;ui.track.listeners.keydown({target:ui.track,key:'End',preventDefault(){prevented=true;}});assert(prevented);assert.equal(ui.next.disabled,true);assert.equal(ui.track.calls.at(-1).left,1000);
  const restored=setup(key);assert.equal(restored.track.calls.at(-1).left,1000);assert.equal(restored.next.disabled,true);
  restored.track.scrollLeft=0;restored.track.listeners.scroll();assert.equal(restored.previous.disabled,true);assert.equal(restored.choices[0].attrs['aria-pressed'],'true');
  globalThis.matchMedia=()=>({matches:false});
  restored.track.scrollTo=options=>restored.track.calls.push(options);
  restored.next.listeners.click();restored.track.scrollLeft=100;restored.track.listeners.scroll();
  restored.next.listeners.click();assert.equal(restored.track.calls.at(-1).left,1000);assert.equal(restored.choices[2].attrs['aria-pressed'],'true');
  restored.track.scrollLeft=1000;restored.track.listeners.scroll();assert.equal(restored.next.disabled,true);
  restored.track.listeners.wheel();restored.track.scrollLeft=0;restored.track.listeners.scroll();assert.equal(restored.previous.disabled,true);
});
