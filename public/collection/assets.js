/* Real project media for the adapted 点亮收藏 texture atlas. */
(function(){
'use strict';
var SP=window.SP=window.SP||{},images=new Map(),pending=[],cancelled=false;
SP.collectionWorks=[];
function canvas(w,h){var c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function placeholder(work,w,h){var c=canvas(w,h),g=c.getContext('2d');g.fillStyle='#E4E2D9';g.fillRect(0,0,w,h);g.strokeStyle='#B8B7AB';g.lineWidth=2;g.strokeRect(w*.07,h*.09,w*.86,h*.82);g.fillStyle='#55594B';g.textAlign='center';g.textBaseline='middle';var size=w*.055;g.font='500 '+size+'px "PingFang SC",sans-serif';while(size>12&&g.measureText(work.name).width>w*.75){size*=.9;g.font='500 '+size+'px "PingFang SC",sans-serif';}g.fillText(work.name,w/2,h/2,w*.78);return c;}
SP.loadCollectionMedia=function(works,onChange){
  SP.disposeCollectionMedia();cancelled=false;SP.collectionWorks=works;
  works.forEach(function(work){if(!work.cover)return;var image=new Image();image.decoding='async';pending.push(image);
    image.onload=function(){if(cancelled)return;var c=canvas(512,320),g=c.getContext('2d'),iw=image.naturalWidth||512,ih=image.naturalHeight||320,ratio=Math.min(512/iw,320/ih);g.fillStyle='#E8E6DE';g.fillRect(0,0,512,320);try{g.drawImage(image,(512-iw*ratio)/2,(320-ih*ratio)/2,iw*ratio,ih*ratio);images.set(work.id,c);if(onChange)onChange();}catch{}};
    image.src=work.cover;
  });
};
SP.disposeCollectionMedia=function(){cancelled=true;pending.forEach(function(image){image.onload=null;image.onerror=null;image.removeAttribute('src');});pending=[];images.clear();};
SP.coverCanvas=function(index,size){var work=SP.collectionWorks[index]||{id:'',name:''},image=images.get(work.id);if(!image)return placeholder(work,size,Math.round(size*.625));var c=canvas(size,Math.round(size*.625));c.getContext('2d').drawImage(image,0,0,c.width,c.height);return c;};
SP.buildAtlas=function(){var count=SP.collectionWorks.length,cols=Math.max(1,Math.min(3,count)),rows=Math.max(1,Math.ceil(count/cols)),cw=512,ch=320,gap=4,c=canvas(cols*(cw+gap*2),rows*(ch+gap*2)),ctx=c.getContext('2d');ctx.fillStyle='#E8E6DE';ctx.fillRect(0,0,c.width,c.height);SP.collectionWorks.forEach(function(work,i){ctx.drawImage(SP.coverCanvas(i,cw),(i%cols)*(cw+gap*2)+gap,Math.floor(i/cols)*(ch+gap*2)+gap,cw,ch);});return{canvas:c,cols:cols,cw:cw,ch:ch,g:gap};};
})();
