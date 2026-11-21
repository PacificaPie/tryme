import test from 'node:test';
import assert from 'node:assert/strict';
import {attachCityGestures} from '../public/lit-city/gestures.js';

function harness(interrupted=false) {
  const canvas=new EventTarget(),classes=new Set(),captures=new Set(),calls=[];
  canvas.classList={add:v=>classes.add(v),remove:v=>classes.delete(v)};
  canvas.setPointerCapture=id=>captures.add(id);canvas.hasPointerCapture=id=>captures.has(id);canvas.releasePointerCapture=id=>captures.delete(id);
  const gestures=attachCityGestures(canvas,{onStart:()=>interrupted,onEnd:()=>calls.push(['end']),onHover:e=>calls.push(['hover',e?.clientX]),onTap:e=>calls.push(['tap',e.pointerType]),onDrag:(x,y)=>calls.push(['drag',x,y])});
  function send(type,fields={}){const event=new Event(type);Object.assign(event,{pointerId:1,pointerType:'mouse',button:0,isPrimary:true,clientX:20,clientY:20},fields);canvas.dispatchEvent(event);}
  return {send,calls,classes,captures,gestures};
}
test('hover and tap stay separate from pointer-captured dragging outside the card',()=>{
  const h=harness();h.send('pointermove');assert.equal(h.calls[0][0],'hover');
  h.send('pointerdown');h.send('pointermove',{clientX:23});h.send('pointerup');assert.equal(h.calls.filter(c=>c[0]==='tap').length,1);
  h.calls.length=0;h.send('pointerdown');h.send('pointermove',{clientX:70,clientY:40});h.send('pointerleave');h.send('pointerup',{clientX:900});
  assert.deepEqual(h.calls,[['drag',50,20],['end']]);assert.equal(h.captures.size,0);assert.equal(h.classes.size,0);
});
test('touch tapping forwards a touch activation; cancellation and multitouch never activate',()=>{
  const h=harness();h.send('pointerdown',{pointerType:'touch'});h.send('pointerup',{pointerType:'touch'});assert.equal(h.calls.at(-1)[1],'touch');
  h.calls.length=0;h.send('pointerdown',{pointerType:'touch'});h.send('pointercancel');h.send('pointerup');
  h.send('pointerdown',{pointerType:'touch'});h.send('pointerdown',{pointerId:2,pointerType:'touch',isPrimary:false});h.send('pointerup',{pointerId:2});h.send('pointerup');
  assert.equal(h.calls.filter(c=>c[0]==='tap').length,0);assert.equal(h.captures.size,0);
});
test('a tap that takes over the automatic intro does not accidentally open a work',()=>{
  const h=harness(true);h.send('pointerdown');h.send('pointerup');assert.deepEqual(h.calls,[['end']]);
  h.send('pointerdown');h.send('pointermove',{clientX:50});h.send('pointerup');assert.equal(h.calls.filter(c=>c[0]==='drag').length,1);assert.equal(h.calls.filter(c=>c[0]==='tap').length,0);
});
test('pause, lost capture and disposal release gestures and cannot leave stuck drag state',()=>{
  const h=harness();h.send('pointerdown');h.send('pointermove',{clientY:60});h.gestures.cancel();h.send('pointerup');assert.equal(h.classes.size,0);assert.equal(h.captures.size,0);
  h.send('pointerdown');h.send('lostpointercapture');h.send('pointerup');assert.equal(h.calls.filter(c=>c[0]==='tap').length,0);
  h.gestures.dispose();const count=h.calls.length;h.send('pointerdown');h.send('pointermove');h.send('pointerup');assert.equal(h.calls.length,count);
});
