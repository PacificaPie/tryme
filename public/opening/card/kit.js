/* 白模的积木。所有体块合进一个网格，所有亮边合进另一个。
   每个顶点记着它属于哪栋楼：[编号, 延迟, 这栋楼的总高]。
   编号 0–8 是九栋主楼，-1 是配楼和街上的小东西，-2 是不会动的（名片本身、刻线）。
   楼是整栋从名片下面平移上来的，所以要知道总高。 */
(function(){
'use strict';
var SP=window.LC=window.LC||{};
/* 亮边的种类 */
SP.LK={EDGE:0,RIM:1,TRACE:2,PAD:3,FRAME:4};

SP.kit=function(T){
  var P=[],N=[],B=[],BL=[],UV=[],WS=[];      /* 体块：位置、法线、所在体块的底高、所属楼、窗格坐标、窗在格子里占多大 */
  var LA=[],LB=[],LBL=[],LSQ=[],LKD=[];      /* 亮边：两个端点、所属楼、两端被点亮的次序、种类 */
  var cur={hero:-2,delay:0},mark={p:0,l:0},maxY=0,roofY=0,m4=new T.Matrix4();
  var K={screens:[],minis:[],signs:[],lamps:[],foot:[],heroFoot:[],embers:[]};

  /* 开始搭一栋楼；end() 把总高写回这栋楼的每个顶点 */
  K.begin=function(hero,delay){cur={hero:hero,delay:delay||0};mark={p:P.length/3,l:LA.length/3};maxY=0;roofY=0;};
  K.end=function(){
    var i,h=maxY;K.roofY=roofY;   /* roofY 只算体块，不算天线之类的线：楼名标签挂在这个高度 */
    for(i=mark.p;i<P.length/3;i++)BL[i*3+2]=h;
    for(i=mark.l;i<LA.length/3;i++)LBL[i*3+2]=h;
    cur={hero:-2,delay:0};return h;
  };

  K.line=function(a,b,kind,sa,sb){
    /* 刻线和地基线的 sa, sb 是两端被点亮的次序；其余的线 sa 是它单独的亮度系数（0 = 不变）。配楼的亮边统一暗一档 */
    if(!sa&&!kind&&cur.hero===-1)sa=SP.CFG.LINE.fill/SP.CFG.LINE.edge;
    LA.push(a[0],a[1],a[2]);LB.push(b[0],b[1],b[2]);LBL.push(cur.hero,cur.delay,0);
    LSQ.push(sa||0,sb==null?(sa||0):sb);LKD.push(kind||0);
    maxY=Math.max(maxY,a[1],b[1]);
  };

  /* 把一个几何体并进来。o: base 体块底高；win 开窗的函数；noEdge 不描边；crease 多大的折角才描边 */
  function push(geo,mat,o){
    o=o||{};
    var g=geo.index?geo.toNonIndexed():geo;if(mat)g.applyMatrix4(mat);
    if(o.flat)g.computeVertexNormals();
    var p=g.attributes.position.array,n=g.attributes.normal.array,uv=g.attributes.uv?g.attributes.uv.array:null,cnt=p.length/3,i,w;
    for(i=0;i<cnt;i++){
      P.push(p[i*3],p[i*3+1],p[i*3+2]);N.push(n[i*3],n[i*3+1],n[i*3+2]);B.push(o.base||0);BL.push(cur.hero,cur.delay,0);
      w=o.win?o.win(i,uv[i*2],uv[i*2+1]):null;
      if(w){UV.push(w[0],w[1],w[2]);WS.push(w[3],w[4]);}else{UV.push(0,0,0);WS.push(0,0);}
      if(p[i*3+1]>maxY)maxY=p[i*3+1];
      if(p[i*3+1]>roofY)roofY=p[i*3+1];
    }
    if(!o.noEdge){
      var e=new T.EdgesGeometry(g,o.crease||24),ep=e.attributes.position.array;
      for(i=0;i<ep.length;i+=6){
        /* 贴着名片的那圈底边不描：楼和名片的交线留给地基线 */
        if(cur.hero>-2&&ep[i+1]<0.02&&ep[i+4]<0.02)continue;
        K.line([ep[i],ep[i+1],ep[i+2]],[ep[i+3],ep[i+4],ep[i+5]],o.kind||0,o.soft||0);
      }
      e.dispose();
    }
    g.dispose();if(g!==geo)geo.dispose();
  }
  K.push=push;

  /* 盒子。win 写哪几个立面开小窗：E(+x) W(-x) S(+z) N(-z)；cw, ch 一格多大；fx, fy 窗占格子的比例 */
  K.box=function(cx,y0,cz,w,h,d,o){
    o=o||{};var win=o.win||'',seed=o.seed||0,thin=h<=0.08&&!o.noEdge;
    m4.makeRotationY(o.rot||0);m4.setPosition(cx,y0+h/2,cz);
    push(new T.BoxGeometry(w,h,d),m4,{base:y0,noEdge:o.noEdge||thin,win:win?function(i,u,v){
      var f=(i/6)|0,key='EW..SN'.charAt(f);
      if(key==='.'||win.indexOf(key)<0)return null;
      var fw=f<2?d:w,nx=Math.max(1,Math.round(fw/(o.cw||0.30))),ny=Math.max(1,Math.round(h/(o.ch||0.36)));
      return [u*nx,v*ny,1+seed+f*0.37,o.fx||0.46,o.fy||0.50];
    }:null});
    /* 薄板只描上面那一圈：上下两圈线挨得太近，远看会糊成一条虚线 */
    if(thin)K.loop(cx,y0+h,cz,w,d,o.rot||0);
    if(y0<0.05&&cur.hero===-1&&!o.noFoot)K.foot.push({x:cx,z:cz,w:w,d:d});
  };

  /* 一圈水平的长方形亮边 */
  K.loop=function(cx,y,cz,w,d,rot){
    var c=Math.cos(rot||0),s=Math.sin(rot||0),q=[[-1,-1],[1,-1],[1,1],[-1,1]].map(function(e){var x=e[0]*w/2,z=e[1]*d/2;return [cx+x*c+z*s,y,cz-x*s+z*c];});
    for(var i=0;i<4;i++)K.line(q[i],q[(i+1)%4]);
  };

  /* 上小下大的收分体块（城门的塔楼） */
  K.taper=function(cx,y0,cz,w0,d0,w1,d1,h){
    var g=new T.BoxGeometry(1,1,1).toNonIndexed(),p=g.attributes.position.array,i;
    for(i=0;i<p.length;i+=3){var top=p[i+1]>0;p[i]*=top?w1:w0;p[i+2]*=top?d1:d0;p[i+1]=(p[i+1]+0.5)*h;}
    m4.makeTranslation(cx,y0,cz);push(g,m4,{base:y0,flat:true});
  };

  /* 坡屋顶：axis 是屋脊的方向 */
  K.gable=function(cx,y0,cz,w,d,h,axis){
    var rz=axis==='z',hx=(rz?d:w)/2,hz=(rz?w:d)/2;
    var A=[-hx,0,hz],Bq=[hx,0,hz],C=[hx,0,-hz],Dq=[-hx,0,-hz],R1=[-hx,h,0],R2=[hx,h,0];
    var tri=[A,Bq,R2,A,R2,R1,C,Dq,R1,C,R1,R2,Dq,A,R1,Bq,C,R2],arr=[],i;
    for(i=0;i<tri.length;i++)arr.push(tri[i][0],tri[i][1],tri[i][2]);
    var g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float32Array(arr),3));g.computeVertexNormals();
    m4.makeRotationY(rz?Math.PI/2:0);m4.setPosition(cx,y0,cz);push(g,m4,{base:-9});
  };

  /* 四棱锥 */
  K.pyramid=function(cx,y0,cz,w,d,h){
    var g=new T.ConeGeometry(Math.SQRT1_2,h,4,1).toNonIndexed();g.rotateY(Math.PI/4);g.scale(w,1,d);
    m4.makeTranslation(cx,y0+h/2,cz);push(g,m4,{base:-9,flat:true});
  };

  /* 多棱台：n 条棱，r0 底半径，r1 顶半径 */
  K.frustum=function(cx,y0,cz,r0,r1,h,n,o){
    o=o||{};var g=new T.CylinderGeometry(r1,r0,h,n,1,false).toNonIndexed();if(o.rot)g.rotateY(o.rot);if(o.sx)g.scale(o.sx,1,1);   /* sx：左右拉宽，做成一座扁的山 */
    m4.makeTranslation(cx,y0+h/2,cz);push(g,m4,{base:o.base==null?-9:o.base,flat:true,noEdge:o.noEdge});
  };

  /* 细圆柱：柱子、灯杆，不描边 */
  K.post=function(x,y0,z,r,h,n){m4.makeTranslation(x,y0+h/2,z);push(new T.CylinderGeometry(r,r,h,n||6),m4,{base:-9,noEdge:true});};

  /* 二十面体：树冠 */
  K.ico=function(x,y,z,r,rot,soft){var g=new T.IcosahedronGeometry(r,0);g.rotateY(rot||0);m4.makeTranslation(x,y,z);push(g,m4,{base:-9,flat:true,soft:soft});};

  /* 六棱的小松树：不描边，夜里只是一个深色的剪影，被旁边的灯照到才看得见 */
  K.tree=function(x,z,s){
    K.post(x,0,z,0.016*s,0.09*s,5);
    var g=new T.ConeGeometry(0.17*s,0.56*s,6,1).toNonIndexed();m4.makeTranslation(x,0.09*s+0.28*s,z);push(g,m4,{base:-9,flat:true,noEdge:true});
  };

  /* 路灯：ax, az 是灯臂伸出去的方向 */
  K.lamp=function(x,z,ax,az,delay){
    var h=0.50,L=0.12;
    K.begin(-1,delay);
    K.post(x,0,z,0.010,h,6);
    m4.makeRotationY(Math.atan2(-az,ax));m4.setPosition(x+ax*L/2,h,z+az*L/2);push(new T.BoxGeometry(L,0.012,0.012),m4,{base:-9,noEdge:true});
    var H=K.end();
    K.lamps.push({x:x+ax*L,y:h-0.02,z:z+az*L,delay:delay,H:H});
  };

  /* 作品窗的窗框：四条线，比窗大一圈 */
  K.frame=function(x,yc,z,w,h){
    var m=0.022,x0=x-w/2-m,x1=x+w/2+m,y0=yc-h/2-m,y1=yc+h/2+m,F=SP.LK.FRAME;
    K.line([x0,y0,z],[x1,y0,z],F);K.line([x1,y0,z],[x1,y1,z],F);K.line([x1,y1,z],[x0,y1,z],F);K.line([x0,y1,z],[x0,y0,z],F);
  };

  /* 圆角板：名片本身 */
  K.slab=function(w,d,r,th){
    var x0=-w/2,x1=w/2,z0=-d/2,z1=d/2,s=new T.Shape();
    s.moveTo(x0+r,z0);s.lineTo(x1-r,z0);s.absarc(x1-r,z0+r,r,-Math.PI/2,0,false);s.lineTo(x1,z1-r);s.absarc(x1-r,z1-r,r,0,Math.PI/2,false);
    s.lineTo(x0+r,z1);s.absarc(x0+r,z1-r,r,Math.PI/2,Math.PI,false);s.lineTo(x0,z0+r);s.absarc(x0+r,z0+r,r,Math.PI,Math.PI*1.5,false);
    var g=new T.ExtrudeGeometry(s,{depth:th,bevelEnabled:false,curveSegments:14});
    g.rotateX(Math.PI/2);push(g,null,{base:-th,noEdge:true});
    var pts=s.getPoints(14),i,R=SP.LK.RIM;
    for(i=0;i<pts.length-1;i++){
      K.line([pts[i].x,0,pts[i].y],[pts[i+1].x,0,pts[i+1].y],R);
      K.line([pts[i].x,-th,pts[i].y],[pts[i+1].x,-th,pts[i+1].y],R,SP.CFG.LINE.rimLow);
    }
  };

  K.finish=function(){
    /* 每条亮边展开成一个朝着镜头的细长方形：四个顶点，两个三角形 */
    var n=LA.length/3,a=new Float32Array(n*12),b=new Float32Array(n*12),bl=new Float32Array(n*12),sq=new Float32Array(n*8),kd=new Float32Array(n*4),sd=new Float32Array(n*8),idx=new Uint32Array(n*6),i,k,v;
    var SD=[0,-1,0,1,1,-1,1,1];
    for(i=0;i<n;i++){
      for(k=0;k<4;k++){
        v=i*4+k;
        a.set([LA[i*3],LA[i*3+1],LA[i*3+2]],v*3);b.set([LB[i*3],LB[i*3+1],LB[i*3+2]],v*3);bl.set([LBL[i*3],LBL[i*3+1],LBL[i*3+2]],v*3);
        sq.set([LSQ[i*2],LSQ[i*2+1]],v*2);kd[v]=LKD[i];sd.set([SD[k*2],SD[k*2+1]],v*2);
      }
      idx.set([i*4,i*4+1,i*4+2,i*4+2,i*4+1,i*4+3],i*6);
    }
    return {pos:new Float32Array(P),nrm:new Float32Array(N),base:new Float32Array(B),bld:new Float32Array(BL),uvw:new Float32Array(UV),ws:new Float32Array(WS),
      la:a,lb:b,lbld:bl,lseq:sq,lkind:kd,lside:sd,lidx:idx};
  };
  return K;
};
})();
