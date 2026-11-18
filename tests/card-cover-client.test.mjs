import test from 'node:test';
import assert from 'node:assert/strict';
import {renderCardCoverUpdates} from '../public/card-cover-updates.js';
const id='old-card',owner='owner';
const data={card:{id,authorId:owner},updates:[{workId:'work-one',metadataId:'meta-one',name:'<script>name</script>',previousCoverUrl:'',coverUrl:'/media/meta-one'},{workId:'work-two',metadataId:'meta-two',name:'Two',coverUrl:'/media/meta-two'}]};
class Node {listeners={};disabled=false;textContent='';addEventListener(type,fn){this.listeners[type]=fn;}fire(type){return this.listeners[type]?.({preventDefault(){}});}}
function fixture(){
  const form=new Node(),button=new Node(),error=new Node(),inputs=[0,1].map(value=>({value:String(value),checked:true,disabled:false})),requests=[],saved=[],renders=[];let current=true;
  form.querySelector=selector=>selector==='button[type=submit]'?button:error;form.querySelectorAll=()=>inputs;
  const h={owner,root:{querySelector:()=>form},esc:value=>String(value||'').replaceAll('<','&lt;').replaceAll('>','&gt;'),safeCover:value=>value||'',isCurrent:()=>current,render:html=>{renders.push(html);return true;},onSaved:card=>saved.push(card),api:async(path,options)=>{if(!options.method)return structuredClone(data);return new Promise((resolve,reject)=>requests.push({path,options,resolve,reject}));}};
  return {h,form,button,error,inputs,requests,saved,renders,leave:()=>{current=false;}};
}
test('cover form escapes content, requires selection and retries an uncertain save with the same frozen references and key',async()=>{
  const f=fixture();await renderCardCoverUpdates(id,f.h);assert(!f.renders[0].includes('<script>'));assert(f.renders[0].includes('&lt;script&gt;'));
  f.inputs.forEach(i=>i.checked=false);f.form.fire('change');assert(f.button.disabled);await f.form.fire('submit');assert.equal(f.requests.length,0);
  f.inputs[0].checked=true;f.form.fire('change');const pending=f.form.fire('submit');await f.form.fire('submit');assert.equal(f.requests.length,1);assert(f.inputs.every(i=>i.disabled));
  f.requests[0].reject(Error('Network interrupted'));await pending;assert(!f.button.disabled);assert.equal(f.error.textContent,'Network interrupted');
  const retry=f.form.fire('submit');assert.deepEqual(f.requests[1].options.body,{updates:[{workId:'work-one',metadataId:'meta-one'}]});
  assert.equal(f.requests[1].options.headers['Idempotency-Key'],f.requests[0].options.headers['Idempotency-Key']);
  f.requests[1].resolve({card:{id:'new-card',authorId:owner}});await retry;assert.equal(f.saved.length,1);
});
test('route/account changes suppress a delayed load, success and error',async()=>{
  const loaded=fixture();let resolve;loaded.h.api=()=>new Promise(r=>resolve=r);const load=renderCardCoverUpdates(id,loaded.h);loaded.leave();resolve(data);await load;assert.equal(loaded.renders.length,0);
  for(const outcome of ['success','failure']){
    const f=fixture();await renderCardCoverUpdates(id,f.h);const save=f.form.fire('submit');f.leave();
    if(outcome==='success')f.requests[0].resolve({card:{id:'new-card',authorId:owner}});else f.requests[0].reject(Error('Late error'));
    await save;assert.equal(f.saved.length,0);assert.equal(f.error.textContent,'');
  }
});
test('new choices get a new retry key and mismatched save receipts cannot navigate to another account’s card',async()=>{
  const f=fixture();await renderCardCoverUpdates(id,f.h);let pending=f.form.fire('submit');f.requests[0].resolve({card:{id:'other-card',authorId:'other'}});await pending;assert.equal(f.saved.length,0);
  f.inputs[1].checked=false;f.form.fire('change');pending=f.form.fire('submit');assert.notEqual(f.requests[0].options.headers['Idempotency-Key'],f.requests[1].options.headers['Idempotency-Key']);
  f.requests[1].resolve({card:{id:'new-card',authorId:owner}});await pending;assert.equal(f.saved.length,1);
});
test('an outdated source offers a route to the current card instead of a save button or endless reload',async()=>{
  const f=fixture();f.h.api=async()=>{throw Object.assign(Error('当前名片已变化，请返回我的名片后重试。'),{status:409});};
  await renderCardCoverUpdates(id,f.h);assert(f.renders[0].includes('href="#/cards"'));assert(!f.renders[0].includes('card-cover-form'));assert.equal(f.requests.length,0);
});
