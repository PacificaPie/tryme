/* 名片背面：墨底、骨白抖点，和展廊里"还没醒"的作品是同一种画面语言，只有一颗朱红的小太阳。
   横版：左边是点阵人像，右边是名字、身份、一句话、几个数字，右下角是二维码。 */
(function(){
'use strict';
var LC=window.LC=window.LC||{};
var BONE='#ECE9E2',INK='#0E0F12',RED='#E23A2E';
var SERIF='"Noto Serif SC","Songti SC",serif',MONO='"JetBrains Mono",ui-monospace,Menlo,monospace',DISP='"Big Shoulders Display","Arial Narrow",Impact,sans-serif';
/* 4x4 的抖点矩阵，和原来背面那颗小星球用的是同一张 */
var M=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];

/* 名片主人的资料。都是示例，换成真人只改这里；名字和正面的 CFG.OWNER 要一致 */
LC.PROFILE={
  name:'阿成',latin:'A CHENG',no:'0037',since:'2026.11',
  role:'独立创作者 · 字节电商 AI 产品经理',
  quote:'作品比简历诚实。',
  bio:['白天做电商里的 AI 产品，','晚上把想到的小东西做出来。'],
  stats:[['56','件作品'],['12,408','次试玩'],['386','人收藏']],     /* 第一个数开机时会按展廊里实际挂的数量重写 */
  scan:'扫码进入展厅'
};
/* 背面上用到的所有字，开机时让字体把这些字先下好 */
LC.backGlyphs=function(){var P=LC.PROFILE;return P.name+P.role+P.quote+P.bio.join('')+P.scan+P.stats.map(function(s){return s[1];}).join('')+'作品就是名片“”';};

function rnd(seed){var s=(seed>>>0)||1;return function(){s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
/* 带字距地写一行字，返回写了多宽；x 传 null 只量不写 */
function spaced(g,text,x,y,track){var i,w=0;for(i=0;i<text.length;i++){if(x!=null)g.fillText(text[i],x+w,y);w+=g.measureText(text[i]).width+track;}return w-track;}

/* 点阵人像：把原图缩到一格一个像素，再按抖点矩阵决定这一格点不点。(px0, py0) 左上角，PS 边长，s 一格多大，gap 点和点之间留多少 */
function dither(g,img,px0,py0,PS,s,gap){
  var n=Math.floor(PS/s),x,y;if(!img)return;
  var t=document.createElement('canvas');t.width=t.height=n;var tg=t.getContext('2d');
  var iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;
  tg.fillStyle='#000';tg.fillRect(0,0,n,n);tg.imageSmoothingQuality='high';
  tg.drawImage(img,iw*0.045,ih*0.050,iw*0.905,ih*0.905,0,0,n,n);
  var d=tg.getImageData(0,0,n,n).data,Lm=new Float32Array(n*n),Bl=new Float32Array(n*n),j,l,a,b,c,q;
  for(j=0;j<n*n;j++)Lm[j]=(0.299*d[j*4]+0.587*d[j*4+1]+0.114*d[j*4+2])/255;
  /* 和周围一小圈的平均比一比，把差别放大：眼睛、镜框、嘴角这些细的东西才不会被点阵吃掉 */
  for(y=0;y<n;y++)for(x=0;x<n;x++){a=0;c=0;for(q=-2;q<=2;q++)for(b=-2;b<=2;b++){var xx=x+b,yy=y+q;if(xx>=0&&yy>=0&&xx<n&&yy<n){a+=Lm[yy*n+xx];c++;}}Bl[y*n+x]=a/c;}
  for(y=0;y<n;y++)for(x=0;x<n;x++){
    j=y*n+x;l=Lm[j];
    if(l<0.035)continue;                                   /* 背景是黑的，一个点都不打 */
    l=l+0.85*(l-Bl[j]);
    /* 再拉开明暗：暗部压下去、亮部留着 */
    l=Math.pow(Math.min(1,Math.max(0,(l-0.03)/0.90)),1.15)*1.03;
    if(l>(M[(y&3)*4+(x&3)]+0.5)/16)g.fillRect(px0+x*s,py0+y*s,s-gap,s-gap);
  }
}
/* 二维码：骨白的底、墨色的点，这样任何扫码器都认。(xr, yb) 是它的右下角，size 是大约要多大；返回实际的边长 */
function qrcode(g,qr,xr,yb,size){
  if(!qr||!qr.n)return 0;
  var N=qr.n+4,cell=Math.max(2,Math.floor(size/N)),qs=N*cell,qx=xr-qs,qy=yb-qs,x,y;
  g.globalAlpha=1;g.fillStyle=BONE;g.fillRect(qx,qy,qs,qs);g.fillStyle=INK;
  for(y=0;y<qr.n;y++)for(x=0;x<qr.n;x++)if(qr.rows[y].charAt(x)==='1')g.fillRect(qx+(x+2)*cell,qy+(y+2)*cell,cell,cell);
  g.fillStyle=BONE;return qs;
}

/* img：人像的原图（黑底的灰度图）；qr：二维码的点阵 {n, rows:['0101…']}，没有就不画；
   compact：名片在屏幕上很小的时候（手机竖屏）用的排版 —— 同样的东西，字大一号，数字改成竖着排三行，两行自我介绍不放 */
LC.cardBack=function(W,H,img,qr,compact){
  var cv=document.createElement('canvas');cv.width=W;cv.height=H;
  var g=cv.getContext('2d'),P=LC.PROFILE,r=rnd(11),i,x,y;
  g.fillStyle=INK;g.fillRect(0,0,W,H);
  g.textBaseline='alphabetic';g.textAlign='left';
  if(compact){
    var c=W/1280,cm=52*c,cs=5*c;
    g.fillStyle=BONE;
    for(i=0;i<900;i++){var cz=(r()<0.10?4:r()<0.42?3:2)*c;g.globalAlpha=0.14+0.62*r()*r();g.fillRect(Math.round(r()*W),Math.round(r()*H),cz,cz);}
    g.globalAlpha=1;
    /* 顶上一行和一条线 */
    g.font='500 '+26*c+'px '+MONO;spaced(g,'CREATOR CARD',cm,80*c,3*c);
    g.font='900 '+30*c+'px '+SERIF;var ctw=spaced(g,'作品就是名片',null,0,3*c);spaced(g,'作品就是名片',W-cm-ctw,81*c,3*c);
    g.fillRect(cm,100*c,W-2*cm,2*c);
    /* 点阵人像，占左边一半 */
    var CPS=560*c,cx0=cm-12*c,cy0=138*c;
    dither(g,img,cx0,cy0,CPS,cs,1*c);
    g.fillStyle=RED;g.beginPath();g.arc(cx0+CPS*0.115,cy0+CPS*0.085,10*c,0,Math.PI*2);g.fill();
    /* 右边：编号、名字、身份、一句话 */
    var X0=cx0+CPS+28*c,XR=W-cm,fs;
    g.fillStyle=BONE;
    g.globalAlpha=0.6;g.font='500 '+26*c+'px '+MONO;spaced(g,'N°'+P.no+'  /  '+P.since,X0,168*c,2.4*c);
    g.globalAlpha=1;g.font='900 '+150*c+'px '+SERIF;var cnw=spaced(g,P.name,X0-6*c,318*c,9*c);
    g.globalAlpha=0.6;g.font='500 '+28*c+'px '+MONO;spaced(g,P.latin,X0+cnw+22*c,318*c,6*c);
    /* 身份那一行：一行放不下就把字缩小一点 */
    g.globalAlpha=0.94;
    for(fs=38;fs>30;fs--){g.font='600 '+fs*c+'px '+SERIF;if(spaced(g,P.role,null,0,1.2*c)<=XR-X0)break;}
    spaced(g,P.role,X0,386*c,1.2*c);
    g.globalAlpha=1;g.fillRect(X0,414*c,3*c,60*c);
    g.font='900 '+46*c+'px '+SERIF;spaced(g,'“'+P.quote+'”',X0+20*c,462*c,2.5*c);
    /* 一排点分开上下两段 */
    g.globalAlpha=0.5;for(x=X0;x<XR;x+=cs)g.fillRect(x,498*c,cs-1*c,cs-1*c);
    /* 二维码在右下角，下面一行小字；数字在它左边竖着排三行 */
    var cqs=qrcode(g,qr,XR,724*c,200*c);
    if(cqs){g.globalAlpha=0.86;g.font='600 '+27*c+'px '+SERIF;var csw=spaced(g,P.scan,null,0,2.5*c);spaced(g,P.scan,XR-csw,759*c,2.5*c);}
    P.stats.forEach(function(st,si){
      var by=(572+si*76)*c;
      g.globalAlpha=1;g.font='900 '+66*c+'px '+DISP;var w=g.measureText(st[0]).width;g.fillText(st[0],X0,by);
      g.globalAlpha=0.72;g.font='600 '+31*c+'px '+SERIF;spaced(g,st[1],X0+w+14*c,by-2*c,2.5*c);
    });
    g.globalAlpha=1;
    return cv;
  }
  var k=W/2048,m=88*k;
  /* 底上散着的碎点 */
  g.fillStyle=BONE;
  for(i=0;i<1700;i++){var sz=(r()<0.10?5:r()<0.42?3:2)*k;g.globalAlpha=0.14+0.62*r()*r();g.fillRect(Math.round(r()*W),Math.round(r()*H),sz,sz);}
  g.globalAlpha=1;

  /* 顶上一行和一条线 */
  g.font='500 '+26*k+'px '+MONO;spaced(g,'CREATOR CARD',m,104*k,3.2*k);
  g.font='900 '+30*k+'px '+SERIF;var tw=spaced(g,'作品就是名片',null,0,4*k);spaced(g,'作品就是名片',W-m-tw,105*k,4*k);
  g.fillRect(m,130*k,W-2*m,2*k);

  /* 点阵人像 */
  var s=7*k,PS=1008*k,px0=m-34*k,py0=188*k;
  dither(g,img,px0,py0,PS,s,2*k);
  /* 那颗朱红的小太阳，在人像的左上方 */
  g.fillStyle=RED;g.beginPath();g.arc(px0+PS*0.115,py0+PS*0.085,15*k,0,Math.PI*2);g.fill();

  /* 右边的字 */
  var x0=px0+PS+30*k,xr=W-m;
  g.fillStyle=BONE;
  g.globalAlpha=0.6;g.font='500 '+24*k+'px '+MONO;spaced(g,'N°'+P.no+'  /  '+P.since+'  /  CREATOR',x0,222*k,2.6*k);
  g.globalAlpha=1;g.font='900 '+196*k+'px '+SERIF;var nw=spaced(g,P.name,x0-8*k,430*k,12*k);
  g.globalAlpha=0.6;g.font='500 '+30*k+'px '+MONO;spaced(g,P.latin,x0+nw+34*k,430*k,7*k);
  g.globalAlpha=0.92;g.font='600 '+40*k+'px '+SERIF;spaced(g,P.role,x0,516*k,2*k);
  /* 一句话，左边一条竖线 */
  g.globalAlpha=1;g.fillRect(x0,566*k,3*k,74*k);
  g.font='900 '+54*k+'px '+SERIF;spaced(g,'“'+P.quote+'”',x0+22*k,624*k,3*k);

  /* 一排点分开上下两段 */
  g.globalAlpha=0.5;for(x=x0;x<xr;x+=s)g.fillRect(x,706*k,s-2*k,s-2*k);
  /* 数字 */
  var sx=x0;
  P.stats.forEach(function(st,si){
    g.globalAlpha=1;g.font='900 '+122*k+'px '+DISP;var w=g.measureText(st[0]).width;g.fillText(st[0],sx,852*k);
    g.globalAlpha=0.66;g.font='600 '+27*k+'px '+SERIF;var lw=spaced(g,st[1],sx+3*k,902*k,2.5*k);
    sx+=Math.max(w,lw)+70*k;
    if(si<P.stats.length-1){g.globalAlpha=0.4;for(y=770*k;y<904*k;y+=s)g.fillRect(sx-36*k,y,s-2*k,s-2*k);}
  });

  /* 二维码 */
  var qs=qrcode(g,qr,xr,H-m,272*k),qx=xr-qs;
  /* 两行自我介绍，在数字下面、二维码左边 */
  g.fillStyle=BONE;g.globalAlpha=0.78;g.font='600 '+31*k+'px '+SERIF;
  P.bio.forEach(function(line,bi){spaced(g,line,x0,(996+bi*52)*k,2.5*k);});
  if(qs){
    g.globalAlpha=0.86;g.font='600 '+27*k+'px '+SERIF;var sw=spaced(g,P.scan,null,0,3*k);spaced(g,P.scan,qx-sw-34*k,H-m-6*k,3*k);
    /* 指向二维码的一小排点 */
    g.globalAlpha=0.5;for(x=qx-26*k;x<qx-8*k;x+=s)g.fillRect(x,H-m-17*k,s-2*k,s-2*k);
  }
  g.globalAlpha=1;
  return cv;
};
})();
