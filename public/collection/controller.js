import {t,getLocale,applyGalleryLocale} from '../gallery/i18n.js';
applyGalleryLocale('collection',new URLSearchParams(location.search).get('lang'),{first:true});
/* Same-origin real-data adapter for the supplied 点亮收藏 renderer. */
(function(){
'use strict';
var SP=window.SP,PI=Math.PI,PAGE_SIZE=window.FuntrackGallery.pageSize;
var $=function(id){return document.getElementById(id);},canvas=$('canvas'),stage=$('stage');
var data=null,key='',page=0,focusWorkId=null,core=null,desk=null,layout=null,failed=false,disposed=false,raf=0,lastTime=0,hoverIndex=-1,hover=[],pointer=null,lastHeight=0;
var light={x:0,z:0},lightTarget={x:0,z:0},listeners=[],stageObserver=null,heightObserver=null,motion=window.matchMedia('(prefers-reduced-motion: reduce)');
function listen(node,type,fn,options){node.addEventListener(type,fn,options);listeners.push(function(){node.removeEventListener(type,fn,options);});}
function send(message){if(parent!==window)parent.postMessage(message,location.origin);}
function state(){send({type:'funtrack:gallery:state',open:true,face:'front',inside:false,yaw:0,page:page,pageSize:PAGE_SIZE,focusWorkId:focusWorkId});}
function reportHeight(){var h=Math.ceil($('shell').getBoundingClientRect().height);if(h>0&&h!==lastHeight){lastHeight=h;send({type:'funtrack:gallery:resize',height:h});}}
function string(value,fallback,max){return typeof value==='string'?value.trim().slice(0,max||1000):fallback;}
function coverURL(value){if(typeof value!=='string'||!value.trim())return '';try{var url=new URL(value,location.href);return url.origin===location.origin&&['http:','https:'].indexOf(url.protocol)>=0?url.href:'';}catch{return '';}}
function websiteURL(value){try{var url=new URL(value);return ['http:','https:'].indexOf(url.protocol)>=0&&!url.username&&!url.password?url.href:'';}catch{return '';}}
function clean(payload){
  if(!payload||!payload.author||!Array.isArray(payload.works))return null;
  var seen=new Set(),works=[];payload.works.forEach(function(w){if(!w||typeof w.id!=='string'||!w.id||seen.has(w.id))return;seen.add(w.id);works.push({id:w.id,name:string(w.name,t('未命名作品'),140)||t('未命名作品'),desc:string(w.desc,'',1000),cover:coverURL(w.cover),kind:string(w.kind,'作品',80),version:string(w.version,'',40)});});
  if(works.length>30)return null;
  var author=payload.author;return{author:{id:string(author.id,'creator',128),name:string(author.name,t('创作者'),140)||t('创作者'),bio:string(author.bio,'',500),headline:string(author.headline,'',120),signature:string(author.signature,'',80),website:websiteURL(author.website)},works:works};
}
function currentWorks(){return data?data.works.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE):[];}
function indexOfFocus(){return currentWorks().findIndex(function(w){return w.id===focusWorkId;});}
function syncState(payload){
  var index=typeof payload.focusWorkId==='string'?data.works.findIndex(function(w){return w.id===payload.focusWorkId;}):-1;
  focusWorkId=index>=0?data.works[index].id:null;
  var pages=Math.max(1,Math.ceil(data.works.length/PAGE_SIZE));page=index>=0?Math.floor(index/PAGE_SIZE):Number.isInteger(payload.page)?Math.max(0,Math.min(pages-1,payload.page)):0;
}
function profile(){
  $('name').textContent=data.author.name;
  ['headline','bio','signature'].forEach(function(id){$(id).textContent=data.author[id];$(id).hidden=!data.author[id];});
  var a=$('website');a.hidden=!data.author.website;if(data.author.website){a.href=data.author.website;a.textContent=new URL(data.author.website).hostname+' ↗';}
}
function updateList(){
  var works=currentWorks(),list=$('works');list.replaceChildren();
  works.forEach(function(work){var li=document.createElement('li'),button=document.createElement('button');button.type='button';button.className='work';button.setAttribute('aria-label',t('打开作品：{name}',{name:work.name}));
    if(work.cover){var image=document.createElement('img');image.src=work.cover;image.alt='';image.loading='lazy';image.addEventListener('error',function(){image.hidden=true;},{once:true});button.appendChild(image);}
    var text=document.createElement('span'),title=document.createElement('strong'),desc=document.createElement('small');title.textContent=work.name;desc.textContent=work.desc||[t(work.kind),work.version].filter(Boolean).join(' · ');text.append(title,desc);button.appendChild(text);button.addEventListener('click',function(){openWork(work.id);});li.appendChild(button);list.appendChild(li);
  });
  var count=Math.max(1,Math.ceil(data.works.length/PAGE_SIZE));$('pager').hidden=count<=1;$('prev').disabled=page===0;$('next').disabled=page>=count-1;$('page-label').textContent=(page+1)+' / '+count;
  $('status').textContent=data.works.length?t('第 {page} 组，共 {count} 组作品',{page:page+1,count:count}):t('尚未选择作品');if(!heightObserver)reportHeight();
}
function openWork(id){if(!data||!data.works.some(function(w){return w.id===id;}))return;focusWorkId=id;state();send({type:'funtrack:gallery:open-work',workId:id,play:true});}
function fallback(message){
  failed=true;cancelAnimationFrame(raf);raf=0;canvas.hidden=true;$('fallback').hidden=false;$('fallback-title').textContent=t('作品列表');$('fallback-message').textContent=message||t('当前设备暂时无法显示作品桌面，可以从下方打开作品。');$('details').open=true;stage.dataset.state='fallback';reportHeight();
}
function releaseDesk(){if(desk){desk.dispose();desk=null;}SP.disposeCollectionMedia();}
function ensureCore(){if(failed)return false;if(core)return true;try{if(!window.THREE)throw Error();canvas.hidden=false;core=SP.createCore(canvas);core.shared.uEdge.value=1.9;core.resize();return true;}catch{if(core){core.dispose();core=null;}fallback();return false;}}
function fitCamera(){
  if(!core||!layout)return;var T=core.T,camera=core.camera,target=new T.Vector3(0,.08,.12),angle=1.07,th=Math.tan(16*PI/180),distance=Math.max(3,layout.width/(2*th*camera.aspect*.82),layout.depth*Math.sin(angle)/(2*th*.78)),point=new T.Vector3();
  for(var attempt=0;attempt<35;attempt++){
    camera.position.set(0,target.y+distance*Math.sin(angle),target.z+distance*Math.cos(angle));camera.lookAt(target);camera.updateMatrixWorld(true);
    var fits=true;[-1,1].forEach(function(x){[-1,1].forEach(function(z){[0,.52].forEach(function(y){point.set(x*(layout.width/2+.14),y,z*(layout.depth/2+.14)).project(camera);if(Math.abs(point.x)>.90||Math.abs(point.y)>.88)fits=false;});});});if(fits)break;distance*=1.055;
  }
}
function relayout(){if(!core||!desk)return;core.resize();layout=SP.makeCollectionLayout(canvas.clientWidth,canvas.clientHeight,currentWorks());desk.setLayout(layout);desk.resize();fitCamera();requestRender();}
function rebuild(){
  releaseDesk();profile();updateList();hoverIndex=-1;hover=currentWorks().map(function(){return 0;});light.x=lightTarget.x=0;light.z=lightTarget.z=-.5;$('hover-title').hidden=true;
  if(!data.works.length){canvas.hidden=true;$('fallback').hidden=false;$('fallback-title').textContent=t('尚未选择作品');$('fallback-message').textContent=t('先选入作品，再生成收藏桌面。');stage.dataset.state='empty';reportHeight();return;}
  if(!ensureCore()){fallback();return;}
  try{SP.loadCollectionMedia(currentWorks(),function(){if(desk){desk.refresh();requestRender();}});desk=SP.createDesk(core);canvas.hidden=false;$('fallback').hidden=true;stage.dataset.state='ready';relayout();core.resetTrail();requestRender();}
  catch{releaseDesk();fallback();}
}
function initialize(payload){applyGalleryLocale('collection',payload?.locale);var next=clean(payload);if(!next){fallback(t('这张名片的作品资料不完整，请返回后重试。'));return;}var nextKey=JSON.stringify({locale:getLocale(),data:next}),oldPage=page;data=next;syncState(payload);if(nextKey!==key||page!==oldPage||!desk){key=nextKey;rebuild();}else{updateList();requestRender();}state();}
function changePage(next){if(!data||next<0||next>=Math.ceil(data.works.length/PAGE_SIZE))return;page=next;focusWorkId=data.works[page*PAGE_SIZE]?.id||null;rebuild();state();}
function selectIndex(index){if(!data?.works.length)return;index=Math.max(0,Math.min(data.works.length-1,index));var nextPage=Math.floor(index/PAGE_SIZE);focusWorkId=data.works[index].id;if(nextPage!==page){page=nextPage;rebuild();}requestRender();state();$('status').textContent=data.works[index].name;}
function requestRender(){if(!disposed&&!document.hidden&&core&&desk&&!raf)raf=requestAnimationFrame(frame);}
function frame(now){
  raf=0;if(disposed||document.hidden||!core||!desk)return;
  var dt=lastTime?Math.min(.05,(now-lastTime)/1000):1/60;lastTime=now;var mix=motion.matches?1:Math.min(1,dt*13),moving=false;
  light.x+=(lightTarget.x-light.x)*mix;light.z+=(lightTarget.z-light.z)*mix;if(Math.abs(lightTarget.x-light.x)+Math.abs(lightTarget.z-light.z)>.003)moving=true;
  var selected=hoverIndex>=0?hoverIndex:indexOfFocus();for(var i=0;i<hover.length;i++){var target=i===selected?1:0;hover[i]+=(target-hover[i])*mix;if(Math.abs(target-hover[i])>.001)moving=true;else hover[i]=target;}
  desk.update({tt:0,clock:0,light:{x:light.x,y:3,z:light.z,I:1,R:7},uw:currentWorks().map(function(){return -10;}),hov:hover,load:1,open:1,sheets:0,folderK:1,all:1,grow:0,day:1,focusId:-1,focusK:0,fx:0,fz:0,fs:1,fy:0});
  core.scene.updateMatrixWorld(true);desk.prepass();core.render({trail:0,ab:0,grain:.012,vig:0});
  if(moving)requestRender();else lastTime=0;
}
function rayAt(event){if(!core||!desk)return null;var rect=canvas.getBoundingClientRect(),ray=new core.T.Raycaster(),point=new core.T.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);core.camera.updateMatrixWorld(true);core.scene.updateMatrixWorld(true);ray.setFromCamera(point,core.camera);return ray;}
function hit(event){var ray=rayAt(event);if(!ray)return -1;var hits=ray.intersectObject(desk.posterMesh,false);return hits.length&&Number.isInteger(hits[0].instanceId)?hits[0].instanceId:-1;}
function move(event){
  if(event.pointerType==='touch'||!core||!desk)return;var ray=rayAt(event),point=new core.T.Vector3();if(ray.ray.intersectPlane(new core.T.Plane(new core.T.Vector3(0,1,0),0),point)){lightTarget.x=Math.max(-layout.width/2-1,Math.min(layout.width/2+1,point.x));lightTarget.z=Math.max(-layout.depth/2-1,Math.min(layout.depth/2+1,point.z));}
  hoverIndex=hit(event);canvas.style.cursor=hoverIndex>=0?'pointer':'default';var tip=$('hover-title');tip.hidden=hoverIndex<0;if(hoverIndex>=0){tip.textContent=currentWorks()[hoverIndex].name;var rect=canvas.getBoundingClientRect();tip.style.left=Math.max(8,Math.min(rect.width-tip.offsetWidth-8,event.clientX-rect.left+12))+'px';tip.style.top=Math.max(8,Math.min(rect.height-35,event.clientY-rect.top-34))+'px';}requestRender();
}
listen(window,'message',function(event){if(event.source!==parent||event.origin!==location.origin)return;if(event.data?.type==='funtrack:gallery:init')initialize(event.data.payload);});
listen($('prev'),'click',function(){changePage(page-1);});listen($('next'),'click',function(){changePage(page+1);});
listen(canvas,'pointermove',move);
listen(canvas,'pointerleave',function(){hoverIndex=-1;$('hover-title').hidden=true;requestRender();});
listen(canvas,'pointerdown',function(event){if(event.button!==0)return;pointer={id:event.pointerId,x:event.clientX,y:event.clientY};});
listen(canvas,'pointercancel',function(){pointer=null;});
listen(canvas,'pointerup',function(event){if(!pointer||pointer.id!==event.pointerId)return;var dx=event.clientX-pointer.x,dy=event.clientY-pointer.y;pointer=null;if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.4){changePage(page+(dx<0?1:-1));return;}if(Math.hypot(dx,dy)>8)return;var i=hit(event);if(i>=0)openWork(currentWorks()[i].id);});
listen(canvas,'keydown',function(event){if(!data?.works.length)return;var index=data.works.findIndex(function(w){return w.id===focusWorkId;});if(index<0)index=page*PAGE_SIZE;if(['ArrowLeft','ArrowRight','Home','End'].indexOf(event.key)>=0){event.preventDefault();selectIndex(event.key==='Home'?0:event.key==='End'?data.works.length-1:index+(event.key==='ArrowLeft'?-1:1));}else if(event.key==='Enter'||event.key===' '){event.preventDefault();openWork(data.works[index].id);}});
listen(canvas,'webglcontextlost',function(event){event.preventDefault();fallback();});
listen($('details'),'toggle',reportHeight);
listen(document,'visibilitychange',function(){if(document.hidden){cancelAnimationFrame(raf);raf=0;lastTime=0;}else requestRender();});
if(motion.addEventListener)listen(motion,'change',requestRender);
if(window.ResizeObserver){stageObserver=new ResizeObserver(relayout);stageObserver.observe(stage);heightObserver=new ResizeObserver(reportHeight);heightObserver.observe($('shell'));}else listen(window,'resize',function(){relayout();reportHeight();});
function destroy(){if(disposed)return;disposed=true;cancelAnimationFrame(raf);listeners.forEach(function(off){off();});if(stageObserver)stageObserver.disconnect();if(heightObserver)heightObserver.disconnect();releaseDesk();if(core){core.dispose();core=null;}}
listen(window,'pagehide',function(event){if(!event.persisted)destroy();else{cancelAnimationFrame(raf);raf=0;}});listen(window,'pageshow',function(event){if(event.persisted){lastTime=0;requestRender();}});
send({type:'funtrack:gallery:ready'});reportHeight();
})();
