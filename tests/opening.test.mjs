import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createOpening, OPENING_SEEN_KEY} from '../public/opening.js';

const source = file => readFileSync(new URL('../public/'+file,import.meta.url),'utf8');
const classes = () => {const values=new Set();return {add(...v){v.forEach(x=>values.add(x));},remove(...v){v.forEach(x=>values.delete(x));},contains:v=>values.has(v)};};
function harness(t,{guard=true,reduced=false}={}) {
  t.mock.timers.enable({apis:['setTimeout']});
  const listeners=new Map(),messages=[],values=new Map();
  let doc;
  class Element {
    constructor(tag){this.tag=tag;this.children=[];this.classList=classes();this.style={};this.attributes={};this.events={};this.hidden=false;this.disabled=false;this.contentWindow={postMessage:(...args)=>messages.push(args)};}
    setAttribute(k,v){this.attributes[k]=v;} removeAttribute(k){delete this.attributes[k];}
    addEventListener(k,fn){this.events[k]=fn;}
    append(el){this.children.push(el);el.parent=this;}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);this.removed=true;}
    focus(){doc.activeElement=this;}
    contains(el){return el===this||this.children.some(c=>c.contains(el));}
    querySelector(selector){return this.children.find(el=>el.selector===selector||el.id===selector.slice(1))||this.children.map(el=>el.querySelector(selector)).find(Boolean);}
    querySelectorAll(){return this.children.filter(el=>el.tag==='button'&&!el.disabled);}
    set innerHTML(_){
      const cover=new Element('div');cover.selector='.opening-boot';this.append(cover);
      const actions=new Element('div');actions.selector='.opening-actions';actions.hidden=true;this.append(actions);
      for(const name of ['explore','flip']){const b=new Element('button');b.selector='[data-'+name+']';actions.append(b);}
    }
    click(){this.events.click?.({currentTarget:this,preventDefault(){},stopPropagation(){}});}
    animate(frames,options){this.animation={frames,options};return {finished:new Promise(()=>{}),cancel(){}};}
  }
  const shell=new Element('div');shell.id='site-shell';
  const main=new Element('main');main.id='main';shell.append(main);
  const body=new Element('body');body.append(shell);
  doc={body,activeElement:null,querySelector:s=>body.querySelector(s),createElement:tag=>new Element(tag)};
  const boot={active:guard,startedAt:0,release(){this.active=false;shell.inert=false;shell.removeAttribute('aria-hidden');}};
  const media={matches:reduced,addEventListener(k,fn){this.listener=fn;},removeEventListener(){}};
  const win={OpeningBoot:boot,performance:{now:()=>0},location:{origin:'https://tryme.test'},matchMedia:()=>media,
    localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},sessionStorage:{getItem:()=>null,setItem(){}},
    addEventListener(k,fn){listeners.set(k,fn);},removeEventListener(k){listeners.delete(k);}};
  const opening=createOpening({document:doc,window:win});
  const overlay=()=>doc.querySelector('#site-opening');
  const frame=()=>overlay()?.children.find(el=>el.tag==='iframe');
  const emit=(type,extra={})=>listeners.get('message')?.({origin:win.location.origin,source:frame()?.contentWindow,data:{channel:'tryme-opening',type,...extra}});
  return {opening,overlay,frame,emit,win,doc,shell,main,boot,values,listeners,messages,media,
    resolve:(extra={})=>opening.resolve({path:'/feed',authenticated:false,checked:true,...extra})};
}

test('gallery is 20% slower; front gets 2.5 seconds before a complete 1.3-second flip',()=>{
  const context={window:{},URLSearchParams};vm.runInNewContext(source('opening/timing.js'),context);
  const timing=context.window.OpeningTiming,s=timing.resolve();
  assert.equal(6/s.gallery,.8);
  const settled=s.gallery+s.morph+s.city+s.settle;
  assert.equal(s.hold,2.5);assert.equal(timing.flipAt(settled+2.49,s),0);
  assert.ok(Math.abs(timing.flipAt(settled+2.5+.65,s)-Math.PI/2)<1e-10);
  assert.equal(timing.flipAt(timing.duration(s),s),Math.PI);
  assert.equal(timing.sourceAt(timing.duration(s)+60,s),timing.sourceAt(settled,s));
});

test('ready keeps the logo through warmup and the fade before starting playback',t=>{
  const h=harness(t);assert.equal(h.shell.inert,true);h.resolve();
  assert.equal(h.boot.active,false);assert.equal(h.shell.inert,true);assert.equal(h.values.get(OPENING_SEEN_KEY),'1');
  h.emit('ready');t.mock.timers.tick(799);assert.equal(h.messages.length,0);
  t.mock.timers.tick(1);assert.equal(h.overlay().querySelector('.opening-boot').classList.contains('opening-boot-ready'),true);
  t.mock.timers.tick(319);assert.equal(h.messages.length,0);t.mock.timers.tick(1);
  assert.equal(h.messages[0][0].type,'start');assert.equal(h.overlay().querySelector('.opening-boot'),undefined);
  h.opening.cancel();
});

test('complete holds indefinitely; background clicks do not exit, flip stays in place, Explore raises Feed',t=>{
  const h=harness(t);h.resolve();h.emit('ready');t.mock.timers.tick(1120);h.emit('complete');
  const overlay=h.overlay(),actions=overlay.querySelector('.opening-actions');
  assert.equal(actions.hidden,false);t.mock.timers.tick(60000);assert.equal(h.overlay(),overlay);
  overlay.click();assert.equal(h.overlay(),overlay);assert.equal(overlay.animation,undefined);
  const flip=actions.querySelector('[data-flip]');flip.click();assert.equal(flip.disabled,true);assert.equal(h.messages.at(-1)[0].type,'flip');
  h.emit('flipped',{back:false});assert.equal(flip.disabled,false);assert.equal(flip.textContent,'翻到背面');
  actions.querySelector('[data-explore]').click();assert.equal(h.shell.animation.options.duration,900);
  assert.equal(h.shell.animation.frames[0].transform,'translateY(100dvh)');
  t.mock.timers.tick(1100);assert.equal(h.overlay(),undefined);assert.equal(h.shell.inert,false);assert.equal(h.doc.activeElement,h.main);
});

test('skip during playback cancels pending start and ignores late messages',t=>{
  const h=harness(t);h.resolve();h.emit('ready');h.overlay().click();
  h.emit('complete');t.mock.timers.tick(2000);
  assert.equal(h.overlay(),undefined);assert.equal(h.messages.length,0);assert.equal(h.shell.inert,false);
});

test('unknown messages cannot reveal, complete or dismiss another frame',t=>{
  const h=harness(t);h.resolve();const message=h.listeners.get('message');
  message({origin:'https://evil.test',source:h.frame().contentWindow,data:{channel:'tryme-opening',type:'complete'}});
  message({origin:h.win.location.origin,source:{},data:{channel:'tryme-opening',type:'failed'}});
  assert.equal(h.overlay().querySelector('.opening-actions').hidden,true);
  t.mock.timers.tick(12000);assert.equal(h.overlay(),undefined);assert.equal(h.shell.inert,false);
});

test('auth, seen, direct routes, reduced motion and expired guard release the shell without a film',t=>{
  const h=harness(t);h.resolve({authenticated:true});assert.equal(h.overlay(),undefined);assert.equal(h.shell.inert,false);assert.equal(h.boot.active,false);
  assert.equal(h.values.get(OPENING_SEEN_KEY),'1');
});
for(const scenario of ['seen','deep-link','reduced','expired','unchecked'])test('no film for '+scenario,t=>{
  const h=harness(t,{reduced:scenario==='reduced'});
  if(scenario==='seen')h.values.set(OPENING_SEEN_KEY,'1');if(scenario==='expired')h.boot.expired=true;
  h.resolve({path:scenario==='deep-link'?'/work/abc':'/feed',checked:scenario!=='unchecked'});
  assert.equal(h.overlay(),undefined);assert.equal(h.shell.inert,false);assert.equal(h.boot.active,false);
});

test('route cancellation and motion preference changes remove loading/film and restore interaction',t=>{
  const h=harness(t);h.resolve();h.media.matches=true;h.media.listener();
  assert.equal(h.overlay(),undefined);assert.equal(h.shell.inert,false);assert.equal(h.listeners.size,0);
  h.opening.cancel();assert.equal(h.boot.active,false);
});

test('head guard blocks first Feed paint, but times out safely if site/auth never boots',()=>{
  const root={classList:classes()},timers=[];const shell={inert:true,removeAttribute(){}};
  const context={window:{},document:{documentElement:root,getElementById:()=>shell},location:{hash:'#/feed'},
    performance:{now:()=>100},localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null},matchMedia:()=>({matches:false}),
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return 1;},clearTimeout(){}};
  vm.runInNewContext(source('opening-init.js'),context);
  assert.equal(root.classList.contains('opening-pending'),true);assert.equal(timers[0].ms,12000);
  timers[0].fn();assert.equal(root.classList.contains('opening-pending'),false);assert.equal(context.window.OpeningBoot.expired,true);assert.equal(shell.inert,false);
  context.location.hash='#/work/abc';timers.length=0;vm.runInNewContext(source('opening-init.js'),context);assert.equal(timers.length,0);
});

test('bridge starts paused and accepts start/flip only from its own parent',()=>{
  const events={},sent=[],parent={postMessage:data=>sent.push(data)};
  const context={window:{},parent,location:{origin:'https://tryme.test'},URLSearchParams,addEventListener:(type,fn)=>events[type]=fn};
  vm.runInNewContext(source('opening/timing.js'),context);vm.runInNewContext(source('opening/bridge.js'),context);
  const seq=context.window.OpeningSequence;assert.equal(seq.paused,true);
  const message=(type,extra={})=>events.message({source:parent,origin:context.location.origin,data:{channel:'tryme-opening',type},...extra});
  message('start');assert.equal(seq.paused,true);seq.ready=true;
  message('start',{source:{}});assert.equal(seq.paused,true);message('start');assert.equal(seq.paused,false);
  let flipped=0;seq.flip=()=>flipped++;message('flip');assert.equal(flipped,0);seq.completed=true;message('flip');assert.equal(flipped,1);
});
