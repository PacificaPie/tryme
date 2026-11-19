/* 展廊的建筑：三间连成一条轴线的展厅。真的墙厚、门洞、踢脚线、天花板灯带、抛光地面倒影。
   坐标：镜头沿 -z 方向前进，下面一律用 s = -z 表示"往里走了多少米"。 */
(function(){
'use strict';
var SP=window.SP=window.SP||{};
var TH=0.4,PAR=0.5;   /* PAR：墙比天花板高出的一截女儿墙，镜头穿出屋顶后还能看见墙头往下退 */
/* 三间的区别全在建筑和布展：窄长低顶的走廊 / 又宽又高的大厅 / 低顶黑地面的方厅 */
/* 三间都是同一位创作者的：no 是他的编号（和名片背面的一样），hall 是第几号厅 */
var ROOMS=[
  {x0:-3,x1:3,s0:0,s1:18,H:3.8,bay:3,n:6,no:'0037',hall:'01',name:'TryMe',style:'沙龙式',line:'沙龙式挂法。二十九件，挤满两面墙。',col:[0.76,0.745,0.72],r0:0.05,joint:[0,3],jc:0.42,strip:[0.16,1,0.8]},
  {x0:-13.5,x1:3.5,s0:18.8,s1:30.8,H:6.8,bay:4,n:3,no:'0037',hall:'02',name:'TryMe',style:'只挂一件',line:'只挂一件。占满尽头的墙。',col:[0.84,0.83,0.805],r0:0.06,joint:[0,0],jc:0.5,strip:[2.0,1,0.86]},
  {x0:-4.5,x1:4.5,s0:31.6,s1:45.6,H:3.6,bay:3.5,n:4,no:'0037',hall:'03',name:'TryMe',style:'网格',line:'二十六件。排成整齐的网格。',col:[0.070,0.073,0.085],r0:0.11,joint:[1.5,1.75],jc:0.46,strip:[0.9,5,0.5]}
];
var DOORS=[{s:18,x:0,w:2.2,h:2.9},{s:30.8,x:0,w:2.2,h:2.9}];

SP.createHall=function(core){
  var T=core.T,U=SP.u,world=new T.Group(),floors=new T.Group();
  core.scene.add(world);core.scene.add(floors);
  var uFront={value:0},uCut={value:0};

  /* 灯光：每间按进深分成几段，每段头顶一排灯。uFront 是"亮到哪儿了"，由镜头位置算出来 */
  var LIGHT=[
    'uniform vec4 uRect;uniform float uBay;uniform float uN;uniform float uFront;',
    'float ramp(float j){if(j<-0.5||j>uN-0.5)return 0.0;float x=clamp((uFront-(uRect.z+j*uBay)-1.0)/1.6,0.0,1.0);float y=1.0-x;return 1.0-y*y*y*y*y;}',
    'float lightAt(float s){float u=(s-uRect.z)/uBay;float b=clamp(floor(u),0.0,uN-1.0);float l=0.0;',
    '  for(int k=-1;k<=1;k++){float j=b+float(k);float d=(u-(j+0.5))/0.72;l+=ramp(clamp(j,0.0,uN-1.0))*exp(-d*d);}return l/1.27;}'].join('\n');
  function rampJ(r,j,f){if(j<0||j>r.n-1)return 0;return U.eo5(U.c01((f-(r.s0+j*r.bay)-1)/1.6));}
  function lightAt(ri,s,f){
    var r=ROOMS[ri],u=(Math.max(r.s0,Math.min(r.s1,s))-r.s0)/r.bay,b=Math.max(0,Math.min(r.n-1,Math.floor(u))),l=0;
    for(var k=-1;k<=1;k++){var j=b+k,d=(u-(j+0.5))/0.72;l+=rampJ(r,Math.max(0,Math.min(r.n-1,j)),f)*Math.exp(-d*d);}
    return l/1.27;
  }
  var VS='varying vec3 vP;varying vec3 vN;varying float vY;void main(){vN=normal;vY=position.y;vec4 w=modelMatrix*vec4(position,1.0);vP=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}';
  function roomU(r,extra){
    var u={uRect:{value:new T.Vector4(r.x0,r.x1,r.s0,r.s1)},uBay:{value:r.bay},uN:{value:r.n},uFront:uFront,uH:{value:r.H}};
    for(var k in extra)u[k]=extra[k];return u;
  }
  var WALL_F=[
    'varying vec3 vP;varying vec3 vN;varying float vY;uniform float uH;uniform float uCut;',LIGHT,
    'float bay2(vec2 a){a=floor(a);return fract(a.x/2.0+a.y*a.y*0.75);}',
    'void main(){',
    '  if(uCut>0.0){vec2 fc=gl_FragCoord.xy/3.0;if(bay2(0.5*fc)*0.25+bay2(fc)<uCut)discard;}',
    '  vec3 N=normalize(vN);',
    '  if(N.y>0.5){gl_FragColor=vec4(0.082,0.086,0.102,1.0);return;}',            /* 墙顶是墨色：从上面看就是平面图里的墙线 */
    '  float s=-vP.z;',
    '  float inside=step(uRect.x-0.02,vP.x)*step(vP.x,uRect.y+0.02)*step(uRect.z-0.42,s)*step(s,uRect.w+0.42);',
    '  float l=lightAt(clamp(s,uRect.z,uRect.w));',
    '  float prof=0.90+0.10*exp(-pow((vY-0.6*uH)/(0.55*uH),2.0));',
    '  prof*=(1.0-0.12*exp(-vY*3.0))*(1.0-0.07*exp(-abs(uH-vY)*4.0));',
    '  prof*=0.955+0.045*cos(6.2832*((s-uRect.z)/uBay-0.5));',
    '  float jamb=step(s,uRect.z-0.001)+step(uRect.w+0.001,s);',
    '  prof*=1.0-0.10*jamb-0.03*abs(N.z)*(1.0-jamb);',
    '  if(N.y<-0.5)prof*=0.80;',
    '  if(vY<0.10)prof*=0.90;else if(vY<0.114)prof*=0.76;',                        /* 踢脚线和它上沿的一道阴影缝 */
    '  vec3 col=mix(vec3(0.040,0.042,0.050),vec3(0.925,0.914,0.886)*min(prof*1.06,1.04),l);',
    '  vec3 ext=vec3(0.925,0.914,0.886)*(0.86+0.06*N.x-0.07*N.z);',
    '  gl_FragColor=vec4(mix(ext,col,inside),1.0);',
    '}'].join('\n');
  var FLOOR_F=[
    'varying vec3 vP;uniform vec3 uCol;uniform float uR0;uniform vec2 uJoint;uniform float uJc;uniform sampler2D tRefl;uniform vec2 uRes;uniform float uRefl;uniform float uAlpha;',LIGHT,
    'void main(){',
    '  float s=-vP.z;float l=lightAt(clamp(s,uRect.z,uRect.w));',
    '  vec2 g=vec2(vP.x-uRect.x,s-uRect.z);float jl=0.0;',
    '  if(uJoint.x>0.0){float a=abs(fract(g.x/uJoint.x+0.5)-0.5)*uJoint.x;jl=max(jl,1.0-smoothstep(0.0,fwidth(g.x)*1.3+0.006,a));}',
    '  if(uJoint.y>0.0){float b=abs(fract(g.y/uJoint.y+0.5)-0.5)*uJoint.y;jl=max(jl,1.0-smoothstep(0.0,fwidth(g.y)*1.3+0.006,b));}',
    '  float ao=1.0-0.13*exp(-min(vP.x-uRect.x,uRect.y-vP.x)*2.0);',
    '  vec3 base=mix(uCol*ao,vec3(uJc),jl*0.5);',
    '  vec3 V=normalize(cameraPosition-vP);float F=uR0+(0.66-uR0)*pow(1.0-max(V.y,0.0),3.2);',
    '  vec2 suv=gl_FragCoord.xy/uRes;vec3 r=vec3(0.0);float tw=0.0;',
    '  for(int i=-4;i<=4;i++){float f=float(i);float w=exp(-f*f*0.15);r+=texture2D(tRefl,suv+vec2(f*0.0006,f*0.0042)).rgb*w;tw+=w;}',
    '  r/=tw;',
    '  vec3 col=mix(vec3(0.030,0.032,0.038),base,l)*(1.0-F*0.7)+r*F*uRefl;',
    '  gl_FragColor=vec4(col,uAlpha);',
    '}'].join('\n');
  var CEIL_F=[
    'varying vec3 vP;uniform vec3 uStrip;',LIGHT,
    'void main(){',
    '  float s=-vP.z;float u=(s-uRect.z)/uBay;float b=clamp(floor(u),0.0,uN-1.0);float on=ramp(b);',
    '  float ds=abs(u-(b+0.5))*uBay;float aa=fwidth(s)*1.2+0.003;',
    '  float inS=1.0-smoothstep(uStrip.x*0.5-aa,uStrip.x*0.5+aa,ds);',
    '  float segW=(uRect.y-uRect.x)/uStrip.y;float dx=abs(fract((vP.x-uRect.x)/segW)-0.5)*segW;float ax=fwidth(vP.x)*1.2+0.003;',
    '  float inX=1.0-smoothstep(uStrip.z*segW*0.5-ax,uStrip.z*segW*0.5+ax,dx);',
    '  float glow=exp(-max(ds-uStrip.x*0.5,0.0)*1.5)*on;',
    '  vec3 cl=mix(vec3(0.034,0.036,0.043),vec3(0.925,0.914,0.886)*(0.70+0.24*glow),lightAt(s));',
    '  vec3 lamp=mix(vec3(0.085,0.087,0.097),vec3(1.0,0.985,0.95),on);',
    '  gl_FragColor=vec4(mix(cl,lamp,inS*inX),1.0);',
    '}'].join('\n');

  /* 把很多盒子并成一个网格 */
  function Geo(){this.p=[];this.n=[];}
  Geo.prototype.box=function(x0,x1,y0,y1,s0,s1){
    var g=new T.BoxGeometry(x1-x0,y1-y0,s1-s0).toNonIndexed();g.translate((x0+x1)/2,(y0+y1)/2,-(s0+s1)/2);
    var p=g.attributes.position.array,n=g.attributes.normal.array,i;
    for(i=0;i<p.length;i++){this.p.push(p[i]);this.n.push(n[i]);}
    g.dispose();
  };
  Geo.prototype.mesh=function(mat){
    var g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(this.p,3));g.setAttribute('normal',new T.Float32BufferAttribute(this.n,3));
    return new T.Mesh(g,mat);
  };

  var lintels=[],ceils=[],floorMats=[],rtR=null;
  ROOMS.forEach(function(r,i){
    var wallMat=new T.ShaderMaterial({uniforms:roomU(r,{uCut:{value:0}}),vertexShader:VS,fragmentShader:WALL_F});
    var lintelMat=new T.ShaderMaterial({uniforms:roomU(r,{uCut:uCut}),vertexShader:VS,fragmentShader:WALL_F});
    var w=new Geo(),lt=new Geo(),dIn=i>0?DOORS[i-1]:null,dOut=i<ROOMS.length-1?DOORS[i]:null;
    var top=r.H+PAR;
    w.box(r.x0-TH,r.x0,0,top,r.s0-TH,r.s1+TH);w.box(r.x1,r.x1+TH,0,top,r.s0-TH,r.s1+TH);
    function cross(sa,sb,d){
      if(!d){w.box(r.x0,r.x1,0,top,sa,sb);return;}
      w.box(r.x0,d.x-d.w/2,0,top,sa,sb);w.box(d.x+d.w/2,r.x1,0,top,sa,sb);lt.box(d.x-d.w/2,d.x+d.w/2,d.h,top,sa,sb);
    }
    cross(r.s0-TH,r.s0,dIn);cross(r.s1,r.s1+TH,dOut);
    world.add(w.mesh(wallMat));
    if(lt.p.length){var lm=lt.mesh(lintelMat);world.add(lm);lintels.push(lm);}

    var cg=new T.PlaneGeometry(r.x1-r.x0,r.s1-r.s0);cg.rotateX(Math.PI/2);cg.translate((r.x0+r.x1)/2,r.H,-(r.s0+r.s1)/2);
    var cm=new T.Mesh(cg,new T.ShaderMaterial({uniforms:roomU(r,{uStrip:{value:new T.Vector3(r.strip[0],r.strip[1],r.strip[2])}}),vertexShader:VS,fragmentShader:CEIL_F,extensions:{derivatives:true}}));
    world.add(cm);ceils.push(cm);

    var fa=r.s0-TH,fb=r.s1+TH,fg=new T.PlaneGeometry(r.x1-r.x0,fb-fa);fg.rotateX(-Math.PI/2);fg.translate((r.x0+r.x1)/2,0,-(fa+fb)/2);
    var fm=new T.ShaderMaterial({vertexShader:VS,fragmentShader:FLOOR_F,extensions:{derivatives:true},uniforms:roomU(r,{
      uCol:{value:new T.Vector3(r.col[0],r.col[1],r.col[2])},uR0:{value:r.r0},uJoint:{value:new T.Vector2(r.joint[0],r.joint[1])},uJc:{value:r.jc},
      tRefl:{value:null},uRes:core.shared.uRes,uRefl:{value:1},uAlpha:{value:1}})});
    floors.add(new T.Mesh(fg,fm));floorMats.push(fm);
  });

  /* 抛光地面的倒影：把整个世界上下翻过来再画一遍，存成一张小图，地面按屏幕位置去取，再竖向抹开 */
  function resize(){
    var s=core.size(),w=Math.max(2,Math.round(s.w*s.px*0.5)),h=Math.max(2,Math.round(s.h*s.px*0.5));
    if(rtR)rtR.dispose();
    rtR=new T.WebGLRenderTarget(w,h,{minFilter:T.LinearFilter,magFilter:T.LinearFilter,format:T.RGBAFormat,depthBuffer:true,stencilBuffer:false});
    floorMats.forEach(function(m){m.uniforms.tRefl.value=rtR.texture;});
  }
  function renderRefl(hide){
    if(!rtR)return;
    var i,keep=[];floors.visible=false;
    for(i=0;i<hide.length;i++){keep.push(hide[i].visible);hide[i].visible=false;}
    world.scale.y=-1;core.renderer.setRenderTarget(rtR);core.renderer.render(core.scene,core.camera);world.scale.y=1;
    floors.visible=true;for(i=0;i<hide.length;i++)hide[i].visible=keep[i];
  }
  /* st: front 亮到哪儿，above 镜头是否已经在屋顶之上，cut 门楣按抖点溶掉的进度（平面图上门洞要是缺口），flat 墙压扁成平面图的进度，swap 墙线是否已交给平面图层 */
  function update(st){
    uFront.value=st.front;
    var i,refl=st.above?0:1;
    uCut.value=st.cut;for(i=0;i<lintels.length;i++)lintels[i].visible=st.cut<1;
    for(i=0;i<ceils.length;i++)ceils[i].visible=!st.above;
    world.visible=!st.swap;floors.visible=st.flat<0.999;
    world.scale.y=U.lerp(1,0.0015,st.flat);
    for(i=0;i<floorMats.length;i++){var m=floorMats[i];m.uniforms.uRefl.value=refl;m.uniforms.uAlpha.value=1-st.flat;m.transparent=st.flat>0.001;}
    return refl>0&&st.flat<=0;
  }
  return {world:world,floors:floors,rooms:ROOMS,doors:DOORS,TH:TH,uFront:uFront,lightAt:lightAt,rampJ:rampJ,resize:resize,renderRefl:renderRefl,update:update};
};
SP.HALL_ROOMS=ROOMS;
})();
