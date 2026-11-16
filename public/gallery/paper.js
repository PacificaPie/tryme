/* 纸的材质和光影。
   三种材质共用一套光照：两面不同的纸板（board）、作品画面（art）、只接影子的桌面（ground）。
   影子用 three 自带的深度图，但过滤是自己写的：先找遮挡物有多远，再按距离决定影子有多虚（离墙根近就实，远就虚）。
   沉睡和醒来也在这里：任何表面在没被光扫到之前都按 1-bit 抖点画。 */
(function(){
'use strict';
var SP=window.SP=window.SP||{};

var VS=[
'uniform mat4 uShM;',
'varying vec3 vWp;varying vec3 vN;varying vec3 vOp;varying vec3 vOn;varying vec4 vSh;varying vec2 vUv;varying vec3 vVl;',
'void main(){',
'  vOp=position;vOn=normal;vUv=uv;',
'  vec4 wp=modelMatrix*vec4(position,1.0);',
'  vWp=wp.xyz;vN=normalize(mat3(modelMatrix)*normal);',
'  vVl=(cameraPosition-wp.xyz)*mat3(modelMatrix);',
'  vSh=uShM*wp;',
'  gl_Position=projectionMatrix*viewMatrix*wp;',
'}'].join('\n');

var COMMON=[
'uniform vec3 uL;uniform sampler2D tSh;uniform float uShExt;uniform float uShDepth;uniform float uShOn;uniform vec3 uPen;',
'uniform float uEdge;uniform vec2 uRes;uniform float uPx;uniform float uTime;uniform vec3 uDark;uniform vec3 uLight;',
'uniform float uWake;uniform float uFog;',
'varying vec3 vWp;varying vec3 vN;varying vec3 vOp;varying vec3 vOn;varying vec4 vSh;varying vec2 vUv;varying vec3 vVl;',
'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y);}',
'float bayer2(vec2 a){a=floor(a);return fract(a.x/2.0+a.y*a.y*0.75);}',
'float bayer4(vec2 a){return bayer2(0.5*a)*0.25+bayer2(a);}',
'float bayer8(vec2 a){return bayer4(0.5*a)*0.25+bayer2(a);}',
'float unpackD(vec4 v){return dot(v,vec4(5.9371814e-8,1.5199184e-5,3.8909912e-3,0.99609375));}',
'float ign(vec2 p){return fract(52.9829189*fract(dot(p,vec2(0.06711056,0.00583715))));}',
/* 柔和阴影：16 次采样找遮挡物的平均深度，再用 20 次采样按半影宽度过滤 */
'float shadowSoft(){',
'  vec3 sc=vSh.xyz/vSh.w;',
'  if(sc.x<0.003||sc.x>0.997||sc.y<0.003||sc.y>0.997||sc.z>0.999)return 1.0;',
'  vec3 dx=dFdx(sc),dy=dFdy(sc);',
'  float det=dx.x*dy.y-dx.y*dy.x;vec2 dz=vec2(0.0);',
'  if(abs(det)>1e-14)dz=vec2(dy.y*dx.z-dx.y*dy.z,dx.x*dy.z-dy.x*dx.z)/det;',
'  dz=clamp(dz,vec2(-3.0),vec2(3.0));',
'  float bias=0.0022/uShDepth+(abs(dz.x)+abs(dz.y))*(1.6/2048.0);',
'  float ang=ign(gl_FragCoord.xy)*6.2831853;',
'  float rs=uPen.x/uShExt,zb=0.0,nb=0.0;',
'  float n1=uShExt>20.0?10.0:16.0,n2=uShExt>20.0?12.0:20.0;',
'  for(int i=0;i<16;i++){',
'    float fi=float(i);if(fi>=n1)break;',
'    float r=sqrt((fi+0.5)/n1);float a=fi*2.39996323+ang;',
'    vec2 o=vec2(cos(a),sin(a))*r*rs;',
'    float d=unpackD(texture2D(tSh,sc.xy+o));',
'    if(d<sc.z+dot(o,dz)-bias){zb+=d;nb+=1.0;}',
'  }',
'  if(nb<0.5)return 1.0;',
'  zb/=nb;',
'  float pen=clamp((sc.z-zb)*uShDepth*0.115,uPen.y,uPen.z)/uShExt,s=0.0;',
'  for(int j=0;j<20;j++){',
'    float fj=float(j);if(fj>=n2)break;',
'    float r2=sqrt((fj+0.5)/n2);float a2=fj*2.39996323+ang+1.7;',
'    vec2 o2=vec2(cos(a2),sin(a2))*r2*pen;',
'    float d2=unpackD(texture2D(tSh,sc.xy+o2));',
'    s+=step(sc.z+dot(o2,dz)-bias,d2);',
'  }',
'  return s/n2;',
'}',
'float lightK(vec3 N,out float shd){',
'  float ndl=dot(N,uL);shd=1.0;',
'  if(ndl>0.0&&uShOn>0.5)shd=shadowSoft();',
'  return max(ndl,0.0)*shd;',
'}',
/* 一点点珠光：两块很宽的柔光，一块在正前偏右，一块在后上方。只有白，没有彩色 */
'float sheenF(vec3 N){',
'  vec3 V=normalize(cameraPosition-vWp);vec3 Rv=reflect(-V,N);',
'  float a=pow(max(dot(Rv,vec3(0.6116,0.2039,0.7645)),0.0),10.0),b=pow(max(dot(Rv,vec3(0.3011,0.6222,-0.7226)),0.0),11.0);',
'  return a+b;',
'}',
/* 光扫过来的那条边，和背景擦除用的是同一条 */
'float wakeM(){',
'  vec2 s=gl_FragCoord.xy/uRes;float x=s.x*2.0-1.0;',
'  float wob=(noise(vec2(s.y*3.0,uTime*0.35))-0.5)*0.22+(noise(vec2(s.y*9.0+4.0,uTime*0.6))-0.5)*0.06;',
'  return smoothstep(-0.10,0.10,uEdge-x+wob);',
'}',
/* cont 是连续色调（沉睡时拿它的亮度去抖点），col 是醒来后的颜色 */
'vec3 finish(vec3 cont,vec3 col,float wk,float fk){',
'  float m=wakeM();float w=smoothstep(0.0,1.0,m*wk);',
'  float lum=dot(cont,vec3(0.299,0.587,0.114));',
'  float bit=step(bayer8(gl_FragCoord.xy/(uPx*1.5)),lum*0.96+0.015);',
'  vec3 dorm=mix(vec3(0.062,0.064,0.076),vec3(0.80,0.79,0.765),bit);',
'  vec3 o=mix(dorm,col,w);',
'  o+=vec3(1.0,0.93,0.80)*sin(w*3.14159)*fk;',
'  return mix(o,mix(uDark,uLight,m),uFog);',
'}'].join('\n');

var BOARD=[
'uniform sampler2D tA;uniform sampler2D tB;uniform vec3 uColA;uniform vec3 uColB;uniform vec3 uCore;uniform vec2 uUse;',
'uniform vec4 uMA;uniform vec2 uOA;uniform vec4 uMB;uniform vec2 uOB;uniform vec2 uSheen;uniform vec2 uStip;uniform vec2 uStipK;uniform vec4 uStipR;',
'uniform vec4 uAo;uniform float uAoSide;uniform vec2 uOrg;uniform vec2 uDim;',
/* 印在纸上的抖点：卡面只印两种颜色，所有灰度都用点的疏密表示。点小到看不清时退回连续色调 */
'float cellBit(vec2 c,float tone){return step(bayer8(c)+0.02,tone);}',
/* 画布上的约定：绿色通道是实印（字和线，边缘照常抗锯齿），红减绿是灰度（交给抖点） */
'vec3 stipple(vec3 c,vec2 uv,float n,float k,out vec3 cont){',
'  float cov=clamp((c.g-0.0863)/0.828,0.0,1.0),tone=clamp((c.r-c.g)/0.79,0.0,1.0);',
'  vec2 g=uv*vec2(n,n*k);vec2 fw=max(fwidth(g),vec2(1e-4));',
'  vec2 gi=floor(g-0.5),gf=g-0.5-gi;vec2 wg=clamp((gf-0.5)/fw+0.5,0.0,1.0);',
'  float v=mix(mix(cellBit(gi,tone),cellBit(gi+vec2(1.0,0.0),tone),wg.x),mix(cellBit(gi+vec2(0.0,1.0),tone),cellBit(gi+vec2(1.0,1.0),tone),wg.x),wg.y);',
'  v=mix(v,tone,smoothstep(0.22,0.6,max(fw.x,fw.y)));',
'  cont=mix(vec3(0.082,0.086,0.102),vec3(0.925,0.914,0.886),max(cov,tone));',
'  return mix(vec3(0.082,0.086,0.102),vec3(0.925,0.914,0.886),max(cov,v));',
'}',
/* 抛光地面：把后墙上三件作品的倒影算出来，离墙越远越糊，越贴着地面看越明显 */
'#ifdef REFL',
'uniform sampler2D tR0;uniform sampler2D tR1;uniform sampler2D tR2;uniform vec4 uR0;uniform vec4 uR1;uniform vec4 uR2;uniform vec3 uRw;uniform vec2 uRp;',
'float rmask(vec2 u,float s){return smoothstep(-s,s,u.x)*smoothstep(-s,s,1.0-u.x)*smoothstep(-s,s,u.y)*smoothstep(-s,s,1.0-u.y);}',
'vec3 reflect3(vec3 base){',
'  vec3 V=normalize(vVl);vec3 Rd=vec3(-V.x,-V.y,V.z);',
'  if(Rd.y<0.002)return base;',
'  float t=(uRp.x-vOp.y)/Rd.y,hx=vOp.x+Rd.x*t,hz=Rd.z*t;',
'  float k=min(uRp.y*pow(1.0-clamp(V.z,0.0,1.0),4.0),0.6)*exp(-hz*1.2);',
'  float bl=clamp(0.6+hz*3.2,0.0,3.6),sf=0.008+hz*0.05;',
'  vec2 u0=vec2((hx-uR0.x)/uR0.z+0.5,(hz-uR0.y)/uR0.w+0.5),u1=vec2((hx-uR1.x)/uR1.z+0.5,(hz-uR1.y)/uR1.w+0.5),u2=vec2((hx-uR2.x)/uR2.z+0.5,(hz-uR2.y)/uR2.w+0.5);',
'  float m0=rmask(u0,sf/uR0.z)*uRw.x,m1=rmask(u1,sf/uR1.z)*uRw.y,m2=rmask(u2,sf/uR2.z)*uRw.z;',
'  vec3 c=texture2D(tR0,clamp(u0,0.0,1.0),bl).rgb*m0+texture2D(tR1,clamp(u1,0.0,1.0),bl).rgb*m1+texture2D(tR2,clamp(u2,0.0,1.0),bl).rgb*m2;',
'  float a=min(m0+m1+m2,1.0);',
'  return mix(base,mix(base,c/max(m0+m1+m2,1e-3),a),k*a);',
'}',
'#endif',
'void main(){',
'  vec3 N=normalize(vN);',
'  float fa=step(0.5,vOn.z),fb=step(0.5,-vOn.z),fe=1.0-fa-fb;',
'  vec2 ua=vec2(dot(uMA.xy,vOp.xy),dot(uMA.zw,vOp.xy))+uOA;',
'  vec2 ub=vec2(dot(uMB.xy,vOp.xy),dot(uMB.zw,vOp.xy))+uOB;',
'  vec3 ca=mix(uColA,texture2D(tA,ua).rgb,uUse.x),cb=mix(uColB,texture2D(tB,ub).rgb,uUse.y);',
'  vec3 pa=ca,pb=cb,ka=ca,kb=cb,ct;',
'  if(uStip.x>0.5){float inR=step(uStipR.x,ua.x)*step(ua.x,uStipR.z)*step(uStipR.y,ua.y)*step(ua.y,uStipR.w);pa=mix(stipple(ca,ua,uStip.x,uStipK.x,ct),ca,inR);ka=mix(ct,ca,inR);}',
'  if(uStip.y>0.5){pb=stipple(cb,ub,uStip.y,uStipK.y,ct);kb=ct;}',
'  vec3 cont=ka*fa+kb*fb+uCore*fe,prn=pa*fa+pb*fb+uCore*fe;',
'  float fib=1.0+(noise(vOp.xy*64.0)*0.6+noise(vOp.xy*210.0)*0.4-0.5)*0.04;',
'  vec2 q=vOp.xy-uOrg;',
'  float ao=uAo.x*exp(-q.x/0.16)+uAo.y*exp(-(uDim.x-q.x)/0.16)+uAo.z*exp(-q.y/0.16)+uAo.w*exp(-(uDim.y-q.y)/0.16);',
'  ao*=uAoSide>0.0?fa:fb;',
'  float shd;float key=lightK(N,shd);',
'  float shade=(mix(0.66,0.74,N.y*0.5+0.5)+0.36*key)*(1.0-ao)*fib;',
'  vec3 spec=vec3(1.0,0.985,0.955)*(uSheen.x*fa+uSheen.y*fb)*sheenF(N)*mix(0.45,1.0,shd);',
'  vec3 lc=cont*shade+spec+fe*0.3,lp=prn*shade+spec;',
'#ifdef REFL',
'  lc=reflect3(lc);lp=reflect3(lp);',
'#endif',
'  gl_FragColor=vec4(finish(lc,lp,uWake,0.30),1.0);',
'}'].join('\n');

var ART=[
'uniform sampler2D tMap;uniform vec4 uRect;uniform float uRad;uniform vec3 uUnder;',
'void main(){',
'  vec3 N=normalize(vN);',
'  vec2 uv=uRect.xy+vUv*uRect.zw;',
'  vec3 tex=texture2D(tMap,uv).rgb;',
'  float shd;float key=lightK(N,shd);',
'  float shade=mix(0.66,0.74,N.y*0.5+0.5)+0.36*key;',
'  vec3 col=tex*mix(1.0,shade,0.6)*1.05+vec3(1.0,0.985,0.955)*sheenF(N)*0.035;',
'  if(uRad>0.0){',
'    vec2 q=(uv-0.5)*vec2(1.0,0.625);',
'    float d=length(max(abs(q)-(vec2(0.5,0.3125)-uRad),0.0))-uRad;',
'    float aa=fwidth(d)*1.2+0.0004;',
'    col=mix(uUnder*shade,col,1.0-smoothstep(-aa,aa,d));',
'  }',
'  gl_FragColor=vec4(finish(col,col,uWake,0.5),1.0);',
'}'].join('\n');

var GROUND=[
'uniform float uAlpha;',
'void main(){',
'  float shd=uShOn>0.5?shadowSoft():1.0;',
'  gl_FragColor=vec4(0.13,0.115,0.10,(1.0-shd)*uAlpha*wakeM());',
'}'].join('\n');

SP.createPaper=function(core){
  var T=core.T,sh=core.shared,R=core.renderer;
  R.shadowMap.enabled=true;R.shadowMap.type=T.BasicShadowMap;
  var light=new T.DirectionalLight(0xffffff,1);light.castShadow=true;
  light.shadow.mapSize.set(2048,2048);light.shadow.camera.near=1;light.shadow.camera.far=71;
  core.scene.add(light);core.scene.add(light.target);
  /* 光从右前上方来：右墙背光，影子落在屋里的地面上，从镜头这边正好看得见 */
  var L=new T.Vector3(0.38,0.74,0.56).normalize();
  var white=new T.DataTexture(new Uint8Array([255,255,255,255]),1,1,T.RGBAFormat);white.needsUpdate=true;
  var G={uL:{value:L},tSh:{value:white},uShM:{value:light.shadow.matrix},uShExt:{value:7},uShDepth:{value:70},uShOn:{value:0},uPen:{value:new T.Vector3(0.3,0.006,0.5)},
    uEdge:sh.uEdge,uRes:sh.uRes,uPx:sh.uPx,uTime:sh.uTime,uDark:sh.uDark,uLight:sh.uLight};
  function uni(own){var u={},k;for(k in G)u[k]=G[k];for(k in own)u[k]=own[k];return u;}
  function v3(c){var k=new T.Color(c);return new T.Vector3(k.r,k.g,k.b);}

  /* 每一帧：把光对准要拍的地方，影子图只包住这一块，这样近景的影子才够细 */
  function aim(target,half){
    light.target.position.copy(target);light.position.copy(target).addScaledVector(L,36);
    var c=light.shadow.camera;c.left=-half;c.right=half;c.top=half;c.bottom=-half;c.updateProjectionMatrix();
    G.uShExt.value=half*2;G.uPen.value.set(0.22+half*0.03,Math.max(0.005,half*2/2048*1.5),0.2+half*0.06);
    if(light.shadow.map){G.tSh.value=light.shadow.map.texture;G.uShOn.value=1;}
  }

  var INK=0x15161A,PAPER=0xF6F4ED,CORE=0xEDEAE2;
  function board(o){
    o=o||{};
    var m=new T.ShaderMaterial({vertexShader:VS,fragmentShader:COMMON+'\n'+BOARD,extensions:{derivatives:true},uniforms:uni({
      tA:{value:o.tA||white},tB:{value:o.tB||white},uColA:{value:v3(o.colA===undefined?PAPER:o.colA)},uColB:{value:v3(o.colB===undefined?PAPER:o.colB)},uCore:{value:v3(o.core===undefined?CORE:o.core)},
      uUse:{value:new T.Vector2(o.tA?1:0,o.tB?1:0)},
      uMA:{value:new T.Vector4(1,0,0,1)},uOA:{value:new T.Vector2(0,0)},uMB:{value:new T.Vector4(1,0,0,1)},uOB:{value:new T.Vector2(0,0)},
      uSheen:{value:new T.Vector2(o.sheenA||0,o.sheenB||0)},uStip:{value:new T.Vector2(o.stipA||0,o.stipB||0)},uStipK:{value:new T.Vector2(1.5333,1.5333)},uStipR:{value:new T.Vector4(2,2,3,3)},
      tR0:{value:white},tR1:{value:white},tR2:{value:white},uR0:{value:new T.Vector4(0,0,1,1)},uR1:{value:new T.Vector4(0,0,1,1)},uR2:{value:new T.Vector4(0,0,1,1)},uRw:{value:new T.Vector3(0,0,0)},uRp:{value:new T.Vector2(1,0)},
      uAo:{value:new T.Vector4(0,0,0,0)},uAoSide:{value:o.aoSide||1},uOrg:{value:new T.Vector2(0,0)},uDim:{value:new T.Vector2(1,1)},
      uWake:{value:1},uFog:{value:0}})});
    if(o.refl)m.defines={REFL:1};
    m.shadowSide=T.FrontSide;return m;
  }
  function art(tex,o){
    o=o||{};
    var m=new T.ShaderMaterial({vertexShader:VS,fragmentShader:COMMON+'\n'+ART,extensions:{derivatives:true},uniforms:uni({
      tMap:{value:tex},uRect:{value:new T.Vector4(0,0,1,1)},uRad:{value:o.rad||0},uUnder:{value:v3(INK)},uWake:{value:1},uFog:{value:0}})});
    m.shadowSide=T.FrontSide;return m;
  }
  function ground(){
    return new T.ShaderMaterial({vertexShader:VS,fragmentShader:COMMON+'\n'+GROUND,extensions:{derivatives:true},transparent:true,depthWrite:false,
      uniforms:uni({uAlpha:{value:0.36},uWake:{value:1},uFog:{value:0}})});
  }
  function tex(cv,mip){
    var t=new T.CanvasTexture(cv);t.minFilter=mip===false?T.LinearFilter:T.LinearMipmapLinearFilter;t.magFilter=T.LinearFilter;t.generateMipmaps=mip!==false;
    t.anisotropy=Math.min(8,R.capabilities.getMaxAnisotropy());return t;
  }
  return {board:board,art:art,ground:ground,tex:tex,aim:aim,light:light,L:L,INK:INK,PAPER:PAPER,CORE:CORE,white:white,dispose:function(){white.dispose();if(light.shadow.map)light.shadow.map.dispose();core.scene.remove(light);core.scene.remove(light.target);}};
};
})();
