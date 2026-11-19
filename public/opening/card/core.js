/* 渲染底座：相机、多重采样的场景缓冲、光晕、移轴。没有拖影、色散、颗粒、暗角。 */
(function(){
'use strict';
var SP=window.LC=window.LC||{};
var U=SP.u={
  c01:function(x){return x<0?0:x>1?1:x;},
  lerp:function(a,b,t){return a+(b-a)*t;},
  seg:function(t,a,b){return U.c01((t-a)/(b-a));},
  eio:function(t){return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;},
  eo:function(t){return 1-Math.pow(1-t,3);},
  eo5:function(t){return 1-Math.pow(1-t,5);},
  back:function(t,c){c=c==null?1.70158:c;return 1+(c+1)*Math.pow(t-1,3)+c*Math.pow(t-1,2);},
  /* 一条轨道 [[时间, 值, 缓动], ...] 在时间 t 的值 */
  track:function(k,t){
    if(t<=k[0][0])return k[0][1];
    for(var i=1;i<k.length;i++)if(t<k[i][0]){var e=U[k[i][2]||'eio'];return U.lerp(k[i-1][1],k[i][1],e(U.seg(t,k[i-1][0],k[i][0])));}
    return k[k.length-1][1];
  }
};

SP.createCore=function(canvas){
  var T=THREE,S=SP.GLSL,C=SP.CFG,BG=new T.Color().fromArray(C.COL.bg);
  var renderer=new T.WebGLRenderer({canvas:canvas,antialias:false,alpha:false,powerPreference:'high-performance'});
  renderer.setClearColor(BG,1);
  var scene=new T.Scene(),camera=new T.PerspectiveCamera(C.CAM.fov,1,0.05,260);
  var shared={uRes:{value:new T.Vector2(1,1)},uTime:{value:0},uHalfPx:{value:1}};

  var qcam=new T.OrthographicCamera(-1,1,1,-1,0,1),qscene=new T.Scene();
  function pass(frag,uni){return new T.ShaderMaterial({vertexShader:S.quadV,fragmentShader:frag,uniforms:uni,depthTest:false,depthWrite:false});}
  var brightMat=pass(S.brightF,{tMap:{value:null},uTexel:{value:new T.Vector2()},uThresh:{value:C.POST.bloomThresh}});
  var blurMat=pass(S.blurF,{tMap:{value:null},uDir:{value:new T.Vector2()}});
  var tiltMat=pass(S.tiltF,{tMap:{value:null},uRes:shared.uRes,uAmt:{value:0},uFocus:{value:0.5},uBand:{value:C.POST.tiltBand},uRot:{value:0}});
  var finalMat=pass(S.finalF,{tMap:{value:null},tB1:{value:null},tB2:{value:null},uBloom:{value:C.POST.bloom},uGrid:{value:new T.Vector2(1,1)},uMos:{value:0}});
  var quad=new T.Mesh(new T.PlaneGeometry(2,2),brightMat);quad.frustumCulled=false;qscene.add(quad);

  var msaa=!!(renderer.capabilities.isWebGL2&&T.WebGLMultisampleRenderTarget);
  var rt={},W=1,H=1,px=1;
  function mk(w,h,depth,ms){
    /* 要深度的那张同时要一个模板缓冲：这样拿到的是 24 位深度（否则多重采样的缓冲只给 16 位，薄的东西会互相穿） */
    var o={minFilter:T.LinearFilter,magFilter:T.LinearFilter,format:T.RGBAFormat,depthBuffer:!!depth,stencilBuffer:!!depth};
    if(ms&&msaa){var r=new T.WebGLMultisampleRenderTarget(w,h,o);r.samples=4;return r;}
    return new T.WebGLRenderTarget(w,h,o);
  }
  function resize(){
    var w=canvas.clientWidth||window.innerWidth,h=canvas.clientHeight||window.innerHeight;
    if(w<2||h<2)return;
    /* 画成几倍像素、要不要多重采样和移轴，由 quality.js 定：桌面是 2 倍、都要；手机按屏幕自己的密度，3 倍时两样都不要 */
    var Q=(window.FV&&window.FV.Q)||null;
    px=Q?Q.c:Math.min(window.devicePixelRatio||1,2);
    renderer.setPixelRatio(px);renderer.setSize(w,h,false);
    W=w;H=h;camera.aspect=w/h;camera.updateProjectionMatrix();
    var pw=Math.max(2,Math.round(w*px)),ph=Math.max(2,Math.round(h*px)),k;
    for(k in rt){rt[k].dispose();delete rt[k];}
    rt.scene=mk(pw,ph,true,Q?Q.msaa:true);
    if(!Q||Q.tilt){rt.t1=mk(pw,ph,false);rt.t2=mk(pw,ph,false);}
    rt.half=mk(pw>>1,ph>>1,false);rt.q1=mk(pw>>2,ph>>2,false);rt.q2=mk(pw>>2,ph>>2,false);rt.e1=mk(pw>>3,ph>>3,false);rt.e2=mk(pw>>3,ph>>3,false);
    shared.uRes.value.set(pw,ph);shared.uHalfPx.value=C.LINE.px*px*0.5;
  }
  function draw(mat,target){quad.material=mat;renderer.setRenderTarget(target);renderer.render(qscene,qcam);}
  function blur(a,b){
    blurMat.uniforms.tMap.value=a.texture;blurMat.uniforms.uDir.value.set(1/a.width,0);draw(blurMat,b);
    blurMat.uniforms.tMap.value=b.texture;blurMat.uniforms.uDir.value.set(0,1/a.height);draw(blurMat,a);
  }
  /* post: {tilt 移轴半径（CSS 像素）, focus 清晰带在画面的什么高度, mos 要不要变成马赛克：[横向多少格, 纵向多少格]，不要就不传} */
  function render(post){
    if(!rt.scene)return;
    renderer.setRenderTarget(rt.scene);renderer.render(scene,camera);
    /* 光晕：取出亮的部分，缩到四分之一和八分之一各糊一遍 */
    brightMat.uniforms.tMap.value=rt.scene.texture;brightMat.uniforms.uTexel.value.set(1/rt.scene.width,1/rt.scene.height);brightMat.uniforms.uThresh.value=C.POST.bloomThresh;draw(brightMat,rt.half);
    brightMat.uniforms.tMap.value=rt.half.texture;brightMat.uniforms.uTexel.value.set(1/rt.half.width,1/rt.half.height);brightMat.uniforms.uThresh.value=-1;draw(brightMat,rt.q1);
    blur(rt.q1,rt.q2);
    brightMat.uniforms.tMap.value=rt.q1.texture;brightMat.uniforms.uTexel.value.set(1/rt.q1.width,1/rt.q1.height);draw(brightMat,rt.e1);
    blur(rt.e1,rt.e2);
    var src=rt.scene.texture,tilt=(post&&post.tilt)||0;
    if(tilt>0.05&&rt.t1){
      var tu=tiltMat.uniforms;tu.uAmt.value=tilt*px;tu.uFocus.value=post.focus==null?0.5:post.focus;tu.uBand.value=C.POST.tiltBand;
      tu.tMap.value=src;tu.uRot.value=0;draw(tiltMat,rt.t1);
      tu.tMap.value=rt.t1.texture;tu.uRot.value=1;draw(tiltMat,rt.t2);
      src=rt.t2.texture;
    }
    var fu=finalMat.uniforms,mg=post&&post.mos;fu.tMap.value=src;fu.tB1.value=rt.q1.texture;fu.tB2.value=rt.e1.texture;fu.uBloom.value=C.POST.bloom;
    fu.uMos.value=mg?1:0;if(mg)fu.uGrid.value.set(mg[0],mg[1]);
    draw(finalMat,null);
  }
  return {T:T,renderer:renderer,scene:scene,camera:camera,shared:shared,msaa:msaa,resize:resize,render:render,
    size:function(){return {w:W,h:H,px:px};}};
};
})();
