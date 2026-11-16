/* Adapted from the supplied 卡中展厅 demo: data-driven paper prints. */
(function(){
'use strict';
var SP=window.SP=window.SP||{};
var W=3,H=4.6,FX=1.3,Y0=-.55,Y1=1.85,TAU=Math.PI*2;
var SERIF='"Songti SC","Noto Serif SC",Georgia,serif',DISP='Arial,sans-serif',MONO='ui-monospace,Menlo,monospace',ITAL='Georgia,serif';
var INK='#15161A',BONE='#ECE9E2',PAPER='#F6F4ED';
var WORKS=[],HANG=[],SLOTS=[],PEOPLE=[],TOTAL=0,OFFSET=0;
var BENCH={x:-.02,y:.05,L:.9,D:.26,h:.15},FIGS=[{x:.3,y:1.25,k:1,red:true},{x:.7,y:-.02,k:.94,red:false}];
function mk(w,h){var c=document.createElement('canvas');c.width=Math.round(w);c.height=Math.round(h);return c;}
function rnd(seed){var s=(seed>>>0)||1;return function(){s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
function pad4(n){return ('000'+n).slice(-4);}
function sp(g,px){if('letterSpacing' in g)g.letterSpacing=px.toFixed(2)+'px';}

/* 头像：一个受光的半身像，全是灰度，印出来就是一团疏密不同的点 */
/* 灰度不直接画成灰色，而是只写进红色通道（tc），着色器再把它变成抖点。这样字的边缘不会被抖花 */
function tc(t){return 'rgb('+Math.round(21+Math.max(0,Math.min(1,t))*204)+',22,26)';}
function avatar(g,cx,cy,r,seed){
  var q=rnd(seed*31+5),bg=g.createRadialGradient(cx+r*0.45,cy-r*0.55,r*0.1,cx,cy,r*1.2);
  bg.addColorStop(0,tc(0.40));bg.addColorStop(1,tc(0.08));
  g.save();g.beginPath();g.arc(cx,cy,r,0,TAU);g.clip();g.fillStyle=bg;g.fillRect(cx-r,cy-r,2*r,2*r);
  var sh=g.createLinearGradient(cx+r*0.7,cy+r*0.3,cx-r*0.7,cy+r);sh.addColorStop(0,tc(0.82));sh.addColorStop(1,tc(0.30));
  g.fillStyle=sh;g.beginPath();g.ellipse(cx,cy+r*1.05,r*(0.78+q()*0.08),r*0.66,0,0,TAU);g.fill();
  var hx=cx+(q()-0.5)*r*0.08,hy=cy-r*0.12,hr=r*0.40,hd=g.createRadialGradient(hx+hr*0.45,hy-hr*0.5,hr*0.1,hx,hy,hr*1.15);
  hd.addColorStop(0,tc(1));hd.addColorStop(0.6,tc(0.76));hd.addColorStop(1,tc(0.38));
  g.fillStyle=hd;g.beginPath();g.arc(hx,hy,hr,0,TAU);g.fill();
  g.fillStyle=INK;g.beginPath();
  var k=(q()*3)|0;
  if(k===0){g.arc(hx,hy-hr*0.1,hr*1.08,Math.PI*1.02,Math.PI*1.98);g.fill();}
  else if(k===1){g.ellipse(hx,hy-hr*0.2,hr*1.16,hr*1.02,0,Math.PI*0.94,Math.PI*2.06);g.lineTo(hx+hr*0.78,hy+hr*0.72);g.lineTo(hx+hr*0.6,hy-hr*0.2);g.lineTo(hx-hr*0.6,hy-hr*0.2);g.lineTo(hx-hr*0.78,hy+hr*0.72);g.fill();}
  else{g.arc(hx,hy-hr*0.86,hr*0.5,0,TAU);g.fill();g.beginPath();g.arc(hx,hy-hr*0.18,hr*1.04,Math.PI*1.08,Math.PI*1.92);g.fill();}
  g.restore();
  g.strokeStyle=BONE;g.lineWidth=Math.max(1,r*0.035);g.beginPath();g.arc(cx,cy,r,0,TAU);g.stroke();
}

function fitText(g,text,x,y,width,size,font,weight){
  var s=size;g.font=(weight||'400')+' '+s+'px '+font;
  while(s>size*.4&&g.measureText(text).width>width){s*=.92;g.font=(weight||'400')+' '+s+'px '+font;}
  g.fillText(text,x,y,width);
}
function front(p,P,thumbs,caps){
  var c=mk(W*P,H*P),g=c.getContext('2d');
  function X(x){return(x+W/2)*P;}function Y(y){return(H/2-y)*P;}
  g.fillStyle=INK;g.fillRect(0,0,c.width,c.height);g.textBaseline='alphabetic';g.fillStyle=BONE;
  g.font='500 '+(.056*P)+'px '+MONO;g.textAlign='left';g.fillText('CREATOR CARD',X(-FX),Y(2.075));
  g.textAlign='right';g.fillText('FUNTRACK',X(FX),Y(2.075));g.fillRect(X(-FX),Y(1.99),2*FX*P,Math.max(1,.004*P));
  g.textAlign='left';SLOTS.forEach(function(q,i){
    if(thumbs&&thumbs[i])g.drawImage(thumbs[i],X(q.x-q.w/2),Y(q.y+q.h/2),q.w*P,q.h*P);
    g.fillStyle=BONE;fitText(g,('0'+(OFFSET+i+1)).slice(-2)+'  '+(caps[i]||''),X(q.x-q.w/2),Y(q.y-q.h/2-.075),q.w*P,.038*P,MONO,'500');
  });
  avatar(g,X(-.92),Y(-1.24),.37*P,p.no);g.fillStyle=BONE;
  fitText(g,p.n,X(-.45),Y(-1.38),1.7*P,.52*P,SERIF,'900');
  fitText(g,p.h,X(-.43),Y(-1.63),1.7*P,.065*P,SERIF,'500');
  g.fillRect(X(-FX),Y(-1.80),2*FX*P,Math.max(1,.004*P));
  g.font='700 '+(.19*P)+'px '+DISP;g.fillText(String(TOTAL),X(-FX),Y(-2.085));var width=g.measureText(String(TOTAL)).width;
  g.font='600 '+(.06*P)+'px '+SERIF;g.fillText('件作品',X(-FX)+width+.04*P,Y(-2.085));
  g.textAlign='right';g.font='500 '+(.047*P)+'px '+MONO;g.fillText('SELECTED '+(OFFSET+1)+'–'+(OFFSET+WORKS.length),X(FX),Y(-2.085));
  return c;
}
function back(p,P){
  var c=mk(W*P,H*P),g=c.getContext('2d'),tw=96,th=Math.round(96*H/W),tc=mk(tw,th),tg=tc.getContext('2d'),im=tg.createImageData(tw,th),d=im.data;
  function X(x){return (x+W/2)*P;}function Y(y){return (H/2-y)*P;}
  var r=rnd(p.no*977+13),kind=p.no%4,an=r()*TAU,ca=Math.cos(an),sa=Math.sin(an),ox=(r()-0.5)*W*1.3,oy=(r()-0.5)*H*1.1,fq=1.9+r()*2.2,x,y;
  for(y=0;y<th;y++)for(x=0;x<tw;x++){
    var px=(x+0.5)/tw*W-W/2,py=H/2-(y+0.5)/th*H,a,dd=Math.sqrt((px-ox)*(px-ox)+(py-oy)*(py-oy));
    if(kind===0)a=0.5+(px*ca+py*sa)/3.4;
    else if(kind===1)a=1-dd/4.4;
    else if(kind===2)a=0.5+0.5*Math.sin(dd*fq);
    else a=0.5+0.5*Math.sin((px*ca+py*sa)*fq*1.3);
    a=Math.max(0,Math.min(1,a));
    var rr=Math.sqrt(px*px+(py-0.3)*(py-0.3));a*=0.22+0.78*Math.max(0,Math.min(1,(rr-1.05)/0.5));
    var k=(y*tw+x)*4;d[k]=Math.round(21+(0.03+0.5*a)*204);d[k+1]=22;d[k+2]=26;d[k+3]=255;
  }
  tg.putImageData(im,0,0);g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';g.drawImage(tc,0,0,c.width,c.height);
  g.strokeStyle=BONE;g.lineWidth=0.012*P;g.beginPath();g.arc(X(0),Y(0.3),1.16*P,0,TAU);g.stroke();
  g.fillStyle=BONE;g.textAlign='center';g.textBaseline='middle';g.font='900 '+(1.56*P)+'px '+SERIF;g.fillText(p.g,X(0),Y(0.25));
  g.textBaseline='alphabetic';g.font='500 '+(0.056*P)+'px '+MONO;sp(g,0.005*P);
  g.textAlign='left';g.fillText('CREATOR CARD',X(-FX),Y(2.075));g.textAlign='right';g.fillText('FUNTRACK',X(FX),Y(2.075));
  sp(g,0);g.textAlign='left';g.font='900 '+(0.2*P)+'px '+SERIF;g.fillText(p.n,X(-FX),Y(-1.93));
  g.font='500 '+(0.05*P)+'px '+MONO;sp(g,0.004*P);g.fillText(p.h,X(-FX),Y(-2.085));
  sp(g,0);
  return c;
}

function wall(which,len,h,P){
  var c=mk(len*P,h*P),g=c.getContext('2d');function X(s){return(s+len/2)*P;}function Y(v){return(h-v)*P;}
  g.fillStyle='#EEEBE4';g.fillRect(0,0,c.width,c.height);g.textAlign='left';g.textBaseline='alphabetic';
  HANG.forEach(function(q,i){if(q.wall!==which)return;
    var gr=g.createRadialGradient(0,0,0,0,0,1);gr.addColorStop(0,'rgba(255,253,247,.9)');gr.addColorStop(1,'rgba(255,253,247,0)');
    g.save();g.translate(X(q.s),Y(q.v+q.w*.14));g.scale((q.w*.9+.22)*P,(q.w*.6+.3)*P);g.fillStyle=gr;g.beginPath();g.arc(0,0,1,0,TAU);g.fill();g.restore();
    var x=X(q.s-q.w/2),y=Y(q.v-q.w*.3125-.075);g.fillStyle=INK;
    fitText(g,WORKS[i].t,x,y,q.w*P,.055*P,ITAL,'500');g.fillStyle='rgba(21,22,26,.60)';
    fitText(g,WORKS[i].kind+'  /  '+WORKS[i].version,x,y+.05*P,q.w*P,.024*P,MONO,'400');
  });
  if(which==='B'){
    g.fillStyle=INK;fitText(g,PEOPLE[0].n+' · 作品展厅',X(-len/2+.12),Y(h-.16),(len-.24)*P,.13*P,SERIF,'700');
    g.fillStyle='rgba(21,22,26,.5)';g.font='400 '+(.024*P)+'px '+MONO;g.textAlign='right';g.fillText('CLICK A WORK TO OPEN',X(len/2-.12),Y(h-.16));
  }
  return c;
}
function floorPrint(P){
  var D=Y1-Y0,c=mk(2*FX*P,D*P),g=c.getContext('2d'),i;
  function X(x){return (x+FX)*P;}function Y(y){return (Y1-y)*P;}
  g.fillStyle=PAPER;g.fillRect(0,0,c.width,c.height);
  g.strokeStyle='rgba(21,22,26,.30)';g.fillStyle='rgba(21,22,26,.42)';g.lineWidth=Math.max(1,0.0045*P);
  g.setLineDash([0.03*P,0.022*P]);g.beginPath();
  g.moveTo(X(-FX+0.04),Y(Y0+0.05));g.lineTo(X(-FX+0.04),Y(Y1-0.04));g.lineTo(X(FX-0.04),Y(Y1-0.04));g.lineTo(X(FX-0.04),Y(Y0+0.05));g.stroke();
  var b=BENCH,m=0.014;g.strokeRect(X(b.x+b.h-b.L/2-m),Y(b.y+b.D/2+m),(b.L+2*m)*P,(b.D+2*m)*P);
  FIGS.forEach(function(f){
    var k=f.k;g.beginPath();g.moveTo(X(f.x-0.12*k),Y(f.y));g.lineTo(X(f.x+0.12*k),Y(f.y));g.stroke();
    g.beginPath();g.moveTo(X(f.x-0.062*k),Y(f.y));g.lineTo(X(f.x-0.097*k),Y(f.y-0.29*k));g.quadraticCurveTo(X(f.x-0.1*k),Y(f.y-0.372*k),X(f.x-0.03*k),Y(f.y-0.377*k));
    g.arc(X(f.x),Y(f.y-0.435*k),0.07*k*P,Math.PI*1.348,Math.PI*1.652,true);
    g.quadraticCurveTo(X(f.x+0.1*k),Y(f.y-0.372*k),X(f.x+0.097*k),Y(f.y-0.29*k));g.lineTo(X(f.x+0.062*k),Y(f.y));g.stroke();
  });
  g.setLineDash([]);g.lineWidth=Math.max(1,0.004*P);
  [[-1,1],[1,1],[-1,-1],[1,-1]].forEach(function(q){
    var cx=q[0]*(FX-0.1),cy=q[1]>0?Y1-0.1:Y0+0.1;g.beginPath();g.moveTo(X(cx-0.035),Y(cy));g.lineTo(X(cx+0.035),Y(cy));g.moveTo(X(cx),Y(cy-0.035));g.lineTo(X(cx),Y(cy+0.035));g.stroke();
  });
  g.font='500 '+(0.026*P)+'px '+MONO;sp(g,0.002*P);g.textBaseline='alphabetic';g.textAlign='left';
  g.fillText('01  BENCH',X(b.x+b.h-b.L/2),Y(b.y-b.D/2-0.05));
  g.fillText('02  VISITOR',X(FIGS[0].x+0.13),Y(FIGS[0].y-0.02));g.textAlign='right';g.fillText('03  VISITOR',X(FIGS[1].x-0.13),Y(FIGS[1].y-0.02));
  g.textAlign='center';g.fillText('FOLD  B',X(0.72),Y(Y1-0.085));
  g.save();g.translate(X(-FX+0.085),Y(0.1));g.rotate(-Math.PI/2);g.fillText('FOLD  A',0,0);g.restore();
  g.save();g.translate(X(FX-0.085),Y(0.6));g.rotate(Math.PI/2);g.fillText('FOLD  C',0,0);g.restore();
  g.fillText('FUNTRACK  /  FLOOR  /  1 : 1',X(0),Y(Y0+0.075));sp(g,0);
  return c;
}

/* 后墙朝外的那一面：平躺时会露出来一小会儿。墨底，一片由疏到密的点，角上是零件编号 */
function backOut(len,h,P){
  var c=mk(len*P,h*P),g=c.getContext('2d'),gr=g.createLinearGradient(0,0,c.width*0.7,c.height);
  gr.addColorStop(0,tc(0.04));gr.addColorStop(1,tc(0.46));g.fillStyle=gr;g.fillRect(0,0,c.width,c.height);
  g.strokeStyle=BONE;g.lineWidth=Math.max(1,0.005*P);g.strokeRect(0.06*P,0.06*P,c.width-0.12*P,c.height-0.12*P);
  g.fillStyle=BONE;g.textBaseline='alphabetic';g.font='500 '+(0.05*P)+'px '+MONO;sp(g,0.004*P);
  g.textAlign='left';g.fillText('B  /  BACK WALL',0.12*P,0.17*P);g.textAlign='right';g.fillText('FUNTRACK',c.width-0.12*P,0.17*P);
  g.textAlign='left';g.fillText('FOLD UP',0.12*P,c.height-0.12*P);sp(g,0);
  return c;
}

function placeholder(work){
  var c=mk(640,400),g=c.getContext('2d');g.fillStyle='#E9E5DC';g.fillRect(0,0,640,400);
  g.strokeStyle='#A9A495';g.lineWidth=2;g.strokeRect(24,24,592,352);g.beginPath();g.arc(320,160,55,0,TAU);g.stroke();
  g.fillStyle=INK;g.textAlign='center';g.textBaseline='middle';fitText(g,work.t,320,280,520,28,SERIF,'700');return c;
}
SP.configurePrints=function(author,works,total,offset){
  TOTAL=total;OFFSET=offset;WORKS=works.map(function(w){return{id:w.id,t:w.name,desc:w.desc||'',cover:w.cover||'',kind:w.kind||'WEB',version:w.version||''};});
  var hash=0;for(var i=0;i<author.id.length;i++)hash=(hash*31+author.id.charCodeAt(i))>>>0;
  PEOPLE=[{n:author.name,g:author.name.slice(-1)||'作',h:author.bio||'',no:hash%9999,w:total,bio:author.bio||''}];
  var count=WORKS.length,cols=count===1?1:count<=4?2:3,rows=Math.ceil(count/cols),cw=2.45/cols,rh=2.22/rows;
  SLOTS=WORKS.map(function(w,i){var width=Math.min(1.56,cw-.1),height=Math.min(width*.625,rh-.20);return{x:((i%cols)-(cols-1)/2)*cw,y:1.70-Math.floor(i/cols)*rh-height/2,w:width,h:height};});
  if(count===3)SLOTS=[{x:0,y:1.075,w:2.45,h:1.25},{x:-.65,y:-.10,w:1.15,h:.60},{x:.65,y:-.10,w:1.15,h:.60}];
  var wallNames=count<=2?WORKS.map(function(){return'B';}):WORKS.map(function(w,i){return['B','L','R'][i%3];});
  HANG=WORKS.map(function(w,i){var wall=wallNames[i],ids=wallNames.map(function(v,j){return v===wall?j:-1;}).filter(function(v){return v>=0;}),position=ids.indexOf(i),span=wall==='B'?2.25:2.08,width=Math.min(count===1?1.4:.95,span/ids.length-.12);return{wall:wall,s:(position+.5)*span/ids.length-span/2,v:.57,w:width};});
  SP.prints={W:W,H:H,FX:FX,Y0:Y0,Y1:Y1,WORKS:WORKS,HANG:HANG,SLOTS:SLOTS,PEOPLE:PEOPLE,front:front,back:back,wall:wall,floorPrint:floorPrint,backOut:backOut,BENCH:BENCH,FIGS:FIGS,placeholder:placeholder,caps:function(){return WORKS.map(function(w){return w.t;});}};
  return SP.prints;
};
})();
