import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the actual gameplay handlers with deterministic time and DOM adapters.
// No network/API fixtures are inserted into the application.
const source=readFileSync(new URL('../public/site.js',import.meta.url),'utf8');
const handlers=source.slice(source.indexOf('function endSession('),source.indexOf('async function startGame('))+
  source.slice(source.indexOf('function receiveGame('),source.indexOf('function receiveGallery('));
class Element extends EventTarget {
  attributes=new Map();dataset={};hidden=false;innerHTML='';children=new Map();
  setAttribute(name,value){this.attributes.set(name,value);}
  removeAttribute(name){this.attributes.delete(name);}
  querySelector(selector){return this.children.get(selector);}
}
function fixture(){
  let now=0,next=0;const timers=new Map(),events=[],actions=[],displays=[];
  const scope={activeSession:null,sessionQueues:new Set(),t:value=>value,esc:value=>value,
    $:(selector,root)=>root.querySelector(selector),
    setTimeout(callback,delay){const id=++next;timers.set(id,{callback,at:now+delay});return id;},
    clearTimeout:id=>timers.delete(id),
    enqueueSession(queue,type,result){const event={type,result};events.push(event);queue.pending.push(event);},
    restoreGameCover:(work,cover)=>actions.push(['restore',work,cover]),startGame:work=>actions.push(['start',work]),
    mountGameDisplay(shell){const display={shell,disposed:false,dispose(){this.disposed=true;}};displays.push(display);return display;},
  };
  vm.createContext(scope);vm.runInContext(handlers,scope);
  function session(){
    const frame=new Element(),shell=new Element(),loadState=new Element(),expand=new Element(),retry=new Element();
    frame.contentWindow={};frame.setAttribute('src','/game/pinned#bridge=test');frame.setAttribute('aria-hidden','true');frame.setAttribute('tabindex','-1');
    shell.dataset.gameStatus='loading';shell.setAttribute('aria-busy','true');expand.hidden=true;
    shell.children.set('#expand-game',expand);loadState.children.set('[data-game-retry]',retry);
    const clock={starts:0,finishes:0,start(){this.starts++;},finish(){this.finishes++;return null;}};
    const result={frame,shell,loadState,expand,retry,clock,bridge:'test',ready:false,started:false,ended:false,queue:{pending:[],sending:false},work:{id:'work'},coverHTML:'original cover'};
    scope.sessionQueues.add(result.queue);return result;
  }
  function activate(value){scope.activeSession=value;scope.watchGameLoad(value);}
  function message(session,type,overrides={}){scope.receiveGame({source:session.frame.contentWindow,origin:'null',data:{channel:'funtrack-game',version:1,bridge:session.bridge,type},...overrides});}
  function tick(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}}
  return {scope,session,activate,message,tick,timers,events,actions,displays};
}

test('a stalled frame becomes retryable at 30 seconds and closes without a fake play or duration',()=>{
  const f=fixture(),s=f.session();f.activate(s);f.tick(29999);
  assert.equal(s.shell.dataset.gameStatus,'loading');assert.equal(f.events.length,0);
  f.tick(1);assert.equal(s.shell.dataset.gameStatus,'failed');assert.equal(s.shell.attributes.get('aria-busy'),'false');
  assert.match(s.loadState.innerHTML,/重试打开/);assert.equal(s.frame.attributes.has('src'),false);
  assert.equal(f.scope.activeSession,null);assert.equal(s.queue.closed,true);assert.equal(s.clock.starts,0);
  assert.deepEqual(f.events,[{type:'session_end',result:null}]);assert.equal(f.timers.size,0);
  s.retry.dispatchEvent(new Event('click'));s.retry.dispatchEvent(new Event('click'));
  assert.deepEqual(f.actions,[['restore',s.work,'original cover'],['start',s.work]]);
});

test('only the current opaque frame and bridge may reveal the game; ready itself is not a play',()=>{
  const f=fixture(),s=f.session();f.activate(s);const lateTimeout=[...f.timers.values()][0].callback;
  f.message(s,'ready',{origin:'https://example.test'});f.message(s,'ready',{source:{}});
  f.message(s,'ready',{data:{channel:'funtrack-game',version:1,bridge:'wrong',type:'ready'}});
  f.message(s,'input');assert.equal(s.ready,false);assert.equal(s.clock.starts,0);assert.equal(f.timers.size,1);
  f.message(s,'ready');assert.equal(s.ready,true);assert.equal(s.loadState.hidden,true);assert.equal(s.expand.hidden,false);
  assert.equal(s.frame.attributes.has('aria-hidden'),false);assert.equal(s.frame.attributes.has('tabindex'),false);
  assert.equal(f.timers.size,0);assert.equal(f.displays.length,1);assert.equal(f.events.length,0);
  lateTimeout();f.tick(30000);f.message(s,'ready');assert.equal(s.shell.dataset.gameStatus,'ready');assert.equal(f.displays.length,1);
  f.message(s,'input');f.message(s,'input');assert.equal(s.clock.starts,1);assert.deepEqual(f.events,[{type:'play_start',result:undefined}]);
});

test('exiting clears listeners and a late old frame cannot change a newer session',()=>{
  const f=fixture(),old=f.session();f.activate(old);const oldTimeout=[...f.timers.values()][0].callback;
  f.scope.endSession('route');assert.equal(f.timers.size,0);assert.equal(old.queue.closed,true);
  const current=f.session();f.activate(current);oldTimeout();old.frame.dispatchEvent(new Event('error'));f.message(old,'ready');
  assert.equal(f.scope.activeSession,current);assert.equal(current.ready,false);assert.equal(f.timers.size,1);
  assert.deepEqual(f.events,[{type:'session_end',result:null}]);
  f.message(current,'ready');f.scope.endSession('exit');assert.equal(f.displays[0].disposed,true);assert.equal(f.timers.size,0);
});

test('an explicit iframe error uses the same recoverable state and ends its session once',()=>{
  const f=fixture(),s=f.session();f.activate(s);s.frame.dispatchEvent(new Event('error'));s.frame.dispatchEvent(new Event('error'));f.tick(30000);f.message(s,'ready');
  assert.equal(s.shell.dataset.gameStatus,'failed');assert.equal(f.events.length,1);assert.equal(s.clock.finishes,1);assert.equal(f.timers.size,0);
});
