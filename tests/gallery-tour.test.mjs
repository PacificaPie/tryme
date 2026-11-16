import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Build the actual popup with inert canvas/material adapters. No WebGL, browser,
// mocked camera formulas, network requests, or copied wall transforms are used.
function setup(){
  const context=new Proxy({}, {get(object,key){
    if(key==='measureText')return value=>({width:String(value).length*10});
    if(String(key).startsWith('create'))return ()=>({addColorStop(){}});
    return object[key]??(()=>{});
  },set(object,key,value){object[key]=value;return true;}});
  const scope={console,document:{createElement(){return {width:1,height:1,getContext(){return context;}};}}};scope.window=scope;vm.createContext(scope);
  for(const file of ['config.js','vendor/three.min.js','core.js','prints.js','popup.js','tour.js'])vm.runInContext(fs.readFileSync(new URL('../public/gallery/'+file,import.meta.url),'utf8'),scope,{filename:file});
  const T=scope.THREE;
  function material(){const mat=new T.MeshBasicMaterial();mat.uniforms=new Proxy({}, {get(object,key){return object[key]||(object[key]={value:new T.Vector4()});}});return mat;}
  const paper={board:material,art:material,ground:material,tex:()=>new T.Texture(),white:new T.Texture(),PAPER:0xffffff,INK:0x000000};
  return {T,SP:scope.SP,paper,config:scope.FuntrackGallery};
}
const {T,SP,paper,config}=setup();
const LAYOUTS=[1,2,3,4,5,6,9];
function makePopup(count){
  const works=Array.from({length:count},(_,i)=>({id:'work-'+i,name:'Work '+i,cover:''}));
  SP.configurePrints({id:'author',name:'Creator'},works,count,0);
  const popup=SP.createPopup({T,scene:new T.Scene()},paper);
  assert.equal(SP.prints.HANG.length,count,'Layout must not fill unused places');
  assert.equal(popup.targets.length,count,'Every frame must correspond to a selected work');
  popup.root.userData.tourRoom={minX:-SP.prints.FX,maxX:SP.prints.FX,minY:SP.prints.Y0,maxY:SP.prints.Y1};
  popup.update({thL:Math.PI/2,thR:Math.PI/2,thB:Math.PI/2,bench:Math.PI/2,figA:Math.PI/2,figB:Math.PI/2,pop:works.map(()=>1),wake:works.map(()=>1)},0);
  popup.root.rotation.x=-Math.PI/2;popup.root.updateMatrixWorld(true);
  return popup;
}

test('tour order follows each actual wall without omissions or repeated IDs',()=>{
  assert.equal(config.pageSize,6);
  for(let count=0;count<=30;count++){
    const works=Array.from({length:count},(_,i)=>({id:'w'+i})),before=JSON.stringify(works),order=Array.from(SP.tourOrder(works));
    assert.equal(order.length,count);assert.equal(new Set(order).size,count);assert.deepEqual([...order].sort(),works.map(w=>w.id).sort());
    if(count)assert.equal(order[0],'w0');assert.equal(JSON.stringify(works),before);
  }
  assert.deepEqual(Array.from(SP.tourOrder([{id:'a'},{id:'b'}])),['a','b']);
  const eleven=Array.from({length:11},(_,i)=>({id:'w'+i}));
  assert.deepEqual(Array.from(SP.tourOrder(eleven)),['w0','w3','w2','w5','w1','w4','w6','w9','w8','w7','w10']);
  assert.deepEqual(Array.from(SP.tourOrder(eleven,9)),['w0','w3','w6','w2','w5','w8','w1','w4','w7','w9','w10'],'Explicit legacy grouping must override config');
  assert.deepEqual(Array.from(SP.tourOrder(eleven,2)),eleven.map(work=>work.id),'Two-picture rooms retain their original order');
  assert.deepEqual(Array.from(SP.tourOrder([{id:'a'},{id:'a'},{id:'b'}])),['a','b']);
});

test('all 1–6-work and legacy 9-work poses face their real planes, fit the UI-safe frame and stay inside the room',()=>{
  let poses=0,minDistance=Infinity,maxDistance=0,maxFov=0;
  for(const count of LAYOUTS){
    const popup=makePopup(count);
    for(const aspect of [320/490,360/490,390/620,1,16/9,2.5,.5])for(const target of popup.targets){
      const pose=SP.tourPose(T,target,aspect);assert(pose,'Pose must exist');
      const normal=new T.Vector3(0,0,1).transformDirection(target.matrixWorld),delta=pose.eye.clone().sub(pose.look),distance=delta.length();
      assert(delta.clone().normalize().dot(normal)>1-1e-10,'Eye must follow the picture front normal');
      assert(pose.look.distanceTo(target.getWorldPosition(new T.Vector3()))<1e-10);
      const localEye=popup.root.worldToLocal(pose.eye.clone());
      assert(localEye.x>=-1.22-1e-9&&localEye.x<=1.22+1e-9,'Eye must not cross either side wall');
      assert(localEye.y>=-.47-1e-9&&localEye.y<=1.77+1e-9,'Eye must remain above the room footprint');
      assert(localEye.z>.04&&localEye.z<popup.top,'Eye must stay between floor and wall top');
      const camera=new T.PerspectiveCamera(pose.fov,aspect,.04,100);camera.position.copy(pose.eye);camera.lookAt(pose.look);camera.updateMatrixWorld(true);
      const box=target.geometry.boundingBox;
      for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y]){
        const projected=new T.Vector3(x,y,0).applyMatrix4(target.matrixWorld).project(camera);
        assert(Math.abs(projected.x)<=.660001&&Math.abs(projected.y)<=.660001,'Actual picture corners must fit inside the reserved viewport');
        assert(projected.z>-1&&projected.z<1,'Picture must not be clipped by camera near/far');
      }
      poses++;minDistance=Math.min(minDistance,distance);maxDistance=Math.max(maxDistance,distance);maxFov=Math.max(maxFov,pose.fov);
    }
    popup.dispose();
  }
  assert.equal(poses,210);
  console.log(`Geometry: ${poses} poses, distance ${minDistance.toFixed(3)}–${maxDistance.toFixed(3)}, maximum vertical FOV ${maxFov.toFixed(2)}°.`);
});

test('explicit room metadata survives a transformed wrapper and poses leave source transforms unchanged',()=>{
  const popup=makePopup(3),wrapper=new T.Group();wrapper.position.set(3,1,-2);wrapper.rotation.y=.45;wrapper.scale.setScalar(1.3);wrapper.add(popup.root);wrapper.updateMatrixWorld(true);
  const target=popup.targets[2],position=target.position.clone(),rotation=target.rotation.clone(),scale=target.scale.clone();
  const pose=SP.tourPose(T,target,.7);assert(pose);const local=popup.root.worldToLocal(pose.eye.clone());
  assert(local.x>=-1.22&&local.x<=1.22);assert(local.y>=-.47&&local.y<=1.77);
  assert(target.position.equals(position));assert(target.rotation.equals(rotation));assert(target.scale.equals(scale));
  popup.dispose();
});

test('linear tour movement stays above the actual bench and entry figures, including each midpoint',()=>{
  let sampled=0,minimumClearance=Infinity,highestDecoration=0;
  for(const count of LAYOUTS){
    const popup=makePopup(count);
    // Panels reach 1.343 world units; the other positive-height root children
    // are the actual floor trims, articulated bench and two entry figures.
    const decorations=popup.root.children.map(node=>new T.Box3().setFromObject(node)).filter(box=>box.max.y>.001&&box.max.y<.60);
    const top=Math.max(...decorations.map(box=>box.max.y));highestDecoration=Math.max(highestDecoration,top);
    assert(top>.45&&top<.55,'The actual figures must be included in the clearance check');
    for(const aspect of [320/490,1,16/9,.5]){
      const poses=popup.targets.map(target=>SP.tourPose(T,target,aspect));
      for(const a of poses)for(const b of poses)for(const blend of [0,.25,.5,.75,1]){
        const eye=a.eye.clone().lerp(b.eye,blend),nearHalfHeight=.04*Math.tan(Math.max(a.fov,b.fov)*Math.PI/360);
        const clearance=eye.y-nearHalfHeight-top;
        assert(clearance>.10,'Both the camera and its near plane remain above decoration tops');
        const local=popup.root.worldToLocal(eye.clone());
        assert(local.x>=-1.220001&&local.x<=1.220001&&local.y>=-.470001&&local.y<=1.770001,'Interpolated eyes remain inside the convex room footprint');
        minimumClearance=Math.min(minimumClearance,clearance);sampled++;
      }
    }
    popup.dispose();
  }
  console.log(`Movement: ${sampled} samples; actual decoration top ${highestDecoration.toFixed(3)}, minimum camera near-plane clearance ${minimumClearance.toFixed(3)}.`);
});
