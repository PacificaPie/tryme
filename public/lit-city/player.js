/* Adapted from the user-supplied 灯城名片 scene. Data, lifecycle and UI are owned by TryMe. */
(function(){
'use strict';var SP=window.SP;
SP.createCityPlayer=function(canvas,onSelect,onHover){
var U=SP.u,C=SP.CFG,TM=C.T,END=TM.end,T=THREE;
var core=SP.createCore(canvas),scene=SP.createScene(core),cam=SP.createCam(core),heroes=scene.heroes,N=heroes.length;
var reduce=matchMedia('(prefers-reduced-motion: reduce)'),tt=END,playing=false,last=0,clock=0,raf=0,disposed=false,paused=false,until=0;
function arr(v){return Array(N).fill(v);}function approach(a,b,step){return a<b?Math.min(b,a+step):Math.max(b,a-step);}
var st={rise:arr(0),hinge:arr(1),on:arr(0),glow:arr(0),lampOn:arr(0),fill:0,fillDown:0,city:0,winOn:0,load:0,attached:true,nameA:0,floorA:1,traceA:.4,padA:.4,tram:{x:0,k:0,light:1}};
var pop=arr(0),hov=arr(0),pinned=arr(false),city=false,cityAt=0,cityOffAt=-99,cityK=0,popMax=0,hoverIdx=-1;
function isCard(){return tt>=TM.home;}
  function compute(dt){
    var i,h,g0,f0,q,card=isCard();
    st.load=U.seg(tt,TM.load[0],TM.load[1])+0.45*U.seg(tt,TM.load[1],TM.load[1]+0.6);
    st.attached=tt<TM.walk[1];
    cityK=approach(cityK,city&&card?1:0,dt/(city?1.3:0.7));popMax=0;
    for(i=0;i<N;i++){
      h=heroes[i];g0=TM.growStart+TM.growAt[h.rank];f0=TM.foldStart+h.rank*TM.foldGap;
      hov[i]=approach(hov[i],i===hoverIdx?1:0,dt/0.2);
      /* 整座城：进城时九栋按次序起，收回时倒着一栋栋收 */
      var want=card&&(i===hoverIdx||pinned[i]||(city?clock-cityAt>h.rank*0.08:clock-cityOffAt<(N-1-h.rank)*0.07));
      pop[i]=approach(pop[i],want?1:0,dt/(want?0.85:0.8));popMax=Math.max(popMax,pop[i]);
      if(st.attached){st.rise[i]=U.back(U.seg(tt,g0,g0+TM.growDur),1.25);st.hinge[i]=1;}
      else{
        /* 收拢：q 是这栋楼收到哪了（匀速）。沉、落、躺三步各自缓起缓停：
           前 56% 楼带着窗沉下去，窗落到名片上立住；后 50% 窗往后一躺，成为名片上的一块小图 */
        q=U.seg(tt,f0,f0+TM.foldDur);
        /* 悬停那一路反过来：窗先立起来（0–0.3），楼再从它身后顶上来（0.3–1）；起和落用同一条对称的缓动 */
        st.rise[i]=Math.max(1-U.eio(U.seg(q,0,0.56)),U.eio(U.seg(pop[i],0.3,1)));
        st.hinge[i]=Math.max(1-U.eio(U.seg(q,0.50,1)),U.eio(U.seg(pop[i],0,0.3)));
      }
      /* 楼顶到位的那一刻（回弹曲线走到 45% 时）窗开始亮 */
      st.on[i]=U.eo(U.seg(tt,g0+TM.growDur*0.45,g0+TM.growDur*0.45+TM.lightDur));
      st.glow[i]=hov[i];
    }
    st.fill=U.eio(U.seg(tt,TM.fill[0],TM.fill[1]));st.fillDown=U.seg(tt,TM.fillDown[0],TM.fillDown[1]);st.city=U.c01(cityK*1.3-0.3);   /* 进城时配楼比主楼晚 0.3 秒起 */
    st.winOn=Math.max(U.seg(tt,2.6,4.6)*(1-U.seg(tt,TM.winOff[0],TM.winOff[1])),cityK);
    for(i=0;i<7;i++){var t0=U.lerp(TM.lamps[0],TM.lamps[1],i/6);st.lampOn[i]=Math.max(U.eio(U.seg(tt,t0,t0+0.35))*(1-U.seg(tt,TM.lampsOff[0],TM.lampsOff[1])),U.seg(cityK,0.6,1));}
    if(cityK>0.01){var x=((clock*0.9)%10.6)-5.3;st.tram.x=x;st.tram.k=U.seg(cityK,0.7,1)*U.seg(5.3-Math.abs(x),0,0.6);}
    else{var TR=C.TRAM;st.tram.x=TR.x0+TR.v*(tt-TR.t0);st.tram.k=U.eio(U.seg(tt,TR.show[0],TR.show[1]))*(1-U.eio(U.seg(tt,TR.hide[0],TR.hide[1])));}
    st.traceA=U.lerp(U.lerp(0.44,C.LINE.trace,U.seg(tt,1.6,3.2)),C.LINE.traceCard,U.seg(tt,9.4,10.8));
    /* 九块地基在长楼之前一起亮一下：先交代“这里要长东西了” */
    st.padA=U.lerp(U.lerp(0.44,C.LINE.pad,U.seg(tt,1.6,3.2)),C.LINE.padCard,U.seg(tt,9.4,10.8))+0.4*Math.sin(Math.PI*U.seg(tt,1.5,1.75));
    st.nameA=Math.max(C.LINE.nameDim,U.eio(U.seg(tt,TM.name[0],TM.name[1]))*0.92);
    st.floorA=1-U.eio(U.seg(tt,TM.lift[0],TM.lift[0]+1.3));
  }


function draw(dt){var s=core.size(),cs=cam.at(tt,s.w/s.h,{x:0,y:0},{city:U.eio(cityK),hov:U.eio(popMax)});core.shared.uTime.value=clock;compute(dt);st.nameA=0;scene.update(st);core.render({tilt:0,focus:cs.focus});}
function request(){if(!disposed&&!paused&&!document.hidden&&!raf)raf=requestAnimationFrame(frame);}
function wake(){until=performance.now()+1800;request();}
function frame(now){raf=0;if(disposed||paused||document.hidden)return;var dt=last?Math.min(.05,(now-last)/1000):1/60;last=now;clock+=dt;if(playing){tt=Math.min(END,tt+dt);playing=tt<END;}if(reduce.matches){dt=2;tt=END;playing=false;}draw(dt);if(playing||(!reduce.matches&&(city||now<until)))request();else last=0;}
function hit(e){var r=canvas.getBoundingClientRect(),ray=new T.Raycaster();core.camera.updateMatrixWorld(true);ray.setFromCamera(new T.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2),core.camera);return scene.pick(ray.ray,st.rise,e.pointerType==='touch'?.2:0);}
function move(e){if(e.pointerType==='touch'||playing)return;var i=hit(e);if(i!==hoverIdx){hoverIdx=i;canvas.style.cursor=i>=0?'pointer':'default';onHover(i);wake();}}
function leave(){hoverIdx=-1;onHover(-1);wake();}
function click(e){if(playing)return;var i=hit(e);if(i>=0)onSelect(i);}
canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerleave',leave);canvas.addEventListener('click',click);
core.onMedia=wake;core.resize();draw(2);wake();
return {setWork:scene.setWork,resize:function(){core.resize();wake();},replay:function(){tt=reduce.matches?END:0;playing=!reduce.matches;city=false;wake();},skip:function(){tt=END;playing=false;wake();},city:function(value){tt=END;playing=false;city=value;if(value)cityAt=clock;else cityOffAt=clock;wake();},pause:function(value){paused=value;if(value){cancelAnimationFrame(raf);raf=0;last=0;}else wake();},focus:function(i){hoverIdx=i;wake();},dispose:function(){disposed=true;cancelAnimationFrame(raf);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerleave',leave);canvas.removeEventListener('click',click);scene.dispose();core.dispose();}};
};})();
