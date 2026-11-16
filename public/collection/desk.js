/* Adapted from the supplied 点亮收藏 demo: original solid cards, lighting and shadow passes; real selected works only. */
/* 桌面这一场的全部物件：桌面、卡片、文件名、影子、文件夹，以及那束光怎么照它们。
   沉睡的东西一律是 1-bit 抖点，光的衰减、高光、影子都先算成亮度再去抖；醒了的东西才有连续的颜色。 */
(function(){
'use strict';
var SP=window.SP=window.SP||{};
SP.createDesk=function(core){
  var T=core.T,U=SP.u,D=SP.dim,sh=core.shared,renderer=core.renderer,gl2=renderer.capabilities.isWebGL2;
  var MONO='"PingFang SC",Arial,sans-serif',ITAL='"Songti SC",Georgia,serif';
  var aniso=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  var DEAL=0.76,FLIP=0.64,REARR=1.25,MAXP=SP.collectionWorks.length;
  var group=new T.Group();core.scene.add(group);

  /* 所有材质共用的灯和两张辅助贴图 */
  var LU={uLP:{value:new T.Vector3(0,2.4,0)},uLI:{value:0},uLR:{value:6.2},uCam:{value:new T.Vector3()},uRes:sh.uRes,uPx:sh.uPx,uTt:{value:0},
    uField:{value:null},uFR:{value:new T.Vector4(-17,-13,1/34,1/26)},uShadow:{value:null},uAll:{value:0},uDay:{value:0},uDim:{value:0}};
  function uni(o){var k,r={};for(k in LU)r[k]=LU[k];for(k in o)r[k]=o[k];return r;}
  var GL=[
    'uniform vec3 uLP;uniform float uLI;uniform float uLR;uniform vec3 uCam;uniform vec2 uRes;uniform float uPx;',
    'uniform sampler2D uField;uniform vec4 uFR;uniform sampler2D uShadow;uniform float uAll;uniform float uDay;uniform float uDim;',
    'const vec3 INK=vec3(0.043,0.043,0.051);const vec3 SLAB=vec3(0.070,0.073,0.086);const vec3 DOT=vec3(0.70,0.71,0.75);',
    'const vec3 BONE=vec3(0.925,0.914,0.886);const vec3 WARM=vec3(1.0,0.93,0.80);const vec3 EDGE=vec3(0.082,0.086,0.102);',
    'float bayer2(vec2 a){a=floor(a);return fract(a.x/2.0+a.y*a.y*0.75);}',
    'float bayer4(vec2 a){return bayer2(0.5*a)*0.25+bayer2(a);}',
    'float bayer8(vec2 a){return bayer4(0.5*a)*0.25+bayer2(a);}',
    'float dth(){return bayer8(gl_FragCoord.xy/(uPx*1.5))+0.008;}',
    /* 灯在 P 点、法线 N 上的照度：正下方的桌面记作 1，按距离平方和入射角衰减，再用一个软边的光锥收住 */
    'float lampAt(vec3 P,vec3 N,out vec3 L,out float win){',
    '  vec3 d=uLP-P;float d2=dot(d,d);L=d*inversesqrt(d2);',
    '  win=1.0-smoothstep(uLR*0.25,uLR,length(d.xz));',
    '  return uLI*max(dot(N,L),0.0)*(uLP.y*uLP.y/d2)*win;',
    '}',
    /* 醒着的世界里用的宽版衰减：整张桌子都还能分出受光和背光 */
    'float lampWide(vec3 P){vec3 d=uLP-P;return uLI*uLP.y*uLP.y/(uLP.y*uLP.y+dot(d.xz,d.xz)*0.22);}',
    'vec4 fieldAt(vec3 P){return texture2D(uField,(P.xz-uFR.xy)*uFR.zw);}',
    'uniform float uTt;',
    'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y);}',
    /* 骨白从醒了的地方往外晕：边缘带一点起伏，起伏跟着时间线慢慢漂（不跟墙上的钟，所以同一时刻的画面永远一样）。
       返回 0 到 1，再交给抖点决定每个像素归哪一边 */
    'float wakeAt(vec3 P,float fr){',
    '  float n=noise(P.xz*0.8+vec2(uTt*0.05,-uTt*0.035))+0.5*noise(P.xz*2.3-vec2(uTt*0.04));',
    '  return smoothstep(0.36,0.70,max(fr+(n-0.75)*0.2*smoothstep(0.02,0.3,fr),uAll));',
    '}'
  ].join('\n');

  /* ---------- 贴图 ---------- */
  function ctex(cv,mip){var t=new T.CanvasTexture(cv);t.minFilter=mip?T.LinearMipmapLinearFilter:T.LinearFilter;t.magFilter=T.LinearFilter;t.generateMipmaps=!!mip;t.anisotropy=aniso;return t;}
  var atlas=SP.buildAtlas(),atex=ctex(atlas.canvas,true),AW=atlas.canvas.width,AH=atlas.canvas.height;

  /* 四种沉睡的文件图标：只画亮度，交给着色器去抖。纸面接近全白，折角是半调，记号是全黑 */
  function gray(v){var c=Math.round(v*255);return 'rgb('+c+','+c+','+c+')';}
  var icv=document.createElement('canvas');icv.width=1024;icv.height=160;
  (function(){
    var g=icv.getContext('2d'),k,q,gr;
    g.fillStyle=gray(0.03);g.fillRect(0,0,1024,160);
    for(k=0;k<4;k++){
      g.save();g.translate(k*256,0);
      var kind='hfzj'.charAt(k);
      if(kind==='f'){
        var x=128-66,y=80-40,w=132,h=92;
        g.fillStyle=gray(0.44);g.beginPath();g.moveTo(x,y+10);g.lineTo(x,y-8);g.quadraticCurveTo(x,y-15,x+7,y-15);g.lineTo(x+46,y-15);g.lineTo(x+60,y);g.lineTo(x+w-7,y);g.quadraticCurveTo(x+w,y,x+w,y+7);g.lineTo(x+w,y+24);g.lineTo(x,y+24);g.closePath();g.fill();
        gr=g.createLinearGradient(0,y+14,0,y+h);gr.addColorStop(0,gray(1.0));gr.addColorStop(1,gray(0.74));
        g.fillStyle=gr;g.beginPath();g.moveTo(x+7,y+14);g.lineTo(x+w-7,y+14);g.quadraticCurveTo(x+w,y+14,x+w,y+21);g.lineTo(x+w,y+h-7);g.quadraticCurveTo(x+w,y+h,x+w-7,y+h);g.lineTo(x+7,y+h);g.quadraticCurveTo(x,y+h,x,y+h-7);g.lineTo(x,y+21);g.quadraticCurveTo(x,y+14,x+7,y+14);g.fill();
      }else{
        var pw=92,ph=124,px=128-pw/2,py=80-ph/2,c=30;
        gr=g.createLinearGradient(0,py,0,py+ph);gr.addColorStop(0,gray(1.0));gr.addColorStop(1,gray(0.78));
        g.fillStyle=gr;g.beginPath();g.moveTo(px+6,py);g.lineTo(px+pw-c,py);g.lineTo(px+pw,py+c);g.lineTo(px+pw,py+ph-6);g.quadraticCurveTo(px+pw,py+ph,px+pw-6,py+ph);g.lineTo(px+6,py+ph);g.quadraticCurveTo(px,py+ph,px,py+ph-6);g.lineTo(px,py+6);g.quadraticCurveTo(px,py,px+6,py);g.fill();
        g.fillStyle=gray(0.42);g.beginPath();g.moveTo(px+pw-c,py);g.lineTo(px+pw-c,py+c);g.lineTo(px+pw,py+c);g.closePath();g.fill();
        g.strokeStyle=gray(0);g.fillStyle=gray(0);g.lineWidth=8;g.lineCap='round';g.lineJoin='round';
        var cx=128,cy=py+ph*0.62;
        if(kind==='h'){
          g.beginPath();g.moveTo(cx-15,cy-16);g.lineTo(cx-31,cy);g.lineTo(cx-15,cy+16);g.stroke();
          g.beginPath();g.moveTo(cx+15,cy-16);g.lineTo(cx+31,cy);g.lineTo(cx+15,cy+16);g.stroke();
          g.beginPath();g.moveTo(cx+6,cy-21);g.lineTo(cx-6,cy+21);g.stroke();
        }else if(kind==='z'){
          for(q=0;q<7;q++)g.fillRect(cx-11+(q%2)*11,py+12+q*14,11,10);
          g.fillRect(cx-11,py+ph-22,22,12);
        }else{
          g.beginPath();g.moveTo(cx-11,cy-23);g.quadraticCurveTo(cx-23,cy-23,cx-22,cy-10);g.quadraticCurveTo(cx-21,cy,cx-32,cy);g.quadraticCurveTo(cx-21,cy,cx-22,cy+10);g.quadraticCurveTo(cx-23,cy+23,cx-11,cy+23);g.stroke();
          g.beginPath();g.moveTo(cx+11,cy-23);g.quadraticCurveTo(cx+23,cy-23,cx+22,cy-10);g.quadraticCurveTo(cx+21,cy,cx+32,cy);g.quadraticCurveTo(cx+21,cy,cx+22,cy+10);g.quadraticCurveTo(cx+23,cy+23,cx+11,cy+23);g.stroke();
        }
      }
      g.restore();
    }
  })();
  var itex=ctex(icv,true);

  /* 文件名和作品名：一行一张卡，左半是文件名，右半是作品名 */
  var LW=512,LH=72,lcv=document.createElement('canvas'),ltex=null;
  function drawLabels(cards){
    lcv.width=LW*2;lcv.height=LH*cards.length;
    var g=lcv.getContext('2d');g.fillStyle='#000';g.fillRect(0,0,lcv.width,lcv.height);g.fillStyle='#fff';g.textBaseline='middle';g.textAlign='left';
    cards.forEach(function(c,i){
      var y=i*LH+LH*0.5,fs=40;g.font='500 '+fs+'px '+MONO;
      var w=g.measureText(c.file).width;if(w>LW-10){fs=Math.floor(fs*(LW-10)/w);g.font='500 '+fs+'px '+MONO;}
      g.fillText(c.file,2,y+1);
      var size=44;g.font='500 '+size+'px '+MONO;while(size>18&&g.measureText(c.work.name).width>LW-12){size*=.9;g.font='500 '+size+'px '+MONO;}g.fillText(c.work.name,LW+2,y-1,LW-12);
    });
    if(ltex)ltex.dispose();
    ltex=ctex(lcv,true);labMat.uniforms.uText.value=ltex;labMat.uniforms.uRows.value=cards.length;
  }

  /* ---------- 桌面 ---------- */
  var VS_W='varying vec3 vP;void main(){vec4 w=modelMatrix*vec4(position,1.0);vP=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}';
  var deskMat=new T.ShaderMaterial({uniforms:uni({}),vertexShader:VS_W,fragmentShader:[GL,
    'varying vec3 vP;',
    'void main(){',
    '  vec3 L;float win;float key=lampAt(vP,vec3(0.0,1.0,0.0),L,win);',
    '  vec4 sb=texture2D(uShadow,gl_FragCoord.xy/uRes);',
    '  vec4 fb=fieldAt(vP);',
    '  vec3 V=normalize(uCam-vP);',
    '  float spec=pow(max(normalize(L+V).y,0.0),90.0)*uLI*win;',
    '  float m=wakeAt(vP,fb.r);',
    '  float th=dth();',
    '  float aw=step(th,m);',
    '  float lit=(key*1.25+spec*0.7)*(1.0-sb.r)+fb.g*0.85;',
    '  vec3 dorm=mix(INK,mix(DOT,BONE,m),step(th,lit));',
    '  float kw=lampWide(vP);',
    '  float shade=sb.r*(0.16+0.30*kw)+sb.g*0.11;',
    '  vec3 awake=BONE*(0.92+0.07*kw+0.05*min(key,1.0)+fb.g*0.12-shade)+WARM*spec*0.16;',
    '  gl_FragColor=vec4(mix(dorm,awake*(1.0-0.20*uDim),aw),1.0);',
    '}'].join('\n')});
  var deskMesh=new T.Mesh(new T.PlaneGeometry(240,240),deskMat);deskMesh.rotation.x=-Math.PI/2;deskMesh.renderOrder=0;deskMesh.frustumCulled=false;group.add(deskMesh);

  /* ---------- 卡片：有厚度的圆角板，正面是作品，背面是文件图标 ---------- */
  function rr(x,y,w,h,r){var s=new T.Shape();s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;}
  var cardGeo=new T.ExtrudeGeometry(rr(-D.CW/2,-D.CH/2,D.CW,D.CH,0.064),{depth:D.TH,bevelEnabled:false,curveSegments:5});cardGeo.translate(0,0,-D.TH/2);
  var CARD_V=[
    'attribute vec4 aA;attribute vec4 aB;',
    'varying vec2 vUv;varying vec3 vP;varying vec3 vN;varying float vFz;varying vec4 vA;varying vec4 vB;',
    'void main(){',
    '  vUv=position.xy/vec2(1.6,1.0)+0.5;vFz=normal.z;vA=aA;vB=aB;',
    '  vec4 w=modelMatrix*instanceMatrix*vec4(position,1.0);vP=w.xyz;',
    '  vN=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal);',
    '  gl_Position=projectionMatrix*viewMatrix*w;',
    '}'].join('\n');
  var CARD_F=[GL,
    'uniform sampler2D uAtlas;uniform float uCols;uniform vec2 uPitch;uniform vec2 uSize;uniform vec2 uGut;uniform sampler2D uIcons;',
    'varying vec2 vUv;varying vec3 vP;varying vec3 vN;varying float vFz;varying vec4 vA;varying vec4 vB;',
    'void main(){',
    '  vec3 N=normalize(vN);vec3 L;float win;float key=lampAt(vP,N,L,win);',
    '  vec3 V=normalize(uCam-vP);float ndh=max(dot(N,normalize(L+V)),0.0);',
    '  float spec=(pow(ndh,130.0)*1.0+pow(ndh,22.0)*0.15)*uLI*win*(1.0-0.8*vB.y);',
    '  vec4 fb=fieldAt(vP);',
    '  float shd=texture2D(uShadow,gl_FragCoord.xy/uRes).b*(1.0-vA.w);',
    '  float th=dth();float w=smoothstep(0.0,1.0,vA.z);float day=max(uDay,smoothstep(0.3,0.8,fb.r));',
    '  float c=floor(vA.x+0.5);vec2 cell=vec2(mod(c,uCols),floor(c/uCols));',
    '  vec2 uv=vec2(cell.x*uPitch.x+uGut.x+vUv.x*uSize.x,1.0-(cell.y*uPitch.y+uGut.y+(1.0-vUv.y)*uSize.y));',
    '  vec3 col=texture2D(uAtlas,uv).rgb;',
    '  float il=texture2D(uIcons,vec2((vA.y+vUv.x)*0.25,1.0-vUv.y)).r;',
    '  vec2 q=(vUv-0.5)*vec2(1.6,1.0);float d=length(max(abs(q)-(vec2(0.8,0.5)-0.064),0.0))-0.064;',
    '  vec3 outc;',
    '  if(vFz>0.5){',
    /* 正面：一圈墨色细框，里面是作品。还没醒透时是它自己的抖点版 */
    '    col=mix(col,EDGE,smoothstep(-0.021,-0.013,d));',
    '    float lum=dot(col,vec3(0.299,0.587,0.114));',
    '    float ld=(lum*(0.62+0.8*key+0.6*fb.g)+spec*0.6)*(1.0-shd);',
    '    vec3 dorm=mix(SLAB,DOT,step(th,ld*0.96+0.03));',
    '    float amb=mix(0.86,0.97,day);',
    '    vec3 awake=col*(amb+(1.10-amb)*min(key,1.0))*(1.0-0.5*shd)+WARM*spec*0.7;',
    '    outc=mix(dorm,awake,w)+WARM*sin(w*3.14159)*0.62;',
    '  }else if(vFz<-0.5){',
    /* 背面：文件图标。板子本身几乎是黑的，只有被照到才显形 */
    '    float ld=(il*(0.74+0.7*key+0.7*fb.g)+0.10*key+spec*0.6)*(1.0-shd);',
    '    outc=mix(SLAB,mix(DOT,BONE,day*0.6),step(th,ld));',
    '  }else{',
    '    float ld=0.04+0.9*key+0.5*fb.g+spec;',
    '    vec3 dorm=mix(SLAB*0.8,DOT,step(th,ld));',
    '    vec3 awake=EDGE*(1.0+1.6*max(dot(N,L),0.0)*lampWide(vP))+spec*0.5;',
    '    outc=mix(dorm,awake,max(w,day))+WARM*sin(w*3.14159)*0.4;',
    '  }',
    '  gl_FragColor=vec4((outc+vB.x*0.045)*(1.0-0.4*uDim*(1.0-vB.y)),1.0);',
    '}'].join('\n');
  var ATLAS_U={cols:atlas.cols,pitch:new T.Vector2((atlas.cw+2*atlas.g)/AW,(atlas.ch+2*atlas.g)/AH),size:new T.Vector2(atlas.cw/AW,atlas.ch/AH),gut:new T.Vector2(atlas.g/AW,atlas.g/AH)};
  function mkMat(){
    return new T.ShaderMaterial({vertexShader:CARD_V,fragmentShader:CARD_F,
      uniforms:uni({uAtlas:{value:atex},uCols:{value:ATLAS_U.cols},uPitch:{value:ATLAS_U.pitch.clone()},uSize:{value:ATLAS_U.size.clone()},uGut:{value:ATLAS_U.gut.clone()},uIcons:{value:itex}})});
  }
  function single(mat,tex){mat.uniforms.uAtlas.value=tex;mat.uniforms.uCols.value=1;mat.uniforms.uPitch.value.set(1,1);mat.uniforms.uSize.value.set(1,1);mat.uniforms.uGut.value.set(0,0);}
  function mkMesh(mat,count){
    var geo=cardGeo.clone(),at={};
    ['aA','aB'].forEach(function(k){at[k]=new T.InstancedBufferAttribute(new Float32Array(count*4),4);at[k].setUsage(T.DynamicDrawUsage);geo.setAttribute(k,at[k]);});
    var m=new T.InstancedMesh(geo,mat,count);m.instanceMatrix.setUsage(T.DynamicDrawUsage);m.frustumCulled=false;m.renderOrder=2;m.userData.at=at;group.add(m);
    return m;
  }
  var posterMesh=mkMesh(mkMat(),MAXP),special={},lives=[];
  /* 首页上点开一张海报时，单独给它画一张高清的，免得放大以后发虚 */
  var focusMat=mkMat(),focusMesh=mkMesh(focusMat,1),focusTex=null,focusCell=-1;focusMesh.visible=false;focusMesh.renderOrder=3;
  function focusPoster(cell){
    if(cell===focusCell)return;focusCell=cell;if(focusTex)focusTex.dispose();
    focusTex=ctex(SP.coverCanvas(cell,1024),true);single(focusMat,focusTex);
  }

  /* ---------- 文件名 ---------- */
  var OFFZ=D.CH/2+D.LABEL_GAP+D.LABEL_H/2;
  var labGeo=new T.InstancedBufferGeometry(),pl=new T.PlaneGeometry(D.CW,D.LABEL_H);
  labGeo.setAttribute('position',pl.getAttribute('position'));labGeo.setAttribute('uv',pl.getAttribute('uv'));labGeo.setIndex(pl.getIndex());
  var labP=new T.InstancedBufferAttribute(new Float32Array(40*4),4),labQ=new T.InstancedBufferAttribute(new Float32Array(40*4),4);
  labP.setUsage(T.DynamicDrawUsage);labQ.setUsage(T.DynamicDrawUsage);labGeo.setAttribute('aP',labP);labGeo.setAttribute('aQ',labQ);
  var labMat=new T.ShaderMaterial({transparent:true,depthWrite:false,uniforms:uni({uText:{value:null},uRows:{value:1}}),
    vertexShader:[
      'attribute vec4 aP;attribute vec4 aQ;varying vec2 vUv;varying vec3 vP;varying vec4 vQ;varying float vO;',
      'void main(){',
      '  vUv=uv;vQ=aQ;vO=aP.w;',
      '  vec2 l=vec2(position.x,'+OFFZ.toFixed(4)+'-position.y);float c=cos(aP.z),s=sin(aP.z);',
      '  vP=vec3(aP.x+l.x*c+l.y*s,0.012,aP.y-l.x*s+l.y*c);',
      '  gl_Position=projectionMatrix*viewMatrix*vec4(vP,1.0);',
      '}'].join('\n'),
    fragmentShader:[GL,
      'uniform sampler2D uText;uniform float uRows;varying vec2 vUv;varying vec3 vP;varying vec4 vQ;varying float vO;',
      'void main(){',
      '  float v=1.0-(vQ.x+1.0-vUv.y)/uRows;',
      '  float a0=texture2D(uText,vec2(vUv.x*0.5,v)).r,a1=texture2D(uText,vec2(0.5+vUv.x*0.5,v)).r;',
      /* 醒来时文件名从左到右被作品名换掉 */
      '  float f=vQ.y*1.12-0.06;',
      '  float a=a1*step(vUv.x,f)+a0*step(f+0.05,vUv.x);',
      /* 字的颜色永远和它脚下那个像素相反：桌面这一点是亮的就用墨色，是暗的就用骨白 */
      '  vec3 L;float win;float key=lampAt(vP,vec3(0.0,1.0,0.0),L,win);vec4 fb=fieldAt(vP);',
      '  float shd=texture2D(uShadow,gl_FragCoord.xy/uRes).r;',
      '  float m=wakeAt(vP,fb.r);float th=dth();',
      '  float bright=max(step(th,m),step(th,key*1.25*(1.0-shd)+fb.g*0.85));',
      '  gl_FragColor=vec4(mix(vec3(0.88,0.88,0.90),EDGE,bright),smoothstep(0.04,0.72,a)*vO);',
      '}'].join('\n')});
  var labMesh=new T.Mesh(labGeo,labMat);labMesh.frustumCulled=false;labMesh.renderOrder=1;group.add(labMesh);

  /* ---------- 影子：先单独画成一张屏幕大小的图，桌面和卡片再去查 ----------
     红：所有东西投在桌上的影子。绿：贴地的一圈暗。蓝：只有离了桌的卡片投的影子，给别的卡片的正面用。 */
  var MAXS=84,sGeo=new T.InstancedBufferGeometry();
  sGeo.setAttribute('position',new T.Float32BufferAttribute([-0.5,0,-0.5,0.5,0,-0.5,0.5,0,0.5,-0.5,0,0.5],3));sGeo.setIndex([0,2,1,0,3,2]);
  var sC=new T.InstancedBufferAttribute(new Float32Array(MAXS*4),4),sU=new T.InstancedBufferAttribute(new Float32Array(MAXS*4),4),sM=new T.InstancedBufferAttribute(new Float32Array(MAXS*4),4);
  [sC,sU,sM].forEach(function(a){a.setUsage(T.DynamicDrawUsage);});sGeo.setAttribute('aC',sC);sGeo.setAttribute('aU',sU);sGeo.setAttribute('aM',sM);
  var sMat=new T.ShaderMaterial({side:T.DoubleSide,depthTest:false,depthWrite:false,transparent:true,
    blending:T.CustomBlending,blendEquation:T.MaxEquation,blendSrc:T.OneFactor,blendDst:T.OneFactor,
    vertexShader:[
      'attribute vec4 aC;attribute vec4 aU;attribute vec4 aM;varying vec2 vQ;varying vec2 vH;varying vec4 vM;varying vec2 vS;',
      'void main(){',
      '  vec2 hu=aU.xy,hv=aU.zw;float lu=max(length(hu),1e-4),lv=max(length(hv),1e-4);',
      '  float m=aC.z*1.5+0.03;vec2 q=position.xz*2.0;',
      '  vec2 p=aC.xy+hu*q.x*(1.0+m/lu)+hv*q.y*(1.0+m/lv);',
      '  vQ=vec2(q.x*(lu+m),q.y*(lv+m));vH=vec2(lu,lv);vM=aM;vS=aC.zw;',
      '  gl_Position=projectionMatrix*viewMatrix*vec4(p.x,0.0,p.y,1.0);',
      '}'].join('\n'),
    fragmentShader:[
      'varying vec2 vQ;varying vec2 vH;varying vec4 vM;varying vec2 vS;',
      'void main(){',
      '  float rad=min(vM.x,min(vH.x,vH.y));vec2 e=abs(vQ)-(vH-rad);',
      '  float d=length(max(e,0.0))+min(max(e.x,e.y),0.0)-rad;',
      '  float a=(1.0-smoothstep(-vS.x,vS.x,d))*vS.y;',
      '  gl_FragColor=mix(vec4(a,0.0,a*vM.y,a),vec4(0.0,a,0.0,a),vM.z);',
      '}'].join('\n')});
  var sMesh=new T.Mesh(sGeo,sMat);sMesh.frustumCulled=false;
  var sScene=new T.Scene();sScene.add(sMesh);
  var rtShadow=null;

  /* ---------- 晕开的骨白和翻面那一下的光：画进一张俯视的小图 ----------
     红：这一带醒了没有。绿：刚翻过来的卡片往四周溅出去的暖光。 */
  var fGeo=new T.InstancedBufferGeometry();
  fGeo.setAttribute('position',sGeo.getAttribute('position'));fGeo.setIndex([0,2,1,0,3,2]);
  var fF=new T.InstancedBufferAttribute(new Float32Array(40*4),4),fG=new T.InstancedBufferAttribute(new Float32Array(40*4),4);
  fF.setUsage(T.DynamicDrawUsage);fG.setUsage(T.DynamicDrawUsage);fGeo.setAttribute('aF',fF);fGeo.setAttribute('aG',fG);
  var fMat=new T.ShaderMaterial({side:T.DoubleSide,depthTest:false,depthWrite:false,transparent:true,
    blending:T.CustomBlending,blendEquation:T.AddEquation,blendSrc:T.OneFactor,blendDst:T.OneFactor,uniforms:{uFR:LU.uFR},
    vertexShader:[
      'attribute vec4 aF;attribute vec4 aG;uniform vec4 uFR;varying vec2 vQ;varying vec4 vF;varying vec2 vG;',
      'void main(){',
      '  float R=max(aF.z,aG.x)*2.6;vQ=position.xz*2.0*R;vF=aF;vG=aG.xy;',
      '  vec2 p=aF.xy+vQ;',
      '  gl_Position=vec4((p-uFR.xy)*uFR.zw*2.0-1.0,0.0,1.0);',
      '}'].join('\n'),
    fragmentShader:[
      'varying vec2 vQ;varying vec4 vF;varying vec2 vG;',
      'void main(){',
      '  float d2=dot(vQ,vQ);',
      '  gl_FragColor=vec4(vF.w*exp(-d2/(vF.z*vF.z)),vG.y*exp(-d2/(vG.x*vG.x)),0.0,1.0);',
      '}'].join('\n')});
  var fMesh=new T.Mesh(fGeo,fMat);fMesh.frustumCulled=false;
  var fScene=new T.Scene();fScene.add(fMesh);
  var rtField=new T.WebGLRenderTarget(384,288,{minFilter:T.LinearFilter,magFilter:T.LinearFilter,format:T.RGBAFormat,depthBuffer:false,stencilBuffer:false});
  LU.uField.value=rtField.texture;

  /* ---------- 每帧 ---------- */
  var lay=null,slot=[],N=0,fpos={x:0,z:0};
  var m4=new T.Matrix4(),mzero=new T.Matrix4().makeScale(0,0,0),pos=new T.Vector3(),quat=new T.Quaternion(),scl=new T.Vector3(),eul=new T.Euler();
  function setLayout(L){
    lay=L;N=L.cards.length;slot=[];var pi=0;
    L.cards.forEach(function(c){
      if(c.work.kind==='poster')slot.push({mesh:posterMesh,idx:pi++,sp:null,cell:c.work.cell});
      else{var sp=special[c.work.key];slot.push({mesh:sp.mesh,idx:0,sp:sp,cell:c.work.cell||0});}
    });
    posterMesh.count=pi;
    drawLabels(L.cards);labGeo.instanceCount=N;fGeo.instanceCount=N;sGeo.instanceCount=2*N;
    LU.uFR.value.set(L.field[0],L.field[1],1/L.field[2],1/L.field[3]);
  }
  function resize(){
    var w=sh.uRes.value.x,h=sh.uRes.value.y;
    if(rtShadow)rtShadow.dispose();
    rtShadow=new T.WebGLRenderTarget(w,h,{minFilter:T.LinearFilter,magFilter:T.LinearFilter,format:T.RGBAFormat,depthBuffer:false,stencilBuffer:false});
    LU.uShadow.value=rtShadow.texture;
  }
  /* 一块平放或者正在翻的矩形，从灯的位置投到桌面上，近似成一个平行四边形 */
  function castShadow(n,x,y,z,exx,exz,eyx,eyy,eyz,lx,ly,lz,blur,str,rad,liftB){
    var cx=0,cz=0,ux=0,uz=0,vx=0,vz=0,a,b,k=0;
    for(a=-1;a<=1;a+=2)for(b=-1;b<=1;b+=2){
      var py=y+b*eyy,t=ly/Math.max(ly-py,0.4),qx=lx+(x+a*exx+b*eyx-lx)*t,qz=lz+(z+a*exz+b*eyz-lz)*t;
      cx+=qx;cz+=qz;ux+=a*qx;uz+=a*qz;vx+=b*qx;vz+=b*qz;k+=t;
    }
    var o=n*4;sC.array[o]=cx/4;sC.array[o+1]=cz/4;sC.array[o+2]=blur;sC.array[o+3]=str;
    sU.array[o]=ux/4;sU.array[o+1]=uz/4;sU.array[o+2]=vx/4;sU.array[o+3]=vz/4;
    sM.array[o]=rad*k/4;sM.array[o+1]=liftB;sM.array[o+2]=0;sM.array[o+3]=0;
  }
  function contact(n,x,z,hux,huz,hvx,hvz,str,rad){
    var o=n*4;sC.array[o]=x;sC.array[o+1]=z;sC.array[o+2]=0.11;sC.array[o+3]=str;
    sU.array[o]=hux;sU.array[o+1]=huz;sU.array[o+2]=hvx;sU.array[o+3]=hvz;
    sM.array[o]=rad;sM.array[o+1]=0;sM.array[o+2]=1;sM.array[o+3]=0;
  }

  function update(st){
    var L=lay,tt=st.tt,clock=st.clock,i,lx=st.light.x,ly=st.light.y,lz=st.light.z,LI=Math.min(1,st.light.I);
    LU.uLP.value.set(lx,ly,lz);LU.uLI.value=st.light.I;LU.uLR.value=st.light.R;LU.uCam.value.copy(core.camera.position);LU.uAll.value=st.all;LU.uDay.value=st.day;LU.uDim.value=st.focusK||0;LU.uTt.value=tt;
    var mouthX=0,mouthZ=0,flips=0,uflips=0,awake=0,usedFocus=false;
    for(i=0;i<N;i++){
      var c=L.cards[i],sl=slot[i];
      var e=U.seg(tt,c.dealAt,c.dealAt+DEAL),ep=U.eo5(e);
      var ut=clock-st.uw[i],tau=Math.max(tt-c.tw,ut),k=U.c01(tau/FLIP);
      var kr=U.eio(U.seg(tt,c.rs,c.rs+REARR)),hov=st.hov[i]||0;
      if(k>0&&k<1){flips++;if(ut>tt-c.tw)uflips++;}if(k>=1)awake++;
      /* 发牌：从文件夹口贴着桌面滑出去 */
      var x=U.lerp(mouthX,c.gx,ep),z=U.lerp(mouthZ,c.gz,ep),y=D.TH/2+0.13*(1-ep)+0.3*Math.sin(Math.PI*e)*(1-e);
      var yaw=U.lerp(c.yaw0,c.yaw,ep),s=e<=0?0.0001:U.lerp(0.7,1,U.eo5(U.seg(e,0,0.55)));
      /* 翻面：近的那条边抬起来翻过去，正面朝着镜头转上来 */
      var rot=U.eio(U.seg(k,0.02,0.70)),a=Math.PI/2-Math.PI*rot,ca=Math.cos(a),sa=Math.sin(a);
      y+=0.5*ca+0.10*Math.sin(Math.PI*U.seg(k,0,0.86));
      s*=1+0.05*Math.sin(Math.PI*k);
      var wake=U.seg(k,0.42,1.0);
      /* 重排成首页的墙：抬起来、滑过去、落下 */
      if(kr>0){x=U.lerp(x,c.wx,kr);z=U.lerp(z,c.wz,kr);s*=U.lerp(1,c.ws,kr);yaw*=1-kr;y+=Math.sin(Math.PI*kr)*(0.22+0.5*c.r2);}
      y+=0.36*hov;s*=1+0.03*hov;
      /* 首页上点开的那一张：升到最上面，放大到墙的正中 */
      var fq=i===st.focusId?st.focusK:0;
      if(fq>0){x=U.lerp(x,st.fx,fq);z=U.lerp(z,st.fz,fq);s=U.lerp(s,st.fs,fq);y+=st.fy*fq;}
      eul.set(a,yaw,0,'YXZ');quat.setFromEuler(eul);pos.set(x,y,z);scl.set(s,s,1);m4.compose(pos,quat,scl);
      var mesh=sl.mesh,idx=sl.idx,cell=sl.sp?Math.max(0,sl.sp.cell<0?sl.cell:sl.sp.cell):sl.cell;
      if(fq>0&&!sl.sp){focusPoster(sl.cell);sl.mesh.setMatrixAt(sl.idx,mzero);mesh=focusMesh;idx=0;cell=0;usedFocus=true;}
      mesh.setMatrixAt(idx,m4);
      var at=mesh.userData.at,o=idx*4,h=Math.max(0,y-D.TH/2);
      at.aA.array[o]=cell;at.aA.array[o+1]=c.icon;at.aA.array[o+2]=wake;at.aA.array[o+3]=U.c01((h-0.03)/0.1);
      at.aB.array[o]=hov;at.aB.array[o+1]=fq;
      if(sl.sp&&sl.sp.live)sl.sp.on=k>0.3;
      /* 影子 */
      var cy=Math.cos(yaw),sy=Math.sin(yaw),on=e>0?1:0;
      castShadow(i,x,y+D.TH/2,z,cy*0.8*s,-sy*0.8*s,sa*sy*0.5*s,ca*0.5*s,sa*cy*0.5*s,lx,ly,lz,0.028+0.5*h+0.012*s,on*LI/(1+1.5*h),0.064*s,U.c01((h-0.05)/0.15));
      contact(N+i,x,z,cy*0.8*s,-sy*0.8*s,sy*0.5*s*Math.abs(sa),cy*0.5*s*Math.abs(sa),on*0.62*(1-U.c01(h/0.14)),0.064*s);
      /* 这张卡周围晕开的骨白，和翻面那一下溅出去的光 */
      o=i*4;
      fF.array[o]=x;fF.array[o+1]=z;fF.array[o+2]=1.1+1.2*U.eo5(U.seg(tau,0.28,1.5))+st.grow;fF.array[o+3]=U.eio(U.seg(tau,0.28,0.72));
      fG.array[o]=1.5;fG.array[o+1]=Math.sin(Math.PI*wake)*0.9;
      /* 文件名 */
      labP.array[o]=c.gx;labP.array[o+1]=c.gz;labP.array[o+2]=c.yaw;labP.array[o+3]=U.seg(e,0.88,1.0)*(1-U.eio(U.seg(tt,8.0,8.45)));
      labQ.array[o]=i;labQ.array[o+1]=U.seg(k,0.5,1.0);
    }
    posterMesh.instanceMatrix.needsUpdate=true;posterMesh.userData.at.aA.needsUpdate=true;posterMesh.userData.at.aB.needsUpdate=true;
    focusMesh.visible=usedFocus;if(usedFocus){focusMesh.instanceMatrix.needsUpdate=true;focusMesh.userData.at.aA.needsUpdate=true;focusMesh.userData.at.aB.needsUpdate=true;}
    for(var key in special){var sp=special[key];sp.mesh.instanceMatrix.needsUpdate=true;sp.mesh.userData.at.aA.needsUpdate=true;sp.mesh.userData.at.aB.needsUpdate=true;}
    for(i=0;i<lives.length;i++)if(lives[i].on){lives[i].live.tick(clock);lives[i].tex.needsUpdate=true;}
    sC.needsUpdate=sU.needsUpdate=sM.needsUpdate=fF.needsUpdate=fG.needsUpdate=labP.needsUpdate=labQ.needsUpdate=true;
    return {flips:flips,uflips:uflips,awake:awake};
  }
  function prepass(){
    if(!rtShadow)return;
    renderer.setClearColor(0x000000,0);
    renderer.setRenderTarget(rtField);renderer.render(fScene,core.camera);
    renderer.setRenderTarget(rtShadow);renderer.render(sScene,core.camera);
    renderer.setRenderTarget(null);renderer.setClearColor(0x0B0B0D,1);
  }
  /* 字体来晚了（开场等不及先用了替代字体）：把海报和文件名重画一遍 */
  function refresh(){
    atlas.canvas.getContext('2d').drawImage(SP.buildAtlas().canvas,0,0);atex.needsUpdate=true;
    if(lay)drawLabels(lay.cards);focusCell=-1;
  }
  /* 首页上鼠标底下是哪张卡 */
  function pickHome(x,z){
    for(var i=0;i<N;i++){var c=lay.cards[i];if(Math.abs(x-c.wx)<0.8*c.ws&&Math.abs(z-c.wz)<0.5*c.ws)return i;}
    return -1;
  }
  return {group:group,setLayout:setLayout,resize:resize,update:update,prepass:prepass,pickHome:pickHome,refresh:refresh,folderPos:function(){return fpos;},
    times:{deal:DEAL,flip:FLIP,rearr:REARR},
    LU:LU,special:special,posterMesh:posterMesh,dispose:function(){
      var geos=new Set([cardGeo,pl]),mats=new Set(),textures=new Set([atex,itex]);
      if(ltex)textures.add(ltex);if(focusTex)textures.add(focusTex);
      [group,sScene,fScene].forEach(function(node){node.traverse(function(o){if(o.geometry)geos.add(o.geometry);if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(function(m){mats.add(m);});});});
      mats.forEach(function(m){Object.keys(m.uniforms||{}).forEach(function(k){var v=m.uniforms[k].value;if(v&&v.isTexture&&v!==rtField.texture&&(!rtShadow||v!==rtShadow.texture))textures.add(v);});m.dispose();});
      geos.forEach(function(g){g.dispose();});textures.forEach(function(t){t.dispose();});rtField.dispose();if(rtShadow)rtShadow.dispose();core.scene.remove(group);
    }};
};
})();
