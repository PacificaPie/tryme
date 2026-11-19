/* 画质：这台设备上每一块画面按多少倍像素来画。
   桌面（有鼠标）：和以前一模一样 —— 展廊最多 1.75 倍，名片最多 2 倍加四倍多重采样和移轴虚化，像素点最多 2 倍。
   手机和平板（只有触屏）：先按屏幕自己的像素密度画（最多 3 倍），字和线才是清楚的；
   开机时每块画面试画几帧、量一量要多久（main.js 里的 calibrate），画不动就降到画得动的那一档；
   放的过程里要是还连着掉帧，再降一档，每块只降一次。
   地址后面加 ?q=mobile 或 ?q=desktop 可以强行指定（本地验证用）。 */
(function(){
'use strict';
var FV=window.FV=window.FV||{};
function mm(q){try{return !!(window.matchMedia&&window.matchMedia(q).matches);}catch(e){return false;}}
var force=/[?&]q=(mobile|desktop)\b/.exec(location.search||'');
var mobile=force?force[1]==='mobile':mm('(hover: none) and (pointer: coarse)');
var TIERS=[3,2.75,2.5,2.25,2,1.75,1.5];
var Q=FV.Q={
  mobile:mobile,
  g:1,c:1,d:1,            /* 展廊、名片、像素点各自的倍数：一个 CSS 像素画成几个设备像素 */
  msaa:true,              /* 名片那一块要不要多重采样（3 倍时像素已经够密，不用，也省显存） */
  tilt:true,              /* 名片那一块要不要移轴虚化（手机屏幕小，虚化只会显得糊，不用） */
  live:1,                 /* 展廊里真在跑的那几件作品，每几帧重画一次 */
  capG:9,capC:9,          /* 量出来（或者掉帧以后）定下的上限 */
  drops:{g:0,c:0},bench:null,
  /* 按现在的像素密度和上限，定下各块的倍数。窗口挪到别的屏幕、手机转向以后要重新调一次 */
  apply:function(){
    var dpr=window.devicePixelRatio||1;
    if(!mobile){Q.g=Math.min(dpr,1.75);Q.c=Math.min(dpr,2);Q.d=Math.min(dpr,2);Q.msaa=true;Q.tilt=true;Q.live=1;return;}
    Q.g=Math.min(dpr,3,Q.capG);Q.c=Math.min(dpr,3,Q.capC);Q.d=Math.min(dpr,3);
    Q.msaa=Q.c<=2.01;Q.tilt=false;Q.live=2;
  },
  /* 不超过 v 的最大一档 */
  snap:function(v){for(var i=0;i<TIERS.length;i++)if(TIERS[i]<=v+0.001)return TIERS[i];return TIERS[TIERS.length-1];},
  /* which（'g' 展廊 / 'c' 名片）这一块按现在的倍数画一帧要 ms 毫秒。超出预算，就按像素数折算，降到画得动的那一档。返回有没有变 */
  fit:function(which,ms,budget){
    var cur=Q[which];if(!mobile||!(ms>budget))return false;
    var want=Q.snap(cur*Math.sqrt(budget/ms));if(want>=cur)want=Q.snap(cur-0.01);
    if(want>=cur)return false;
    if(which==='g')Q.capG=want;else Q.capC=want;Q.apply();return true;
  },
  /* 放的过程里连着掉帧：这一块降一档。每块只降一次 —— 也可能不是画不动，而是系统把帧率压低了（省电模式），那样再降也没用 */
  drop:function(which){
    if(!mobile||Q.drops[which]>=1)return false;
    var cur=Q[which],want=Q.snap(cur-0.01);if(want>=cur)return false;
    Q.drops[which]++;if(which==='g')Q.capG=want;else Q.capC=want;Q.apply();return true;
  }
};
Q.apply();
})();
