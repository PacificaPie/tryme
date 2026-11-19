/* 像素点：把一帧画面碎成一格一格的点，散开，再变成别的东西。有自己的一块透明画布，压在两段画面的上面。
   两种用法：
   form —— 画面碎成点、散开、收拢到一组目标点上（展厅变成名片）；
   warp —— 一整幅马赛克迎面往外飞出去、边飞边缩成点，中间再涌出一圈圈星点（穿进橱窗）。
   点是屏幕上的正方形，位置全按像素算。给定"像素点接手了多少秒"就能直接算出那一帧。 */
(function(){
'use strict';
var FX=window.FX=window.FX||{};
/* 8x8 的抖点矩阵：哪些格子留下来变成点，和展廊里没醒的作品是同一种抖法 */
var B8=[0,32,8,40,2,34,10,42,48,16,56,24,50,18,58,26,12,44,4,36,14,46,6,38,60,28,52,20,62,30,54,22,3,35,11,43,1,33,9,41,51,19,59,27,49,17,57,25,15,47,7,39,13,45,5,37,63,31,55,23,61,29,53,21];
/* 各段的时刻（秒，从像素点接手开始算）。接手之前，底下的画面自己已经一级一级变成了马赛克，最后一级正好是这里的格子。
   form：方块缩成点 → 散开 → 1.3 秒起收拢 → 2.65 秒以后淡掉，交给真的画面，一共 3.2 秒；
   warp：方块一边往外飞一边缩成点，接着从正中涌出一圈圈星点，一共 1.5 秒 */
var TM=FX.DOT_T={form:3.2,warp:1.5};

var VS=[
'attribute vec2 aHome;attribute vec3 aCol;attribute vec4 aRnd;attribute float aOn;attribute vec3 aTgt;attribute vec3 aTcol;attribute float aKind;',
'uniform float uT;uniform float uCell;uniform vec2 uRes;uniform float uMode;uniform float uV0;',
'varying vec3 vCol;varying float vA;',
'vec2 rot(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(p.x*c-p.y*s,p.x*s+p.y*c);}',
'void main(){',
'  vec3 bone=vec3(0.925,0.914,0.886);',
'  vec2 home=aHome*uRes*0.5,p;float size,alpha;vec3 col;',
'  if(uMode<0.5){',
     /* 接手时画面已经是一整幅马赛克。镜头本来还在往前走，这里照着它的余势再放大一点点（uV0），慢慢停住 */
'    home*=1.0+uV0*0.35*(1.0-exp(-uT/0.35));',
'    float d1=smoothstep(0.02+aRnd.x*0.30,0.50+aRnd.x*0.30,uT);',                   /* 方块缩成点；没被抖点矩阵选中的格子在这一步消失 */
'    col=mix(aCol,mix(aCol,bone,0.45),d1);',
     /* 散开：从画面中心往外，有的冲得远（像是朝镜头飞过来，也更大），有的近；缓缓停下 */
'    float sc=clamp((uT-(0.38+aRnd.y*0.30))/1.15,0.0,1.0);sc=1.0-pow(1.0-sc,3.0);',
'    float cv=clamp((uT-(1.30+aRnd.z*0.55))/1.15,0.0,1.0);cv=cv*cv*(3.0-2.0*cv);',
'    vec2 dir=normalize(home+(aRnd.wx-0.5)*uRes.y*0.5+vec2(0.01));',
'    float near=aRnd.y*aRnd.y;',
'    vec2 sp=home+dir*(0.10+0.42*near)*uRes.y*sc+(aRnd.zw-0.5)*uRes.y*0.16*sc;',
     /* 收拢：绕着自己的落点转着圈收进去 */
'    vec2 tg=aTgt.xy*uRes*0.5;',
'    p=tg+rot(sp-tg,(aRnd.x<0.5?-1.0:1.0)*(0.5+0.9*aRnd.w)*cv)*(1.0-cv);',
'    float s0=uCell*mix(1.04,0.46,d1)*(1.0+1.3*near*sc);',
'    size=mix(s0,aTgt.z,smoothstep(0.35,1.0,cv));',
'    float keep=aKind<0.5?1.0-0.92*smoothstep(0.30,0.95,cv):1.0;',                  /* 填在里面的那些点，落下来就淡掉 */
'    alpha=mix(1.0,aOn,d1)*keep*(1.0-smoothstep(2.65,3.15,uT));',
'    col=mix(col,aTcol,smoothstep(0.25,0.90,cv));',
'  }else{',
     /* 迎面飞出去。头一瞬间所有格子照着镜头冲过来的速度一起放大（uV0，每秒放大多少），画面不顿；
        然后各走各的：离得近的越飞越快、越来越大，从身边掠过去；离得远的慢下来，像悬在半空的碎屑 */
'    float dw=smoothstep(0.04+aRnd.x*0.22,0.34+aRnd.x*0.22,uT);',
'    float near=aRnd.y*aRnd.y;',
'    float tau=mix(0.10,0.80,near);',
'    float acc=uV0*tau*(1.0-exp(-uT/tau))+uT*uT*(0.6+11.0*near);',
'    p=home*(1.0+acc);',
'    size=uCell*mix(1.04,0.50,dw)*(1.0+acc*0.55);',
'    alpha=mix(1.0,aOn,dw)*(1.0-smoothstep(0.55,1.05,uT));',
'    col=mix(aCol,mix(aCol,bone,0.45),dw);',
'    float ts=uT-(0.30+aRnd.x*0.30);',
'    if(aOn<0.5&&ts>0.0){',
       /* 没被选中的格子改当星点：从正中一圈圈往外涌，越到外面越快越大；正中那一小团压暗，不结成块 */
'      float ph=fract(aRnd.x*7.0+ts*(0.75+0.7*aRnd.y));',
'      vec2 dr=normalize(aRnd.zw-0.5+vec2(0.001));',
'      p=dr*(0.015+0.75*ph*ph)*uRes.y;',
'      size=uCell*(0.16+0.55*ph*ph);col=bone;',
'      alpha=smoothstep(0.0,0.25,ts)*(1.0-smoothstep(0.95,1.45,uT))*smoothstep(0.03,0.30,ph)*(0.3+0.7*aRnd.y);',
'    }',
'  }',
'  vCol=col;vA=alpha;',
'  gl_Position=vec4(p/(uRes*0.5),0.0,1.0);',
'  gl_PointSize=max(size,1.0);',
'}'].join('\n');
var FS='varying vec3 vCol;varying float vA;void main(){if(vA<0.004)discard;gl_FragColor=vec4(vCol*vA,vA);}';

FX.createDots=function(canvas){
  var T=THREE,renderer=new T.WebGLRenderer({canvas:canvas,alpha:true,antialias:false,premultipliedAlpha:true,powerPreference:'high-performance'});
  renderer.setClearColor(0x000000,0);
  var scene=new T.Scene(),cam=new T.Camera(),W=1,H=1,px=1,cols=8,rows=8,shown=false;
  var uni={uT:{value:0},uCell:{value:8},uRes:{value:new T.Vector2(1,1)},uMode:{value:0},uV0:{value:0}};
  var mat=new T.ShaderMaterial({uniforms:uni,transparent:true,depthTest:false,depthWrite:false,premultipliedAlpha:true,vertexShader:VS,fragmentShader:FS});
  var points=new T.Points(new T.BufferGeometry(),mat);points.frustumCulled=false;scene.add(points);
  var sc=document.createElement('canvas'),sg=sc.getContext('2d',{willReadFrequently:true});

  function resize(){
    var w=canvas.clientWidth||window.innerWidth,h=canvas.clientHeight||window.innerHeight;if(w<2||h<2)return;
    px=(window.FV&&window.FV.Q)?window.FV.Q.d:Math.min(window.devicePixelRatio||1,2);renderer.setPixelRatio(px);renderer.setSize(w,h,false);W=w;H=h;
    /* 一格大约 5.5 到 10 个像素：宽屏上大约 150 格一行 */
    var cell=Math.max(5.5,Math.min(10,w/150));cols=Math.max(8,Math.round(w/cell));rows=Math.max(8,Math.round(h/(w/cols)));
    uni.uRes.value.set(w*px,h*px);uni.uCell.value=Math.max(w*px/cols,h*px/rows);
  }
  /* 把一帧画面（任何画得进画布的东西）缩成一格一个颜色 */
  function sample(src){sc.width=cols;sc.height=rows;sg.imageSmoothingQuality='high';sg.drawImage(src,0,0,cols,rows);return sg.getImageData(0,0,cols,rows);}
  /* 做一段过场要用的点。img 是 sample() 拿到的那帧画面；
     targets 是收拢的落点 [x, y, 大小, r, g, b, 种类] 一组一组排下去，也可以是一个函数（告诉它留下了多少个点，它返回落点）；
     没有落点就不传，比如 warp */
  function clip(img,targets){
    var n=cols*rows,d=img.data,home=new Float32Array(n*2),col=new Float32Array(n*3),rnd=new Float32Array(n*4),on=new Float32Array(n),
      tgt=new Float32Array(n*3),tcol=new Float32Array(n*3),kind=new Float32Array(n),lit=[],i,j,k=0,z=97531;
    function r(){z=(Math.imul(z,1664525)+1013904223)>>>0;return z/4294967296;}
    for(j=0;j<rows;j++)for(i=0;i<cols;i++,k++){
      var o=k*4,R=d[o]/255,G=d[o+1]/255,B=d[o+2]/255;
      home[k*2]=-1+(i+0.5)*2/cols;home[k*2+1]=1-(j+0.5)*2/rows;
      col[k*3]=R;col[k*3+1]=G;col[k*3+2]=B;
      rnd[k*4]=r();rnd[k*4+1]=r();rnd[k*4+2]=r();rnd[k*4+3]=r();
      on[k]=((0.299*R+0.587*G+0.114*B)*0.96+0.02)>(B8[(j&7)*8+(i&7)]+0.5)/64?1:0;
      tgt[k*3]=home[k*2];tgt[k*3+1]=home[k*2+1];tgt[k*3+2]=2;tcol[k*3]=R;tcol[k*3+1]=G;tcol[k*3+2]=B;
      if(on[k])lit.push(k);
    }
    if(typeof targets==='function')targets=targets(lit.length);
    if(targets&&targets.length){
      /* 谁落到哪：点和落点都按"从左到右、略带一点上下"排个队，一一对上，这样收拢时是一股一股地流过去，不是乱成一锅；
         队里再打乱一点点，免得太整齐。点比落点多的时候，多出来的点落下就淡掉 */
      var M=targets.length/7,ti=[],keyT=new Float32Array(M),keyP=new Float32Array(n),L=lit.length,q,last=-1;
      for(q=0;q<M;q++){ti.push(q);keyT[q]=targets[q*7]+0.35*targets[q*7+1]+(r()-0.5)*0.10;}
      ti.sort(function(a,b){return keyT[a]-keyT[b];});
      for(q=0;q<L;q++)keyP[lit[q]]=home[lit[q]*2]+0.35*home[lit[q]*2+1]+(r()-0.5)*0.22;
      lit.sort(function(a,b){return keyP[a]-keyP[b];});
      for(q=0;q<L;q++){
        var kk=lit[q],at=Math.min(M-1,Math.floor(q*M/L)),t=ti[at]*7;
        tgt[kk*3]=targets[t];tgt[kk*3+1]=targets[t+1];tgt[kk*3+2]=targets[t+2];
        tcol[kk*3]=targets[t+3];tcol[kk*3+1]=targets[t+4];tcol[kk*3+2]=targets[t+5];
        kind[kk]=at===last?0:targets[t+6];last=at;
      }
    }
    var g=new T.BufferGeometry();
    g.setAttribute('position',new T.BufferAttribute(new Float32Array(n*3),3));
    g.setAttribute('aHome',new T.BufferAttribute(home,2));g.setAttribute('aCol',new T.BufferAttribute(col,3));g.setAttribute('aRnd',new T.BufferAttribute(rnd,4));
    g.setAttribute('aOn',new T.BufferAttribute(on,1));g.setAttribute('aTgt',new T.BufferAttribute(tgt,3));g.setAttribute('aTcol',new T.BufferAttribute(tcol,3));g.setAttribute('aKind',new T.BufferAttribute(kind,1));
    g.userData={n:n,lit:lit.length};
    return g;
  }
  /* v0：接手那一刻画面每秒放大多少（镜头还在往前走），像素点照这个速度接着走一小段 */
  function draw(geo,mode,t,v0){
    if(!geo)return hide();
    if(points.geometry!==geo)points.geometry=geo;
    uni.uMode.value=mode==='warp'?1:0;uni.uT.value=t;uni.uV0.value=v0||0;
    renderer.render(scene,cam);
    if(!shown){shown=true;canvas.style.visibility='visible';}
  }
  function hide(){if(shown){shown=false;renderer.clear();canvas.style.visibility='hidden';}}
  /* 开头那几帧让这块画布空着露一次面（透明的，看不出来）：浏览器把它第一次送上屏幕要现准备，放到开头做，后面真要用的那一帧就不卡 */
  function prime(on){renderer.clear();shown=!!on;canvas.style.visibility=on?'visible':'hidden';}
  resize();
  return {resize:resize,sample:sample,clip:clip,draw:draw,hide:hide,prime:prime,grid:function(){return {cols:cols,rows:rows,n:cols*rows};},px:function(){return px;},canvas:canvas};
};
})();
