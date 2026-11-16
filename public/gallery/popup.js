/* 主角：一张能撑开成展厅的名片。
   机构是真的：每块纸板都有厚度，绕着自己的折线转。合上时从下往上叠四层（地面、长凳和小人、后墙、两扇侧墙），
   侧墙朝上的那一面印着卡面，朝下的那一面是展厅的白墙，所以立起来以后，卡面翻到了屋外，白墙翻到了屋里。 */
(function(){
'use strict';
var SP=window.SP=window.SP||{};
SP.createPopup=function(core,paper,onChange){
  var T=core.T,U=SP.u,PR=SP.prints,W=PR.W,H=PR.H,FX=PR.FX,Y0=PR.Y0,Y1=PR.Y1,PI=Math.PI;
  var TC=0.045,RAD=0.13,t=0.016,zF=0.004,zL2=0.026,zL3=0.046,hS=1.297,hB=zL3+hS-zL2,D=Y1-Y0;
  var root=new T.Group();root.userData.tourRoom={minX:-FX,maxX:FX,minY:Y0,maxY:Y1};core.scene.add(root);

  var disposed=false,images=[],targets=[];
  function containCover(image,width,height){
    var cover=document.createElement('canvas');cover.width=1024;cover.height=Math.max(1,Math.round(1024*height/width));
    var ctx=cover.getContext('2d'),iw=image.naturalWidth||image.width||1024,ih=image.naturalHeight||image.height||640,scale=Math.min(width/iw,height/ih),px=cover.width/width,py=cover.height/height;
    ctx.fillStyle='#EEEAE1';ctx.fillRect(0,0,cover.width,cover.height);
    // Fit in physical slot coordinates so integer canvas sizing cannot distort the mapped image.
    ctx.drawImage(image,(width-iw*scale)*px/2,(height-ih*scale)*py/2,iw*scale*px,ih*scale*py);return cover;
  }
  /* Selected project covers are images, never simulated running games. */
  var works=PR.WORKS.map(function(w,i){
    var placeholder=PR.placeholder(w),slot=PR.SLOTS[i];
    var o={w:w,tex:paper.tex(placeholder),thumbTex:paper.tex(containCover(placeholder,slot.w,slot.h)),mats:[],thumbMats:[],coverCanvas:null};
    if(w.cover){
      var im=new Image();images.push(im);im.decoding='async';
      im.onload=function(){
        if(disposed)return;
        // Wall frames and closed-card slots have different physical aspect ratios.
        var cover=containCover(im,1.6,1),thumb=containCover(im,slot.w,slot.h);
        o.coverCanvas=cover;var tx=paper.tex(cover);tx.needsUpdate=true;
        var old=o.tex;o.tex=tx;o.mats.forEach(function(m){m.uniforms.tMap.value=tx;});old.dispose();
        var nextThumb=paper.tex(thumb);nextThumb.needsUpdate=true;old=o.thumbTex;o.thumbTex=nextThumb;o.thumbMats.forEach(function(m){m.uniforms.tMap.value=nextThumb;});old.dispose();
        if(works[0]===o&&bodyMat){var nextBack=paper.tex(PR.back(me,512,cover));bodyMat.uniforms.tB.value=nextBack;backTex.dispose();backTex=nextBack;}
        if(onChange)onChange();
      };
      im.onerror=function(){if(!disposed&&onChange)onChange();};im.src=w.cover;
    }
    return o;
  });

  /* 卡身：黑面白芯的厚纸板，圆角 */
  var s=new T.Shape(),w2=W/2,h2=H/2;
  s.moveTo(-w2+RAD,-h2);s.lineTo(w2-RAD,-h2);s.quadraticCurveTo(w2,-h2,w2,-h2+RAD);s.lineTo(w2,h2-RAD);s.quadraticCurveTo(w2,h2,w2-RAD,h2);
  s.lineTo(-w2+RAD,h2);s.quadraticCurveTo(-w2,h2,-w2,h2-RAD);s.lineTo(-w2,-h2+RAD);s.quadraticCurveTo(-w2,-h2,-w2+RAD,-h2);
  var bodyGeo=new T.ExtrudeGeometry(s,{depth:TC,bevelEnabled:false,curveSegments:12});bodyGeo.translate(0,0,-TC);
  var me=PR.PEOPLE[0],frontTex=paper.tex(PR.front(me,512,null,PR.caps())),backTex=paper.tex(PR.back(me,512));
  var STIP=256,stipR=new T.Vector4(-FX/W+0.5,Y0/H+0.5,FX/W+0.5,(Y1+t)/H+0.5);
  var bodyMat=paper.board({tA:frontTex,tB:backTex,sheenA:0.11,sheenB:0.05,stipA:STIP,stipB:0});
  bodyMat.uniforms.uMA.value.set(1/W,0,0,1/H);bodyMat.uniforms.uOA.value.set(0.5,0.5);
  bodyMat.uniforms.uMB.value.set(-1/W,0,0,1/H);bodyMat.uniforms.uOB.value.set(0.5,0.5);bodyMat.uniforms.uStipR.value=stipR;
  var body=new T.Mesh(bodyGeo,bodyMat);body.castShadow=true;root.add(body);

  /* 地面、四周的垫条（墙就立在垫条上，合上时垫条正好是这一叠纸的侧边） */
  var floorMat=paper.board({tA:paper.tex(PR.floorPrint(400)),refl:true}),fu=floorMat.uniforms;
  fu.uMA.value.set(1/(2*FX),0,0,1/D);fu.uOA.value.set(0.5,0.5);fu.uOrg.value.set(-FX,-D/2);fu.uDim.value.set(2*FX,D);fu.uRp.value.set(D/2,2.0);
  var reflections=PR.HANG.map(function(a,i){return a.wall==='B'?i:-1;}).filter(function(i){return i>=0;}).slice(0,3);
  [fu.uR0,fu.uR1,fu.uR2].forEach(function(u,j){var a=PR.HANG[reflections[j]];if(a)u.value.set(a.s,a.v+zL2-zF,a.w,a.w*0.625);});
  var floor=new T.Mesh(new T.PlaneGeometry(2*FX,D),floorMat);floor.position.set(0,(Y0+Y1)/2,zF);root.add(floor);
  var whiteMat=paper.board({core:paper.PAPER}),inkMat=paper.board({colA:paper.INK,colB:paper.INK,core:paper.INK}),redMat=paper.board({colA:0xE23A2E,colB:0xE23A2E,core:0xE23A2E});
  function box(w,h,d,x,y,z,mat){var m=new T.Mesh(new T.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;root.add(m);return m;}
  box(t,D+2*t,zL3,-FX-t/2,(Y0+Y1)/2,zL3/2,whiteMat);box(t,D+2*t,zL3,FX+t/2,(Y0+Y1)/2,zL3/2,whiteMat);
  box(2*FX,t,zL2,0,Y1+t/2,zL2/2,whiteMat);box(2*FX,t,zL3,0,Y0-t/2,zL3/2,whiteMat);

  /* 一块绕折线转的纸板。局部坐标：X 沿折线，Y 是离折线的距离，Z 是厚度。rz 决定它平躺时朝哪边倒 */
  function panel(len,h,z,hx,hy,rz,mat){
    var frame=new T.Group();frame.position.set(hx,hy,z);frame.rotation.z=rz;root.add(frame);
    var leaf=new T.Group();frame.add(leaf);
    var geo=new T.BoxGeometry(len,h,t);geo.translate(0,h/2,t/2);
    var mesh=new T.Mesh(geo,mat);mesh.castShadow=true;leaf.add(mesh);
    var ca=Math.cos(rz),sa=Math.sin(rz),u=mat.uniforms;
    u.uMA.value.set(ca/W,-sa/W,sa/H,ca/H);u.uOA.value.set(hx/W+0.5,hy/H+0.5);
    u.uMB.value.set(-1/len,0,0,1/h);u.uOB.value.set(0.5,0);
    u.uOrg.value.set(-len/2,0);u.uDim.value.set(len,h);u.uStipR.value=stipR;
    return {frame:frame,leaf:leaf,mesh:mesh,mat:mat,len:len,h:h,hx:hx,hy:hy,rz:rz};
  }
  var lenS=D+t,ycS=(Y0+Y1+t)/2;
  var PL=panel(lenS,hS,zL3,-FX,ycS,-PI/2,paper.board({tA:frontTex,tB:paper.tex(PR.wall('L',lenS,hS,840)),sheenA:0.11,stipA:STIP,aoSide:-1}));
  var PRt=panel(lenS,hS,zL3,FX,ycS,PI/2,paper.board({tA:frontTex,tB:paper.tex(PR.wall('R',lenS,hS,840)),sheenA:0.11,stipA:STIP,aoSide:-1}));
  var PB=panel(2*FX,hB,zL2,0,Y1,PI,paper.board({tA:paper.tex(PR.backOut(2*FX,hB,300)),tB:paper.tex(PR.wall('B',2*FX,hB,786)),sheenA:0.11,stipA:222,aoSide:-1}));
  PB.mat.uniforms.uMA.value.set(-1/(2*FX),0,0,-1/hB);PB.mat.uniforms.uOA.value.set(0.5,1);PB.mat.uniforms.uStipK.value.x=hB/(2*FX);PB.mat.uniforms.uStipR.value=new T.Vector4(2,2,3,3);

  /* 墙上的画：墨色细框加画面。合上时框是压扁的，墙立起来以后才鼓出来 */
  var arts=[];
  PR.HANG.forEach(function(a,i){
    var pn=a.wall==='L'?PL:a.wall==='R'?PRt:PB,w=a.w,h=w*0.625,b=0.012,dep=0.03;
    var g=new T.Group();g.position.set(-a.s,a.v,0);g.rotation.y=PI;pn.leaf.add(g);
    var fr=new T.Mesh(new T.BoxGeometry(w+2*b,h+2*b,dep),inkMat);fr.position.z=dep/2;fr.castShadow=true;fr.userData.workId=works[i].w.id;g.add(fr);
    var m=paper.art(works[i].tex);works[i].mats.push(m);
    var im=new T.Mesh(new T.PlaneGeometry(w,h),m);im.position.z=dep+0.0015;im.userData.workId=works[i].w.id;g.add(im);targets.push(im);
    arts.push({g:g,mat:m});
  });

  /* Cover thumbnails follow the selected-work layout and split at the physical seam. */
  function thumb(pn,i,x0,x1,u0,u1){
    var slot=PR.SLOTS[i],cy=slot.y,dx=(x0+x1)/2-pn.hx,dy=cy-pn.hy,ca=Math.cos(pn.rz),sa=Math.sin(pn.rz);
    var m=paper.art(works[i].thumbTex,{rad:0.04});m.uniforms.uRect.value.set(u0,0,u1-u0,1);works[i].thumbMats.push(m);
    var mesh=new T.Mesh(new T.PlaneGeometry(x1-x0,slot.h),m);
    mesh.position.set(ca*dx+sa*dy,-sa*dx+ca*dy,t+0.0015);mesh.rotation.z=-pn.rz;pn.leaf.add(mesh);
  }
  PR.SLOTS.forEach(function(slot,i){
    var x0=slot.x-slot.w/2,x1=slot.x+slot.w/2,gap=.003;
    if(x1<=0)thumb(PL,i,x0,x1,0,1);
    else if(x0>=0)thumb(PRt,i,x0,x1,0,1);
    else{thumb(PL,i,x0,-gap,0,(-gap-x0)/slot.w);thumb(PRt,i,gap,x1,(gap-x0)/slot.w,1);}
  });

  /* 长凳：两条腿是平行连杆，腿立起来的时候凳面始终保持水平 */
  var bench=(function(){
    var B=PR.BENCH,bx=B.x,by=B.y,L=B.L,Dp=B.D,hL=B.h,tl=0.008,ts=0.012,z0=zF+0.002;
    var legs=[-0.38,0.38].map(function(ox){
      var fr=new T.Group();fr.position.set(bx+ox,by,z0);fr.rotation.z=-PI/2;root.add(fr);
      var leaf=new T.Group();fr.add(leaf);
      var geo=new T.BoxGeometry(Dp*0.86,hL,tl);geo.translate(0,hL/2,tl/2);
      var m=new T.Mesh(geo,inkMat);m.castShadow=true;leaf.add(m);return leaf;
    });
    var seat=new T.Mesh(new T.BoxGeometry(L,Dp,ts),inkMat);seat.castShadow=true;root.add(seat);
    return function(th){
      legs[0].rotation.x=legs[1].rotation.x=th;
      seat.position.set(bx+hL*Math.cos(th),by,z0+hL*Math.sin(th)+tl*Math.cos(th)+ts/2);
    };
  })();

  /* 比例人：建筑模型里常见的纸片小人。脚下是折线，平躺时朝门口倒 */
  function figure(fx,fy,mat,k){
    var p=new T.Shape();
    p.moveTo(-0.05*k,0);p.lineTo(0.05*k,0);p.lineTo(0.085*k,0.29*k);p.quadraticCurveTo(0.088*k,0.36*k,0.022*k,0.365*k);p.lineTo(0.022*k,0.3813*k);
    p.absarc(0,0.435*k,0.058*k,-1.182,4.3236,false);
    p.lineTo(-0.022*k,0.365*k);p.quadraticCurveTo(-0.088*k,0.36*k,-0.085*k,0.29*k);p.lineTo(-0.05*k,0);
    var fr=new T.Group();fr.position.set(fx,fy,zF+0.002);fr.rotation.z=PI;root.add(fr);
    var leaf=new T.Group();fr.add(leaf);
    var m=new T.Mesh(new T.ExtrudeGeometry(p,{depth:0.008,bevelEnabled:false,curveSegments:18}),mat);m.castShadow=true;leaf.add(m);
    return leaf;
  }
  var figA=figure(PR.FIGS[0].x,PR.FIGS[0].y,redMat,PR.FIGS[0].k),figB=figure(PR.FIGS[1].x,PR.FIGS[1].y,inkMat,PR.FIGS[1].k);

  /* 桌面：看不见，只接影子 */
  var ground=new T.Mesh(new T.PlaneGeometry(120,120),paper.ground());ground.rotation.x=-PI/2;ground.position.set(0,-TC-0.002,-10);core.scene.add(ground);

  function update(st,clock){
    PL.leaf.rotation.x=st.thL;PRt.leaf.rotation.x=st.thR;PB.leaf.rotation.x=st.thB;
    var uL=Math.sin(st.thL),uR=Math.sin(st.thR),uB=Math.sin(st.thB);
    /* 墙角的暗：墙立得越直，墙根和转角越暗 */
    floorMat.uniforms.uAo.value.set(0.20*uL,0.20*uR,0,0.20*uB);
    /* 地面倒影：后墙立直了、作品醒了，才映得出来 */
    var up4=uB*uB*uB*uB;
    var weights=[0,1,2].map(function(j){var k=reflections[j];fu['tR'+j].value=k===undefined?paper.white:works[k].tex;return k===undefined?0:st.wake[k]*up4;});
    fu.uRw.value.set(weights[0],weights[1],weights[2]);
    PB.mat.uniforms.uAo.value.set(0.17*uR*uB,0.17*uL*uB,0.13*uB,0);
    PL.mat.uniforms.uAo.value.set(0.17*uB*uL,0,0.13*uL,0);
    PRt.mat.uniforms.uAo.value.set(0,0.17*uB*uR,0.13*uR,0);
    bench(st.bench);figA.rotation.x=st.figA;figB.rotation.x=st.figB;
    for(var i=0;i<arts.length;i++){arts[i].g.scale.z=U.lerp(0.1,1,st.pop[i]);arts[i].mat.uniforms.uWake.value=st.wake[i];}
  }
  function dispose(){
    if(disposed)return;disposed=true;
    images.forEach(function(im){im.onload=null;im.onerror=null;im.removeAttribute('src');});
    var geos=new Set(),mats=new Set(),textures=new Set();
    [root,ground].forEach(function(node){node.traverse(function(o){
      if(o.geometry)geos.add(o.geometry);
      if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(function(m){mats.add(m);});
    });core.scene.remove(node);});
    mats.forEach(function(m){Object.keys(m.uniforms||{}).forEach(function(k){var v=m.uniforms[k].value;if(v&&v.isTexture&&k!=='tSh'&&v!==paper.white)textures.add(v);});m.dispose();});
    works.forEach(function(o){textures.add(o.tex);textures.add(o.thumbTex);});textures.forEach(function(tx){tx.dispose();});geos.forEach(function(g){g.dispose();});
    targets.length=0;
  }
  return {root:root,update:update,works:works,body:body,ground:ground,targets:targets,dispose:dispose,TC:TC,top:zL3+hS};
};
})();
