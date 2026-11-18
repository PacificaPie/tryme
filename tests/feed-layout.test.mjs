import test from 'node:test';
import assert from 'node:assert/strict';
import {feedColumns,feedCoverRatio,shortestColumnLayout,mountFeedLayout} from '../public/feed-layout.js';

test('shortest-column layout preserves top-to-bottom server order and breaks ties left to right',()=>{
  const layout=shortestColumnLayout([200,100,300,90,180,70],640,{columns:3,columnWidth:200,gap:20,rowGap:20});
  assert.deepEqual(layout.items.map(item=>[item.column,item.y]),[[0,0],[1,0],[2,0],[1,120],[0,220],[1,230]]);
  for(let i=1;i<layout.items.length;i++)assert(layout.items[i].y>=layout.items[i-1].y);
  assert.equal(layout.height,400);
});
test('appending a page does not move the existing cards',()=>{
  const before=[190,310,160,250,120,360],later=[...before,210,140,300];
  const first=shortestColumnLayout(before,1000),next=shortestColumnLayout(later,1000);
  assert.deepEqual(next.items.slice(0,before.length),first.items);
});
test('cards do not overlap or leave their container across responsive column counts',()=>{
  const heights=[80,240,320,140,175,300,90,360,200,180,210,100];
  for(const width of [280,350,590,720,1000,1450]){
    const layout=shortestColumnLayout(heights,width),options=feedColumns(width);
    assert(options.columnWidth>0);assert.equal(layout.items.length,heights.length);
    layout.items.forEach((item,i)=>{
      assert(item.x>=0&&item.x+item.width<=width+0.001);
      assert(item.y+heights[i]<=layout.height+0.001);
      layout.items.slice(i+1).forEach((other,j)=>{if(other.column===item.column)assert(other.y>=item.y+heights[i]+options.rowGap);});
    });
  }
});
test('image framing is stable by work, keeps portrait ratios and never depends on feed rank',()=>{
  assert.equal(feedCoverRatio('portrait',.75),.75);
  assert.equal(feedCoverRatio('square',1),1);
  const ratio=feedCoverRatio('fixed-work',1.6);
  assert.equal(feedCoverRatio('fixed-work',1.6),ratio);
  assert.equal(ratio,1.6);
  for(const natural of [0.3,0.75,1,1.6,2.8,4])for(const id of ['one','two','three'])assert.equal(feedCoverRatio(id,natural),natural,'loaded frames match their image without letterboxing');
  assert.equal(feedCoverRatio('fixed-work'),feedCoverRatio('fixed-work'));
  assert(Number.isFinite(feedCoverRatio('bad',NaN)));
});
test('removing the route host disconnects observers and cancels queued layout work without a caller disposer',()=>{
  const keys=['window','ResizeObserver','MutationObserver','requestAnimationFrame','cancelAnimationFrame'];
  const saved=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const observers=[],cancelled=[];
  class Observer{constructor(callback){this.callback=callback;this.disconnected=false;observers.push(this);}observe(){}unobserve(){}disconnect(){this.disconnected=true;}}
  try{
    globalThis.window={scrollY:0,removeEventListener(){},addEventListener(){}};
    globalThis.ResizeObserver=Observer;globalThis.MutationObserver=Observer;
    globalThis.requestAnimationFrame=()=>17;globalThis.cancelAnimationFrame=id=>cancelled.push(id);
    const grid={isConnected:true,clientWidth:350,children:[],dataset:{},style:{},contains:()=>false};
    const host={isConnected:true,parentNode:{}};
    mountFeedLayout(grid,{host});
    observers[0].callback([{target:grid,contentRect:{width:360}}]);
    host.isConnected=false;grid.isConnected=false;observers[1].callback();
    assert(observers.every(observer=>observer.disconnected));assert.deepEqual(cancelled,[17]);
  }finally{for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
