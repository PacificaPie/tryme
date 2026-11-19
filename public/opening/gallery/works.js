/* 墙上的东西：56 件作品（墨色细框、柔边影子、抖点沉睡态到彩色）、三块展签、一条长凳 */
(function(){
'use strict';
var SP=window.SP=window.SP||{};
SP.createWorks=function(core,hall,assets){
  var T=core.T,U=SP.u,R=hall.rooms,world=hall.world,group=new T.Group();world.add(group);
  var SERIF='"Noto Serif SC","Songti SC",serif',DISP='"Big Shoulders Display","Arial Narrow",Impact,sans-serif',MONO='"JetBrains Mono",ui-monospace,Menlo,monospace',INK='#15161A';
  var aniso=Math.min(8,core.renderer.capabilities.getMaxAnisotropy());
  function canvasTex(cv,mip){var t=new T.CanvasTexture(cv);t.minFilter=mip?T.LinearMipmapLinearFilter:T.LinearFilter;t.magFilter=T.LinearFilter;t.generateMipmaps=!!mip;t.anisotropy=aniso;return t;}

  var VS='varying vec2 vUv;varying vec3 vN;varying vec3 vW;void main(){vUv=uv;vN=normal;vec4 w=modelMatrix*vec4(position,1.0);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}';
  /* 作品：沉睡时是屏幕对齐的 Bayer 抖点，醒来时按抖点矩阵一格一格溶成彩色，中途闪一下暖白 */
  var ART_F=[
    'uniform sampler2D tMap;uniform float uWake;uniform float uDorm;uniform float uPx;uniform vec3 uTan;varying vec2 vUv;varying vec3 vW;',
    'float bayer2(vec2 a){a=floor(a);return fract(a.x/2.0+a.y*a.y*0.75);}',
    'float bayer4(vec2 a){return bayer2(0.5*a)*0.25+bayer2(a);}',
    'float bayer8(vec2 a){return bayer4(0.5*a)*0.25+bayer2(a);}',
    'void main(){',
    '  vec3 col=texture2D(tMap,vUv).rgb;float lum=dot(col,vec3(0.299,0.587,0.114));',
    '  vec2 fc=gl_FragCoord.xy/(uPx*1.5);',
    '  float bit=step(bayer8(fc),(lum*0.96+0.02)*uDorm-0.004);',
    '  vec3 dorm=mix(vec3(0.040,0.042,0.050),vec3(0.80,0.79,0.765),bit);',
    '  float k=step(bayer8(floor(fc*0.5)),uWake*1.03-0.004);',
    '  vec3 outc=mix(dorm,col,k);',
    '  outc+=vec3(1.0,0.93,0.80)*sin(clamp(uWake,0.0,1.0)*3.14159)*0.40;',
    '  float b=vUv.x*0.9+vUv.y*0.5-0.7-dot(cameraPosition-vW,uTan)*0.07;outc+=exp(-b*b/0.02)*0.05*uWake;',
    '  gl_FragColor=vec4(outc,1.0);',
    '}'].join('\n');
  var SOLID_F='uniform vec3 uC;uniform float uLit;varying vec3 vN;void main(){float f=vN.y>0.5?1.7:(vN.y<-0.5?0.55:(abs(vN.x)>0.5?0.85:1.0));gl_FragColor=vec4(uC*f*mix(0.42,1.0,uLit),1.0);}';
  var SHADOW_F='varying vec2 vUv;uniform vec2 uHalf;uniform vec2 uTot;uniform float uA;void main(){vec2 p=(vUv-0.5)*uTot;vec2 d=abs(p)-uHalf;float dist=length(max(d,0.0))+min(max(d.x,d.y),0.0);float a=1.0-smoothstep(-0.12,0.42,dist);gl_FragColor=vec4(0.10,0.09,0.085,a*a*uA);}';
  function solid(c){return new T.ShaderMaterial({vertexShader:VS,fragmentShader:SOLID_F,uniforms:{uC:{value:new T.Vector3(c[0],c[1],c[2])},uLit:{value:0}}});}
  function shadowMesh(w,h,m){
    return new T.Mesh(new T.PlaneGeometry(w+2*m,h+2*m),new T.ShaderMaterial({transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,
      vertexShader:VS,fragmentShader:SHADOW_F,uniforms:{uHalf:{value:new T.Vector2(w/2,h/2)},uTot:{value:new T.Vector2(w+2*m,h+2*m)},uA:{value:0}}}));
  }

  var pieces=[],cover=0,imgTex=[];
  assets.imgs.forEach(function(im,k){
    var t=im?new T.Texture(im):canvasTex(SP.coverCanvas(48+k,768),true);
    t.minFilter=T.LinearMipmapLinearFilter;t.magFilter=T.LinearFilter;t.generateMipmaps=true;t.anisotropy=aniso;t.needsUpdate=true;imgTex.push(t);
  });
  /* src: 数字 = 第几张作品图，字符串 = 哪个真在跑的小程序，不写 = 下一张代码画的海报 */
  function add(ri,wall,a,y,w,src){
    var r=R[ri],h=w*0.625,g=new T.Group(),tex,cell,lv=null;
    if(typeof src==='string'){lv=assets.lives[src];tex=lv.tex;cell=lv.cell;}
    else if(typeof src==='number'){tex=imgTex[src];cell=48+src;}
    else{cell=(cover++*5+2)%47;tex=canvasTex(SP.coverCanvas(cell,w>1.85?768:512),true);}
    var tan=new T.Vector3(0,0,-1),s=a;
    if(wall==='L'){g.position.set(r.x0,y,-a);g.rotation.y=Math.PI/2;}
    else if(wall==='R'){g.position.set(r.x1,y,-a);g.rotation.y=-Math.PI/2;}
    else{g.position.set(a,y,-r.s1);tan.set(1,0,0);s=r.s1;}
    var sh=shadowMesh(w,h,0.5);sh.position.set(0,-0.10-h*0.015,0.004);sh.renderOrder=1;g.add(sh);
    var fm=solid([0.082,0.086,0.102]),fr=new T.Mesh(new T.BoxGeometry(w+0.07,h+0.07,0.05),fm);fr.position.z=0.025;g.add(fr);
    var am=new T.ShaderMaterial({vertexShader:VS,fragmentShader:ART_F,uniforms:{tMap:{value:tex},uWake:{value:0},uDorm:{value:0},uPx:core.shared.uPx,uTan:{value:tan}}});
    var art=new T.Mesh(new T.PlaneGeometry(w,h),am);art.position.z=0.056;g.add(art);
    group.add(g);g.updateMatrixWorld(true);
    var j=wall==='E'?r.n-1:Math.max(0,Math.min(r.n-1,Math.floor((s-r.s0)/r.bay))),B=r.s0+j*r.bay;
    var p={room:ri,wall:wall,s:s,w:w,h:h,cell:cell,lv:lv,am:am,fm:fm,sm:sh.material,g:g,
      t0:wall==='E'?B+1.4:B+1.2+(s-B)/r.bay*1.0,dur:wall==='E'?2.4:1.6,beacon:false,
      pos:art.getWorldPosition(new T.Vector3()),quat:g.getWorldQuaternion(new T.Quaternion())};
    pieces.push(p);return p;
  }
  /* 第一间：沙龙式，两面墙挤满，大小不一 */
  [[1.55,2.5,1.5],[1.65,1.28,1.7],[3.35,1.95,1.25],[3.35,2.95,1.0],[3.35,0.98,1.0],[5.2,2.52,1.9,0],[5.05,1.22,1.55],[7.2,1.8,1.6,'bricks'],[7.2,2.9,1.1],[12.6,2.58,1.7],[12.75,1.32,2.05],[14.8,2.0,1.9],[16.6,2.05,1.3],[16.6,1.05,1.1]]
    .forEach(function(d){add(0,'L',d[0],d[1],d[2],d[3]);});
  [[1.5,1.9,1.9],[3.6,2.55,1.6],[3.5,1.3,1.8,1],[5.6,1.85,1.5],[5.6,2.85,1.1],[5.6,0.9,1.0],[7.5,2.5,1.5],[7.6,1.25,1.75],[9.7,1.95,2.0,'clock'],[9.7,3.08,1.2],[11.75,2.6,1.45],[11.8,1.4,1.6],[13.9,1.9,2.1,4],[15.9,1.95,1.6],[15.9,2.92,1.2]]
    .forEach(function(d){add(0,'R',d[0],d[1],d[2],d[3]);});
  /* 第二间：只有一件，占满尽头的墙，是一段真在跑的流场 */
  add(1,'E',-7.35,3.4,10.08,'flow');
  /* 第三间：整齐的网格。轴线尽头正对镜头的那一件，就是加载时黑暗里的亮点 */
  var cs=[34.4,36.5,38.6,40.7,42.8],ys=[2.675,1.25];
  cs.forEach(function(s,ci){ys.forEach(function(y,yi){add(2,'L',s,y,1.8,(ci===1&&yi===0)?2:undefined);});});
  cs.forEach(function(s,ci){ys.forEach(function(y,yi){add(2,'R',s,y,1.8,(ci===2&&yi===1)?3:undefined);});});
  [-2.1,0,2.1].forEach(function(x){ys.forEach(function(y,yi){var p=add(2,'E',x,y,1.8,(x===0&&yi===1)?'orbit':undefined);if(x===0&&yi===1)p.beacon=true;});});

  /* 展签：朱红编号加大号宋体名字 */
  var labels=[];
  function label(r,ri,sLit,w,place){
    var cv=document.createElement('canvas');cv.width=1024;cv.height=760;var g=cv.getContext('2d');
    g.textBaseline='alphabetic';g.fillStyle=INK;
    g.font='500 24px '+MONO;g.fillText('HALL '+r.hall+'  /  常设',4,30);g.textAlign='right';g.fillText('2026.11 —',1020,30);g.textAlign='left';
    g.fillRect(4,50,1016,2);
    g.fillStyle='#E23A2E';g.font='900 310px '+DISP;g.fillText(r.hall,-6,318);
    g.fillStyle=INK;g.font='900 196px '+SERIF;g.fillText(r.name,-4,540);
    g.font='600 46px '+SERIF;g.fillText(r.line,2,640);
    g.font='400 24px '+MONO;g.fillStyle='rgba(21,22,26,.62)';g.fillText('N°'+r.no+'  /  每一件都能直接玩',4,712);
    var m=new T.Mesh(new T.PlaneGeometry(w,w*760/1024),new T.MeshBasicMaterial({map:canvasTex(cv,true),transparent:true,depthWrite:false,opacity:0,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
    place(m);m.renderOrder=2;group.add(m);labels.push({m:m,ri:ri,s:sLit});
  }
  label(R[0],0,10.2,2.6,function(m){m.position.set(R[0].x0+0.006,1.98,-10.2);m.rotation.y=Math.PI/2;});
  label(R[1],0,18,1.5,function(m){m.position.set(2.05,1.78,-18+0.006);});
  label(R[2],1,30.8,1.6,function(m){m.position.set(2.3,1.78,-30.8+0.006);});

  /* 第二间的长凳：给那件大作品一个人的尺度 */
  var bm=solid([0.115,0.105,0.10]),bg=new T.Group(),bx=-7.35,bs=24.2;
  [[4.4,0.09,0.62,0,0.465],[0.09,0.42,0.56,-1.9,0.21],[0.09,0.42,0.56,1.9,0.21]].forEach(function(d){var b=new T.Mesh(new T.BoxGeometry(d[0],d[1],d[2]),bm);b.position.set(d[3],d[4],0);bg.add(b);});
  bg.position.set(bx,0,-bs);world.add(bg);
  var bsh=shadowMesh(4.3,0.5,0.7);bsh.rotation.x=-Math.PI/2;bsh.position.set(bx,0.004,-bs);bsh.renderOrder=1;world.add(bsh);

  /* st: front 亮到哪儿，dorm 抖点可见度，beacon 加载亮点的可见度，show 墙上的真作品是否还在 */
  function update(st){
    group.visible=st.show;if(!st.show)return;
    var f=st.front,i;
    for(i=0;i<pieces.length;i++){
      var p=pieces[i],l=hall.lightAt(p.room,p.s,f);
      p.wake=U.eio(U.c01((f-p.t0)/p.dur));
      p.am.uniforms.uWake.value=p.wake;p.am.uniforms.uDorm.value=p.beacon?Math.max(st.dorm,st.beacon):st.dorm;
      p.fm.uniforms.uLit.value=l;p.sm.uniforms.uA.value=0.42*l;
    }
    for(i=0;i<labels.length;i++)labels[i].m.material.opacity=U.c01(hall.lightAt(labels[i].ri,labels[i].s,f)*1.25-0.2);
    var bl=hall.lightAt(1,bs,f);bm.uniforms.uLit.value=bl;bsh.material.uniforms.uA.value=0.36*bl;
  }
  return {pieces:pieces,labels:labels,update:update,group:group};
};
})();
