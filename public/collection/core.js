/* 渲染底座：相机、背景、三段后期（场景 -> 拖影 -> 色散加颗粒） */
(function(){
'use strict';
var SP=window.SP=window.SP||{};
var U=SP.u={
  c01:function(x){return x<0?0:x>1?1:x;},
  lerp:function(a,b,t){return a+(b-a)*t;},
  seg:function(t,a,b){return U.c01((t-a)/(b-a));},
  eio:function(t){return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;},
  eio5:function(t){return t<.5?16*t*t*t*t*t:1-Math.pow(-2*t+2,5)/2;},
  eo:function(t){return 1-Math.pow(1-t,3);},
  eo5:function(t){return 1-Math.pow(1-t,5);},
  ei:function(t){return t*t*t;},
  back:function(t){var c=1.70158;return 1+(c+1)*Math.pow(t-1,3)+c*Math.pow(t-1,2);},
  rnd:function(seed){var s=(seed>>>0)||1;return function(){s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
};

SP.createCore=function(canvas){
  var T=THREE,S=SP.shaders;
  var renderer=new T.WebGLRenderer({canvas:canvas,antialias:false,alpha:false,powerPreference:'high-performance'});
  renderer.setClearColor(0x0B0B0D,1);
  var scene=new T.Scene(),camera=new T.PerspectiveCamera(32,1,0.5,160);
  var shared={
    uDark:{value:new T.Color(0x0B0B0D)},uLight:{value:new T.Color(0xECE9E2)},
    uEdge:{value:-1.7},uRes:{value:new T.Vector2(1,1)},uPx:{value:1},uTime:{value:0}
  };
  var bg=new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({
    vertexShader:S.bgV,fragmentShader:S.bgF,depthTest:false,depthWrite:false,
    uniforms:{uDark:shared.uDark,uLight:shared.uLight,uEdge:shared.uEdge,uTime:shared.uTime}
  }));
  bg.frustumCulled=false;bg.renderOrder=-10;scene.add(bg);

  var qcam=new T.OrthographicCamera(-1,1,1,-1,0,1),qscene=new T.Scene();
  var trailMat=new T.ShaderMaterial({vertexShader:S.quadV,fragmentShader:S.trailF,depthTest:false,depthWrite:false,
    uniforms:{tScene:{value:null},tPrev:{value:null},uTrail:{value:0}}});
  var finalMat=new T.ShaderMaterial({vertexShader:S.quadV,fragmentShader:S.finalF,depthTest:false,depthWrite:false,
    uniforms:{tMap:{value:null},uAb:{value:0},uTime:shared.uTime,uRes:shared.uRes,uGrain:{value:0.035},uVig:{value:0}}});
  var quad=new T.Mesh(new T.PlaneGeometry(2,2),trailMat);quad.frustumCulled=false;qscene.add(quad);

  var rtS=null,rtA=null,rtB=null,W=1,H=1,px=1,first=true;
  /* 这一版的卡片是有厚度的实体，轮廓靠几何体而不是透明边，所以场景那一层在 WebGL2 上开 4 倍多重采样 */
  var msaa=renderer.capabilities.isWebGL2&&!!T.WebGLMultisampleRenderTarget;
  function mk(w,h,depth){
    var o={minFilter:T.LinearFilter,magFilter:T.LinearFilter,format:T.RGBAFormat,depthBuffer:!!depth,stencilBuffer:false};
    if(depth&&msaa){var m=new T.WebGLMultisampleRenderTarget(w,h,o);m.samples=4;return m;}
    return new T.WebGLRenderTarget(w,h,o);
  }
  function resize(){
    var w=canvas.clientWidth||window.innerWidth,h=canvas.clientHeight||window.innerHeight;
    if(w<2||h<2)return;
    px=Math.min(window.devicePixelRatio||1,1.5);
    renderer.setPixelRatio(px);renderer.setSize(w,h,false);
    W=w;H=h;camera.aspect=w/h;camera.updateProjectionMatrix();
    var pw=Math.max(2,Math.round(w*px)),ph=Math.max(2,Math.round(h*px));
    if(rtS){rtS.dispose();rtA.dispose();rtB.dispose();}
    rtS=mk(pw,ph,true);rtA=mk(pw,ph,false);rtB=mk(pw,ph,false);
    shared.uRes.value.set(pw,ph);shared.uPx.value=px;first=true;
  }
  function render(post){
    if(!rtS)return;
    renderer.setRenderTarget(rtS);renderer.render(scene,camera);
    trailMat.uniforms.tScene.value=rtS.texture;trailMat.uniforms.tPrev.value=rtB.texture;
    trailMat.uniforms.uTrail.value=first?0:post.trail;first=false;
    quad.material=trailMat;renderer.setRenderTarget(rtA);renderer.render(qscene,qcam);
    finalMat.uniforms.tMap.value=rtA.texture;finalMat.uniforms.uAb.value=post.ab;finalMat.uniforms.uGrain.value=post.grain;finalMat.uniforms.uVig.value=post.vig||0;
    quad.material=finalMat;renderer.setRenderTarget(null);renderer.render(qscene,qcam);
    var t=rtA;rtA=rtB;rtB=t;
  }
  function tanHalf(){return Math.tan(camera.fov*Math.PI/360);}
  return {
    T:T,renderer:renderer,scene:scene,camera:camera,shared:shared,resize:resize,render:render,
    size:function(){return {w:W,h:H,px:px};},msaa:msaa,
    /* 一块 pw x ph 的平面刚好铺满画面时，相机该离多远 */
    coverDist:function(pw,ph){var th=tanHalf();return Math.min(ph/(2*th),pw/(2*th*camera.aspect));},
    /* 一块 pw x ph 的平面刚好完整装进画面时的距离 */
    fitDist:function(pw,ph){var th=tanHalf();return Math.max(ph/(2*th),pw/(2*th*camera.aspect));},
    resetTrail:function(){first=true;},
    dispose:function(){[rtS,rtA,rtB].forEach(function(rt){if(rt)rt.dispose();});quad.geometry.dispose();trailMat.dispose();finalMat.dispose();bg.geometry.dispose();bg.material.dispose();scene.remove(bg);renderer.dispose();renderer.forceContextLoss();}
  };
};
})();
