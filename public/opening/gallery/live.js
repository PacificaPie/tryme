/* 会动的作品：每个都是一段真的在跑的小程序，画进自己的画布 */
(function(){
'use strict';
var SP=window.SP=window.SP||{};
var TAU=Math.PI*2,INK='#15161A',BONE='#EDE8DC',RED='#E23A2E',BLUE='#1E3FE0',YEL='#F4C318';
var DISP='"Big Shoulders Display","Arial Narrow",Impact,sans-serif',MONO='"JetBrains Mono",ui-monospace,Menlo,monospace';
function rnd(seed){var s=(seed>>>0)||1;return function(){s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}

var K={};

/* 流场：粒子顺着一张看不见的风向图走，留下笔触。
   粒子怎么走（flowSim）只有一份；怎么画有两种：画在一块 2D 画布上（K.flow，桌面用），或者直接用显卡画进一张贴图（SP.flowGL，手机用）。
   手机上不用画布，是因为手机浏览器每次把这张 1440×900 的画布传给显卡都要好几毫秒，传的那一帧就会掉帧 */
function flowSim(W,H){
  var r=rnd(7),P=[],n=Math.round(W*H/1100),cols=[INK,INK,BLUE,RED,YEL,INK],i;
  function spawn(p){p.x=r()*W;p.y=r()*H;p.life=40+r()*160;p.c=cols[(r()*cols.length)|0];p.w=(r()<0.2?3.4:1.2)*W/1280*(SP.flowBold||1);return p;}
  for(i=0;i<n;i++)P.push(spawn({nx:0,ny:0}));
  /* 这一笔从 (x, y) 画到 (nx, ny) */
  function step(p,t){
    var u=p.x/W-0.5,v=p.y/H-0.5;
    var a=Math.sin(u*5.2+t*0.11)*1.7+Math.cos(v*6.1-t*0.07)*1.5+Math.sin((u*u+v*v)*9.0-t*0.2),rr=Math.sqrt(u*u+v*v)+0.18;
    var dx=Math.cos(a)*0.75-v/rr*0.9,dy=Math.sin(a)*0.75+u/rr*0.9,dl=Math.sqrt(dx*dx+dy*dy)||1,sp=1.9*W/1280;
    p.nx=p.x+dx/dl*sp;p.ny=p.y+dy/dl*sp;
  }
  /* 画完这一笔，走到新位置；走完了寿命或者出了画面就换个地方重生 */
  function next(p){p.x=p.nx;p.y=p.ny;if(--p.life<0||p.x<0||p.x>W||p.y<0||p.y>H)spawn(p);}
  return {P:P,step:step,next:next};
}
K.flow=function(g,W,H){
  var sim=flowSim(W,H),P=sim.P;
  g.fillStyle=BONE;g.fillRect(0,0,W,H);
  return function(t){
    g.fillStyle='rgba(237,232,220,0.022)';g.fillRect(0,0,W,H);
    g.lineCap='round';
    for(var i=0;i<P.length;i++){
      var p=P[i];sim.step(p,t);
      g.strokeStyle=p.c;g.lineWidth=p.w;g.globalAlpha=0.8;g.beginPath();g.moveTo(p.x,p.y);g.lineTo(p.nx,p.ny);g.stroke();
      sim.next(p);
    }
    g.globalAlpha=1;
  };
};
/* 同一段流场，直接用显卡画进一张贴图：每一拍先整张盖一层很淡的底色（旧笔触慢慢退掉），再把一千多笔当成一千多个两头圆的小胶囊一次画完。
   和画布那一版是同一套粒子、同样的颜色和粗细；贴图不清空，一拍一拍叠上去 */
SP.flowGL=function(core,W,H){
  var T=core.T,R=core.renderer,sim=flowSim(W,H),P=sim.P,n=P.length,i;
  var rt=new T.WebGLRenderTarget(W,H,{minFilter:T.LinearFilter,magFilter:T.LinearFilter,format:T.RGBAFormat,depthBuffer:false,stencilBuffer:false});
  var cam=new T.Camera(),scene=new T.Scene();
  function rgb(h){return [parseInt(h.slice(1,3),16)/255,parseInt(h.slice(3,5),16)/255,parseInt(h.slice(5,7),16)/255];}
  var CMAP={};[INK,BLUE,RED,YEL].forEach(function(c){CMAP[c]=rgb(c);});
  var bone=rgb(BONE);
  var fade=new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,side:T.DoubleSide,
    vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
    fragmentShader:'void main(){gl_FragColor=vec4('+bone[0].toFixed(4)+','+bone[1].toFixed(4)+','+bone[2].toFixed(4)+',0.022);}'}));
  fade.frustumCulled=false;fade.renderOrder=0;scene.add(fade);
  var geo=new T.InstancedBufferGeometry();
  geo.setAttribute('position',new T.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geo.setIndex([0,1,2,0,2,3]);
  var seg=new T.InstancedBufferAttribute(new Float32Array(n*4),4),sty=new T.InstancedBufferAttribute(new Float32Array(n*4),4);
  seg.setUsage(T.DynamicDrawUsage);sty.setUsage(T.DynamicDrawUsage);geo.setAttribute('aSeg',seg);geo.setAttribute('aSty',sty);geo.instanceCount=n;
  var strokes=new T.Mesh(geo,new T.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,side:T.DoubleSide,uniforms:{uSize:{value:new T.Vector2(W,H)}},
    vertexShader:[
      'attribute vec4 aSeg;attribute vec4 aSty;uniform vec2 uSize;varying vec2 vP;varying vec4 vSeg;varying vec4 vSty;',
      'void main(){',
      '  vec2 d=aSeg.zw-aSeg.xy;float len=length(d);vec2 dir=len>1e-5?d/len:vec2(1.0,0.0);vec2 nrm=vec2(-dir.y,dir.x);',
      '  float hw=aSty.w*0.5+1.0;',
      '  vec2 p=(aSeg.xy+aSeg.zw)*0.5+dir*position.x*(len*0.5+hw)+nrm*position.y*hw;',
      '  vP=p;vSeg=aSeg;vSty=aSty;',
      '  gl_Position=vec4(p.x/uSize.x*2.0-1.0,1.0-p.y/uSize.y*2.0,0.0,1.0);',      /* 和画布一样：y 朝下，(0,0) 在左上角 */
      '}'].join('\n'),
    fragmentShader:[
      'varying vec2 vP;varying vec4 vSeg;varying vec4 vSty;',
      'void main(){',
      '  vec2 pa=vP-vSeg.xy,ba=vSeg.zw-vSeg.xy;float h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-6),0.0,1.0);',
      '  float a=1.0-smoothstep(vSty.w*0.5-0.5,vSty.w*0.5+0.5,length(pa-ba*h));',
      '  gl_FragColor=vec4(vSty.rgb,a*0.8);',
      '}'].join('\n')}));
  strokes.frustumCulled=false;strokes.renderOrder=1;scene.add(strokes);
  /* 一开始整张是底色 */
  var keep=new T.Color();keep.copy(R.getClearColor(keep));var ka=R.getClearAlpha();
  R.setRenderTarget(rt);R.setClearColor(new T.Color(bone[0],bone[1],bone[2]),1);R.clear();R.setClearColor(keep,ka);R.setRenderTarget(null);
  function tick(t){
    var sa=seg.array,st=sty.array,p,c,o;
    for(i=0;i<n;i++){
      p=P[i];sim.step(p,t);o=i*4;c=CMAP[p.c];
      sa[o]=p.x;sa[o+1]=p.y;sa[o+2]=p.nx;sa[o+3]=p.ny;st[o]=c[0];st[o+1]=c[1];st[o+2]=c[2];st[o+3]=p.w;
      sim.next(p);
    }
    seg.needsUpdate=true;sty.needsUpdate=true;
    var ac=R.autoClear;R.autoClear=false;R.setRenderTarget(rt);R.render(scene,cam);R.setRenderTarget(null);R.autoClear=ac;
  }
  return {tick:tick,texture:rt.texture,kind:'flow',gl:true};
};

/* 打砖块：自己会玩的小游戏 */
K.bricks=function(g,W,H){
  var cols=8,rows=5,bw=W*0.86/cols,bh=H*0.065,ox=W*0.07,oy=H*0.16,B=[],pal=[RED,YEL,BONE,BLUE,BONE],score=0,last=0;
  var bx=W*0.5,by=H*0.6,vx=W*0.42,vy=-H*0.62,px=W*0.5;
  function reset(){B=[];for(var i=0;i<cols*rows;i++)B.push(1);}
  reset();
  return function(t){
    var dt=Math.min(0.05,t-last);last=t;
    bx+=vx*dt;by+=vy*dt;
    if(bx<W*0.05){bx=W*0.05;vx=Math.abs(vx);}if(bx>W*0.95){bx=W*0.95;vx=-Math.abs(vx);}
    if(by<H*0.1){by=H*0.1;vy=Math.abs(vy);}
    px+=(bx-px)*Math.min(1,dt*9);
    if(by>H*0.86&&vy>0){by=H*0.86;vy=-Math.abs(vy);vx+=(bx-px)*4;}
    var c=Math.floor((bx-ox)/bw),rw=Math.floor((by-oy)/(bh*1.5));
    if(c>=0&&c<cols&&rw>=0&&rw<rows&&B[rw*cols+c]){B[rw*cols+c]=0;vy=-vy;score+=10;}
    if(B.indexOf(1)<0||score>390){reset();score=0;}
    g.fillStyle=INK;g.fillRect(0,0,W,H);
    for(var i=0;i<B.length;i++)if(B[i]){g.fillStyle=pal[(i/cols)|0];g.fillRect(ox+(i%cols)*bw+2,oy+((i/cols)|0)*bh*1.5,bw-4,bh);}
    g.fillStyle=BONE;g.fillRect(px-W*0.07,H*0.88,W*0.14,H*0.022);
    g.beginPath();g.arc(bx,by,H*0.02,0,TAU);g.fill();
    g.font='500 '+(H*0.04)+'px '+MONO;g.textBaseline='top';g.textAlign='left';g.fillText('SCORE '+('000'+score).slice(-4),ox,H*0.05);
    g.textAlign='right';g.fillStyle=YEL;g.fillText('AUTO PLAY',W-ox,H*0.05);
  };
};

/* 时钟：现在几点，就显示几点 */
K.clock=function(g,W,H){
  return function(t){
    var d=new Date(),hh=('0'+d.getHours()).slice(-2),mm=('0'+d.getMinutes()).slice(-2),ss=d.getSeconds()+d.getMilliseconds()/1000;
    g.fillStyle=BLUE;g.fillRect(0,0,W,H);
    g.fillStyle=BONE;g.font='900 '+(H*0.78)+'px '+DISP;g.textBaseline='alphabetic';g.textAlign='center';
    g.fillText(hh,W*0.27,H*0.78);g.fillText(mm,W*0.73,H*0.78);
    g.fillStyle=YEL;var on=(ss%1)<0.5?1:0.25;g.globalAlpha=on;g.fillRect(W*0.485,H*0.36,W*0.03,H*0.07);g.fillRect(W*0.485,H*0.56,W*0.03,H*0.07);g.globalAlpha=1;
    g.fillStyle='rgba(237,232,220,.28)';g.fillRect(W*0.06,H*0.9,W*0.88,H*0.012);
    g.fillStyle=BONE;g.fillRect(W*0.06,H*0.9,W*0.88*(ss/60),H*0.012);
    g.font='500 '+(H*0.035)+'px '+MONO;g.textAlign='left';g.textBaseline='top';g.fillText('NOW',W*0.06,H*0.06);
  };
};

/* 轨道：几颗小球绕着转，留下轨迹 */
K.orbit=function(g,W,H){
  g.fillStyle=YEL;g.fillRect(0,0,W,H);
  return function(t){
    g.fillStyle='rgba(244,195,24,0.10)';g.fillRect(0,0,W,H);
    var cx=W*0.5,cy=H*0.52;
    g.strokeStyle='rgba(21,22,26,.18)';g.lineWidth=1;
    for(var k=1;k<=4;k++){g.beginPath();g.ellipse(cx,cy,k*W*0.1,k*H*0.1,0,0,TAU);g.stroke();}
    for(k=1;k<=4;k++){var a=t*(1.5/k)+k*1.7;g.fillStyle=k%2?INK:RED;g.beginPath();g.arc(cx+Math.cos(a)*k*W*0.1,cy+Math.sin(a)*k*H*0.1,H*(0.018+k*0.006),0,TAU);g.fill();}
    g.fillStyle=INK;g.beginPath();g.arc(cx,cy,H*0.035,0,TAU);g.fill();
  };
};

SP.live=function(kind,W,H){
  var cv=document.createElement('canvas');cv.width=W;cv.height=H;
  var tick=K[kind](cv.getContext('2d'),W,H);
  return {canvas:cv,tick:tick,kind:kind};
};
})();
