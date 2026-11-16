/* 着色器：卡片（抖点沉睡态到彩色）、背景擦除、拖影、色散和颗粒 */
(function(){
'use strict';
var SP=window.SP=window.SP||{};
var S=SP.shaders={};

S.cardV=[
'attribute float aCell;attribute float aWake;attribute float aDim;attribute float aBlur;attribute float aFog;',
'varying vec2 vUv;varying float vCell;varying float vWake;varying float vDim;varying float vBlur;varying float vFog;varying vec3 vN;varying vec3 vV;',
'void main(){',
'  vUv=uv;vCell=aCell;vWake=aWake;vDim=aDim;vBlur=aBlur;vFog=aFog;',
'  vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.0);',
'  vN=normalize(mat3(modelViewMatrix)*mat3(instanceMatrix)*vec3(0.0,0.0,1.0));',
'  vV=normalize(-mv.xyz);',
'  gl_Position=projectionMatrix*mv;',
'}'].join('\n');

S.cardF=[
'uniform sampler2D uAtlas;uniform float uCols;uniform vec2 uPitch;uniform vec2 uSize;uniform vec2 uGut;',
'uniform vec3 uDark;uniform vec3 uLight;uniform float uEdge;uniform vec2 uRes;uniform float uPx;',
'varying vec2 vUv;varying float vCell;varying float vWake;varying float vDim;varying float vBlur;varying float vFog;varying vec3 vN;varying vec3 vV;',
'float bayer2(vec2 a){a=floor(a);return fract(a.x/2.0+a.y*a.y*0.75);}',
'float bayer4(vec2 a){return bayer2(0.5*a)*0.25+bayer2(a);}',
'float bayer8(vec2 a){return bayer4(0.5*a)*0.25+bayer2(a);}',
'void main(){',
'  vec2 q=(vUv-0.5)*vec2(1.0,0.625);',
'  float rad=0.042;',
'  float d=length(max(abs(q)-(vec2(0.5,0.3125)-rad),0.0))-rad;',
'  float aa=fwidth(d)*1.2+0.0005;',
'  float alpha=1.0-smoothstep(-aa,aa,d);',
'  if(alpha<0.004)discard;',
'  float c=floor(vCell+0.5);',
'  vec2 cell=vec2(mod(c,uCols),floor(c/uCols));',
'  vec2 uv=vec2(cell.x*uPitch.x+uGut.x+vUv.x*uSize.x,1.0-(cell.y*uPitch.y+uGut.y+(1.0-vUv.y)*uSize.y));',
'  vec3 col=texture2D(uAtlas,uv,vBlur).rgb;',
'  float w=smoothstep(0.0,1.0,vWake);',
'  float lum=dot(col,vec3(0.299,0.587,0.114));',
'  float bit=step(bayer8(gl_FragCoord.xy/(uPx*1.5)),lum*0.96+0.02);',
'  vec3 dorm=mix(vec3(0.070,0.073,0.086),vec3(0.70,0.71,0.75),bit);',
'  vec3 outc=mix(dorm,col,w);',
'  vec3 N=normalize(vN);',
'  if(!gl_FrontFacing){',
'    N=-N;',
'    vec3 back=mix(vec3(0.115,0.118,0.135),vec3(0.80,0.785,0.75),w);',
'    float ring=1.0-smoothstep(0.0,aa*2.0,abs(length(q)-0.09)-0.012);',
'    outc=mix(back,back*0.8,ring);',
'  }',
'  float edge=1.0-smoothstep(0.0,aa*1.5,abs(d+0.006)-0.002);',
'  outc=mix(outc,outc*0.78,edge*0.6);',
'  outc+=vec3(1.0,0.93,0.80)*sin(w*3.14159)*0.5;',
'  vec3 V=normalize(vV);vec3 Hh=normalize(normalize(vec3(-0.45,0.65,0.62))+V);',
'  outc+=pow(max(dot(N,Hh),0.0),48.0)*mix(0.10,0.22,w);',
'  float m=smoothstep(-0.10,0.10,uEdge-(gl_FragCoord.x/uRes.x*2.0-1.0));',
'  outc=mix(outc,mix(uDark,uLight,m),vFog);',
'  gl_FragColor=vec4(outc,alpha*vDim);',
'}'].join('\n');

S.bgV='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,1.0,1.0);}';

S.bgF=[
'uniform vec3 uDark;uniform vec3 uLight;uniform float uEdge;uniform float uTime;',
'varying vec2 vUv;',
'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y);}',
'void main(){',
'  float x=vUv.x*2.0-1.0;',
'  float wob=(noise(vec2(vUv.y*3.0,uTime*0.35))-0.5)*0.22+(noise(vec2(vUv.y*9.0+4.0,uTime*0.6))-0.5)*0.06;',
'  float m=smoothstep(-0.10,0.10,uEdge-x+wob);',
'  vec3 col=mix(uDark,uLight,m);',
'  float g=exp(-pow((x-uEdge-wob)/0.16,2.0))*(1.0-m);',
'  col+=vec3(1.0,0.92,0.78)*g*0.5;',
'  vec2 c=vUv-0.5;',
'  col*=1.0-dot(c,c)*mix(0.9,0.16,m);',
'  gl_FragColor=vec4(col,1.0);',
'}'].join('\n');

S.quadV='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}';

S.trailF=[
'uniform sampler2D tScene;uniform sampler2D tPrev;uniform float uTrail;',
'varying vec2 vUv;',
'void main(){gl_FragColor=mix(texture2D(tScene,vUv),texture2D(tPrev,vUv),uTrail);}'].join('\n');

S.finalF=[
'uniform sampler2D tMap;uniform float uAb;uniform float uTime;uniform vec2 uRes;uniform float uGrain;uniform float uVig;',
'varying vec2 vUv;',
'float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}',
'void main(){',
'  vec2 c=vUv-0.5;float r2=dot(c,c);',
'  vec2 off=c*uAb*(0.5+r2*2.4);',
'  vec3 col;',
'  col.r=texture2D(tMap,vUv+off).r;',
'  col.g=texture2D(tMap,vUv).g;',
'  col.b=texture2D(tMap,vUv-off).b;',
'  float n=hash(floor(vUv*uRes)+fract(uTime)*91.7);',
'  col*=1.0-r2*uVig;',
'  col+=(n-0.5)*uGrain;',
'  gl_FragColor=vec4(col,1.0);',
'}'].join('\n');
})();
