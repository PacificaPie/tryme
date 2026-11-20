import test from 'node:test';
import assert from 'node:assert/strict';
import {feedCardTile,mountCardDiscovery} from '../public/feed-card.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('creator card has one public destination, escaped text, fixed snapshot labels and no play/preview/social surface',()=>{
  const html=feedCardTile({id:'creator-card',name:'<script>person</script>',bio:'<img onerror=bad>',headline:'Maker',works:[{name:'<old title>',version:'v1',coverUrl:'https://private.example/asset'}]},{esc});
  assert.match(html,/href="\/c\/creator-card"/);assert.match(html,/打开名片/);assert.match(html,/&lt;old title&gt;/);assert.match(html,/v1/);
  assert.doesNotMatch(html,/<script>|<img onerror|private.example|data-work-id|preview|like|试玩|\/work\//);
});
function fixture(){
  const nodes=new Map(),calls=[];const root={isConnected:true,innerHTML:'',querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{hidden:false,disabled:false,textContent:'',addEventListener(_type,callback){this.click=callback;}});return nodes.get(selector);}};
  const api=(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,resolve,reject}));return {root,calls,api,button:()=>root.querySelector('[data-card-feed-choice]'),error:()=>root.querySelector('[data-card-feed-error]')};
}
const settle=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
test('opt-in stays off until an explicit click, sends revision, blocks double submits and updates on success',async()=>{
  const f=fixture();let changed=0;const panel=mountCardDiscovery(f.root,{api:f.api,cardId:'card-12345',onChange:()=>changed++});
  assert.equal(f.calls.length,1);assert(!f.calls[0].options.method);f.calls[0].resolve({discovery:{listed:false,revision:0}});await settle();
  assert.match(f.button().textContent,/允许/);const pending=f.button().click();f.button().click();assert.equal(f.calls.length,2);assert.equal(f.button().disabled,true);
  assert.deepEqual(f.calls[1].options.body,{listed:true,expectedRevision:0});f.calls[1].resolve({discovery:{listed:true,revision:4}});await pending;
  assert.equal(changed,1);assert.match(f.button().textContent,/撤回/);const remove=f.button().click();assert.deepEqual(f.calls[2].options.body,{listed:false,expectedRevision:4});f.calls[2].resolve({discovery:{listed:false,revision:5}});await remove;panel.dispose();
});
test('disposal aborts pending read/write and a stale response cannot alter another route',async()=>{
  const f=fixture();let changed=0;const panel=mountCardDiscovery(f.root,{api:f.api,cardId:'card-12345',onChange:()=>changed++});
  f.calls[0].resolve({discovery:{listed:false,revision:0}});await settle();const pending=f.button().click();panel.dispose();
  assert.equal(f.calls[1].options.signal.aborted,true);f.calls[1].resolve({discovery:{listed:true,revision:4}});await pending;assert.equal(changed,0);
});
test('conflicting choice is surfaced and reread instead of silently overwriting another tab',async()=>{
  const f=fixture(),panel=mountCardDiscovery(f.root,{api:f.api,cardId:'card-12345'});
  f.calls[0].resolve({discovery:{listed:false,revision:0}});await settle();const pending=f.button().click();f.calls[1].reject(Error('名片展示状态已变化，请刷新后重试。'));await settle();assert.equal(f.calls.length,3);
  f.calls[2].resolve({discovery:{listed:false,revision:9}});await pending;assert.match(f.error().textContent,/已变化/);
  const retry=f.button().click();assert.deepEqual(f.calls[3].options.body,{listed:true,expectedRevision:9});f.calls[3].resolve({discovery:{listed:true,revision:10}});await retry;panel.dispose();
});
