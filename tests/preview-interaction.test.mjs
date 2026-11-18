import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {previewProfile,startPreviewInteraction} from '../lib/funtrack/preview-interaction.mjs';
function world(missing=false){
 const clicks=[],tasks=[];let current='title';
 const selectors=['#enter','[data-control="mail"]','[data-control="wheel-0"]','[data-control="wheel-1"]','[data-control="wheel-2"]','#back'];
 const elements=Object.fromEntries(selectors.map(selector=>[selector,{getBoundingClientRect:()=>({width:100,height:50,top:10,left:10,right:110,bottom:60}),getAttribute:()=>null,click(){clicks.push(selector);current=selector==='#enter'?'room':selector.includes('mail')?'mail':current;}}]));
 const document={querySelector:s=>missing&&s.includes('mail')?null:s.includes('wheel')&&current!=='mail'?null:elements[s],querySelectorAll:()=>[]};
 const context=vm.createContext({document,innerWidth:960,innerHeight:600,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),setTimeout:(fn,ms)=>tasks.push({fn,ms})});
 vm.runInContext('('+startPreviewInteraction.toString()+')('+JSON.stringify('rain-mailbox-v1')+')',context);
 for(const task of tasks.sort((a,b)=>a.ms-b.ms))task.fn();return {clicks,report:context.__trymeInteraction,tasks};
}
test('rain demonstration enters, inspects and turns real controls within the eight-second recording',()=>{
 const w=world();assert.equal(w.report.failed,false);assert.equal(w.clicks.length,7);assert.equal(w.clicks[0],'#enter');assert.equal(w.clicks.at(-1),'#back');assert.ok(w.tasks.every(t=>t.ms<6000));assert.ok(!w.clicks.some(c=>c.includes('latch')));
});
test('missing control stops the demonstration rather than reporting a static video as successful',()=>{const w=world(true);assert.equal(w.report.failed,true);assert.deepEqual(w.clicks,['#enter']);});
test('an unrelated or edited artifact never inherits the rain script by title',async()=>{assert.equal(await previewProfile('<html><h1>隔窗有雨</h1><button id="enter">走進公寓</button></html>'),null);});
