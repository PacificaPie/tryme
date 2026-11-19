/* 名片这个世界：时间线、镜头和互动。
   它有自己的钟 tc，走的就是《灯城》原片的那条时间线（铺路、九栋楼顶出来、收回名片、名片抬起来），
   只去掉了贴着街面从左看到右的那一段（原片的 5.2–8.4 秒），那以后的事都提前 3 秒。
   外面的总时间线（main.js）每一帧告诉它：现在 tc 是几、名片显出来多少、要不要朝橱窗里冲、能不能互动。
   给定这些就能直接算出那一帧；不由它们决定的只有互动：悬停、点一下、进城、翻面。 */
(function(){
'use strict';
var LC=window.LC=window.LC||{};

LC.createWorld=function(canvas){
  var core=LC.createCore(canvas),T=core.T,U=LC.u,C=LC.CFG,CM=C.CAM,L=C.LINE,COL=C.COL,cam=core.camera,PI=Math.PI;
  var scene=LC.createScene(core),heroes=scene.heroes,N=heroes.length,uni=scene.uni;
  var SW=C.WIN.w,SH=C.WIN.h,CW=C.CARD.w,CD=C.CARD.d,TH=C.CARD.th,PAD=C.PAD;
  function approach(a,b,step){return a<b?Math.min(b,a+step):Math.max(b,a-step);}
  function arr(v){var a=[];for(var k=0;k<N;k++)a.push(v);return a;}
  var aniso=Math.min(8,core.renderer.capabilities.getMaxAnisotropy());

  /* ---------- 名片自己的时间线（秒） ---------- */
  var TT={
    end:10.2,
    load:[0.12,1.50],                 /* 街道刻线从头亮到尾 */
    growStart:1.70,growAt:[0,0.40,0.74,1.04,1.30,1.53,1.74,1.93,2.10],growDur:0.85,lightDur:0.38,   /* 九栋楼依次顶出来，顶到位窗就亮 */
    fill:[1.9,4.6],lamps:[3.5,4.5],   /* 配楼、路灯 */
    att:5.4,                          /* 这以前橱窗钉在楼上；以后楼往下收，窗留在名片上 */
    foldStart:6.05,foldGap:0.12,foldDur:0.85,fillDown:[5.9,7.0],lampsOff:[5.9,6.4],winOff:[5.9,6.6],
    lines:[6.4,7.8],name:[7.0,8.0],lift:[7.2,9.6],
    home:8.9,                         /* 名片快停稳了，首页的字可以出来了 */
    tram:{t0:5.5,x0:-3.0,v:0.9,show:[4.7,5.0],hide:[5.9,6.3]}
  };
  /* 镜头的轨道 [时间, 值, 缓动]：theta 方位角，phi 仰角，fill 名片横向占画面多宽，cx / cy 名片中心在画面哪里；带 P 的是竖屏 */
  /* 头 1.9 秒镜头一动不动：像素点要照着这个机位落到名片的线上，落稳了镜头才开始绕 */
  var K={
    theta:[[0,-0.52],[1.9,-0.52],[5.2,-0.16,'eio'],[9.6,0,'eio']],
    phi:  [[0,0.46],[1.9,0.46],[5.2,0.60,'eio'],[9.6,1.02,'eio']],
    fill: [[0,0.60],[1.9,0.60],[4.0,0.77,'eio'],[5.2,0.77],[9.6,0.53,'eio']],
    cx:   [[0,0.50],[1.9,0.50],[4.0,0.485,'eio'],[7.2,0.485],[9.6,0.66,'eio']],
    cy:   [[0,0.49],[1.9,0.49],[4.0,0.55,'eio'],[7.2,0.55],[9.6,0.50,'eio']],
    phiP: [[0,0.46],[1.9,0.46],[5.2,0.60,'eio'],[9.6,1.12,'eio']],       /* 竖屏上名片最后抬得更正一点：小图少压扁一些 */
    fillP:[[0,0.90],[1.9,0.90],[4.0,0.94,'eio'],[5.2,0.94],[6.2,0.94,'eio'],[7.8,0.94],[9.6,0.90,'eio']],
    cxP:  [[0,0.50]],
    cyP:  [[0,0.47],[1.9,0.47],[4.0,0.50,'eio'],[7.2,0.50],[9.6,0.335,'eio']]
  };
  /* 竖屏上名片最后停在哪、停多大，不写死：由页面上实际留给它的那一段空当决定（fitPortrait） */
  var PORT=false;
  function syncP(){var s=core.size();PORT=LC.isP(s.w,s.h);return s;}

  /* ---------- 镜头 ---------- */
  var pos=new T.Vector3(),tgt=new T.Vector3(),right=new T.Vector3(),upv=new T.Vector3(),camUp=new T.Vector3(),orb={cy:0.5,d:30};
  var b1=new T.Vector3(),b2=new T.Vector3(),pd=new T.Vector3();
  /* 要冲进去的那扇窗：正中那栋最高的楼（霓虹广场）。它正对着前排两栋楼之间的空当，一路过去没有东西挡 */
  var diveH=heroes.filter(function(h){return h.w.id==='neon';})[0]||heroes[0],WIN=new T.Vector3(diveH.x,diveH.yc,diveH.zf+0.012);
  /* 冲进去的那条路：先落到街口上空（窗前 7 个单位、高出 0.9），再平着朝窗冲；停在窗前 end 这么远，那时窗已经把画面占满，视角是 fov 度 */
  var DV={up:0.9,back:7.0,end:1.25,fov:30};
  function rotZ(p,ang,py){var c=Math.cos(ang),s=Math.sin(ang),x=p.x,y=p.y-py;p.x=x*c-y*s;p.y=x*s+y*c+py;}
  /* q: {tc, asp, px, py 指针带来的一点视差, city / hov 整座城或单独一栋立着, flip 名片翻了多少弧度, dive 朝橱窗冲进去的进度 0..1} */
  function place(q){
    var tc=q.tc,asp=q.asp,P=PORT,TF=Math.tan(CM.fov*PI/360);
    var theta=U.track(K.theta,tc)+q.px*CM.parallax[0],phi=U.track(P?K.phiP:K.phi,tc)-q.py*CM.parallax[1];
    var fill=U.track(P?K.fillP:K.fill,tc),cx=U.track(P?K.cxP:K.cx,tc),cy=U.track(P?K.cyP:K.cy,tc);
    /* 比 16:10 更扁的窗口里按高度收小，楼顶不会顶出上沿 */
    if(!P)fill*=Math.min(1,1.6/asp);
    var CC=CM.city,c=q.city;phi=U.lerp(phi,CC.phi,c)-CC.hov*q.hov*(1-c);
    if(!P){fill=U.lerp(fill,CC.fill*Math.min(1,1.6/asp),c);cx=U.lerp(cx,CC.cx,c);}
    var wproj=CW*Math.abs(Math.cos(theta))+CD*Math.abs(Math.sin(theta));
    var d=wproj/(fill*2*TF*asp),vw=2*TF*asp*d,vh=2*TF*d,fov=CM.fov,near=d*0.6,far=d*1.6;
    pos.set(Math.sin(theta)*Math.cos(phi),Math.sin(phi),Math.cos(theta)*Math.cos(phi)).multiplyScalar(d);tgt.set(0,0,0);
    right.set(Math.cos(theta),0,-Math.sin(theta));
    upv.set(-Math.sin(phi)*Math.sin(theta),Math.cos(phi),-Math.sin(phi)*Math.cos(theta));
    pos.addScaledVector(right,-(cx-0.5)*vw).addScaledVector(upv,-(0.5-cy)*vh);
    tgt.addScaledVector(right,-(cx-0.5)*vw).addScaledVector(upv,-(0.5-cy)*vh);
    camUp.set(0,1,0);
    if(q.dive>0){
      /* 走进名片：从绕着看的机位出发，先落到街口上空，再平着朝那扇窗冲进去，越来越快 */
      var k=q.dive,u=1-k;
      b1.set(WIN.x,WIN.y+DV.up,WIN.z+DV.back);b2.set(WIN.x,WIN.y,WIN.z+DV.end);
      pd.set(0,0,0).addScaledVector(pos,u*u).addScaledVector(b1,2*u*k).addScaledVector(b2,k*k);
      tgt.lerp(WIN,U.eo(Math.min(1,k*1.7)));pos.copy(pd);
      fov=U.lerp(CM.fov,DV.fov,k*k);near=U.lerp(d*0.6,0.03,U.c01(k*2.5));far=U.lerp(d*1.6,90,U.c01(k*2.5));
    }
    /* 翻面：名片不动，镜头绕着名片的短轴转到它背后去。画面和把名片翻过来一模一样，名片上的灯光也不用跟着重算 */
    if(q.flip){rotZ(pos,-q.flip,-TH/2);rotZ(tgt,-q.flip,-TH/2);rotZ(camUp,-q.flip,0);}
    cam.fov=fov;cam.near=near;cam.far=far;cam.aspect=asp;cam.updateProjectionMatrix();
    cam.position.copy(pos);cam.up.copy(camUp);cam.lookAt(tgt);cam.updateMatrixWorld();
    orb.cy=cy;orb.d=d;
  }

  /* ---------- 名片的背面 ---------- */
  var backTex=new T.CanvasTexture(LC.cardBack(64,40,null,null));backTex.minFilter=T.LinearMipmapLinearFilter;backTex.magFilter=T.LinearFilter;backTex.anisotropy=aniso;
  var backU={tMap:{value:backTex},uHalf:{value:new T.Vector2(CW/2,CD/2)},uR:{value:C.CARD.r},uSheen:{value:0.5},uA:{value:1}};
  (function(){
    var g=new T.BufferGeometry(),y=-TH-0.004,hx=CW/2,hz=CD/2;
    /* 翻过去以后字要是正的：贴图的横向朝 -x，纵向朝 -z */
    g.setAttribute('position',new T.Float32BufferAttribute([-hx,y,-hz,hx,y,-hz,hx,y,hz,-hx,y,hz],3));
    g.setAttribute('uv',new T.Float32BufferAttribute([1,1,0,1,0,0,1,0],2));g.setIndex([0,1,2,0,2,3]);
    var m=new T.Mesh(g,new T.ShaderMaterial({uniforms:backU,transparent:true,side:T.DoubleSide,extensions:{derivatives:true},
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.0);}',
      fragmentShader:['uniform sampler2D tMap;uniform vec2 uHalf;uniform float uR;uniform float uSheen;uniform float uA;varying vec2 vUv;',
        'void main(){',
        '  vec2 p=(vUv-0.5)*uHalf*2.0;vec2 dq=abs(p)-(uHalf-uR);float sd=length(max(dq,0.0))+min(max(dq.x,dq.y),0.0)-uR;float aa=fwidth(sd)+0.0005;',
        '  float al=1.0-smoothstep(-aa,aa,sd);if(al<0.004)discard;',
        '  vec3 col=texture2D(tMap,vUv).rgb*0.84;',                         /* 压一点亮度：字是印在卡上的，不该自己发光 */
        '  float b=(vUv.x*0.92+vUv.y*0.38)-uSheen;',                       /* 一道斜着的光，跟着翻面和视角走 */
        '  col+=vec3(0.80,0.84,0.92)*(0.075*exp(-b*b/0.022)+0.035*exp(-b*b/0.26));',
        '  col+=vec3(0.84,0.90,0.98)*0.035*exp(sd/0.11);',                 /* 边缘往里一点冷光，和正面一样 */
        '  gl_FragColor=vec4(col*uA,al);',
        '}'].join('\n')}));
    m.frustumCulled=false;m.renderOrder=1;scene.group.add(m);
  })();
  /* 字体和人像都到了以后，把背面按实际大小画出来 */
  /* 名片在首页上有多宽（CSS 像素）。不到 480 的时候（手机竖屏）背面换一套字更大、内容更少的排版，不然小字认不出来 */
  var backSrc={img:null,qr:null,mode:''};
  function cardPx(){var s=syncP(),asp=s.w/s.h;return PORT?U.track(K.fillP,TT.end)*s.w:U.track(K.fill,TT.end)*Math.min(1,1.6/asp)*s.w;}
  function drawBack(){
    var compact=cardPx()<480,mode=compact?'c':'n';if(mode===backSrc.mode)return;backSrc.mode=mode;
    var W=compact?1280:2048,old=backU.tMap.value;
    var t=new T.CanvasTexture(LC.cardBack(W,Math.round(W*CD/CW),backSrc.img,backSrc.qr,compact));t.minFilter=T.LinearMipmapLinearFilter;t.magFilter=T.LinearFilter;t.generateMipmaps=true;t.anisotropy=aniso;
    backU.tMap.value=t;if(old)old.dispose();
  }
  function setBack(img,qr){backSrc.img=img;backSrc.qr=qr;backSrc.mode='';drawBack();}
  /* 竖屏：名片最后要正好放进页面上 y0 到 y1（CSS 像素）这一段空当里，尽量大，上下居中；ym 是起楼那一段画面的中线。
     横屏不用管，直接返回。返回一个描述结果的字符串：它变了，事先拍好的像素点落点就要重算 */
  function fitPortrait(y0,y1,ym){
    var s=syncP(),asp=s.w/s.h;if(!PORT||!(y1>y0))return 'L';
    var fEnd=K.fillP[K.fillP.length-1],cEnd=K.cyP[K.cyP.length-1],f=Math.min(0.94,(s.w-28)/s.w),cy=(y0+y1)/2/s.h,i,k,a,b,y;
    for(i=0;i<4;i++){
      fEnd[1]=f;cEnd[1]=cy;place({tc:TT.end,asp:asp,px:0,py:0,city:0,hov:0,flip:0,dive:0});
      a=1e9;b=-1e9;for(k=0;k<4;k++){v.set((k&1?1:-1)*CW/2,k&2?0:-TH,(k&2?-1:1)*CD/2).project(cam);y=(0.5-v.y*0.5)*s.h;a=Math.min(a,y);b=Math.max(b,y);}
      if(b-a>y1-y0)f*=(y1-y0)/(b-a);
      cy+=((y0+y1)/2-(a+b)/2)/s.h;
    }
    fEnd[1]=f;cEnd[1]=cy;
    /* 起楼那一段：楼是往上长的，名片本身放得比中线低一点，整座城看上去才居中 */
    if(ym>0){var m=ym/s.h;K.cyP[0][1]=K.cyP[1][1]=m+0.012;K.cyP[2][1]=K.cyP[3][1]=m+0.042;}
    drawBack();
    return 'P'+f.toFixed(4)+','+cy.toFixed(4)+','+K.cyP[0][1].toFixed(4);
  }

  /* ---------- 状态 ---------- */
  var st={rise:arr(0),hinge:arr(1),on:arr(0),glow:arr(0),lampOn:[0,0,0,0,0,0,0],fill:0,fillDown:0,city:0,winOn:0,load:0,attached:true,nameA:0,floorA:1,traceA:0.4,padA:0.4,tram:{x:0,k:0,light:1}};
  var pop=arr(0),hov=arr(0),pinned=arr(false),lastPin=-1,city=false,cityAt=0,cityOffAt=-99,cityK=0,popMax=0,hoverIdx=-1,forced=-2,clockNow=0,inter=false;
  /* 翻面：cur 现在翻了多少弧度（π 的偶数倍是正面）；from / to / t0 / dur 是一次缓起缓停的转动；
     user 表示人已经接手，总时间线里那次演示就不再管 */
  var flip={cur:0,from:0,to:0,t0:-9,dur:0.9,user:false,down:false,drag:false,x0:0,a0:0,w:1,ang:0};
  function flipTo(a,dur){flip.from=flip.cur;flip.to=a;flip.t0=clockNow;flip.dur=dur;}
  function isBack(){return Math.cos(flip.ang)<0;}
  function takeFlip(){if(!flip.user){flip.user=true;flip.cur=flip.from=flip.to=flip.ang;flip.t0=-9;}}
  function resetPlay(){for(var i=0;i<N;i++){pop[i]=0;pinned[i]=false;hov[i]=0;}lastPin=-1;city=false;cityOffAt=-99;cityK=0;flip.cur=flip.from=flip.to=0;flip.t0=-9;flip.user=false;flip.down=false;flip.drag=false;}

  var cTop=new T.Vector3().fromArray(COL.cardTop),cSide=new T.Vector3().fromArray(COL.cardSide),cBg=new T.Vector3().fromArray(COL.bg);
  /* tc 名片的钟；ap 名片显出来多少（0 = 还只是一片黑，1 = 完整）；th 九块小图亮出来多少 */
  function compute(tc,dt,ap,th){
    var i,h,g0,f0,q;
    st.load=U.seg(tc,TT.load[0],TT.load[1])+0.45*U.seg(tc,TT.load[1],TT.load[1]+0.6);
    st.attached=tc<TT.att;
    cityK=approach(cityK,city&&inter?1:0,dt/(city?1.3:0.7));popMax=0;
    for(i=0;i<N;i++){
      h=heroes[i];g0=TT.growStart+TT.growAt[h.rank];f0=TT.foldStart+h.rank*TT.foldGap;
      hov[i]=approach(hov[i],i===hoverIdx?1:0,dt/0.2);
      /* 整座城：进城时九栋按次序起，收回时倒着一栋栋收 */
      var want=inter&&(i===hoverIdx||pinned[i]||(city?clockNow-cityAt>h.rank*0.08:clockNow-cityOffAt<(N-1-h.rank)*0.07));
      pop[i]=approach(pop[i],want?1:0,dt/(want?0.85:0.8));popMax=Math.max(popMax,pop[i]);
      if(st.attached){st.rise[i]=U.back(U.seg(tc,g0,g0+TT.growDur),1.25);st.hinge[i]=1;}
      else{
        /* 收拢：q 是这栋楼收到哪了。前 56% 楼带着窗沉下去，窗落到名片上立住；后一半窗往后一躺，成为名片上的一块小图。
           悬停那一路反过来：窗先立起来，楼再从它身后顶上来 */
        q=U.seg(tc,f0,f0+TT.foldDur);
        st.rise[i]=Math.max(1-U.eio(U.seg(q,0,0.56)),U.eio(U.seg(pop[i],0.3,1)));
        st.hinge[i]=Math.max(1-U.eio(U.seg(q,0.50,1)),U.eio(U.seg(pop[i],0,0.3)));
      }
      st.on[i]=U.eo(U.seg(tc,g0+TT.growDur*0.45,g0+TT.growDur*0.45+TT.lightDur))*th;
      st.glow[i]=hov[i];
    }
    st.fill=U.eio(U.seg(tc,TT.fill[0],TT.fill[1]));st.fillDown=U.seg(tc,TT.fillDown[0],TT.fillDown[1]);st.city=U.c01(cityK*1.3-0.3);   /* 进城时配楼比主楼晚一点起 */
    st.winOn=Math.max(U.seg(tc,2.6,4.6)*(1-U.seg(tc,TT.winOff[0],TT.winOff[1])),cityK);
    for(i=0;i<7;i++){var t0=U.lerp(TT.lamps[0],TT.lamps[1],i/6);st.lampOn[i]=Math.max(U.eio(U.seg(tc,t0,t0+0.35))*(1-U.seg(tc,TT.lampsOff[0],TT.lampsOff[1])),U.seg(cityK,0.6,1));}
    if(cityK>0.01){var x=((clockNow*0.9)%10.6)-5.3;st.tram.x=x;st.tram.k=U.seg(cityK,0.7,1)*U.seg(5.3-Math.abs(x),0,0.6);}
    else{var TR=TT.tram;st.tram.x=TR.x0+TR.v*(tc-TR.t0);st.tram.k=U.eio(U.seg(tc,TR.show[0],TR.show[1]))*(1-U.eio(U.seg(tc,TR.hide[0],TR.hide[1])));}
    var kl=U.seg(tc,TT.lines[0],TT.lines[1]);
    st.traceA=U.lerp(U.lerp(0.44,L.trace,U.seg(tc,1.6,3.2)),L.traceCard,kl)*ap;
    /* 九块地基在长楼之前一起亮一下：先交代"这里要长东西了" */
    st.padA=(U.lerp(U.lerp(0.44,L.pad,U.seg(tc,1.6,3.2)),L.padCard,kl)+0.4*Math.sin(PI*U.seg(tc,1.5,1.75)))*ap;
    st.nameA=Math.max(L.nameDim,U.eio(U.seg(tc,TT.name[0],TT.name[1]))*0.92)*ap;
    st.floorA=(1-U.eio(U.seg(tc,TT.lift[0],TT.lift[0]+1.3)))*ap;
    /* 名片本身也是慢慢显出来的：边、表面的颜色、反光，都从"和背景一样黑"开始 */
    uni.uKA.value[1]=L.rim*ap;
    uni.uCardTop.value.lerpVectors(cBg,cTop,ap);uni.uCardSide.value.lerpVectors(cBg,cSide,ap);
    uni.uSheen.value=C.LIGHT.sheen*ap;uni.uRimGlow.value=C.LIGHT.rimGlow*ap;backU.uA.value=ap;
  }

  /* ---------- 每一帧 ----------
     p: {tc 名片的钟, dt, clock, appear 名片显出来多少, thumbs 小图亮出来多少, dive 朝橱窗冲进去的进度,
         inter 现在能不能互动（到了首页以后才行）, demo 总时间线里演示翻面的角度, still 跟着指针晃的幅度 0..1,
         mos 整幅画面变成马赛克：[横向多少格, 纵向多少格]，不要就不传} */
  var ray=new T.Raycaster(),ndc=new T.Vector2(),v=new T.Vector3(),psx=0,psy=0,ptr={nx:0,ny:0,inside:false};
  var plane=new T.Plane(new T.Vector3(0,1,0),0),hit=new T.Vector3();
  function overCard(nx,ny){
    ndc.set(nx,ny);ray.setFromCamera(ndc,cam);plane.constant=isBack()?TH:0;
    return !!ray.ray.intersectPlane(plane,hit)&&Math.abs(hit.x)<CW/2&&Math.abs(hit.z)<CD/2;
  }
  function frame(p){
    var s=syncP(),asp=s.w/s.h,tc=p.tc,dv=p.dive||0,ap=p.appear==null?1:p.appear,th=p.thumbs==null?1:p.thumbs;
    clockNow=p.clock;inter=!!p.inter;
    scene.setPortrait(PORT);
    core.shared.uTime.value=p.clock;
    psx+=(ptr.nx-psx)*Math.min(1,p.dt*3);psy+=(-ptr.ny-psy)*Math.min(1,p.dt*3);
    /* 翻面的角度：人接手以后跟着人走（松手就转到最近的一面），否则走总时间线里那次演示 */
    if(flip.user){if(!flip.drag)flip.cur=U.lerp(flip.from,flip.to,U.eio(U.seg(p.clock,flip.t0,flip.t0+flip.dur)));flip.ang=flip.cur;}
    else flip.ang=p.demo||0;
    var still=(1-Math.abs(Math.sin(flip.ang)))*(1-dv)*(p.still==null?1:p.still);      /* 翻面、冲进橱窗、像素点还没落稳的时候，不跟着指针晃 */
    place({tc:tc,asp:asp,px:psx*still,py:psy*still,city:U.eio(cityK),hov:U.eio(popMax),flip:flip.ang,dive:dv});
    /* 只有到了首页、名片正面朝上的时候才能悬停 */
    hoverIdx=-1;
    if(forced>-2)hoverIdx=forced;
    else if(ptr.inside&&inter&&!flip.drag&&Math.cos(flip.ang)>0.5){ndc.set(ptr.nx,ptr.ny);ray.setFromCamera(ndc,cam);hoverIdx=scene.pick(ray.ray,st.rise);}
    compute(tc,p.dt,ap,th);scene.update(st);
    scene.floor.visible=st.floorA>0.004;
    backU.uSheen.value=0.55+0.5*Math.cos(flip.ang)+psx*0.25;
    core.render({tilt:C.POST.tilt*U.lerp(1,C.POST.tiltCard,U.eio(U.seg(tc,TT.lift[0],TT.lift[1])))*(1-U.c01(dv*1.6)),focus:1-orb.cy,mos:p.mos||null});
  }
  /* 名片还一点都没显出来的时候（像素点正在上面散开），底下就是一片背景色：不用走整套渲染，清成背景色就行 */
  function blank(){core.renderer.setRenderTarget(null);core.renderer.clear();}
  /* 开机预热：把这个世界里每一样东西都真的画一遍（楼全立着、灯全亮、电车在跑、马赛克开着、翻到背面）。
     手机上一样东西第一次被画出来的那一帧，显卡要现编着色器、现传贴图，会卡一下；提前画过，放的时候就不卡了 */
  function warm(clock){
    var base={dt:1/60,clock:clock,appear:1,thumbs:1,dive:0,inter:false,demo:0,still:0},k;
    function go(o){for(k in base)if(!(k in o))o[k]=base[k];frame(o);}
    go({tc:4.9});go({tc:4.9,dive:0.6,mos:[24,24]});go({tc:0.8});go({tc:6.6});go({tc:TT.end,demo:PI});go({tc:TT.end});
    resetPlay();
  }
  /* 冲到窗前的最后一刻，那扇窗在画面上每秒放大多少（按自然对数算）。speed 是 dive 这个进度每秒走多少。
     像素点接手以后要照这个速度接着往外走，画面才不会顿一下 */
  function diveRate(tc,speed){
    var s=syncP(),asp=s.w/s.h,e=0.004;
    function wide(k){
      place({tc:tc,asp:asp,px:0,py:0,city:0,hov:0,flip:0,dive:k});
      v.set(WIN.x-SW/2,WIN.y,WIN.z).project(cam);var x0=v.x;v.set(WIN.x+SW/2,WIN.y,WIN.z).project(cam);return Math.abs(v.x-x0);
    }
    return Math.log(wide(1)/wide(1-e))/e*speed;
  }

  /* ---------- 名片拆成点 ----------
     名片在 tc 这一刻（按那一刻的机位）画在屏幕上的样子，拆成一组点：边、街道刻线、九块地基的框；thumbs 为真时再加上九块小图。
     返回 [x, y, 点的大小（设备像素）, r, g, b, 种类] 一组一组排下去。x, y 是 -1..1 的画面坐标；
     种类 1 是线，2 是小图，0 是填在名片里面、最后会淡掉的。budget 是大约要多少个点 */
  /* dpx：像素点那块画布一个 CSS 像素是几个设备像素（它和名片这一块不一定一样） */
  function targets(tc,thumbs,budget,dpx){
    var s=syncP(),asp=s.w/s.h,out=[],i,j,E=COL.edge,WM=COL.warm,r=(function(){var z=4242;return function(){z=(Math.imul(z,1664525)+1013904223)>>>0;return z/4294967296;};})();
    place({tc:tc,asp:asp,px:0,py:0,city:0,hov:0,flip:0,dive:0});
    v.set(0,0,0).project(cam);var x0=v.x;v.set(1,0,0).project(cam);dpx=dpx||s.px;var ppu=Math.abs(v.x-x0)*s.w*dpx*0.5;      /* 名片上一个单位，在屏幕上是多少像素 */
    function add(x,z,size,c,b,kind){v.set(x,0.002,z).project(cam);out.push(v.x,v.y,size,c[0]*b,c[1]*b,c[2]*b,kind);}
    var polys=[],rr=C.CARD.r,hx=CW/2,hz=CD/2,a,rim=[];
    [[hx-rr,-hz+rr,-PI/2],[hx-rr,hz-rr,0],[-hx+rr,hz-rr,PI/2],[-hx+rr,-hz+rr,PI]].forEach(function(c){for(a=0;a<=6;a++)rim.push([c[0]+Math.cos(c[2]+a/6*PI/2)*rr,c[1]+Math.sin(c[2]+a/6*PI/2)*rr]);});
    rim.push(rim[0]);polys.push({p:rim,b:0.95});
    C.TRACES.forEach(function(t){polys.push({p:t.pts,b:0.62,warm:true});});
    var ZS={A:C.TRACES[8].pts[0][1],B:C.TRACES[0].pts[0][1],C:C.TRACES[4].pts[0][1]};
    heroes.forEach(function(h){
      var zF=h.zf+PAD,zB=h.zf-SH-PAD,xa=h.x-SW/2-PAD,xb=h.x+SW/2+PAD;
      polys.push({p:[[h.x,ZS[h.w.row]],[h.x,zF]],b:0.5});polys.push({p:[[xa,zF],[xb,zF],[xb,zB],[xa,zB],[xa,zF]],b:0.5});
    });
    var total=0;polys.forEach(function(o){o.len=0;for(i=1;i<o.p.length;i++)o.len+=Math.hypot(o.p[i][0]-o.p[i-1][0],o.p[i][1]-o.p[i-1][1]);total+=o.len;});
    var nLine=Math.round(budget*(thumbs?0.40:0.78)),step=total/nLine,lsz=Math.max(1.6*dpx,Math.min(3.0*dpx,step*ppu*1.25));
    polys.forEach(function(o){
      var acc=step*r();
      for(i=1;i<o.p.length;i++){
        var ax=o.p[i-1][0],az=o.p[i-1][1],bx=o.p[i][0],bz=o.p[i][1],len=Math.hypot(bx-ax,bz-az);
        for(;acc<len;acc+=step){var k=acc/len,wm=o.warm&&r()<0.06;add(ax+(bx-ax)*k,az+(bz-az)*k,lsz,wm?WM:E,wm?0.9:o.b,1);}
        acc-=len;
      }
    });
    if(thumbs){
      /* 九块小图：每块按它自己那张作品图取色，一格一个点 */
      var nx=Math.max(6,Math.round(Math.sqrt(budget*0.50/N*1.6))),ny=Math.max(4,Math.round(nx/1.6)),tc2=document.createElement('canvas');tc2.width=nx;tc2.height=ny;
      var tg=tc2.getContext('2d',{willReadFrequently:true}),tsz=ppu*SW/nx*0.92;
      heroes.forEach(function(h){
        var o=scene.screens[h.i],fx=h.w.fx||{},ga=fx.gamma||1,gn=fx.gain==null?1:fx.gain,d=null;
        try{if(o.img){tg.drawImage(o.img,0,0,nx,ny);d=tg.getImageData(0,0,nx,ny).data;}}catch(e){d=null;}
        for(j=0;j<ny;j++)for(i=0;i<nx;i++){
          var q=(j*nx+i)*4,c=d?[Math.pow(d[q]/255,ga)*gn,Math.pow(d[q+1]/255,ga)*gn,Math.pow(d[q+2]/255,ga)*gn]:[0.5,0.5,0.5];
          add(h.x-SW/2+(i+0.5)*SW/nx,h.zf-SH+(j+0.5)*SH/ny,tsz,c,1,2);
        }
      });
    }
    /* 剩下的填在名片里面：它们落下来就淡掉，变成名片那块黑 */
    for(i=out.length/7;i<budget;i++){
      var fxp=(r()*2-1)*(hx-0.2),fzp=(r()*2-1)*(hz-0.2);add(fxp,fzp,1.8*dpx,E,0.28,0);
    }
    return new Float32Array(out);
  }

  /* ---------- 指针 ----------  nx, ny 是 -1..1 的画面坐标（ny 向上为正） */
  function move(nx,ny,px,type){
    ptr.nx=nx;ptr.ny=ny;if(type!=='touch')ptr.inside=true;
    if(flip.down){
      if(!flip.drag&&Math.abs(px-flip.x0)>7){flip.drag=true;takeFlip();flip.a0=flip.cur;}
      if(flip.drag)flip.cur=flip.a0+(px-flip.x0)/flip.w*PI*1.15;
    }
  }
  function down(nx,ny,px,w,type){
    ptr.nx=nx;ptr.ny=ny;
    if(!inter||!overCard(nx,ny))return false;
    flip.down=true;flip.drag=false;flip.x0=px;flip.w=Math.max(240,w*0.5);return true;
  }
  /* 松手：拖过了就转到最近的一面；没拖就算点了一下（把那栋楼钉住 / 放下） */
  function upAt(nx,ny,type){
    var was=flip.down,drag=flip.drag;flip.down=false;flip.drag=false;
    if(drag){var to=Math.round(flip.cur/PI)*PI;flipTo(to,0.24+0.5*Math.min(1,Math.abs(to-flip.cur)/(PI/2)));return 'flip';}
    if(!was||!inter||Math.cos(flip.ang)<0.5)return '';
    var isTouch=type==='touch',k;ndc.set(nx,ny);ray.setFromCamera(ndc,cam);
    var i=scene.pick(ray.ray,st.rise,isTouch?0.3:0);
    if(isTouch){var on=i>=0&&pinned[i];for(k=0;k<N;k++)pinned[k]=false;if(i>=0&&!on){pinned[i]=true;lastPin=i;}else lastPin=-1;}
    else if(i>=0){pinned[i]=!pinned[i];lastPin=i;}
    return 'tap';
  }
  function leave(){ptr.inside=false;ptr.nx=0;ptr.ny=0;}

  function toggleCity(){
    if(!inter)return;
    if(isBack()){takeFlip();flipTo(Math.round(flip.cur/(2*PI))*2*PI,0.9);}
    city=!city;lastPin=-1;if(city)cityAt=clockNow;else{cityOffAt=clockNow;for(var i=0;i<N;i++)pinned[i]=false;}
  }
  function toggleFlip(){
    if(!inter)return;
    takeFlip();var n=Math.round(flip.to/PI);flipTo((n+1)*PI,0.9);
    /* 翻到背面之前，把立着的楼先收回去 */
    if(Math.abs(n)%2===0&&city){city=false;cityOffAt=clockNow;for(var i=0;i<N;i++)pinned[i]=false;}
  }

  /* 楼名标签该放在哪：桌面上挂在楼顶，竖屏上固定在名片下面一行。返回 null 表示不显示 */
  function label(out){
    var li=hoverIdx>=0?hoverIdx:(lastPin>=0&&pinned[lastPin]&&inter?lastPin:-1);
    if(li<0||Math.cos(flip.ang)<0.5)return null;
    var s=syncP(),P=PORT;out.i=li;out.portrait=P;out.w=heroes[li].w;
    if(P){
      v.set(-CW/2,0,CD/2).project(cam);var y=v.y;v.set(CW/2,0,CD/2).project(cam);
      out.x=0;out.y=(0.5-Math.min(y,v.y)*0.5)*s.h+22;
    }else{
      scene.anchor(li,st.rise[li],v).project(cam);out.x=(v.x*0.5+0.5)*s.w;out.y=(0.5-v.y*0.5)*s.h;
    }
    return out;
  }

  return {core:core,scene:scene,heroes:heroes,TT:TT,frame:frame,blank:blank,warm:warm,targets:targets,diveRate:diveRate,fitPortrait:fitPortrait,cardPx:cardPx,
    resize:function(){core.resize();syncP();drawBack();},setBack:setBack,reset:resetPlay,
    move:move,down:down,up:upAt,leave:leave,toggleCity:toggleCity,toggleFlip:toggleFlip,label:label,overCard:overCard,
    state:function(){return {city:city,back:isBack(),hover:hoverIdx,flip:flip.ang,cityK:cityK,dragging:flip.drag};},
    debug:{st:st,flip:flip,hover:function(i){forced=i==null?-2:i;},pin:function(i,on){pinned[i]=on!==false;lastPin=on!==false?i:-1;},
      setFlip:function(a){flip.user=true;flip.cur=flip.from=flip.to=a;flip.t0=-9;},city:function(on){city=on!==false;if(city)cityAt=clockNow;else cityOffAt=clockNow;}}};
};
})();
