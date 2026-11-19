/* 作品封面：56 格（本方案把词表加到 56 个，贴图集改成 8x7）。原说明：24 张程序生成的海报，拼成一张带留白边的贴图集 */
(function(){
'use strict';
var SP=window.SP=window.SP||{};
var COLS=8,ROWS=7,CW=384,CH=240,G=16,TAU=Math.PI*2;
var INK='#15161A',BONE='#EDE8DC';
var PALS=[[BONE,INK,'#E23A2E'],['#1E3FE0',BONE,'#F4C318'],[INK,BONE,'#FF5B2E'],['#AEB89A',INK,'#FF5B2E'],['#5B34E6',BONE,'#FF8FB1'],['#F4C318',INK,'#E23A2E'],['#FF8FB1',INK,'#1E3FE0'],['#0F5B45',BONE,'#F4C318']];
var WORDS=['ORBIT','TOFU','NOVA','MOSS','PING','KITE','LOOP','DUSK','FIZZ','MUON','SALT','ECHO','PLUM','RIFT','GLYPH','OKAY','BLOOM','TILT','WAVE','ZINE','COMET','PAPER','DRIFT','QUILL','HAZE','PIXL','MINT','ATLAS','SODA','FERN','BYTE','LUNA','KNOT','GUST','OPAL','RUNE','SWIM','TACO','VOLT','YARN','ZEST','BRIM','CUBE','DOVE','EMBER','FLUX','GLOW','HUSH','IRIS','JOLT','KELP','LYNX','MOTH','NOOK','OXEN','PUCK'];
var KIND=['GAME','WEB TOY','SITE','GAME','TOOL','WEB TOY','SITE','GAME'];
var DISP='"Big Shoulders Display","Arial Narrow",Impact,sans-serif';
var SERIF='"Instrument Serif",Georgia,"Times New Roman",serif';
var MONO='"JetBrains Mono",ui-monospace,Menlo,monospace';
function rnd(seed){var s=(seed>>>0)||1;return function(){s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
function pad(n){return (n<10?'0':'')+n;}
function meta(g,c,i,x,y,align){
  g.fillStyle=c;g.font='500 9px '+MONO;g.textBaseline='top';g.textAlign=align||'left';
  g.fillText('N°'+pad(i+1)+'  /  '+KIND[i%8]+'  /  2026',x,y);
}
var L=[
  function(g,p,i){ /* 巨字出血 */
    g.fillStyle=p[1];g.font='900 236px '+DISP;g.textBaseline='alphabetic';g.textAlign='left';
    g.fillText(WORDS[i],-10,222);
    g.fillStyle=p[2];g.beginPath();g.arc(CW-34,34,15,0,TAU);g.fill();
    meta(g,p[1],i,14,13);
  },
  function(g,p,i){ /* 左数字，右斜纹 */
    g.fillStyle=p[1];g.fillRect(0,0,CW*0.44,CH);
    g.save();g.beginPath();g.rect(CW*0.44,0,CW*0.56,CH);g.clip();g.strokeStyle=p[2];g.lineWidth=7;
    for(var k=-10;k<26;k++){g.beginPath();g.moveTo(CW*0.44+k*20,CH);g.lineTo(CW*0.44+k*20+150,0);g.stroke();}
    g.restore();
    g.fillStyle=p[0];g.font='900 168px '+DISP;g.textBaseline='alphabetic';g.textAlign='left';g.fillText(pad(i+1),8,214);
    g.fillStyle=p[0];g.fillRect(CW*0.52,CH-62,CW*0.42,44);
    g.fillStyle=p[1];g.font='900 34px '+DISP;g.fillText(WORDS[i],CW*0.52+10,CH-27);
    meta(g,p[0],i,14,13);
  },
  function(g,p,i){ /* 落日与地平线 */
    var sky=g.createLinearGradient(0,0,0,CH*0.72);sky.addColorStop(0,p[0]);sky.addColorStop(1,p[2]);g.fillStyle=sky;g.fillRect(0,0,CW,CH);
    g.fillStyle=p[1];g.beginPath();g.arc(CW*0.66,CH*0.66,84,0,TAU);g.fill();
    g.fillStyle=p[0];g.fillRect(0,CH*0.7,CW,CH*0.3);
    g.fillStyle=p[1];for(var k=0;k<5;k++){var w=150-k*26;g.fillRect(CW*0.66-w/2,CH*0.74+k*12,w,4+k*0.6);}
    g.fillStyle=p[1];g.font='italic 400 50px '+SERIF;g.textBaseline='top';g.textAlign='left';g.fillText(WORDS[i].charAt(0)+WORDS[i].slice(1).toLowerCase()+' run',14,26);
    meta(g,p[1],i,14,13);
  },
  function(g,p,i,r){ /* 像素小怪 */
    g.fillStyle=p[1];g.fillRect(0,0,CW,CH);
    var s=20,ox=40,oy=44,x,y;
    for(y=0;y<7;y++)for(x=0;x<4;x++){var v=r();if(v<0.56||(y>1&&y<5&&x>1)){g.fillStyle=v<0.16?p[2]:p[0];g.fillRect(ox+x*s,oy+y*s,s-2,s-2);g.fillRect(ox+(6-x)*s,oy+y*s,s-2,s-2);}}
    g.fillStyle=p[1];g.fillRect(ox+2*s,oy+2*s,s-2,s-2);g.fillRect(ox+4*s,oy+2*s,s-2,s-2);
    g.fillStyle=p[0];g.font='900 64px '+DISP;g.textBaseline='alphabetic';g.textAlign='right';g.fillText(WORDS[i],CW-16,CH-52);
    g.fillStyle=p[2];g.font='500 12px '+MONO;g.fillText('SCORE  0'+(420+i*37),CW-16,CH-30);
    g.fillStyle=p[0];g.fillRect(CW-16-120,CH-22,120,2);g.fillStyle=p[2];g.fillRect(CW-16-120,CH-22,72,2);
    meta(g,p[0],i,CW-16,13,'right');
  },
  function(g,p,i){ /* 三行叠字 */
    g.font='900 104px '+DISP;g.textBaseline='alphabetic';g.textAlign='left';
    var w=WORDS[i]+' '+WORDS[i];
    g.fillStyle=p[1];g.fillText(w,10,84);
    g.strokeStyle=p[1];g.lineWidth=2;g.strokeText(w,-60,164);
    g.fillStyle=p[2];g.fillText(w,-24,244);
    meta(g,p[1],i,CW-14,CH-20,'right');
  },
  function(g,p,i){ /* 声波 */
    g.strokeStyle=p[1];g.lineWidth=2.5;
    for(var k=0;k<11;k++){g.beginPath();for(var x=0;x<=CW;x+=4){var env=Math.exp(-Math.pow((x-CW*0.56)/110,2)),y=52+k*15+Math.sin(x*0.055+k*0.7)*env*(26-Math.abs(k-5)*3.4);if(x)g.lineTo(x,y);else g.moveTo(x,y);}g.stroke();}
    g.fillStyle=p[2];g.beginPath();g.arc(CW*0.56,52+5*15,9,0,TAU);g.fill();
    g.fillStyle=p[1];g.font='900 40px '+DISP;g.textBaseline='alphabetic';g.textAlign='left';g.fillText(WORDS[i]+' FM',14,CH-16);
    meta(g,p[1],i,14,13);
  },
  function(g,p,i,r){ /* 柔光色团 */
    for(var k=0;k<4;k++){var bx=CW*(0.2+r()*0.7),by=CH*(0.2+r()*0.7),rad=110+r()*90,gr=g.createRadialGradient(bx,by,0,bx,by,rad),c=k%2?p[2]:p[1];gr.addColorStop(0,c);gr.addColorStop(1,'rgba(0,0,0,0)');g.globalAlpha=k%2?0.9:0.42;g.fillStyle=gr;g.fillRect(0,0,CW,CH);}
    g.globalAlpha=1;g.strokeStyle=p[1];g.lineWidth=1;g.strokeRect(12.5,12.5,CW-25,CH-25);
    g.fillStyle=p[1];g.font='italic 400 76px '+SERIF;g.textBaseline='alphabetic';g.textAlign='left';g.fillText(WORDS[i].charAt(0)+WORDS[i].slice(1).toLowerCase(),26,CH-36);
    meta(g,p[1],i,24,24);
  },
  function(g,p,i){ /* 棋盘和贴纸 */
    var s=48,x,y;g.fillStyle=p[1];
    for(y=0;y<5;y++)for(x=0;x<8;x++)if((x+y)%2)g.fillRect(x*s,y*s,s,s);
    g.save();g.translate(CW*0.62,CH*0.52);g.rotate(-0.2);
    g.fillStyle=p[2];g.beginPath();g.arc(0,0,78,0,TAU);g.fill();
    g.fillStyle=p[1]===INK?INK:BONE;g.font='900 50px '+DISP;g.textAlign='center';g.textBaseline='middle';g.fillText(WORDS[i],0,-4);
    g.font='500 9px '+MONO;g.fillText('PLAY  NOW',0,34);
    g.restore();
  }
];
function grain(g,w,h){
  var im=g.getImageData(0,0,w,h),d=im.data,s=1234567;
  for(var k=0;k<d.length;k+=4){s=(Math.imul(s,1664525)+1013904223)>>>0;var n=((s>>>24)-128)*0.055;d[k]+=n;d[k+1]+=n;d[k+2]+=n;}
  g.putImageData(im,0,0);
}
/* 单张高清封面，给展厅墙上的大画用 */
SP.coverCanvas=function(i,W){
  var H=Math.round(W*CH/CW),cv=document.createElement('canvas');cv.width=W;cv.height=H;
  var g=cv.getContext('2d'),p=PALS[(i*3+((i/8)|0))%8];
  g.fillStyle=p[0];g.fillRect(0,0,W,H);
  g.save();g.scale(W/CW,H/CH);g.beginPath();g.rect(0,0,CW,CH);g.clip();L[i%8](g,p,i,rnd(i*131+7));g.restore();
  grain(g,W,H);
  return cv;
};
SP.coverWord=function(i){return WORDS[i%WORDS.length];};
SP.buildAtlas=function(){
  var cv=document.createElement('canvas');cv.width=COLS*(CW+2*G);cv.height=ROWS*(CH+2*G);
  var g=cv.getContext('2d');
  for(var i=0;i<COLS*ROWS;i++){
    var x=(i%COLS)*(CW+2*G),y=((i/COLS)|0)*(CH+2*G),p=PALS[(i*3+((i/8)|0))%8];
    g.save();g.fillStyle=p[0];g.fillRect(x,y,CW+2*G,CH+2*G);
    g.translate(x+G,y+G);g.beginPath();g.rect(0,0,CW,CH);g.clip();
    L[i%8](g,p,i,rnd(i*131+7));
    g.restore();
  }
  grain(g,cv.width,cv.height);
  return {canvas:cv,cols:COLS,rows:ROWS,cw:CW,ch:CH,g:G,count:COLS*ROWS};
};
})();
