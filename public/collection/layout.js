/* Responsive data-only layout: no placeholder works or empty card meshes. */
(function(){
'use strict';
var SP=window.SP=window.SP||{};
SP.dim={CW:1.6,CH:1,TH:.11,GX:1.98,GZ:1.56,LABEL_H:.225,LABEL_GAP:.075,FOLDER_W:1.9,FOLDER_H:1.3,TAB:.16};
SP.makeCollectionLayout=function(width,height,works){
  var portrait=width<620,n=works.length,cols=Math.max(1,Math.min(n,portrait?2:n===4?2:3)),rows=Math.ceil(n/cols),D=SP.dim;
  var cards=works.map(function(work,i){var row=Math.floor(i/cols),inRow=Math.min(cols,n-row*cols),col=i%cols,x=(col-(inRow-1)/2)*D.GX,z=(row-(rows-1)/2)*D.GZ;
    return{id:i,work:{kind:'poster',key:work.id,name:work.name,cell:i},row:row,col:col,gx:x,gz:z,wx:x,wz:z,ws:1,span:1,yaw:0,yaw0:0,file:work.name,icon:0,seed:.5,r1:.5,r2:.5,dealAt:-10,tw:-10,rs:-10};
  });
  var w=Math.max(D.CW,(cols-1)*D.GX+D.CW),d=Math.max(D.CH,(rows-1)*D.GZ+D.CH+D.LABEL_GAP+D.LABEL_H);
  return{cards:cards,portrait:portrait,cols:cols,rows:rows,width:w,depth:d,field:[-w/2-3,-d/2-3,w+6,d+6],folder:{gx:0,gz:0,hx:0,hz:0}};
};
})();
