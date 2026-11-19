/* 场景：把总平面搭成网格，并且按每一帧的状态摆好九块作品窗、灯和电车。
   update(st) 里的 st 完全由时间线（加上悬停）决定，这里不记任何和时间有关的状态。 */
(function(){
'use strict';
var SP=window.SP=window.SP||{};

SP.createScene=function(core){
  var T=core.T,U=SP.u,C=SP.CFG,S=SP.GLSL,sh=core.shared,COL=C.COL,L=C.LIGHT;
  var K=SP.plan(SP.kit(T)),G=K.finish(),heroes=K.heroes,NH=heroes.length,NL=8;
  var SW=C.WIN.w,SH=C.WIN.h,CW=C.CARD.w,CD=C.CARD.d;
  var disposed=false,images=[];
  var group=new T.Group();core.scene.add(group);
  var caps=core.renderer.capabilities,aniso=Math.min(8,caps.getMaxAnisotropy());
  function v3(a){return new T.Vector3().fromArray(a);}
  function vecs(n,Cls){var a=[];for(var k=0;k<n;k++)a.push(new Cls());return a;}
  function zeros(n){var a=[];for(var k=0;k<n;k++)a.push(0);return a;}
  function attr(g,name,arr,n){g.setAttribute(name,new T.BufferAttribute(arr,n));}

  /* ---------- 共用的量 ---------- */
  var uni={
    uRise:{value:zeros(9)},uFill:{value:0},uFillDown:{value:0},uCity:{value:0},uFillAO:{value:0},uOff:{value:new T.Vector4(0,0,0,1)},
    uSPos:{value:vecs(9,T.Vector3)},uSUp:{value:vecs(9,T.Vector3)},uSNrm:{value:vecs(9,T.Vector3)},uSCol:{value:vecs(9,T.Vector3)},
    uFoot:{value:vecs(9,T.Vector4)},uLamp:{value:vecs(NL,T.Vector4)},
    tAO:{value:null},uPlate:{value:new T.Vector4(-CW/2,-CD/2,1/CW,1/CD)},uWinHalf:{value:new T.Vector2(SW/2,SH/2)},
    uCardHalf:{value:new T.Vector2(CW/2,CD/2)},uCardR:{value:C.CARD.r},
    uCardTop:{value:v3(COL.cardTop)},uCardSide:{value:v3(COL.cardSide)},uWallTop:{value:v3(COL.wallTop)},uWallSide:{value:v3(COL.wallSide)},
    uWarm:{value:v3(COL.warm)},uWarmLight:{value:v3(COL.warmLight)},uEdgeCol:{value:v3(COL.edge)},
    uMoon:{value:L.moon},uSpill:{value:L.spill},uHalo:{value:L.halo},uLampK:{value:L.lamp},uLampFall:{value:L.lampFall},
    uWinK:{value:L.window},uWinLit:{value:L.windowLit},uWinOn:{value:0},uSheen:{value:L.sheen},uRimGlow:{value:L.rimGlow},uGloss:{value:L.gloss},uLampWall:{value:L.lampWall},uSignK:{value:C.LINE.sign},
    uRes:sh.uRes,uHalfPx:sh.uHalfPx,uTime:sh.uTime,uGlow:{value:zeros(9)},uSign:{value:zeros(9)},
    uLoad:{value:0},uKA:{value:[C.LINE.edge,C.LINE.rim,C.LINE.trace,C.LINE.pad,C.LINE.frame]},uHoverK:{value:C.LINE.hover}
  };
  heroes.forEach(function(h){var f=K.heroFoot[h.i];uni.uFoot.value[h.i].set(f[0],f[1],f[2],f[3]);});
  function own(extra){var o={},k;for(k in uni)o[k]=uni[k];for(k in extra)o[k]=extra[k];return o;}

  /* ---------- 配楼的接地阴影：把落地轮廓画成一张糊掉的图 ---------- */
  (function(){
    var AS=48,cv=document.createElement('canvas');cv.width=Math.round(CW*AS);cv.height=Math.round(CD*AS);
    var g=cv.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,cv.width,cv.height);
    K.foot.forEach(function(f){
      g.save();g.shadowColor='rgba(0,0,0,0.6)';g.shadowBlur=11;g.fillStyle='rgba(0,0,0,0.5)';
      g.fillRect((f.x-f.w/2+CW/2)*AS,(f.z-f.d/2+CD/2)*AS,f.w*AS,f.d*AS);g.restore();
    });
    var t=new T.CanvasTexture(cv);t.flipY=false;t.minFilter=T.LinearFilter;t.generateMipmaps=false;uni.tAO.value=t;
  })();

  /* ---------- 白模和亮边 ---------- */
  function modelMesh(g0,u){
    var g=new T.BufferGeometry();
    attr(g,'position',g0.pos,3);attr(g,'normal',g0.nrm,3);attr(g,'aBase',g0.base,1);attr(g,'aBld',g0.bld,3);attr(g,'aUvw',g0.uvw,3);attr(g,'aWs',g0.ws,2);
    var m=new T.Mesh(g,new T.ShaderMaterial({vertexShader:S.modelV,fragmentShader:S.modelF,uniforms:u,extensions:{derivatives:true}}));
    m.frustumCulled=false;return m;
  }
  function lineMesh(g0,u){
    var g=new T.BufferGeometry();
    attr(g,'position',g0.la,3);attr(g,'aA',g0.la,3);attr(g,'aB',g0.lb,3);attr(g,'aBld',g0.lbld,3);attr(g,'aSeq',g0.lseq,2);attr(g,'aKind',g0.lkind,1);attr(g,'aSide',g0.lside,2);
    g.setIndex(new T.BufferAttribute(g0.lidx,1));
    var m=new T.Mesh(g,new T.ShaderMaterial({vertexShader:S.lineV,fragmentShader:S.lineF,uniforms:u,transparent:true,depthWrite:false,side:T.DoubleSide}));
    m.frustumCulled=false;m.renderOrder=6;return m;
  }
  group.add(modelMesh(G,uni));group.add(lineMesh(G,uni));

  /* 电车：同一套着色器，自己的位移 */
  var TG=SP.tramKit(T).finish(),tramU=own({uOff:{value:new T.Vector4(0,0,C.TRAM.z,0)},uFill:{value:1},uFillDown:{value:0},uCity:{value:0},uLoad:{value:2},uWinLit:{value:1},uWinOn:{value:1},uWinK:{value:L.window*0.7}});
  var tram=modelMesh(TG,tramU),tramL=lineMesh(TG,tramU);group.add(tram);group.add(tramL);

  /* ---------- 台面 ---------- */
  var floor=new T.Mesh(new T.PlaneGeometry(90,90),new T.ShaderMaterial({vertexShader:S.floorV,fragmentShader:S.floorF,
    uniforms:{uBg:{value:v3(COL.bg)},uCardHalf:uni.uCardHalf,uCardR:uni.uCardR,uA:{value:1}}}));
  floor.rotation.x=-Math.PI/2;floor.position.y=-C.CARD.th-0.004;group.add(floor);

  /* ---------- 九块作品窗 ---------- */
  var ac=document.createElement('canvas');ac.width=8;ac.height=5;var ag=ac.getContext('2d',{willReadFrequently:true});
  /* 这块画面当灯用时的颜色：按它自己的曝光算平均色，只轻轻往上提一点（暗画面的光就该暗），
     再向同亮度的暖中性色靠一截，免得每面墙各染一种杂色 */
  function avg(src,fx,out){
    try{
      ag.drawImage(src,0,0,8,5);var d=ag.getImageData(0,0,8,5).data,r=0,g=0,b=0,k,ga=fx.gamma||1,gn=fx.gain==null?1:fx.gain;
      for(k=0;k<d.length;k+=4){r+=Math.pow(d[k]/255,ga);g+=Math.pow(d[k+1]/255,ga);b+=Math.pow(d[k+2]/255,ga);}
      r*=gn/40;g*=gn/40;b*=gn/40;
      var f=U.lerp(1,0.9/Math.max(r,g,b,0.001),0.12),lum=(0.299*r+0.587*g+0.114*b)*f/0.867,w=L.spillWarm;
      out.set(U.lerp(r*f,lum,w),U.lerp(g*f,lum*0.84,w),U.lerp(b*f,lum*0.66,w));
    }catch(e){out.set(0.5,0.45,0.38);}
  }
  function texOf(src){var t=(src instanceof HTMLCanvasElement)?new T.CanvasTexture(src):new T.Texture(src);t.minFilter=T.LinearMipmapLinearFilter;t.magFilter=T.LinearFilter;t.generateMipmaps=true;t.anisotropy=aniso;t.needsUpdate=true;return t;}
  var blank=document.createElement('canvas');blank.width=16;blank.height=10;
  var sgeo=new T.PlaneGeometry(SW,SH),screens=[],byId={};
  heroes.forEach(function(h){
    var fx=h.w.fx||{},tex=texOf(blank);
    var mat=new T.ShaderMaterial({vertexShader:S.screenV,fragmentShader:S.screenF,extensions:{derivatives:true},transparent:true,side:T.DoubleSide,
      polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-6,
      uniforms:{tMap:{value:tex},uOn:{value:0},uLift:{value:0},uTime:sh.uTime,uClip:{value:1},
        uGamma:{value:fx.gamma||1},uGain:{value:fx.gain==null?1:fx.gain},uMoteK:{value:1},
        uRain:{value:fx.rain||0},uMote:{value:new T.Vector4().fromArray(fx.mote||[0,0,0,0])},uMoteV:{value:new T.Vector4().fromArray(fx.moteV||[0,0,1,0.01])},uPulse:{value:new T.Vector2().fromArray(fx.pulse||[0,0])}}});
    var mesh=new T.Mesh(sgeo,mat);mesh.renderOrder=2;group.add(mesh);
    var o={h:h,mesh:mesh,mat:mat,col:new T.Vector3(0.5,0.5,0.5),live:null};screens.push(o);byId[h.w.id]=o;
  });
  /* 换贴图的接口：按作品的名字，给一个网址、一张图或者一块 canvas（canvas 会每帧重新上传，可以是真的在跑的作品） */
  function setWork(id,src){
    var o=byId[id];if(!o)return;
    function use(el,live){var old=o.mat.uniforms.tMap.value;o.mat.uniforms.tMap.value=texOf(el);if(old)old.dispose();avg(el,o.h.w.fx||{},o.col);o.live=live?el:null;if(o.onTex)o.onTex(o.mat.uniforms.tMap.value);}
    if(typeof src==='string'){var im=new Image();images.push(im);im.onload=function(){if(!disposed){use(im,false);if(core.onMedia)core.onMedia();}};im.src=src;}
    else use(src,src instanceof HTMLCanvasElement);
  }
  // Real work covers are supplied by the trusted parent adapter.

  /* 霓虹广场楼上的小屏 */
  (function(){
    if(!K.minis.length)return;
    var p=[],uv=[],bl=[],hero=K.minis[0].hero,H=heroes[hero].H;
    K.minis.forEach(function(m){
      var q=[[m.x0,m.y0,m.uv[0],m.uv[1]],[m.x1,m.y0,m.uv[2],m.uv[1]],[m.x1,m.y1,m.uv[2],m.uv[3]],[m.x0,m.y1,m.uv[0],m.uv[3]]];
      [0,1,2,0,2,3].forEach(function(k){p.push(q[k][0],q[k][1],m.z);uv.push(q[k][2],q[k][3]);bl.push(hero,0,H);});
    });
    var g=new T.BufferGeometry();attr(g,'position',new Float32Array(p),3);attr(g,'uv',new Float32Array(uv),2);attr(g,'aBld',new Float32Array(bl),3);
    var mu=own({tMap:{value:screens[hero].mat.uniforms.tMap.value},uOn:{value:0}});
    var mesh=new T.Mesh(g,new T.ShaderMaterial({vertexShader:S.miniV,fragmentShader:S.miniF,uniforms:mu,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-6}));
    mesh.frustumCulled=false;mesh.renderOrder=2;group.add(mesh);
    screens[hero].onTex=function(t){mu.tMap.value=t;};screens[hero].mini=mu;
  })();

  /* ---------- 招牌和名片上的字（画在 canvas 上，字体到了以后重画一遍） ---------- */
  var FONT_ZH='"Noto Sans SC","PingFang SC","Hiragino Sans GB",sans-serif',FONT_EN='"Jost","Avenir Next","Helvetica Neue",sans-serif';
  function spaced(g,text,x,y,track){var i,w=0;for(i=0;i<text.length;i++){if(x!=null)g.fillText(text[i],x+w,y);w+=g.measureText(text[i]).width+track;}return w-track;}
  var signCv=document.createElement('canvas');signCv.width=1024;signCv.height=512;
  var signTex=new T.CanvasTexture(signCv);signTex.minFilter=T.LinearMipmapLinearFilter;signTex.anisotropy=aniso;
  var signGeo=new T.BufferGeometry();
  function fitText(g,text,width,spacing){
    var chars=Array.from(text||'');if(spaced(g,chars.join(''),null,0,spacing)<=width)return chars.join('');
    while(chars.length&&spaced(g,chars.join('')+'…',null,0,spacing)>width)chars.pop();
    return chars.join('')+'…';
  }
  function drawSigns(){
    var g=signCv.getContext('2d'),p=[],uv=[],bl=[],SHh=0.135,PXH=64;
    g.clearRect(0,0,1024,512);g.fillStyle='#fff';g.textBaseline='middle';g.font='400 40px '+FONT_ZH;
    K.signs.forEach(function(s,i){
      var label=fitText(g,s.text,480,7),cx=(i%2)*512,cy=((i/2)|0)*80+8,w=spaced(g,label,null,0,7),x0=cx+(512-w)/2;
      spaced(g,label,x0,cy+PXH/2+2,7);
      var ww=(w+12)/PXH*SHh,hh=SHh,u0=(x0-6)/1024,u1=(x0+w+6)/1024,v0=1-(cy+PXH)/512,v1=1-cy/512,H=heroes[s.hero].H;
      var q=[[s.x-ww/2,s.y-hh/2,u0,v0],[s.x+ww/2,s.y-hh/2,u1,v0],[s.x+ww/2,s.y+hh/2,u1,v1],[s.x-ww/2,s.y+hh/2,u0,v1]];
      [0,1,2,0,2,3].forEach(function(k){p.push(q[k][0],q[k][1],s.z);uv.push(q[k][2],q[k][3]);bl.push(s.hero,0,H);});
    });
    attr(signGeo,'position',new Float32Array(p),3);attr(signGeo,'uv',new Float32Array(uv),2);attr(signGeo,'aBld',new Float32Array(bl),3);
    signTex.needsUpdate=true;
  }
  var signs=new T.Mesh(signGeo,new T.ShaderMaterial({vertexShader:S.signV,fragmentShader:S.signF,uniforms:own({tMap:{value:signTex}}),transparent:true,depthWrite:false}));
  signs.frustumCulled=false;signs.renderOrder=7;group.add(signs);

  /* 名片上的字：名字在左下，一行小字在右下，都压在前街那条线下面。竖屏时卡片很小，只留名字 */
  var NAME={x0:-SW/2-4.5,x1:SW/2+4.5,z0:2.56,z1:3.50,ppu:190},nameCv=document.createElement('canvas');
  nameCv.width=Math.round((NAME.x1-NAME.x0)*NAME.ppu);nameCv.height=Math.round((NAME.z1-NAME.z0)*NAME.ppu);
  var nameTex=new T.CanvasTexture(nameCv);nameTex.minFilter=T.LinearMipmapLinearFilter;nameTex.anisotropy=aniso;
  var nameMode='';
  function drawName(portrait){
    var g=nameCv.getContext('2d'),W=nameCv.width,P=NAME.ppu,base=(3.16-NAME.z0)*P,O=C.OWNER;
    g.clearRect(0,0,W,nameCv.height);g.fillStyle='#fff';g.textBaseline='alphabetic';
    var big=portrait?0.60:0.44;
    g.font='300 '+Math.round(big*P)+'px '+FONT_ZH;
    var limit=!portrait&&O.line?W*.54:W;
    spaced(g,fitText(g,O.name,limit,big*P*.16),0,base,big*P*.16);
    if(!portrait&&O.line){g.font='300 '+Math.round(0.20*P)+'px '+FONT_ZH;g.globalAlpha=0.72;var line=fitText(g,O.line,W*.40,.022*P),lw=spaced(g,line,null,0,.022*P);spaced(g,line,W-lw,base-.01*P,.022*P);g.globalAlpha=1;}
    nameTex.needsUpdate=true;nameMode=portrait?'p':'l';
  }
  var nameMesh=new T.Mesh(new T.PlaneGeometry(NAME.x1-NAME.x0,NAME.z1-NAME.z0),new T.ShaderMaterial({vertexShader:S.textV,fragmentShader:S.textF,transparent:true,depthWrite:false,
    polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-6,uniforms:{tMap:{value:nameTex},uCol:{value:v3(COL.edge)},uA:{value:0}}}));
  nameMesh.rotation.x=-Math.PI/2;nameMesh.position.set((NAME.x0+NAME.x1)/2,0.003,(NAME.z0+NAME.z1)/2);nameMesh.renderOrder=5;group.add(nameMesh);
  function redrawText(){drawSigns();drawName(nameMode==='p');}
  drawSigns();drawName(false);

  /* ---------- 路灯的灯头、熔火之峰顶上那一点，和它们的光晕 ---------- */
  var gc=document.createElement('canvas');gc.width=gc.height=64;
  (function(){var g=gc.getContext('2d'),gr=g.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(0.22,'rgba(255,255,255,0.32)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);})();
  var glowTex=new T.CanvasTexture(gc),dotGeo=new T.SphereGeometry(1,10,8);
  function bulb(color,r,halo){
    var m=new T.Mesh(dotGeo,new T.MeshBasicMaterial({color:0x000000}));m.scale.setScalar(r);group.add(m);
    var sp=new T.Sprite(new T.SpriteMaterial({map:glowTex,color:color,blending:T.AdditiveBlending,depthWrite:false,transparent:true,opacity:0}));sp.scale.set(halo,halo,1);sp.renderOrder=8;group.add(sp);
    return {m:m,sp:sp,c:new T.Color(color)};
  }
  var warmC=new T.Color().fromArray(COL.warm),emberC=new T.Color().fromArray(COL.ember);
  var lamps=K.lamps.map(function(l){var b=bulb(new T.Color(1.0,0.93,0.78),0.016,0.55);b.l=l;return b;});
  var embers=K.embers.map(function(e){var b=bulb(emberC,0.045,0.7);b.e=e;return b;});
  function setBulb(b,x,y,z,on,haloA){
    b.m.position.set(x,y,z);b.sp.position.set(x,y,z);b.m.visible=y>0.01;b.sp.visible=y>0.01&&on>0.01;
    b.m.material.color.copy(b.c).multiplyScalar(0.06+0.94*on);b.sp.material.opacity=haloA*on;
  }
  /* 和着色器里的 riseOf 是同一个算式：配楼、树、路灯按离西头的远近依次起落 */
  function sm01(t){t=U.c01(t);return t*t*(3-2*t);}
  function fillRise(dl,st){return Math.max(U.back(U.c01(st.fill*1.6-dl*0.6))*(1-sm01(st.fillDown*1.6-dl*0.6)),sm01(st.city*1.6-dl*0.6));}

  /* ---------- 每一帧 ----------
     st: rise[9] 楼顶出来多少（可以略大于 1）；hinge[9] 窗立着（1）还是躺着（0）；attached 窗是不是钉在楼上（长出来那一段）；
         on[9] 画面亮度；glow[9] 悬停；fill, fillDown, city 配楼的起、退、首页上再起；winOn 小窗；load 刻线亮到哪；lampOn[7]；nameA；floorA；
         tram {x, k, light}；traceA, padA 刻线的亮度；dt */
  function update(st){
    var i,o,h,k,kt,str,slot,cy,th,c,s;
    uni.uFill.value=st.fill;uni.uFillDown.value=st.fillDown;uni.uCity.value=st.city;uni.uFillAO.value=fillRise(0.5,st);uni.uWinOn.value=st.winOn;uni.uLoad.value=st.load;
    uni.uKA.value[2]=st.traceA;uni.uKA.value[3]=st.padA;
    nameMesh.material.uniforms.uA.value=st.nameA;nameMesh.visible=st.nameA>0.004;
    floor.material.uniforms.uA.value=st.floorA;
    for(i=0;i<NH;i++){
      o=screens[i];h=o.h;k=st.rise[i];kt=Math.min(k,1);str=1+Math.max(k-1,0)*0.9;
      uni.uRise.value[i]=k;uni.uGlow.value[i]=st.glow[i];uni.uSign.value[i]=st.on[i]*kt;
      slot=h.yc*str-(1-kt)*(h.H+0.04);
      var vis=1;
      if(st.attached){cy=slot;th=0;vis=U.c01((slot+SH/2)/SH);o.mat.uniforms.uClip.value=1;}
      else{cy=Math.max(SH/2+0.004,slot);th=(1-st.hinge[i])*Math.PI/2;o.mat.uniforms.uClip.value=0;}
      c=Math.cos(th);s=Math.sin(th);
      var yb=cy-SH/2,zh=h.zf+0.012;
      o.mesh.position.set(h.x,yb+SH/2*c,zh-SH/2*s);o.mesh.rotation.x=-th;
      o.mat.uniforms.uOn.value=st.on[i];o.mat.uniforms.uLift.value=st.glow[i];o.mat.uniforms.uMoteK.value=st.attached?1:st.hinge[i];   /* 窗躺成小图以后，飘点收掉 */
      uni.uSPos.value[i].copy(o.mesh.position);uni.uSUp.value[i].set(0,c,-s);uni.uSNrm.value[i].set(0,s,c);
      uni.uSCol.value[i].copy(o.col).multiplyScalar(st.on[i]*vis*(1+0.3*st.glow[i]));
      if(o.mini)o.mini.uOn.value=st.on[i];
      if(o.live)o.mat.uniforms.tMap.value.needsUpdate=true;
    }
    for(i=0;i<lamps.length;i++){
      o=lamps[i];k=Math.min(1,fillRise(o.l.delay,st));var ly=o.l.y-(1-k)*(o.l.H+0.04),on=st.lampOn[i]||0;
      setBulb(o,o.l.x,ly,o.l.z,on,0.75);
      uni.uLamp.value[i].set(o.l.x,ly-0.02,o.l.z,ly>0.05?on:0);
    }
    for(i=0;i<embers.length;i++){
      o=embers[i];h=heroes[o.e.hero];k=Math.min(st.rise[o.e.hero],1);
      setBulb(o,o.e.x,o.e.y-(1-k)*(h.H+0.04),o.e.z,st.on[o.e.hero]*(0.8+0.2*Math.sin(sh.uTime.value*2.3)),0.7);
    }
    /* 电车 */
    var tr=st.tram;tram.visible=tramL.visible=tr.k>0.01;
    /* 电车和别的东西一样，是从名片里升上来、沉回去的 */
    tramU.uOff.value.set(tr.x,0,C.TRAM.z,1);tramU.uFill.value=tr.k;
    uni.uLamp.value[NL-1].set(tr.x+0.42,0.11,C.TRAM.z,tr.light*0.7*U.c01(tr.k*1.6-0.3));
  }

  /* 指针的射线打到了哪栋楼：每栋楼是一个盒子（地基那一圈加上已经顶出来的高度） */
  var PAD=C.PAD;
  function pick(ray,rise,grow){   /* grow：触屏上把每个盒子四周再放大一圈，好点中 */
    grow=grow||0;
    var best=-1,bt=1e9,i,h,f,x0,x1,z0,z1,y1,t0,t1,a,b,ax,o=ray.origin,d=ray.direction;
    for(i=0;i<NH;i++){
      h=heroes[i];f=K.heroFoot[i];
      x0=Math.min(h.x-SW/2-PAD,f[0]-f[2]);x1=Math.max(h.x+SW/2+PAD,f[0]+f[2]);z0=Math.min(h.zf-SH-PAD,f[1]-f[3]);z1=h.zf+PAD;x0-=grow;x1+=grow;z0-=grow;z1+=grow;y1=Math.max(0.03,Math.min(rise[i],1)*h.H);
      t0=0;t1=1e9;
      var lo=[x0,0,z0],hi=[x1,y1,z1],oo=[o.x,o.y,o.z],dd=[d.x,d.y,d.z],ok=true;
      for(ax=0;ax<3;ax++){
        if(Math.abs(dd[ax])<1e-8){if(oo[ax]<lo[ax]||oo[ax]>hi[ax]){ok=false;break;}continue;}
        a=(lo[ax]-oo[ax])/dd[ax];b=(hi[ax]-oo[ax])/dd[ax];if(a>b){var q=a;a=b;b=q;}
        t0=Math.max(t0,a);t1=Math.min(t1,b);if(t0>t1){ok=false;break;}
      }
      if(ok&&t0<bt){bt=t0;best=i;}
    }
    return best;
  }
  /* 楼名标签该挂在哪：楼顶正上方；楼沉下去的时候是小图的上沿 */
  function anchor(i,rise,out){var h=heroes[i],k=Math.min(rise,1);return out.set(h.x,k*h.roof+0.02,U.lerp(h.zf-SH-PAD,h.zf-0.35,k));}

  return {group:group,dispose:function(){disposed=true;images.forEach(function(im){im.onload=null;im.src="";});core.scene.remove(group);var seen=new Set();function release(x){if(x&&x.dispose&&!seen.has(x)){seen.add(x);x.dispose();}}group.traverse(function(o){release(o.geometry);[].concat(o.material||[]).forEach(function(m){Object.values(m.uniforms||{}).forEach(function(u){if(u.value&&u.value.isTexture)release(u.value);});release(m.map);release(m);});});},update:update,pick:pick,anchor:anchor,heroes:heroes,screens:screens,setWork:setWork,redrawText:redrawText,
    setPortrait:function(p){if((p?'p':'l')!==nameMode)drawName(p);},uni:uni,K:K};
};
})();
