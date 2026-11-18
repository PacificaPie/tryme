/* 总平面：名片、街道刻线、九块地基、九栋主楼、配楼、树和路灯。
   三排：A 最里（高），B 中间，C 最前（矮）。前后排的橱窗左右错开，从斜上方看谁也不挡谁。
   所有橱窗都朝前（+z），所以楼沉下去以后，窗往后一躺就是名片上正着的一块小图。 */
(function(){
'use strict';
var SP=window.SP=window.SP||{};

SP.plan=function(K){
  var C=SP.CFG,LK=SP.LK,SW=C.WIN.w,SH=C.WIN.h,PAD=C.PAD,Y=0.002;

  /* ---------- 名片 ---------- */
  K.slab(C.CARD.w,C.CARD.d,C.CARD.r,C.CARD.th);

  /* ---------- 街道刻线：算出电流到每一点要走多远 ---------- */
  var TR=C.TRACES.map(function(t){
    var p=t.pts,s=[0],i;for(i=1;i<p.length;i++)s.push(s[i-1]+Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]));
    return {p:p,s:s,len:s[s.length-1],from:t.from,ring:t.ring||[0,0],sJ:0,dJ:0};
  });
  function at(t,s){var i=1;while(i<t.s.length-1&&t.s[i]<s)i++;var k=(s-t.s[i-1])/Math.max(1e-6,t.s[i]-t.s[i-1]);return [t.p[i-1][0]+(t.p[i][0]-t.p[i-1][0])*k,t.p[i-1][1]+(t.p[i][1]-t.p[i-1][1])*k];}
  function dist(t,s){return t.dJ+Math.abs(s-t.sJ);}
  /* 一个点在某条线上离得最近的位置 */
  function nearest(t,x,z){var best=1e9,bs=0,s,q,d;for(s=0;s<=t.len;s+=0.02){q=at(t,s);d=Math.hypot(q[0]-x,q[1]-z);if(d<best){best=d;bs=s;}}return {s:bs,d:best};}
  TR.forEach(function(t){
    if(t.from<0)return;
    var par=TR[t.from],best=1e9,s,q,n;
    for(s=0;s<=t.len+1e-6;s+=0.02){q=at(t,s);n=nearest(par,q[0],q[1]);if(n.d<best-1e-6){best=n.d;t.sJ=s;t.dJ=dist(par,n.s);}}
  });

  var segs=[],maxD=0;   /* [x0,z0,x1,z1,d0,d1,kind] */
  function seg(a,b,d0,d1,kind){segs.push([a[0],a[1],b[0],b[1],d0,d1,kind]);maxD=Math.max(maxD,d0,d1);}
  function ring(c,r,d){for(var i=0;i<14;i++){var a0=i/14*6.2832,a1=(i+1)/14*6.2832;seg([c[0]+Math.cos(a0)*r,c[1]+Math.sin(a0)*r],[c[0]+Math.cos(a1)*r,c[1]+Math.sin(a1)*r],d,d,LK.TRACE);}}
  TR.forEach(function(t){
    /* 在接头的地方把线断开，两边的次序才各自是直线 */
    var cuts=t.s.slice(),i;if(t.sJ>1e-3&&t.sJ<t.len-1e-3)cuts.push(t.sJ);cuts.sort(function(a,b){return a-b;});
    var R=0.065,s0=t.ring[0]?R*2:0,s1=t.len-(t.ring[1]?R*2:0);
    for(i=0;i<cuts.length-1;i++){var a=Math.max(cuts[i],s0),b=Math.min(cuts[i+1],s1);if(b-a>1e-4)seg(at(t,a),at(t,b),dist(t,a),dist(t,b),LK.TRACE);}
    if(t.ring[0]){var q0=at(t,R);ring(q0,R,dist(t,0));}
    if(t.ring[1]){var q1=at(t,t.len-R);ring(q1,R,dist(t,t.len));}
  });

  /* ---------- 九块地基：一小段引线接到最近的街上，再绕小图一圈 ---------- */
  var STREET={A:TR[8],B:TR[0],C:TR[4]};
  var heroes=C.WORKS.map(function(w,i){
    var row=C.ROWS[w.row],zf=row.zf,yc=w.yc||row.yc,st=STREET[w.row],zs=st.p[0][1];
    var zFront=zf+PAD,zBack=zf-SH-PAD,x0=w.x-SW/2-PAD,x1=w.x+SW/2+PAD;
    var d0=dist(st,nearest(st,w.x,zs).s),d1=d0+Math.abs(zs-zFront);
    seg([w.x,zs],[w.x,zFront],d0,d1,LK.PAD);
    var hw=x1-w.x,dp=zFront-zBack;
    seg([w.x,zFront],[x0,zFront],d1,d1+hw,LK.PAD);seg([x0,zFront],[x0,zBack],d1+hw,d1+hw+dp,LK.PAD);seg([x0,zBack],[w.x,zBack],d1+hw+dp,d1+2*hw+dp,LK.PAD);
    seg([w.x,zFront],[x1,zFront],d1,d1+hw,LK.PAD);seg([x1,zFront],[x1,zBack],d1+hw,d1+hw+dp,LK.PAD);seg([x1,zBack],[w.x,zBack],d1+hw+dp,d1+2*hw+dp,LK.PAD);
    return {i:i,w:w,x:w.x,zf:zf,yc:yc,dist:d1,H:1,rank:0};
  });
  segs.forEach(function(s){K.line([s[0],Y,s[1]],[s[2],Y,s[3]],s[6],s[4]/maxD,s[5]/maxD);});
  /* 电流先到谁，谁先长出来 */
  heroes.slice().sort(function(a,b){return Math.round(a.dist*100)-Math.round(b.dist*100)||a.x-b.x;}).forEach(function(h,r){h.rank=r;});
  function delayAt(x,z){return Math.min(1,Math.hypot(x+5.5,z-0.25)/11.5);}

  /* ---------- 九栋主楼 ---------- */
  function sign(h,x,y,z){K.signs.push({hero:h.i,x:x,y:y,z:z,text:h.w.zh});}
  function foot(h,x,z,hw,hd){K.heroFoot[h.i]=[x,z,hw,hd];}
  function screen(h){K.frame(h.x,h.yc,h.zf+0.014,SW,SH);K.screens[h.i]={x:h.x,yc:h.yc,zf:h.zf};}
  var BUILD={
    /* 九号船台：带龙门吊的船坞棚 */
    slipway:function(h,x,z){
      K.box(x,0,z-0.6,2.0,1.5,1.2,{win:'EW',cw:0.4,ch:0.5,fx:0.36,fy:0.42,seed:3});
      K.gable(x,1.5,z-0.6,2.12,1.32,0.34,'z');
      [-1.22,1.22].forEach(function(s){K.box(x+s,0,z+0.36,0.07,2.02,0.07);});
      K.box(x,2.02,z+0.36,2.58,0.08,0.12);                                 /* 横梁是薄板，只描上面一圈 */
      /* 小车和吊钩挂在画面外侧，不压在作品上 */
      K.box(x+0.95,1.94,z+0.36,0.16,0.08,0.14,{noEdge:true});
      K.line([x+0.95,1.94,z+0.36],[x+0.95,1.56,z+0.36]);K.box(x+0.95,1.50,z+0.36,0.07,0.07,0.07,{noEdge:true});
      sign(h,x,1.64,z+0.08);foot(h,x,z-0.6,1.0,0.6);
    },
    /* 霓虹广场：一栋挂满小屏的高楼。小屏里放的是同一张作品画面的局部 */
    neon:function(h,x,z){
      K.box(x,0,z-0.55,1.9,0.5,1.1);
      K.box(x,0.5,z-0.5,1.62,2.55,1.0,{win:'EW',cw:0.25,ch:0.32,fx:0.42,fy:0.46,seed:11});
      K.box(x-0.2,3.05,z-0.55,0.9,0.28,0.7);
      K.line([x-0.2,3.33,z-0.55],[x-0.2,3.92,z-0.55]);
      /* [x0, x1, y0, y1, 画面上取哪一块 u0 v0 u1 v1] */
      [[-0.72,-0.14,1.88,2.24, 0.05,0.52,0.30,0.93],[-0.06,0.30,1.88,2.24, 0.62,0.56,0.80,0.92],[0.38,0.72,1.88,2.68, 0.84,0.30,0.98,0.96],
       [-0.72,-0.36,2.32,2.68, 0.30,0.30,0.46,0.62],[-0.28,0.30,2.32,2.68, 0.40,0.50,0.62,0.78],[-0.72,0.72,2.78,2.93, 0.04,0.60,0.96,0.70]
      ].forEach(function(m){K.minis.push({hero:h.i,x0:x+m[0],x1:x+m[1],y0:m[2],y1:m[3],z:z+0.012,uv:m.slice(4)});});
      sign(h,x,0.66,z+0.02);foot(h,x,z-0.55,0.95,0.55);
    },
    /* 熔火之峰：一座锥形的楼，顶上一点红光 */
    magma:function(h,x,z){
      /* 一座扁宽的山，从前面那块屏的两侧和上面露出来 */
      K.box(x,0,z-0.15,1.6,1.5,0.3);
      K.frustum(x,0,z-0.86,0.76,0.44,1.15,8,{rot:Math.PI/8,base:0,sx:1.5});
      K.frustum(x,1.15,z-0.86,0.44,0.13,0.85,8,{rot:Math.PI/8,sx:1.5});
      K.embers.push({hero:h.i,x:x,y:2.015,z:z-0.86});
      sign(h,x,1.62,z+0.02);foot(h,x,z-0.75,1.15,0.8);
    },
    /* 法老王城：一座高大的门楼，城门洞里就是那块屏 */
    citadel:function(h,x,z){
      K.box(x,0,z-0.16,1.6,1.34,0.32);
      [-1.06,1.06].forEach(function(s){K.taper(x+s,0,z-0.28,0.56,0.84,0.44,0.68,1.80);K.box(x+s,1.80,z-0.28,0.50,0.06,0.74);});
      K.box(x,1.34,z-0.26,1.72,0.34,0.52);
      [-0.6,-0.2,0.2,0.6].forEach(function(s){K.box(x+s,1.68,z-0.26,0.2,0.12,0.52);});
      K.box(x,0,z+0.07,1.48,0.28,0.14);
      sign(h,x,1.51,z+0.02);foot(h,x,z-0.28,1.34,0.42);
    },
    /* 吉萨自驾：金字塔顶的小馆 */
    giza:function(h,x,z){
      K.box(x,0,z-0.5,1.9,1.34,1.0,{win:'EW',cw:0.5,ch:0.67,fx:0.3,fy:0.34,seed:7});
      K.box(x,1.34,z-0.5,2.04,0.07,1.14);
      K.pyramid(x,1.41,z-0.5,1.84,1.0,0.95);                               /* 金字塔盖满整个屋顶 */
      K.box(x,0,z+0.07,1.48,0.28,0.14);
      sign(h,x,1.53,z+0.02);foot(h,x,z-0.5,0.95,0.5);
    },
    /* 小红帽的森林：一间尖顶小屋 */
    redhood:function(h,x,z){
      K.box(x,0,z-0.52,1.8,1.04,1.04,{win:'EWN',cw:0.52,ch:1.04,fx:0.30,fy:0.28,seed:5});
      K.gable(x,1.04,z-0.52,1.98,1.2,0.74,'z');
      K.box(x+0.5,1.26,z-0.78,0.15,0.5,0.15);
      sign(h,x,1.27,z+0.10);foot(h,x,z-0.52,0.9,0.52);
    },
    /* 沙暴行动：一座哨所 */
    sandstorm:function(h,x,z){
      K.box(x,0,z-0.5,1.9,1.04,1.0,{win:'N',cw:0.38,ch:0.52,fx:0.5,fy:0.26,seed:9});
      K.loop(x,1.042,z-0.5,1.74,0.84);                                   /* 屋顶上的一圈女儿墙，只用一圈线表示 */
      /* 瞭望塔：四根细柱把小屋举到 1.5 以上 */
      [[-0.2,-0.2],[0.2,-0.2],[0.2,0.2],[-0.2,0.2]].forEach(function(c){K.line([x+0.55+c[0],1.04,z-0.62+c[1]],[x+0.55+c[0],1.52,z-0.62+c[1]]);});
      K.box(x+0.55,1.52,z-0.62,0.52,0.34,0.52,{win:'SEW',cw:0.52,ch:0.34,fx:0.72,fy:0.30,seed:2});
      K.box(x+0.55,1.86,z-0.62,0.66,0.05,0.66);
      K.line([x+0.55,1.91,z-0.62],[x+0.55,2.5,z-0.62]);K.line([x+0.47,2.36,z-0.62],[x+0.63,2.36,z-0.62]);
      sign(h,x-0.34,1.16,z+0.02);foot(h,x,z-0.5,0.95,0.5);
    },
    /* 枯朽古树：一段残墙里嵌着那块屏，两边两根不等高的残柱，后面一棵只剩枝桠的树（树偏在西边，不压到后排的画面） */
    witch:function(h,x,z){
      K.box(x,0,z-0.17,1.6,1.30,0.34);
      K.box(x-0.98,0,z-0.17,0.24,1.52,0.30);K.box(x+0.98,0,z-0.17,0.24,0.90,0.30);
      var bx=x-0.55,bz=z-0.78,SOFT=C.LINE.soft,rnd=(function(){var s=7;return function(){s=(s*1664525+1013904223)>>>0;return s/4294967296;};})();
      K.frustum(bx,0,bz,0.11,0.05,0.7,5,{base:0});
      (function grow(p,d,len,dep){
        var e=[p[0]+d[0]*len,p[1]+d[1]*len,p[2]+d[2]*len];K.line(p,e,0,SOFT);
        if(dep<=0)return;
        for(var k=0;k<(dep>2?3:2);k++){
          var a=(k-(dep>2?1:0.5))*1.0+(rnd()-0.5)*0.5,b=(rnd()-0.5)*1.5;
          var nd=[d[0]+Math.sin(a)*0.75,d[1]*0.82+0.12,d[2]+Math.sin(b)*0.55],l=Math.hypot(nd[0],nd[1],nd[2]);
          grow(e,[nd[0]/l,nd[1]/l,nd[2]/l],len*(0.62+rnd()*0.14),dep-1);
        }
      })([bx,0.7,bz],[-0.2,1,0],0.36,3);
      K.box(x+0.52,0,z-0.6,0.15,0.08,0.11,{rot:0.5,noEdge:true});K.box(x+0.3,0,z-0.86,0.09,0.05,0.08,{rot:1.1,noEdge:true});
      sign(h,x,1.41,z-0.02);foot(h,x,z-0.17,1.1,0.17);
    },
    /* 樱·盆景：一座小亭子，顶上一棵树 */
    sakura:function(h,x,z){
      K.box(x,0,z-0.45,1.8,1.04,0.9,{win:'N',cw:0.45,ch:1.04,fx:0.42,fy:0.34,seed:4});
      K.box(x,1.04,z-0.45,2.08,0.07,1.18);
      /* 花盆在屋顶正中，两团错开的树冠，线软一档 */
      K.frustum(x,1.11,z-0.45,0.22,0.31,0.13,8);
      K.post(x-0.02,1.24,z-0.45,0.035,0.36,5);
      K.ico(x-0.08,1.96,z-0.45,0.44,0.3,C.LINE.soft);K.ico(x+0.42,1.72,z-0.34,0.32,1.1,C.LINE.soft);
      sign(h,x-0.44,1.23,z+0.12);foot(h,x,z-0.45,0.9,0.45);
    }
  };
  heroes.forEach(function(h){
    K.begin(h.i,0);BUILD[h.w.id](h,h.x,h.zf);screen(h);h.H=K.end();h.roof=K.roofY;
  });

  /* ---------- 配楼：不发光的矮楼，只做城市的肌理。B 排的都压在 0.8 以下，不挡后排的橱窗 ---------- */
  /* [x, z, 宽, 高, 深, 开窗的立面, 楼顶再叠一块 [dx, dz, 宽, 高, 深]] */
  [[-2.95,-2.95,0.42,0.72,0.7,'S'],[-1.55,-2.86,0.84,1.28,0.92,'SEW',[0.1,-0.1,0.46,0.22,0.5]],[1.6,-2.9,0.78,1.74,0.8,'SEW'],
   [-5.4,-1.0,0.6,0.52,0.95,'SE'],[-4.42,-1.05,0.62,0.8,0.86,'SEW'],[-0.55,-1.02,1.16,0.66,0.92,'SEW',[-0.2,-0.08,0.5,0.3,0.5]],[1.28,-1.28,0.46,0.5,0.5,'S'],
   [4.05,-1.03,0.6,0.78,0.9,'SEW'],[5.3,-1.0,0.7,0.56,1.0,'SW']
  ].forEach(function(f,i){
    K.begin(-1,delayAt(f[0],f[1]));
    K.box(f[0],0,f[1],f[2],f[3],f[4],{win:f[5],cw:0.24+(i%3)*0.05,ch:0.3+(i%2)*0.06,fx:0.40+(i%4)*0.06,fy:0.44+(i%3)*0.07,seed:i*3.7});
    if(f[6])K.box(f[0]+f[6][0],f[3],f[1]+f[6][1],f[6][2],f[6][3],f[6][4]);
    K.end();
  });

  /* ---------- 小松树 ---------- */
  [[-3.34,1.26,1.0],[-2.62,1.52,0.8],[-5.7,1.3,0.9],[-0.32,1.3,0.85],[0.36,1.5,0.7],[3.36,1.28,0.9],[2.66,1.6,0.75],[5.72,1.5,0.8]
  ].forEach(function(t){K.begin(-1,delayAt(t[0],t[1]));K.tree(t[0],t[1],t[2]);K.end();});

  /* ---------- 路灯：主街北侧四盏、前街三盏，从西往东依次亮。主街南侧留给镜头 ---------- */
  [[-4.25,-0.16,0,1],[-2.8,2.22,0,1],[-0.95,-0.16,0,1],[0.2,2.22,0,1],[0.45,-0.16,0,1],[3.2,2.22,0,1],[4.25,-0.16,0,1]
  ].forEach(function(l){K.lamp(l[0],l[1],l[2],l[3],delayAt(l[0],l[1]));});

  K.heroes=heroes;
  return K;
};

/* 电车：一个单独的小白模，沿前街那条刻线走 */
SP.tramKit=function(T){
  var K=SP.kit(T);
  K.begin(-1,0);
  K.box(0,0.03,0,0.66,0.15,0.17,{win:'SN',cw:0.11,ch:0.15,fx:0.62,fy:0.36,seed:1,noFoot:true});
  K.box(0,0.18,0,0.3,0.02,0.09,{noEdge:true,noFoot:true});
  K.end();
  return K;
};
})();
