/* 着色器。夜里的白模：体块本身几乎是黑的，靠橱窗、小图、路灯和小窗自己发光来照亮旁边的墙和地。 */
(function(){
'use strict';
var SP=window.LC=window.LC||{},S=SP.GLSL={};
function J(a){return a.join('\n');}

var HASH=J([
'float h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
'float n21(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h21(i),h21(i+vec2(1.0,0.0)),f.x),mix(h21(i+vec2(0.0,1.0)),h21(i+vec2(1.0,1.0)),f.x),f.y);}'
]);

/* 楼从名片里顶出来：整栋平移，顶到位的那一下多伸出去一点点再落回来。
   b = [楼的编号, 延迟, 总高]。uOff 是整体的位移和缩放，只有电车用它。 */
var PLACE=J([
'uniform float uRise[9];uniform float uFill;uniform float uFillDown;uniform float uCity;uniform vec4 uOff;',
'float backOut(float t){float u=t-1.0;return 1.0+2.70158*u*u*u+1.70158*u*u;}',
'float sm01(float t){t=clamp(t,0.0,1.0);return t*t*(3.0-2.0*t);}',
/* 配楼按 b.y（离西头多远）依次动：起来时带一点回弹；退场也是西头先走，用对称的缓动；首页上“进城”那一路单独算，取大的 */
'float riseOf(vec3 b){',
'  if(b.x>-0.5)return uRise[int(b.x+0.5)];',
'  float up=backOut(clamp(uFill*1.6-b.y*0.6,0.0,1.0))*(1.0-sm01(uFillDown*1.6-b.y*0.6));',
'  return max(up,sm01(uCity*1.6-b.y*0.6));',
'}',
'vec3 place(vec3 p,vec3 b){',
'  if(b.x<-1.5)return p;',
'  float k=riseOf(b);',
'  p.y=p.y*(1.0+max(k-1.0,0.0)*0.9)-(1.0-min(k,1.0))*(b.z+0.04);',
'  return p*uOff.w+uOff.xyz;',
'}']);

/* ---------------- 白模 ---------------- */
S.modelV=J([
'attribute float aBase;attribute vec3 aBld;attribute vec3 aUvw;attribute vec2 aWs;',
PLACE,
'varying vec3 vP;varying vec3 vN;varying float vBase;varying vec3 vUvw;varying vec2 vWs;varying float vHero;',
'void main(){',
'  vec3 p=place(position,aBld);vP=p;vN=normal;vUvw=aUvw;vWs=aWs;vHero=aBld.x;',
'  vBase=aBld.x<-1.5?aBase:max(place(vec3(position.x,aBase,position.z),aBld).y,0.0);',
'  gl_Position=projectionMatrix*viewMatrix*vec4(p,1.0);',
'}']);

S.modelF=J([
'#define NS 9',
'#define NL 8',
'uniform float uRise[9];uniform float uFillAO;',
'uniform vec3 uSPos[NS];uniform vec3 uSUp[NS];uniform vec3 uSNrm[NS];uniform vec3 uSCol[NS];uniform vec4 uFoot[NS];uniform vec4 uLamp[NL];',
'uniform sampler2D tAO;uniform vec4 uPlate;uniform vec2 uWinHalf;uniform vec2 uCardHalf;uniform float uCardR;',
'uniform vec3 uCardTop;uniform vec3 uCardSide;uniform vec3 uWallTop;uniform vec3 uWallSide;uniform vec3 uWarm;uniform vec3 uWarmLight;uniform vec3 uEdgeCol;',
'uniform float uMoon;uniform float uSpill;uniform float uHalo;uniform float uLampK;uniform float uLampFall;uniform float uWinK;uniform float uWinLit;uniform float uWinOn;uniform float uSheen;uniform float uRimGlow;uniform float uGloss;uniform float uLampWall;',
'varying vec3 vP;varying vec3 vN;varying float vBase;varying vec3 vUvw;varying vec2 vWs;varying float vHero;',
HASH,
'void main(){',
'  bool card=vHero<-1.5;',
'  if(!card&&vP.y<0.0)discard;',                      /* 还在名片下面的部分不画 */
'  vec3 N=normalize(vN);float up=N.y;',
'  vec3 base;float ao=1.0;vec3 refl=vec3(0.0);',
'  if(card){',
'    base=up>0.5?uCardTop:uCardSide;',
'    if(up>0.5){',
       /* 楼脚的接地阴影：配楼烘在一张图里，九栋主楼各自算 */
'      ao=mix(1.0,texture2D(tAO,(vP.xz-uPlate.xy)*uPlate.zw).r,clamp(uFillAO,0.0,1.0));',
'      for(int i=0;i<NS;i++){vec4 f=uFoot[i];vec2 d=abs(vP.xz-f.xy)-f.zw;float sd=length(max(d,0.0))+min(max(d.x,d.y),0.0);ao*=1.0-0.5*clamp(uRise[i],0.0,1.0)*exp(-max(sd,0.0)/0.16);}',
       /* 哑光纸面：很浅的深浅不匀，一层随视角移动的反光，边缘往里一点冷光 */
'      base*=0.93+0.09*n21(vP.xz*7.0)+0.05*n21(vP.xz*29.0);',
'      vec2 dq=abs(vP.xz)-(uCardHalf-uCardR);float sdc=length(max(dq,0.0))+min(max(dq.x,dq.y),0.0)-uCardR;',
'      base+=uEdgeCol*uRimGlow*exp(sdc/0.11);',
'      vec3 R=reflect(-normalize(cameraPosition-vP),N);',
'      base+=vec3(0.80,0.87,1.0)*uSheen*pow(max(dot(R,normalize(vec3(-0.30,0.66,-0.69))),0.0),5.0);',
       /* 缎面的倒影：顺着视线的反射方向去找立着的橱窗，找到了就映出它的颜色；离得越远越糊 */
'      vec3 Vd=normalize(vP-cameraPosition);float fres=pow(1.0-max(-Vd.y,0.0),3.0);',
'      for(int i=0;i<NS;i++){',
'        vec3 c=uSCol[i],n=uSNrm[i];float dn=dot(R,n),upr=smoothstep(0.3,0.9,n.z);',   /* upr：窗有多立。躺下去的过程里倒影是慢慢退掉的 */
'        if(c.r+c.g+c.b<0.002||upr<0.001||dn>-0.02)continue;',
'        float t=dot(uSPos[i]-vP,n)/dn;if(t<0.0)continue;',
'        vec3 hp=vP+R*t-uSPos[i];float bl=0.05+0.20*t;',
'        refl+=c*upr*(1.0-smoothstep(-bl,bl,abs(hp.x)-uWinHalf.x))*(1.0-smoothstep(-bl,bl*2.0,abs(dot(hp,uSUp[i]))-uWinHalf.y))/(1.0+0.25*t);',
'      }',
'      refl*=uGloss*(0.10+0.90*fres);',
'    }',
'  }else{',
'    base=mix(uWallSide,uWallTop,max(up,0.0)*uMoon);',
'    if(up<-0.5)ao=0.7;else if(up<0.5)ao=1.0-0.34*exp(-max(vP.y-vBase,0.0)/0.15);',
'  }',
   /* 配楼的小窗：大多数是更深的玻璃，少数几扇亮着，亮度和色温各不一样 */
'  vec3 emit=vec3(0.0);',
'  if(vUvw.z>0.5){',
'    vec2 f=fract(vUvw.xy),fw=fwidth(vUvw.xy)*1.1+0.001,h=vWs*0.5;',
'    float wx=smoothstep(0.5-h.x-fw.x,0.5-h.x+fw.x,f.x)*(1.0-smoothstep(0.5+h.x-fw.x,0.5+h.x+fw.x,f.x));',
'    float wy=smoothstep(0.5-h.y-fw.y,0.5-h.y+fw.y,f.y)*(1.0-smoothstep(0.5+h.y-fw.y,0.5+h.y+fw.y,f.y));',
'    float win=wx*wy,h1=h21(floor(vUvw.xy)+vUvw.z*13.7),h2=h21(floor(vUvw.xy)*1.7+vUvw.z*5.1);',
'    base*=1.0-0.5*win;',
'    float on=smoothstep(h2*0.8,h2*0.8+0.2,uWinOn);',
'    vec2 wq=(f-0.5)/h;',                         /* 窗里的位置 -1..1：下半更亮，中间一道窗棂 */
'    emit=mix(uWarm,vec3(1.0,0.90,0.72),h2*0.55)*(0.42+0.58*h2)*step(1.0-uWinLit,h1)*win*on*uWinK*(0.74-0.26*wq.y)*(1.0-0.7*smoothstep(0.11,0.05,abs(wq.x)));',
'  }',
   /* 九块作品画面当作九盏长方形的灯：照亮前面的地和旁边的墙，贴着的那个面上再加一圈紧挨着的光 */
'  vec3 light=vec3(0.0);',
'  for(int i=0;i<NS;i++){',
'    vec3 c=uSCol[i];if(c.r+c.g+c.b<0.002)continue;',
'    vec3 n=uSNrm[i],u=uSUp[i],q=vP-uSPos[i],l=vec3(q.x,dot(q,u),dot(q,n));',
'    vec3 dl=vec3(clamp(l.x,-uWinHalf.x,uWinHalf.x)-l.x,clamp(l.y,-uWinHalf.y,uWinHalf.y)-l.y,-l.z);',
'    float d2=dot(dl,dl)+0.003,inv=inversesqrt(d2);',
'    vec3 Ld=(vec3(dl.x,0.0,0.0)+u*dl.y+n*dl.z)*inv;',
     /* 窗往后躺的时候：照出去的光随着它躺平慢慢收掉，贴着名片的那圈光慢慢长出来，都不跳变 */
'    light+=c*max(dot(N,Ld),0.0)*smoothstep(-0.05,0.35,l.z*inv)*smoothstep(0.25,0.9,n.z)*uSpill*(uWinHalf.x*uWinHalf.y*2.7)/(d2*1.8+0.55);',
'    light+=c*smoothstep(0.5,0.96,dot(N,n))*(1.0-smoothstep(0.04,0.16,abs(l.z)))*exp(-length(dl.xy)*4.6)*uHalo;',
'  }',
'  float lamp=0.0;',
'  for(int i=0;i<NL;i++){vec4 L=uLamp[i];if(L.w<0.002)continue;vec3 q=L.xyz-vP;float d2=dot(q,q)+0.01;lamp+=L.w*max(dot(N,q)*inversesqrt(d2),0.0)/(1.0+d2*uLampFall);}',
'  light+=uWarmLight*lamp*uLampK*((card||abs(up)>0.5)?1.0:uLampWall);',
'  gl_FragColor=vec4(base*ao+(light+refl)*(0.45+0.55*ao)+emit,1.0);',
'}']);

/* ---------------- 亮边：每条线是一个朝着镜头的细长方形，宽度按屏幕像素算，远近都一样粗 ---------------- */
S.lineV=J([
'attribute vec3 aA;attribute vec3 aB;attribute vec3 aBld;attribute vec2 aSeq;attribute float aKind;attribute vec2 aSide;',
PLACE,
'uniform vec2 uRes;uniform float uHalfPx;uniform float uGlow[9];',
'varying float vEdge;varying float vSeq;varying float vKind;varying float vY;varying float vGlow;',
'void main(){',
'  vec3 a=place(aA,aBld),b=place(aB,aBld);',
   /* 沿视线往镜头方向挪一点点，免得和它所在的面抢深度 */
'  vec4 va=viewMatrix*vec4(a,1.0),vb=viewMatrix*vec4(b,1.0);va.xyz*=1.0-min(0.0015,0.02/max(length(va.xyz),0.001));vb.xyz*=1.0-min(0.0015,0.02/max(length(vb.xyz),0.001));',   /* 最多挪 0.02 个单位：镜头远的时候不至于把被挡住的线拉到前面来 */
'  vec4 ca=projectionMatrix*va,cb=projectionMatrix*vb;',
'  float nw=0.03,ta=0.0,tb=1.0;',
'  if(ca.w<nw&&cb.w<nw){gl_Position=vec4(2.0,2.0,2.0,1.0);vEdge=0.0;vSeq=0.0;vKind=0.0;vY=0.0;vGlow=0.0;return;}',
   /* 一头在镜头后面：截到近平面上（街面那一段镜头就在楼中间） */
'  if(ca.w<nw){ta=(nw-ca.w)/(cb.w-ca.w);ca=mix(ca,cb,ta);}else if(cb.w<nw){tb=(nw-ca.w)/(cb.w-ca.w);cb=mix(ca,cb,tb);}',
'  vec2 dir=(cb.xy/cb.w-ca.xy/ca.w)*uRes;float len=length(dir);dir=len>1e-4?dir/len:vec2(1.0,0.0);',
'  float hw=uHalfPx+1.0;',
'  vec4 c=mix(ca,cb,aSide.x);',
'  c.xy+=vec2(-dir.y,dir.x)*aSide.y*hw*2.0/uRes*c.w;',
'  gl_Position=c;',
'  float t=mix(ta,tb,aSide.x);',
'  vEdge=aSide.y*hw;vSeq=mix(aSeq.x,aSeq.y,t);vY=mix(a.y,b.y,t);vKind=aKind;',
'  vGlow=aBld.x>-0.5?uGlow[int(aBld.x+0.5)]:0.0;',
'}']);
S.lineF=J([
'uniform vec3 uEdgeCol;uniform vec3 uWarm;uniform float uHalfPx;uniform float uLoad;uniform float uKA[5];uniform float uHoverK;',
'varying float vEdge;varying float vSeq;varying float vKind;varying float vY;varying float vGlow;',
'void main(){',
'  bool onCard=vKind>0.5&&vKind<3.5;',
'  if(!onCard&&vY<0.0)discard;',
'  float a=1.0-smoothstep(uHalfPx-0.5,uHalfPx+0.5,abs(vEdge));',
'  float k=vKind<0.5?uKA[0]:(vKind<1.5?uKA[1]:(vKind<2.5?uKA[2]:(vKind<3.5?uKA[3]:uKA[4])));',
'  vec3 col=uEdgeCol;',
'  if(vKind>1.5&&vKind<3.5){',
     /* 加载：电沿着街道走，走到哪亮到哪，最前头那一小段是暖色的 */
'    float lit=smoothstep(vSeq-0.003,vSeq+0.003,uLoad),head=exp(-max(uLoad-vSeq,0.0)*15.0)*lit;',
'    col=mix(col,uWarm,min(1.0,head*1.4));k=lit*(k+head*0.8);',
'  }else{',
'    if(vSeq>0.001)k*=vSeq;',                          /* 不是刻线的那几种线，这个量是它单独的亮度系数（配楼、树冠、名片下沿） */
'    if(vKind<0.5||vKind>3.5)k*=1.0+vGlow*uHoverK;',
'  }',
'  gl_FragColor=vec4(col,a*min(k,1.0));',
'}']);

/* ---------------- 作品窗（立着是橱窗，躺下是名片上的小图） ---------------- */
S.screenV='varying vec2 vUv;varying vec3 vW;void main(){vUv=uv;vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}';
S.screenF=J([
'uniform sampler2D tMap;uniform float uOn;uniform float uLift;uniform float uTime;uniform float uClip;',
'uniform float uRain;uniform vec4 uMote;uniform vec4 uMoteV;uniform vec2 uPulse;uniform float uGamma;uniform float uGain;uniform float uMoteK;',
'varying vec2 vUv;varying vec3 vW;',
HASH,
'void main(){',
'  if(uClip>0.5&&vW.y<0.0)discard;',
'  vec2 uv=vUv;vec3 col=pow(texture2D(tMap,uv).rgb,vec3(uGamma))*uGain;',   /* 这一张单独的曝光 */
   /* 画面里会动的那一层：发光的地方明灭、雨丝、飘着的小光点 */
'  if(uPulse.x>0.0){',
'    float sat=max(col.r,max(col.g,col.b))-min(col.r,min(col.g,col.b));',
'    col*=1.0+uPulse.x*smoothstep(0.18,0.55,sat)*sin(uTime*uPulse.y+h21(floor(uv*vec2(16.0,10.0)))*6.2832+uv.y*9.0);',
'  }',
'  if(uRain>0.0){',
'    vec2 p=vec2(uv.x*46.0+uv.y*5.0,uv.y*3.2+uTime*2.6);float fy=fract(p.y);',
'    col+=vec3(0.75,0.82,0.95)*uRain*0.5*smoothstep(0.90,1.0,h21(floor(p)))*smoothstep(0.0,0.18,fy)*(1.0-smoothstep(0.55,1.0,fy))*(1.0-abs(fract(p.x)-0.5)*2.0);',
'  }',
'  if(uMote.a*uMoteK>0.001){',
'    for(int k=0;k<2;k++){',
'      float fk=float(k);vec2 g=vec2(uMoteV.z,uMoteV.z*0.625)*(1.0+fk*0.6),p=(uv-uMoteV.xy*uTime*(1.0+fk*0.4))*g+fk*7.3,id=floor(p);',
'      vec2 j=vec2(h21(id+3.1),h21(id+8.7))-0.5+0.14*vec2(sin(uTime*1.3+h21(id)*6.28),cos(uTime*1.1+h21(id+1.7)*6.28));',
'      float r=uMoteV.w*g.x,d=length(fract(p)-0.5-j*0.6);',
'      col+=uMote.rgb*uMote.a*uMoteK*smoothstep(r,r*0.25,d)*step(0.70,h21(id+5.5))*(0.55+0.45*sin(uTime*2.0+h21(id+2.2)*6.28));',
'    }',
'  }',
   /* 没亮的时候是一块深色的玻璃，带一道很淡的斜反光 */
'  vec3 glass=vec3(0.012,0.013,0.017)+0.018*smoothstep(0.4,0.0,abs(uv.x*0.8+uv.y*0.5-0.72));',
'  col=mix(glass,col,uOn)*(1.0+uLift*0.13);',
'  vec2 q=(uv-0.5)*vec2(1.6,1.0),bx=abs(q)-(vec2(0.8,0.5)-0.03);',
'  float d=length(max(bx,0.0))+min(max(bx.x,bx.y),0.0)-0.03,aa=fwidth(d)+0.0005;',
'  gl_FragColor=vec4(col,1.0-smoothstep(-aa,aa,d));',
'}']);

/* 霓虹广场楼上的那些小屏：同一张作品画面的局部 */
S.miniV=J(['attribute vec3 aBld;',PLACE,'varying vec2 vUv;varying float vY;varying float vId;',
'void main(){vUv=uv;vec3 p=place(position,aBld);vY=p.y;vId=floor(position.x*7.0+position.y*3.0);gl_Position=projectionMatrix*viewMatrix*vec4(p,1.0);}']);
S.miniF=J(['uniform sampler2D tMap;uniform float uOn;uniform float uTime;varying vec2 vUv;varying float vY;varying float vId;',
'void main(){if(vY<0.0)discard;vec3 c=texture2D(tMap,vUv).rgb;c=c*1.15+0.02;',
'gl_FragColor=vec4(mix(vec3(0.012,0.013,0.017),c*(0.86+0.14*sin(uTime*1.7+vId*2.3)),uOn),1.0);}']);

/* 招牌：暖色的发光字，平时暗着，悬停才亮 */
S.signV=J(['attribute vec3 aBld;',PLACE,'uniform float uSign[9];uniform float uGlow[9];varying vec2 vUv;varying float vY;varying float vK;varying float vG;',
'void main(){vUv=uv;vec3 p=place(position,aBld);vY=p.y;vK=uSign[int(aBld.x+0.5)];vG=uGlow[int(aBld.x+0.5)];gl_Position=projectionMatrix*viewMatrix*vec4(p,1.0);}']);
S.signF='uniform sampler2D tMap;uniform vec3 uWarm;uniform vec3 uEdgeCol;uniform float uSignK;varying vec2 vUv;varying float vY;varying float vK;varying float vG;void main(){if(vY<0.0)discard;gl_FragColor=vec4(mix(uEdgeCol,uWarm*1.12,vG),texture2D(tMap,vUv).a*vK*mix(uSignK,1.0,vG));}';

/* 名片上的名字 */
S.textV='varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}';
S.textF='uniform sampler2D tMap;uniform vec3 uCol;uniform float uA;varying vec2 vUv;void main(){gl_FragColor=vec4(uCol,texture2D(tMap,vUv).a*uA);}';

/* 名片下面的台面：紧挨着名片是一圈压暗的接触阴影，往外是一点点泛起来的光，再往外就是黑 */
S.floorV='varying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}';
S.floorF=J(['uniform vec3 uBg;uniform vec2 uCardHalf;uniform float uCardR;uniform float uA;varying vec3 vW;',
'void main(){vec2 dq=abs(vW.xz)-(uCardHalf-uCardR);float sd=length(max(dq,0.0))+min(max(dq.x,dq.y),0.0)-uCardR;',
'float g=exp(-max(sd,0.0)*0.30)*smoothstep(-0.05,0.9,sd);gl_FragColor=vec4(uBg+vec3(0.032,0.035,0.044)*g*uA,1.0);}']);

/* ---------------- 后期：光晕和移轴，再加一层看不见的抖动防止暗部出现色阶 ---------------- */
S.quadV='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}';
S.brightF=J(['uniform sampler2D tMap;uniform vec2 uTexel;uniform float uThresh;varying vec2 vUv;',
'vec3 pick(vec2 o){vec3 c=texture2D(tMap,vUv+o*uTexel).rgb;float m=max(c.r,max(c.g,c.b));return c*smoothstep(uThresh,uThresh+0.35,m);}',
'void main(){gl_FragColor=vec4((pick(vec2(-1.0,-1.0))+pick(vec2(1.0,-1.0))+pick(vec2(-1.0,1.0))+pick(vec2(1.0,1.0)))*0.25,1.0);}']);
S.blurF=J(['uniform sampler2D tMap;uniform vec2 uDir;varying vec2 vUv;',
'void main(){vec3 c=texture2D(tMap,vUv).rgb*0.2270270;',
'c+=(texture2D(tMap,vUv+uDir*1.3846154).rgb+texture2D(tMap,vUv-uDir*1.3846154).rgb)*0.3162162;',
'c+=(texture2D(tMap,vUv+uDir*3.2307692).rgb+texture2D(tMap,vUv-uDir*3.2307692).rgb)*0.0702703;',
'gl_FragColor=vec4(c,1.0);}']);
S.tiltF=J(['uniform sampler2D tMap;uniform vec2 uRes;uniform float uAmt;uniform float uFocus;uniform float uBand;uniform float uRot;varying vec2 vUv;',
'void main(){',
'  float rad=uAmt*smoothstep(uBand,uBand+0.42,abs(vUv.y-uFocus))*mix(1.0,0.6,uRot);',
'  if(rad<0.3){gl_FragColor=texture2D(tMap,vUv);return;}',
'  vec3 acc=vec3(0.0);float a0=uRot*1.3;',
'  for(int i=0;i<14;i++){float fi=float(i),th=fi*2.3999632+a0;acc+=texture2D(tMap,vUv+vec2(cos(th),sin(th))*sqrt((fi+0.5)/14.0)*rad/uRes).rgb;}',
'  gl_FragColor=vec4(acc/14.0,1.0);',
'}']);
/* 最后一步：加上光晕。uMos 打开时整幅画面变成马赛克（uGrid 是横竖各多少格）：
   每格取一个颜色，格子里均匀取 16 个点求平均，镜头在动的时候才不闪 */
S.finalF=J(['uniform sampler2D tMap;uniform sampler2D tB1;uniform sampler2D tB2;uniform float uBloom;uniform vec2 uGrid;uniform float uMos;varying vec2 vUv;',
'float ign(vec2 p){return fract(52.9829189*fract(dot(p,vec2(0.06711056,0.00583715))));}',
'void main(){',
'  vec2 uv=vUv;vec3 c;',
'  if(uMos>0.5){',
'    vec2 g=floor(vUv*uGrid);uv=(g+0.5)/uGrid;c=vec3(0.0);',
'    for(int j=0;j<4;j++)for(int i=0;i<4;i++)c+=texture2D(tMap,(g+(vec2(float(i),float(j))+0.5)*0.25)/uGrid).rgb;',
'    c*=0.0625;',
'  }else c=texture2D(tMap,uv).rgb;',
'  c+=(texture2D(tB1,uv).rgb*0.6+texture2D(tB2,uv).rgb*0.7)*uBloom;',
'  gl_FragColor=vec4(c+(ign(gl_FragCoord.xy)-0.5)/255.0,1.0);',
'}']);
})();
