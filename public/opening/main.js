/* 总时间线。三块画布叠在一起：
   最下面是展廊（《一镜到底的展廊》那条不剪的镜头），中间是名片的世界（card/world.js，《灯城》的那套动画），
   最上面是一层透明的像素点（dots.js）。两段画面之间不切镜头，靠"整个画面碎成像素点"来接。
   这个文件同时管两个版本（variant.js 里选）：
   A 展廊先行 —— 逛完三间展厅，画面碎成像素点散开，收拢成一张黑色名片，接着是灯城的动画：铺路、起楼、收回、名片抬起来；
   B 名片先行 —— 先是灯城的动画（铺路、起楼），镜头冲进一扇橱窗，穿到展厅里走完那条镜头，最后碎成像素点，再收拢回那张名片。
   给任意时间 tt 都能直接算出那一帧。 */
(function(){
'use strict';
var SP=window.SP,U=SP.u,LC=window.LC,FX=window.FX,Q=window.FV.Q,D=Math.PI/180,PI=Math.PI;
function $(id){return document.getElementById(id);}
var stage=$('stage'),cvA=$('gl'),cvB=$('gl2'),cvC=$('fx');
var VAR=(window.FV&&window.FV.variant)==='B'?'B':'A';
var V=5.3;
/* 在展厅里走得比原片慢一成：展廊自己的钟只走真实时间的 0.9 倍。路线、灯、每件作品醒过来的位置都不变，只是这一段多用一成时间 */
var GR=0.9;
function fail(){window.OpeningSequence.fail('webgl');}

/* ---- 以下到 yawAt 为止，和《一镜到底的展廊》一字不差 ---- */
/* 推轨：先极慢地往前蹭，然后匀速 5.3 米每秒，最后减速停下。写成速度曲线的积分，任意时间都能直接算位置 */
function ramp(t,a,b){if(t<=a)return 0;if(t>=b)return (b-a)/2+(t-b);var u=(t-a)/(b-a);return (b-a)*(u*u*u-u*u*u*u/2);}
function travel(t){return 0.55+0.27*(t-ramp(t,0.9,1.7))+V*(ramp(t,0.9,1.7)-ramp(t,8.0,9.8));}
function ss(x){x=U.c01(x);return x*x*(3-2*x);}
/* 灯亮到哪儿，只由镜头走到哪儿决定：起步的头三米里甩到前面 7 米，之后一直领先 7 米 */
function frontOf(s){return s+7*ss((s-0.9)/3.5);}
/* 镜头左右看：看一眼左墙的展签，看一眼右墙，穿门时回正，进大厅时转头看那件大作品 */
var YAW=[[0.5,0],[3.2,-7],[8.5,6],[13.5,-3.5],[18.4,0],[22.3,-18],[27.5,-7],[31.2,0],[36.5,4.5],[41.2,0]];
function trackAt(K,s){
  if(s<=K[0][0])return K[0][1];
  for(var i=0;i<K.length-1;i++){var a=K[i],b=K[i+1];if(s<b[0])return U.lerp(a[1],b[1],U.eio((s-a[0])/(b[0]-a[0])));}
  return K[K.length-1][1];
}
function yawAt(s){return trackAt(YAW,s);}
/* 竖着的画面很窄，一次只装得下一面墙。所以竖屏另有一套转头的轨道：像举着手机边走边看，头转得更开，
   先看左墙、再看右墙；进第二间时整个转向那件占满一面墙的大作品（同时稍微抬一点头），穿门的时候回正 */
var CAMP={
  yaw:[[0.5,0],[4.2,-24],[9.8,23],[14.6,-9],[17.4,0],[18.7,0],[22.6,-34],[25.2,-33],[29.8,0],[31.6,0],[35.0,-17],[38.4,13],[40.8,0]],
  pitch:[[0,0],[18.7,0],[22.6,5],[25.2,5],[29.8,0]],
  fovMax:84
};

function boot(imgs,portrait){
  if(!window.THREE)return fail();
  var core,world,dots;
  try{core=SP.createCore(cvA);}catch(e){console.error(e);return fail();}
  var T=THREE,cam=core.camera;
  /* 四个真在跑的小程序：先空跑一会儿 */
  var lives={},gframe=0,DBG={nolive:false,noui:false};SP.flowBold=1.9;
  [['flow',1440,900,47,200,false],['bricks',640,400,53,40,true],['clock',640,400,54,1,true],['orbit',640,400,55,90,true]].forEach(function(d){
    var lv,tx,k;
    if(d[0]==='flow'&&Q.mobile){
      /* 手机上那件流场大作品直接用显卡画进贴图，不经过画布（每帧往显卡传一张 1440×900 的画布，手机会掉帧） */
      lv=SP.flowGL(core,d[1],d[2]);for(k=0;k<d[4];k++)lv.tick(k/30);
      lives[d[0]]={lv:lv,tex:lv.texture,cell:d[3],gl:true};return;
    }
    lv=SP.live(d[0],d[1],d[2]);for(k=0;k<d[4];k++)lv.tick(k/30);
    tx=new T.CanvasTexture(lv.canvas);tx.minFilter=d[5]?T.LinearMipmapLinearFilter:T.LinearFilter;tx.magFilter=T.LinearFilter;tx.generateMipmaps=d[5];
    lives[d[0]]={lv:lv,tex:tx,cell:d[3]};
  });

  var hall=SP.createHall(core),works=SP.createWorks(core,hall,{imgs:imgs,lives:lives}),R=hall.rooms,NW=works.pieces.length;
  cam.rotation.order='YXZ';

  /* 名字只有一个出处：展廊里的展签。名片正反两面跟着它；名片上写的作品数就是展廊里挂着的件数 */
  LC.PROFILE.name=LC.CFG.OWNER.name=R[0].name;LC.PROFILE.no=R[0].no;LC.CFG.OWNER.latin='';
  LC.CFG.OWNER.line='作品，让你被看见';LC.PROFILE.stats[0][0]=String(NW);
  try{world=LC.createWorld(cvB);dots=FX.createDots(cvC);}catch(e){console.error(e);return fail();}
  world.setBack(portrait,LC.QR||null);
  var TT=world.TT;
  var elCount=$('count'),elHome=$('home'),elCtaT=$('ctaT'),elFlip=$('flip');
  var elMid=stage.querySelector('.mid');

  /* ---------- 两个版本各自的节点（秒） ----------
     GP：展廊自己的钟走到这儿，像素点接手（镜头不再抬头，走到第三间尽头就碎）。
     接手之前的 MOSD 秒里，画面自己一级一级变成马赛克：每 0.09 秒格子大一倍，镜头照常往前走，最后一级正好是像素点用的那套格子。
     接手以后一段"碎成点再收拢"一共 3.2 秒：方块缩成点，散开，1.3 秒起收拢，2.65 秒以后点淡掉、交给真的名片 */
  var GP=9.30,MOSD=0.36,GD=GP/GR,GM=GP-MOSD*GR,TM;   /* GD：展廊那一段实际放多久；GM：展廊的钟走到这儿，画面开始变马赛克 */
  if(VAR==='A'){
    /* tp 像素点接手；tb0 名片的钟从这儿开始走（点开始往名片上收拢的时候）；home 首页的字出来；flip 演示翻面的起止（只翻一次：从正面翻到背面，然后就停在背面）；end 时间线到这儿为止，之后画面留着、可以互动 */
    TM={tp:GD,tb0:GD+1.25};TM.home=TM.tb0+TT.home;TM.flip=[TM.home+1.0,TM.home+1.85];TM.end=TM.home+2.15;
  }else{
    /* td 镜头朝橱窗冲进去的起止；tw 冲到窗前、像素点接手往外飞的那一刻；tgo 展廊的钟从总时间的哪一秒开始走；tp 展厅那一头像素点接手 */
    TM={td:[5.2,6.9],tw:6.9,tgo:6.55};TM.tp=TM.tgo+GD;TM.home=TM.tp+2.7;TM.flip=[TM.home+1.0,TM.home+1.85];TM.end=TM.home+2.15;
  }
  TM.end=TM.tb0+TT.end;TM.flip=[1e6,1e6+1];var END=TM.end,DIVE_TC=5.3;       /* B 版冲进橱窗的时候，名片的钟停在 5.3（城亮着，还没开始收） */
  /* 冲进橱窗的进度：起步慢，中段最快，到窗前还带着速度（每走完一遍的 0.68 倍），不是刹住 */
  var DIVE_OUT=0.68,MOS=[1,1],V0=0;
  function diveK(t){var k=U.seg(t,TM.td[0],TM.td[1]);return k*k*((3-DIVE_OUT)+(DIVE_OUT-2)*k);}
  /* 离像素点接手还有 left 秒时，画面该是哪一级马赛克：[横向多少格, 纵向多少格]；还没到或者已经接手了，返回 null */
  function mosAt(left){
    if(left>MOSD||left<=0)return null;
    var lv=8>>Math.min(3,Math.floor((MOSD-left)/(MOSD/4))),gd=dots.grid();MOS[0]=gd.cols*lv;MOS[1]=gd.rows*lv;return MOS;
  }
  /* 展廊那一头接手的那一刻，尽头那面墙在画面上每秒放大多少（镜头还在往前走） */
  var V0G=(travel(GP)-travel(GP-0.01))/0.01*GR/Math.max(1,R[2].s1-travel(GP));

  /* 这一刻三块画布各放什么。g 展廊的钟（-1 不画），gm 展廊要不要变成马赛克，aVis 展廊看不看得见；
     w 名片的世界怎么画（null 不画），bOp 它的不透明度；dot 像素点放哪一段、放到第几秒 */
  var S={g:-1,gm:null,aVis:false,w:null,bOp:0,dot:null,dotT:0,inter:false,demo:0};
  var WP={tc:0,dt:0,clock:0,appear:1,thumbs:1,dive:0,inter:false,demo:0,still:1};
  function sched(tt){
    var tau=tt-TM.tp;S.w=null;S.dot=null;S.g=-1;S.gm=null;S.aVis=false;S.bOp=0;
    WP.appear=1;WP.thumbs=1;WP.dive=0;WP.still=1;WP.mos=null;
    if(VAR==='A'){
      if(tt<TM.tp){S.g=tt*GR;S.gm=mosAt(TM.tp-tt);S.aVis=true;}
      else{
        /* 像素点接手的那一帧起，底下换成名片的世界：一开始是全黑的，跟着像素点落下来一点点显出来 */
        S.w=WP;WP.tc=Math.max(0,tt-TM.tb0);WP.appear=ss(U.seg(WP.tc,0.15,1.25));WP.still=ss(U.seg(WP.tc,1.9,2.7));S.bOp=1;
      }
    }else{
      var tw=tt-TM.tw;
      if(tt<TM.tw){
        /* 开头：灯城的动画，然后朝橱窗冲进去。快到窗前时画面一级一级变成马赛克，到窗前那一刻交给像素点接着往外飞 */
        S.w=WP;WP.tc=Math.min(tt,DIVE_TC);WP.dive=diveK(tt);WP.mos=mosAt(TM.tw-tt);S.bOp=1;
      }else if(tt<TM.tp){S.g=(tt-TM.tgo)*GR;S.gm=mosAt(TM.tp-tt);S.aVis=true;}
      else{
        /* 结尾：名片直接是收好的样子，跟着像素点落下来一点点显出来 */
        S.w=WP;WP.tc=TT.end;WP.appear=ss(U.seg(tau,1.5,2.7));WP.thumbs=ss(U.seg(tau,1.9,3.0));WP.still=ss(U.seg(tau,3.1,3.9));S.bOp=1;
      }
      if(tw>=0&&tw<FX.DOT_T.warp){S.dot='warp';S.dotT=tw;}
    }
    if(tau>=0&&tau<FX.DOT_T.form){S.dot='form';S.dotT=tau;}
    S.inter=false;
    S.demo=PI*U.eio(U.seg(tt,TM.flip[0],TM.flip[1]));
    return S;
  }

  /* 系统开了"减少动态效果"就直接停在最后一帧；地址后面加 ?reduce=1 可以手动试这条路 */
  var reduce=(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)||/[?&]reduce=1/.test(location.search);
  var tt=reduce?END:0,playing=!reduce,last=performance.now(),clock=8,mov=playing?1:0;
  var ptr={x:0,y:0,nx:0,ny:0,inside:false},pxs=0,pys=0,lastCnt='',lastCta='',lastFlip='';
  stage.classList.toggle('lite',Q.mobile);

  /* 这块画面有多"竖"。比 3:4 更窄是 1（完全用竖屏那套转头的轨道），接近正方形时在两套之间平滑过渡，横着的画面是 0 */
  function kPortrait(){var s=core.size();return 1-U.seg(s.w/s.h,0.75,0.95);}

  /* 展廊这一块：推轨、灯、作品醒过来，都和《一镜到底的展廊》一样。只有结尾不同：镜头不抬头、不穿天花板，走到第三间尽头就停 */
  function gallery(tg,mos){
    var s=core.size(),asp=s.w/s.h,k;
    var sc=travel(tg),front=frontOf(sc);
    /* 快到头的时候不再跟着指针晃：碎成点的那一帧是事先拍好的，要和眼前这一帧对得上 */
    var par=1-ss(U.seg(tg,8.3,8.9));
    var kp=kPortrait();
    var pitch=-pys*1.4*par+trackAt(CAMP.pitch,sc)*kp,y=1.62+0.014*Math.sin(tg*2.2),x=0.035*Math.sin(tg*1.1+0.6),z=-sc;
    var yaw=U.lerp(yawAt(sc),trackAt(CAMP.yaw,sc),kp)+pxs*2.2*par,roll=0.28*Math.sin(tg*1.3);
    var fov=Math.max(55,Math.min(U.lerp(84,CAMP.fovMax,kp),2*Math.atan(Math.tan(26*D)/asp)/D));
    cam.fov=fov;cam.near=0.12;cam.far=480;cam.updateProjectionMatrix();
    cam.position.set(x,y,z);cam.rotation.set(pitch*D,-yaw*D,roll*D);
    var doRefl=hall.update({front:front,above:false,cut:0,flat:0,swap:false});
    works.update({front:front,dorm:U.eio(U.seg(tg,0.85,1.5)),beacon:U.eio(U.seg(tg,0.05,1.0)),show:true});
    core.shared.uEdge.value=-1.75;
    /* 真在跑的那几件：桌面上每帧都重画。手机上，用显卡直接画的那件（流场）照样每帧画；
       画在画布上的那几件每一帧只重画其中一件，轮着来 —— 每帧往显卡传的画布最多一张 */
    var act=[],nc=0,ci=0;
    for(k in lives){
      if((k==='flow'&&(sc<13||sc>33))||((k==='bricks'||k==='clock')&&sc>20))continue;
      act.push(lives[k]);if(!lives[k].gl)nc++;
    }
    gframe++;if(DBG.nolive)act.length=0;
    for(k=0;k<act.length;k++){
      if(act[k].gl){act[k].lv.tick(clock);continue;}
      if(Q.live>1&&(ci++)!==gframe%nc)continue;
      act[k].lv.tick(clock);act[k].tex.needsUpdate=true;
    }
    var e=U.seg(tg,1.2,2.0)*(1-U.seg(tg,8.5,9.1))*0.42*mov;
    core.shared.uTime.value=clock;
    if(doRefl)hall.renderRefl([]);
    core.render({trail:Math.min(0.5,e*0.62),ab:e*0.008,grain:0.045,vig:0.36,mos:mos||null});
    return sc;
  }

  /* ---------- 像素点要用的两样东西：碎的是哪一帧，落到哪儿去 ----------
     事先各拍一帧（展廊走到头的那一帧；B 版还有冲到橱窗跟前的那一帧），窗口大小变了就重拍 */
  var clips={form:null,warp:null},prepKey='',needPrep=true,fitKey='',dotsWarm=false;
  function prep(){
    var s=core.size(),key=s.w+'x'+s.h+'|'+fitKey;needPrep=false;if(key===prepKey||s.w<2)return;prepKey=key;
    dots.resize();
    var kx=pxs,ky=pys,km=mov,gd=dots.grid(),gm=[gd.cols,gd.rows];pxs=pys=0;mov=0;core.resetTrail();
    gallery(GP,gm);
    if(clips.form)clips.form.dispose();
    clips.form=dots.clip(dots.sample(cvA),function(n){return world.targets(VAR==='A'?0.6:TT.end,VAR==='B',n,dots.px());});
    if(VAR==='B'){
      /* 冲到窗前的那一帧，已经是马赛克了；顺便量一下那一刻画面放大得有多快，像素点照这个速度接着走 */
      world.frame({tc:DIVE_TC,dt:1/60,clock:clock,appear:1,thumbs:1,dive:1,inter:false,demo:0,still:0,mos:gm});
      if(clips.warp)clips.warp.dispose();
      clips.warp=dots.clip(dots.sample(cvB),null);
      V0=world.diveRate(DIVE_TC,DIVE_OUT/(TM.td[1]-TM.td[0]));
    }
    pxs=kx;pys=ky;mov=km;core.resetTrail();
    /* 像素点第一次画出来之前，先偷偷画一遍：着色器和几万个点的数据提前交给显卡，接手的那一帧就不卡 */
    if(!dotsWarm){dotsWarm=true;dots.draw(clips.form,'form',1.0,0);if(clips.warp)dots.draw(clips.warp,'warp',0.5,0);dots.hide();}
  }
  /* 竖屏：名片最后停在哪、停多大，看页面上的字实际占了多少地方 —— 页面的上边距，到首页那段字的上沿，中间这一段留给名片（底下再留一行给楼名）。
     起楼的那一段画面上没有别的字，名片就放在右下角那行按钮以上的正中 */
  function fit(){
    var mid=elMid.offsetTop,k=world.fitPortrait(mid+10,mid+elHome.offsetTop-36,mid+elMid.offsetHeight/2);
    if(k!==fitKey){fitKey=k;needPrep=true;}
  }
  /* 画面大小真的变了才重来（窗口事件之外，再盯着舞台本身的大小：嵌在别的页面里时，窗口不一定会通知） */
  var lastSize='';
  function resize(){
    var k=stage.clientWidth+'x'+stage.clientHeight+'@'+(window.devicePixelRatio||1);if(k===lastSize)return;lastSize=k;
    Q.apply();core.resize();hall.resize();world.resize();dots.resize();fit();needPrep=true;
  }
  /* 画质档位变了（开机试画以后，或者放的过程里降档）：只换画布的像素数，事先拍好的帧不用重拍 */
  function applyScale(){core.resize();hall.resize();world.resize();dots.resize();}
  resize();
  /* 开机时就把展廊所有着色器编译好、所有贴图传上显卡，免得走到第二间时才第一次用到而卡一下 */
  (function warm(){
    core.scene.traverse(function(o){
      var ms=o.material?(Array.isArray(o.material)?o.material:[o.material]):[],i,k,v;
      for(i=0;i<ms.length;i++){
        if(ms[i].map)core.renderer.initTexture(ms[i].map);
        for(k in (ms[i].uniforms||{})){v=ms[i].uniforms[k].value;if(v&&v.isTexture&&v.image)core.renderer.initTexture(v);}
      }
    });
    try{core.renderer.compile(core.scene,cam);}catch(e){}
  })();
  /* 光编好还不够：手机上一样东西第一次真的被画出来的那一帧，显卡还要现建管线、现传网格，会卡几十到一百多毫秒。
     所以开机时关掉视锥裁剪，把三间展厅里每一样东西都真的画一遍（主画面、地面倒影、马赛克），名片那个世界也一样（world.warm） */
  function warmAll(){
    var kx=pxs,ky=pys,km=mov,flags=[],i=0;pxs=pys=0;mov=1;
    core.scene.traverse(function(o){flags.push(o.frustumCulled);o.frustumCulled=false;});
    gallery(2.4,null);gallery(5.6,null);gallery(8.2,[24,24]);
    core.scene.traverse(function(o){o.frustumCulled=flags[i++];});
    world.warm(clock);
    pxs=kx;pys=ky;mov=km;core.resetTrail();
  }
  /* 手机：按现在定的倍数各试画几帧，量一量一帧要多久（等显卡真的画完才算）。超过 12 毫秒（一帧一共只有 16.7 毫秒）就降到画得动的那一档 */
  function timeFrames(fn,gl,log){
    var px=new Uint8Array(4),k,r,a,base,ms,best=1e9;
    function sync(){gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);}
    fn();sync();fn();sync();
    a=performance.now();for(k=0;k<4;k++)sync();base=(performance.now()-a)/4;      /* 光是"等显卡"这个动作本身要多久，要减掉 */
    /* 连着量五组、每组三帧，取最快的一组：头几帧显卡还没提上速，量出来偏慢 */
    for(r=0;r<5;r++){a=performance.now();for(k=0;k<3;k++){fn();sync();}ms=(performance.now()-a)/3;best=Math.min(best,ms);if(log)log.push(+ms.toFixed(1));}
    return Math.max(0,best-base);
  }
  function calibrate(apply){
    if(!Q.mobile)return;
    var kx=pxs,ky=pys,km=mov,g0=Q.g,c0=Q.c,msG,msC,ch,lg=[],lc=[];pxs=pys=0;mov=1;
    try{
      msG=timeFrames(function(){gallery(5.6,null);},core.renderer.getContext(),lg);
      msC=timeFrames(function(){world.frame({tc:4.9,dt:1/60,clock:clock,appear:1,thumbs:1,dive:0,inter:false,demo:0,still:0});},world.core.renderer.getContext(),lc);
      Q.bench={g:[g0,+msG.toFixed(1)],c:[c0,+msC.toFixed(1)],lg:lg,lc:lc};
      if(apply!==false){ch=Q.fit('g',msG,12);ch=Q.fit('c',msC,12)||ch;if(ch)applyScale();}
    }catch(e){console.error(e);}
    pxs=kx;pys=ky;mov=km;core.resetTrail();world.reset();
    return Q.bench;
  }

  /* ---------- 页面上的字 ---------- */
  var elLabel=$('label'),elLabDiv=elLabel.querySelector('div'),elLabB=elLabel.querySelector('b'),elLabS=elLabel.querySelector('span');

  /* 楼名标签：换一栋时先淡出再出现；桌面上夹在画面里 */
  var lab={},labShown=-1,labAt=-9,labW=0,labH=0;
  function label(){
    var o=world.label(lab),li=o?o.i:-1,s=core.size(),x,y;
    if(li!==labShown){
      if(labShown>=0&&elLabel.classList.contains('on')){elLabel.classList.remove('on');labAt=clock;return;}
      if(clock-labAt<0.1)return;
      labShown=li;
      if(o){
        elLabel.classList.toggle('line',o.portrait);elLabB.textContent=o.w.zh;elLabS.textContent=o.portrait?'·  '+o.w.note:o.w.en+'  ·  '+o.w.note;
        var r=elLabDiv.getBoundingClientRect();labW=r.width;labH=r.height;
      }
    }
    if(!o){elLabel.classList.remove('on');return;}
    if(o.portrait){x=elHome.getBoundingClientRect().left-stage.getBoundingClientRect().left;y=o.y;}
    else{x=Math.max(labW/2+12,Math.min(s.w-labW/2-12,o.x));y=Math.max(labH+40,o.y);}
    elLabel.style.transform='translate('+x.toFixed(1)+'px,'+y.toFixed(1)+'px)';elLabel.classList.add('on');
  }

  function ui(){
    var ws=world.state(),tg=(VAR==='A'?tt:tt-TM.tgo)*GR,inG=S.aVis&&S.bOp<0.5;   /* tg：展廊自己的钟 */
    /* 开头的计数：A 版跟着展廊的黑暗数到 100，B 版跟着街道刻线亮完数到 100 */
    var ld=VAR==='A'?U.seg(tg,0,1.12):U.seg(tt,0,1.45),cnt=('00'+Math.round(U.eio(ld)*100)).slice(-3);if(cnt!==lastCnt){lastCnt=cnt;elCount.textContent=cnt;}
    elCount.classList.toggle('on',VAR==='A'?tg<1.3:tt<1.6);
    /* 右下角两个按钮的颜色跟着它们身后的地面：展厅里地面亮的时候用墨，暗的时候和夜里用骨白。
       地面什么时候由暗变亮（开灯）、什么时候由亮变暗（镜头走到第三间的黑地面上），是在画面上量出来的：
       横屏 1.7 和 6.8；竖屏的镜头转得更开、看得更近，都要早一点（1.56 和 6.6） */
    var kp=kPortrait(),tLit=U.lerp(1.7,1.56,kp),tDark=U.lerp(6.8,6.6,kp);
    stage.classList.toggle('bot-ink',inG&&tg>=tLit&&tg<tDark);
    elHome.classList.toggle('on',tt>=TM.home);
    var ct=ws.city?'收回名片':'进城逛逛';if(ct!==lastCta){lastCta=ct;elCtaT.textContent=ct;}
    var ft=ws.back?'翻回正面':'翻到背面';if(ft!==lastFlip){lastFlip=ft;elFlip.textContent=ft;}
    label();
    var over=S.inter&&ptr.inside&&world.overCard(ptr.nx,-ptr.ny);
    cvB.style.cursor=ws.dragging?'grabbing':(ws.hover>=0?'pointer':(over?'grab':''));
  }

  var visA=null,opB=-1;
  function update(dt){
    if(needPrep)prep();
    pxs+=(ptr.nx-pxs)*Math.min(1,dt*3);pys+=(ptr.ny-pys)*Math.min(1,dt*3);
    mov+=((playing?1:0)-mov)*Math.min(1,dt*6);
    sched(tt);
    if(S.g>=0)gallery(S.g,S.gm);
    /* 名片还一点没显出来的那一段（像素点正在上面散开），底下就是一片背景色，不走整套渲染 */
    if(S.w){WP.dt=dt;WP.clock=clock;WP.inter=S.inter;WP.demo=S.demo;if(WP.appear<=0.0005&&!S.inter)world.blank();else world.frame(WP);}
    if(S.dot)dots.draw(clips[S.dot],S.dot,S.dotT,S.dot==='warp'?V0:V0G);else dots.hide();
    if(S.aVis!==visA){visA=S.aVis;cvA.style.visibility=visA?'visible':'hidden';}
    var ob=S.bOp<0.004?0:S.bOp>0.996?1:+S.bOp.toFixed(3);
    if(ob!==opB){opB=ob;cvB.style.opacity=ob;cvB.style.visibility=ob?'visible':'hidden';cvB.style.pointerEvents=ob>0.5?'auto':'none';}
    if(!DBG.noui)ui();
  }

  /* 手机：放的过程里盯着帧间隔。最近 30 帧里有 12 帧超过 22.5 毫秒，正在画的那一块就降一档（每块只降一次）。像素点过场的那几秒不算 */
  var gov={n:0,slow:0,cool:1};
  function govern(raw){
    if(!Q.mobile)return;
    if(raw>0.25||S.dot||!playing){gov.n=gov.slow=0;return;}
    if(gov.cool>0){gov.cool-=raw;return;}
    gov.n++;if(raw>0.0225)gov.slow++;
    if(gov.n<30)return;
    var which=S.g>=0?'g':(S.w?'c':null);
    if(gov.slow>=12&&which&&Q.drop(which)){applyScale();gov.cool=1.5;}
    gov.n=gov.slow=0;
  }
  /* 开头先原地放几帧，时间不走：浏览器第一次把这几块画布和页面上的字送上屏幕，要多花几十毫秒，等它缓过来（连着三帧都正常）再开始。
     这几帧里三块画布都露一次面 —— 还没轮到的那块在底下，或者几乎全透明，看不出来 —— 以后切换画布的那一帧就不用现准备 */
  var settled=!playing,settleN=0,calm=0;var seq=window.OpeningSequence;
  function settle(raw){
    settleN++;calm=raw<0.022?calm+1:0;
    if(VAR==='A')world.blank();else gallery(0,null);
    cvA.style.visibility='visible';cvB.style.visibility='visible';cvB.style.opacity=VAR==='A'?0.01:1;dots.prime(true);
    if((settleN>=6&&calm>=3)||settleN>=24){settled=true;visA=null;opB=-1;dots.prime(false);last=performance.now();}
  }
  function frame(now){
    var raw=(now-last)/1000,dt=Math.min(0.05,Math.max(0.001,raw));last=now;if(!seq.paused)clock+=dt;
    if(settled){
      if(!seq.ready){seq.ready=true;seq.report('ready');}
      if(!seq.paused&&document.visibilityState==='visible')seq.elapsed=Math.min(seq.duration,seq.elapsed+Math.min(0.1,Math.max(0,raw)));
      tt=seq.sourceAt(seq.elapsed);playing=!seq.paused;
    }
    update(dt);
    if(!settled)settle(raw);else govern(raw);
    seq.report('progress');
    if(settled&&!seq.paused&&seq.elapsed>=seq.duration){seq.report('complete');return;}
    requestAnimationFrame(frame);
  }
  var btnPause=$('pause');
  function setPause(){btnPause.textContent=playing?'暂停':'继续';}
  function jump(t){tt=t;playing=true;core.resetTrail();world.reset();setPause();}
  btnPause.addEventListener('click',function(){playing=!playing;if(playing&&tt>=END)jump(0);setPause();});
  $('replay').addEventListener('click',function(){jump(0);});
  window.addEventListener('keydown',function(ev){if(ev.code==='Space'&&ev.target===document.body){ev.preventDefault();btnPause.click();}});
  $('cta').addEventListener('click',function(){world.toggleCity();});
  elFlip.addEventListener('click',function(){world.toggleFlip();});

  /* 指针：展廊里只带一点视差；名片上能悬停、点、拖着翻面 */
  function at(ev,cv){var r=cv.getBoundingClientRect();ptr.x=ev.clientX-r.left;ptr.y=ev.clientY-r.top;ptr.nx=ptr.x/r.width*2-1;ptr.ny=ptr.y/r.height*2-1;return r;}
  cvA.addEventListener('pointermove',function(ev){at(ev,cvA);ptr.inside=true;});
  cvA.addEventListener('pointerleave',function(){ptr.inside=false;ptr.nx=0;ptr.ny=0;});
  cvB.addEventListener('pointermove',function(ev){at(ev,cvB);if(ev.pointerType!=='touch')ptr.inside=true;world.move(ptr.nx,-ptr.ny,ptr.x,ev.pointerType);});
  cvB.addEventListener('pointerdown',function(ev){var r=at(ev,cvB);if(world.down(ptr.nx,-ptr.ny,ptr.x,r.width,ev.pointerType)){try{cvB.setPointerCapture(ev.pointerId);}catch(e){}}});
  cvB.addEventListener('pointerup',function(ev){at(ev,cvB);world.up(ptr.nx,-ptr.ny,ev.pointerType);});
  cvB.addEventListener('pointercancel',function(ev){world.up(ptr.nx,-ptr.ny,ev.pointerType);});
  cvB.addEventListener('pointerleave',function(){ptr.inside=false;ptr.nx=0;ptr.ny=0;world.leave();});
  window.addEventListener('resize',resize);
  /* 手机切到后台久了再回来，系统可能已经把这几块画布在显卡上的东西收走，画面会变黑。还回来的时候整页重载一次（只重载一次，免得来回折腾） */
  [cvA,cvB,cvC].forEach(function(c){
    c.addEventListener('webglcontextlost',function(ev){ev.preventDefault();seq.fail('webgl-context-lost');});
    c.addEventListener('webglcontextrestored',function(){
      var nav=(performance.getEntriesByType&&performance.getEntriesByType('navigation')[0])||{};
      if(nav.type!=='reload')try{location.reload();}catch(e){}
    });
  });
  /* 首页那段字的大小变了（字体晚到、换行变了），竖屏上名片的位置要跟着重算 */
  if(window.ResizeObserver)try{new ResizeObserver(resize).observe(stage);new ResizeObserver(fit).observe(elHome);}catch(e){}

  /* 开机：每样东西先真的画一遍；手机上再试画几帧定下画质档位；最后把像素点要用的那几帧拍好 */
  warmAll();calibrate();prep();
  setPause();requestAnimationFrame(function(now){last=now;frame(now);});
}

/* 字体、展廊的五张作品图、名片上的九张作品图、人像都到了再开机，最多等三秒 */
var GLYPHS='阿成老白柚子陈墨十三岛南风树鹿鸣一苇青柠大橘木汤圆夏至北可七月福麦冬禾川水山饭团秋豆半沙龙式挂法二六九件挤两面墙只占尽头的排成整齐网格字开对作品号厅常设每都能直接玩 0123456789';
var CARDTXT=LC.backGlyphs()+LC.CFG.OWNER.name+LC.CFG.OWNER.line+LC.CFG.WORKS.map(function(w){return w.zh+w.note;}).join('')+'件作品收成一张名片栋小楼立起来每都能推门进去玩就是你的刚才逛过在这卡里座城翻自己到背面回正亮着灯';
var fams=['900 64px "Big Shoulders Display"','italic 400 64px "Instrument Serif"','500 12px "JetBrains Mono"','400 12px "JetBrains Mono"','900 40px "Noto Serif SC"','600 40px "Noto Serif SC"','300 40px "Noto Sans SC"','400 40px "Noto Sans SC"','400 20px "Jost"'];
var imgs=[null,null,null,null,null],portrait=null,waiting=2,started=false;
function go(){if(!started){started=true;boot(imgs,portrait);}}
function one(){if(--waiting<=0)go();}
var left=6+LC.CFG.WORKS.length;
function got(){if(--left===0)one();}
['plum','loop','salt-run','quill','tofu'].forEach(function(n,i){var im=new Image();im.onload=function(){imgs[i]=im;got();};im.onerror=got;im.src='img/'+n+'.jpg';});
(function(){var im=new Image();im.onload=function(){portrait=im;got();};im.onerror=got;im.src='img/portrait.jpg';})();
LC.WORKIMGS={};
LC.CFG.WORKS.forEach(function(w){var im=new Image();im.onload=function(){LC.WORKIMGS[w.id]=im;got();};im.onerror=got;im.src='works/'+w.id+'.jpg';});
if(document.fonts&&document.fonts.load)Promise.all(fams.map(function(f){return document.fonts.load(f,'ORBIT HALL N° A CHENG CREATOR CARD “” '+GLYPHS+CARDTXT);})).then(one,one);else one();
setTimeout(go,3000);
})();
