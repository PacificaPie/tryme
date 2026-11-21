/* 镜头。给任意时间都能直接算出机位，不依赖上一帧。
   两套机位按权重混在一起：斜上方绕着名片转的（参数在 CFG.CAM 的几条轨道里），和贴着街面滑过去的。 */
(function(){
'use strict';
var SP=window.SP=window.SP||{};
SP.createCam=function(core){
  var T=core.T,U=SP.u,C=SP.CFG,CM=C.CAM,cam=core.camera;
  var pos=new T.Vector3(),tgt=new T.Vector3(),right=new T.Vector3(),up=new T.Vector3(),sp=new T.Vector3(),st=new T.Vector3();

  /* 斜上方：名片横向占画面的 fill，中心落在画面的 (cx, cy) */
  function orbit(tt,asp,par,mood,oP,oT){
    var P=core.size().w<600||asp<0.9,TH=Math.tan(CM.fov*Math.PI/360);
    var theta=U.track(CM.theta,tt)+par.x*CM.parallax[0],phi=U.track(P?CM.phiP:CM.phi,tt)-par.y*CM.parallax[1];
    var fill=U.track(P?CM.fillP:CM.fill,tt),cx=U.track(P?CM.cxP:CM.cx,tt),cy=U.track(P?CM.cyP:CM.cy,tt);
    /* fill 是按画面宽度算的。比 16:10 更扁的窗口里按高度收小，城占画面高度的比例和 16:10 时一样，楼顶不会顶出上沿 */
    if(!P)fill*=Math.min(1,1.6/asp);
    if(mood){var CC=CM.city,c=mood.city;phi=U.lerp(phi,CC.phi,c)-CC.hov*mood.hov*(1-c);fill=U.lerp(fill,(P?CC.fillP:CC.fill)*Math.min(1,1.6/asp),c);cx=U.lerp(cx,CC.cx,c);}
    if(mood&&mood.rotation){theta+=mood.rotation.yaw;phi=Math.max(.24,Math.min(1.48,phi+mood.rotation.pitch));}
    var wproj=C.CARD.w*Math.abs(Math.cos(theta))+C.CARD.d*Math.abs(Math.sin(theta));
    var d=wproj/(fill*2*TH*asp);
    // Fit the card and lifted buildings in perspective, including the closer
    // corners at shallow angles. The camera's offset and clipping planes are
    // part of the fit, so a full orbit cannot crop the card at its tilt limits.
    if(mood&&mood.rotation&&(mood.rotation.yaw||mood.rotation.pitch)){
      var sn=Math.sin(theta),co=Math.cos(theta),sp=Math.sin(phi),cp=Math.cos(phi),bx=.90,by=.84,ox=2*(cx-.5),oy=2*(.5-cy);
      for(var ix=-1;ix<=1;ix+=2)for(var iz=-1;iz<=1;iz+=2)for(var iy=0;iy<=1;iy++){
        var x=ix*C.CARD.w/2,z=iz*C.CARD.d/2,y=iy*(mood.height||0);
        var depth=x*sn*cp+y*sp+z*co*cp,horizontal=(x*co-z*sn)/(TH*asp),vertical=(-x*sp*sn+y*cp-z*sp*co)/TH;
        d=Math.max(d,(horizontal+bx*depth)/(bx-ox),(-horizontal+bx*depth)/(bx+ox),(vertical+by*depth)/(by-oy),(-vertical+by*depth)/(by+oy),depth/.39,-depth/.59);
      }
    }
    var vw=2*TH*asp*d,vh=2*TH*d;
    oP.set(Math.sin(theta)*Math.cos(phi),Math.sin(phi),Math.cos(theta)*Math.cos(phi)).multiplyScalar(d);oT.set(0,0,0);
    right.set(Math.cos(theta),0,-Math.sin(theta));
    up.set(-Math.sin(phi)*Math.sin(theta),Math.cos(phi),-Math.sin(phi)*Math.cos(theta));
    oP.addScaledVector(right,-(cx-0.5)*vw).addScaledVector(up,-(0.5-cy)*vh);
    oT.addScaledVector(right,-(cx-0.5)*vw).addScaledVector(up,-(0.5-cy)*vh);
    orb.cy=cy;orb.d=d;
  }
  /* 街面：从名片西头外面进来，沿主街匀速往东，一路偏着头看北边的橱窗 */
  function street(tt,oP,oT){
    var s=CM.street,k=U.seg(tt,s.in[0],s.out[1]),x=U.lerp(s.x[0],s.x[1],k);
    oP.set(x,s.y,s.z);oT.set(x+Math.cos(s.yaw)*3,s.y+s.pitch*3,s.z-Math.sin(s.yaw)*3);
  }
  /* 返回 {w: 有多贴近街面 0..1, focus: 清晰带在画面的什么高度} */
  var out={w:0,focus:0.5},orb={cy:0.5,d:30};
  function at(tt,asp,par,mood){
    var s=CM.street;orbit(tt,asp,par,mood,pos,tgt);var cy=orb.cy;
    var wIn=U.eio(U.seg(tt,s.in[0],s.in[1])),wOut=U.eio(U.seg(tt,s.out[0],s.out[1])),w=wIn*(1-wOut);
    if(w>0){
      street(tt,sp,st);pos.lerp(sp,w);tgt.lerp(st,w);
      pos.y+=s.liftIn*Math.sin(Math.PI*wIn)+s.liftOut*Math.sin(Math.PI*wOut);
    }
    cam.fov=U.lerp(CM.fov,asp<0.9?s.fovP:s.fov,w);
    /* 近面和远面贴着这座城收紧：斜上方时是镜头距离的 0.6 到 1.6 倍，街面时是 0.5 到 60。深度留给城本身，薄的东西才不会互相穿 */
    cam.near=U.lerp(orb.d*0.6,0.5,U.c01(w*2.5));cam.far=U.lerp(orb.d*1.6,60,w);cam.aspect=asp;cam.updateProjectionMatrix();
    cam.position.copy(pos);cam.up.set(0,1,0);cam.lookAt(tgt);cam.updateMatrixWorld();
    out.w=w;out.focus=1-cy;
    return out;
  }
  return {at:at};
};
})();
