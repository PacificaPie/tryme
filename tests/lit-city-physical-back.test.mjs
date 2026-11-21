import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {wrapText} from '../public/lit-city/back.js';

function camera(width=900,height=570){
  const ctx=vm.createContext({window:{},console});
  vm.runInContext(readFileSync(new URL('../public/gallery/vendor/three.min.js',import.meta.url),'utf8'),ctx);
  for(const file of ['config','core','camera'])vm.runInContext(readFileSync(new URL('../public/lit-city/'+file+'.js',import.meta.url),'utf8'),ctx);
  const SP=ctx.window.SP,T=ctx.THREE,C=SP.CFG;
  C.CAM.city.fillP=.84;C.CAM.phiP=[[0,1.12]];C.CAM.cx=C.CAM.cxP=[[0,.5]];C.CAM.cy=C.CAM.cyP=[[0,.53]];C.CAM.fill=C.CAM.fillP=[[0,.9]];
  const cam=new T.PerspectiveCamera(C.CAM.fov,1,.05,260),core={T,camera:cam,size:()=>({w:width,h:height})};
  return {T,C,cam,at:rotation=>SP.createCam(core).at(C.T.end,width/height,{x:0,y:0},{city:0,hov:0,rotation,height:0})};
}
test('physical flip shows the real underside with readable back UV orientation',()=>{
  const {T,C,cam,at}=camera();at({yaw:0,pitch:0});assert.ok(cam.position.y>0);
  at({yaw:Math.PI,pitch:0});assert.ok(cam.position.y<-C.CARD.th);
  const left=new T.Vector3(4,-C.CARD.th-.003,0).project(cam),right=new T.Vector3(-4,-C.CARD.th-.003,0).project(cam);
  const top=new T.Vector3(0,-C.CARD.th-.003,-3).project(cam),bottom=new T.Vector3(0,-C.CARD.th-.003,3).project(cam);
  assert.ok(left.x<right.x);assert.ok(top.y>bottom.y);
});
test('both faces stay in frame through full horizontal and vertical turns, including pole crossings',()=>{
  for(const [w,h] of [[900,570],[330,243]]){
    const {T,C,cam,at}=camera(w,h);
    for(let yaw=-Math.PI*2;yaw<=Math.PI*2;yaw+=Math.PI/8)for(let pitch=-Math.PI;pitch<=Math.PI;pitch+=Math.PI/8){
      at({yaw,pitch});assert.ok(cam.matrixWorld.elements.every(Number.isFinite),JSON.stringify({w,h,yaw,pitch,cam:cam.position}));
      for(const x of [-1,1])for(const z of [-1,1])for(const y of [0,-C.CARD.th-.003]){
        const p=new T.Vector3(x*C.CARD.w/2,y,z*C.CARD.d/2).project(cam);assert.ok([p.x,p.y,p.z].every(n=>Math.abs(n)<=1.001),JSON.stringify({w,h,yaw,pitch,p}));
      }
    }
  }
});
test('long printed profile text wraps safely and preserves complete text when it fits',()=>{
  const ctx={measureText:text=>({width:Array.from(text).length*10})};
  assert.deepEqual(wrapText(ctx,'林间\n作品',100,3),['林间','作品']);
  assert.deepEqual(wrapText(ctx,'abcdefghij',40,2),['abcd','efg…']);
  assert.deepEqual(wrapText(ctx,'🌱🌻🌲',20,2),['🌱🌻','🌲']);
  assert.deepEqual(wrapText(ctx,'',100,2),[]);
});
