import {t,getLocale,applyGalleryLocale} from './i18n.js';
import {safeAvatarURL} from '../avatars.js';
applyGalleryLocale('gallery',new URLSearchParams(location.search).get('lang'),{first:true});
/* Host-driven adapter for the supplied 卡中展厅 Three.js paper model.
   No autoplay, fake metrics, external dependencies, or embedded game execution. */
(function(){
'use strict';
var PAGE_SIZE=window.FuntrackGallery.pageSize,SP=window.SP||{},PI=Math.PI;
var $=function(id){return document.getElementById(id);};
var canvas=$('gallery-canvas'),stage=$('stage'),status=$('gallery-status');
var toggle=$('toggle'),flip=$('flip'),enter=$('enter'),left=$('left'),right=$('right');
var core=null,paper=null,popup=null,raf=0,lastTime=0,disposed=false,failed=false;
var data=null,dataKey='',page=0,progress=0,faceProgress=0,targetOpen=false,targetFace='front',yaw=0,inside=false,fly=0;
var pointer=null,resizeObserver=null,heightObserver=null,lastHeight=0;
var focusWorkId=null,roomEye=null,roomLook=null,roomFov=66,roomFrom=null,roomMove=1,exitPose=null;
var motion=window.matchMedia('(prefers-reduced-motion: reduce)');
var listeners=[];
var documentId=crypto.randomUUID(),initializedRequestId=null;
function listen(target,type,fn,options){target.addEventListener(type,fn,options);listeners.push(function(){target.removeEventListener(type,fn,options);});}
function send(message){if(parent!==window)parent.postMessage(message,location.origin);}
function reportHeight(){var height=Math.ceil($('shell').getBoundingClientRect().height);if(height>0&&height!==lastHeight){lastHeight=height;send({type:'funtrack:gallery:resize',height:height});}}
function sendState(){send({type:'funtrack:gallery:state',open:targetOpen,face:targetFace,page:page,yaw:yaw,inside:inside,focusWorkId:focusWorkId,pageSize:PAGE_SIZE});}
function setText(node,value){if(node.textContent!==value)node.textContent=value;}
function text(value,fallback,max){return typeof value==='string'?value.trim().slice(0,max||1000):fallback;}
function cleanPayload(payload){
  if(!payload||!payload.author||!Array.isArray(payload.works))return null;
  var a=payload.author,website='';try{var u=new URL(a.website);if(/^https?:$/.test(u.protocol)&&!u.username&&!u.password)website=u.href;}catch(e){}
  var author={id:text(a.id,'creator',128)||'creator',name:text(a.name,t('创作者'),140)||t('创作者'),bio:text(a.bio,'',600),signature:text(a.signature,'',80),headline:text(a.headline,'',120),website:website,avatarUrl:safeAvatarURL(a.avatarUrl),backStyle:['ink','ivory','cobalt'].includes(a.backStyle)?a.backStyle:'ink'};
  var seen=new Set(),works=[];
  payload.works.forEach(function(w){
    if(!w||typeof w.id!=='string'||!w.id||seen.has(w.id))return;
    seen.add(w.id);var cover='';
    try{if(typeof w.cover==='string'&&w.cover.trim()){var url=new URL(w.cover,location.href);if(url.origin===location.origin&&(url.protocol==='https:'||url.protocol==='http:'))cover=url.href;}}catch(e){}
    works.push({id:w.id,name:text(w.name,t('未命名作品'),140)||t('未命名作品'),desc:text(w.desc,'',1000),cover:cover,kind:text(w.kind,'作品',80),version:text(w.version,'',40)});
  });
  var focus=works.some(function(w){return w.id===payload.focusWorkId;})?payload.focusWorkId:null;
  return {focusWorkId:focus,author:author,works:works,open:!!payload.open,inside:!!payload.inside&&!!payload.open,face:payload.face==='back'?'back':'front',page:Number.isFinite(payload.page)?Math.max(0,Math.min(Math.max(0,Math.ceil(works.length/PAGE_SIZE)-1),Math.floor(payload.page))):0,yaw:Number.isFinite(payload.yaw)?Math.max(-1.3,Math.min(1.3,payload.yaw)):0};
}
function pageWorks(){return data?data.works.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE):[];}
function openWork(id){
  if(!data||!data.works.some(function(w){return w.id===id;}))return;
  if(inside){focusWorkId=id;sendState();}
  send({type:'funtrack:gallery:open-work',workId:id,play:true});
}
function tourIds(){return data?SP.tourOrder(data.works,PAGE_SIZE):[];}
function selectedWork(){return data&&data.works.find(function(w){return w.id===focusWorkId;});}
function updateWorkNav(){
  var w=selectedWork(),order=tourIds(),index=order.indexOf(focusWorkId);
  $('work-nav').hidden=!inside||!w||failed;
  var previousFocus=document.activeElement;left.disabled=index<=0;right.disabled=index<0||index>=order.length-1;
  if(inside&&((previousFocus===left&&left.disabled)||(previousFocus===right&&right.disabled)))canvas.focus({preventScroll:true});
  left.hidden=right.hidden=order.length<2;
  setText($('current-title'),w?w.name:'');$('current-title').title=w?w.name:'';
  setText($('current-index'),w?(index+1)+' / '+order.length:'');
  setText($('play-current'),t(w&&w.kind==='外链作品'?'打开作品 ↗':'试玩 ↗'));
}
function focusWork(id,animate){
  var index=data?data.works.findIndex(function(w){return w.id===id;}):-1;if(index<0)return;
  roomFrom=roomEye?{eye:roomEye.clone(),look:roomLook.clone(),fov:roomFov}:null;
  roomMove=animate&&roomFrom&&!motion.matches?0:1;focusWorkId=id;
  var nextPage=Math.floor(index/PAGE_SIZE);if(nextPage!==page){page=nextPage;rebuild();}
  clearHover();updateWorkNav();sendState();requestRender();
}
function stepWork(delta){
  if(!inside||failed)return;var order=tourIds(),index=order.indexOf(focusWorkId),next=index+delta;
  if(next>=0&&next<order.length)focusWork(order[next],true);
}
function renderList(){
  var works=pageWorks(),list=$('works');list.replaceChildren();
  $('gallery-title').textContent=data.author.name;
  var a=data.author,copy=$('creator-copy');copy.textContent=[a.name,a.headline,a.bio,a.signature].filter(Boolean).join('\n');
  if(a.website){var link=document.createElement('a');link.href=a.website;link.target='_blank';link.rel='noopener noreferrer';link.textContent=a.website.replace(/^https?:\/\//,'');copy.append(document.createElement('br'),link);}
  $('summary-label').textContent=t('{count} 件作品 · 关于 {name}',{count:data.works.length,name:a.name});
  $('work-count').textContent=t('已选 {count} 件作品',{count:data.works.length});
  $('empty').hidden=data.works.length>0;$('empty').textContent=t('还没有选入作品。请返回上一步选择作品。');
  works.forEach(function(w){
    var li=document.createElement('li'),button=document.createElement('button');button.className='work';button.type='button';button.setAttribute('aria-label',t('查看作品：{name}',{name:w.name}));
    if(w.cover){var img=document.createElement('img');img.src=w.cover;img.alt='';img.loading='lazy';img.addEventListener('error',function(){img.hidden=true;},{once:true});button.appendChild(img);}
    var copy=document.createElement('span');copy.className='copy';var strong=document.createElement('strong');strong.textContent=w.name;var small=document.createElement('small');small.textContent=w.desc||[t(w.kind),w.version].filter(Boolean).join(' · ');copy.append(strong,small);button.appendChild(copy);
    var arrow=document.createElement('span');arrow.className='arrow';arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');button.appendChild(arrow);
    button.addEventListener('click',function(){openWork(w.id);});li.appendChild(button);list.appendChild(li);
  });
  var pages=Math.ceil(data.works.length/PAGE_SIZE);$('paging').hidden=pages<=1;$('prev').disabled=page===0;$('next').disabled=page>=pages-1;
  $('page-label').textContent=(page+1)+' / '+pages;$('page-note').hidden=pages<=1;
  $('page-note').textContent=t('每组展出最多 {size} 件；当前第 {from}–{to} 件。切换分组可查看全部已选作品。',{size:PAGE_SIZE,from:page*PAGE_SIZE+1,to:Math.min((page+1)*PAGE_SIZE,data.works.length)});
}
function hasWorks(){return !!(data&&data.works.length);}
function animating(){return Math.abs(progress-(targetOpen?1:0))>.0001||Math.abs(faceProgress-(targetFace==='back'?1:0))>.0001||Math.abs(fly-(inside?1:0))>.0001||(inside&&roomMove<1);}
function updateUI(){
  var available=hasWorks()&&!failed&&!!popup;
  toggle.disabled=!available;toggle.hidden=!available||inside||fly>.001;toggle.textContent=t(targetOpen?'收起名片':'展开展厅 ↗');toggle.setAttribute('aria-pressed',String(targetOpen));
  flip.disabled=!available||targetOpen||progress>.0001;flip.hidden=flip.disabled;flip.setAttribute('aria-label',t(targetFace==='front'?'翻到背面':'翻到正面'));flip.title=flip.getAttribute('aria-label');
  enter.disabled=!available||progress<.999;enter.hidden=!available||!targetOpen||progress<.999||inside||fly>.001;
  $('room-nav').hidden=!available||!inside;updateWorkNav();
  stage.dataset.face=targetFace;if(!heightObserver)reportHeight();
  if(!hasWorks()){stage.dataset.state=data?'empty':'waiting';status.textContent=data?t('尚未选择作品'):t('等待作品');return;}
  if(failed){stage.dataset.state='fallback';status.textContent=t('作品列表模式');return;}
  var moving=animating();stage.dataset.state=moving?(inside?'entering':fly>.001?'leaving':targetOpen?'opening':progress>.0001?'closing':'flipping'):inside?'inside':targetOpen?'open':'closed';
  if(inside&&fly>.999&&roomMove<1)stage.dataset.state='browsing';
  if(inside&&fly>.999){var focused=selectedWork();setText(status,focused?t('正在浏览 {name}',{name:focused.name}):t('已进入展厅'));return;}
  status.textContent=t(moving?(inside?'正在走进展厅…':fly>.001?'正在返回名片…':targetOpen?'正在展开展厅…':progress>.0001?'正在收起展厅…':'正在翻面…'):inside?'已进入展厅':targetOpen?'展厅已展开':targetFace==='front'?'展厅已收起 · 正面':'展厅已收起 · 背面');
}
function showFallback(message){
  failed=true;cancelAnimationFrame(raf);raf=0;canvas.hidden=true;$('fallback').hidden=false;
  $('details').open=true;
  $('fallback-title').textContent=t('作品仍在这里');$('fallback-message').textContent=message||t('当前浏览器暂时无法显示 3D 展厅。可以通过下方作品按钮继续查看。');updateUI();
}
function releaseScene(){
  if(popup){popup.dispose();popup=null;}
  if(paper){paper.dispose();paper=null;}
  if(core){core.dispose();core=null;}
}
function ensureCore(){
  if(failed)return false;if(core)return true;
  try{
    if(!window.THREE||!SP.createCore)throw new Error('Renderer unavailable');
    canvas.hidden=false;core=SP.createCore(canvas);paper=SP.createPaper(core);core.shared.uEdge.value=1.9;core.resize();
    return true;
  }catch(e){releaseScene();showFallback();return false;}
}
function rebuild(){
  if(popup){popup.dispose();popup=null;}
  renderList();
  if(!hasWorks()){
    canvas.hidden=true;$('fallback').hidden=false;$('fallback-title').textContent=t('尚未选择作品');$('fallback-message').textContent=t('返回上一步选入作品后，再生成卡中展厅。');updateUI();return;
  }
  if(!ensureCore()){showFallback();return;}
  try{
    SP.configurePrints(data.author,pageWorks(),data.works.length,page*PAGE_SIZE);
    popup=SP.createPopup(core,paper,requestRender);canvas.hidden=false;$('fallback').hidden=true;
    core.resize();core.resetTrail();updateUI();requestRender();
  }catch(e){releaseScene();showFallback();}
}
function initialize(payload){
  applyGalleryLocale('gallery',payload?.locale);
  var next=cleanPayload(payload);if(!next)return false;
  var key=JSON.stringify({locale:getLocale(),author:next.author,works:next.works});
  targetOpen=next.open&&next.works.length>0;targetFace=targetOpen?'front':next.face;
  progress=targetOpen?1:0;faceProgress=targetFace==='back'?1:0;
  inside=next.inside&&targetOpen;fly=inside?1:0;
  var oldPage=page,mustRebuild=key!==dataKey;
  data=next;dataKey=key;page=next.page;yaw=next.yaw;focusWorkId=next.focusWorkId;
  if(focusWorkId)page=Math.floor(data.works.findIndex(function(w){return w.id===focusWorkId;})/PAGE_SIZE);
  if(inside&&!focusWorkId)focusWorkId=pageWorks()[0].id;
  roomEye=roomLook=roomFrom=exitPose=null;roomMove=1;
  mustRebuild=mustRebuild||oldPage!==page;
  if(mustRebuild)rebuild();else{updateUI();requestRender();}
  sendState();return true;
}
function setOpen(open){
  if(!popup||failed)return;targetOpen=!!open;if(targetOpen)targetFace='front';else inside=false;
  if(motion.matches){progress=targetOpen?1:0;faceProgress=targetFace==='back'?1:0;fly=inside?1:0;}
  lastTime=0;updateUI();sendState();requestRender();
}
function enterRoom(value){
  if(!popup||failed||!targetOpen)return;inside=!!value;yaw=0;
  if(inside&&!selectedWork())focusWorkId=pageWorks()[0].id;
  if(!inside&&roomEye)exitPose={eye:roomEye.clone(),look:roomLook.clone(),fov:roomFov};
  if(inside){exitPose=null;roomFrom=fly>.001&&roomEye?{eye:roomEye.clone(),look:roomLook.clone(),fov:roomFov}:null;roomMove=roomFrom&&!motion.matches?0:1;}
  else{roomMove=1;roomFrom=null;}
  if(motion.matches)fly=inside?1:0;
  lastTime=0;clearHover();updateUI();canvas.focus({preventScroll:true});sendState();requestRender();
}
function flipCard(){
  if(!popup||targetOpen||progress>.0001||failed)return;
  targetFace=targetFace==='front'?'back':'front';if(motion.matches)faceProgress=targetFace==='back'?1:0;
  lastTime=0;updateUI();sendState();requestRender();
}
function changePage(next){
  if(!data||next<0||next>=Math.ceil(data.works.length/PAGE_SIZE))return;
  if(inside){focusWork(data.works[next*PAGE_SIZE].id,true);return;}
  focusWorkId=null;page=next;rebuild();sendState();
}
function moveTowards(value,goal,step){return value<goal?Math.min(goal,value+step):Math.max(goal,value-step);}
function draw(){
  if(!core||!popup)return;
  var T=core.T,U=SP.u,st={},p=progress,stand=1-U.eio(U.seg(p,0,.38));
  st.thL=PI/2*U.eio(U.seg(p,.25,.62));st.thR=PI/2*U.eio(U.seg(p,.30,.67));st.thB=PI/2*U.eio(U.seg(p,.42,.80));
  st.bench=PI/2*U.eo5(U.seg(p,.68,.89));st.figA=PI/2*U.eo5(U.seg(p,.74,.94));st.figB=PI/2*U.eo5(U.seg(p,.79,1));
  st.pop=pageWorks().map(function(w,i){return U.eio(U.seg(p,.66+i*.012,.90+i*.01));});st.wake=st.pop;
  popup.update(st,0);
  var angle=(1-stand)*PI/2;popup.root.position.set(0,SP.prints.H/2*Math.cos(angle)+.5*stand,0);popup.root.rotation.order='YXZ';popup.root.rotation.set(-angle,PI*U.eio(faceProgress)*(1-p),0);
  core.scene.updateMatrixWorld(true);
  var blend=U.eio(p),tour=U.eio(fly),asp=core.camera.aspect,az=(-.10+Math.max(-.65,Math.min(.85,yaw)))*blend,el=U.lerp(.015,.54,blend);
  var box=new T.Box3().setFromObject(popup.root),target=box.getCenter(new T.Vector3());
  var direction=new T.Vector3(Math.sin(az)*Math.cos(el),Math.sin(el),Math.cos(az)*Math.cos(el));
  var rightV=new T.Vector3().crossVectors(new T.Vector3(0,1,0),direction).normalize(),upV=new T.Vector3().crossVectors(direction,rightV).normalize();
  var th=Math.tan(16*PI/180),d=2,margin=.88;
  [box.min.x,box.max.x].forEach(function(x){[box.min.y,box.max.y].forEach(function(y){[box.min.z,box.max.z].forEach(function(z){
    var v=new T.Vector3(x,y,z).sub(target),depth=v.dot(direction);
    d=Math.max(d,depth+Math.abs(v.dot(rightV))/(th*asp*margin),depth+Math.abs(v.dot(upV))/(th*margin));
  });});});
  var outer=target.clone().addScaledVector(direction,d),mesh=popup.targets.find(function(m){return m.userData.workId===focusWorkId;})||popup.targets[0];
  var pose=(!inside&&fly>.0001&&exitPose)||(mesh&&p>.999?SP.tourPose(T,mesh,asp):null)||{eye:new T.Vector3(0,.68,.30),look:new T.Vector3(0,.64,-1.5),fov:66};
  if(!roomEye){roomEye=pose.eye.clone();roomLook=pose.look.clone();roomFov=pose.fov;}
  var travel=U.eio(roomMove);
  roomEye.copy(roomFrom?roomFrom.eye:pose.eye).lerp(pose.eye,travel);
  if(roomFrom&&travel<1){
    var fromDir=roomFrom.look.clone().sub(roomFrom.eye).normalize(),toDir=pose.look.clone().sub(pose.eye).normalize();
    var fromYaw=Math.atan2(fromDir.x,-fromDir.z),toYaw=Math.atan2(toDir.x,-toDir.z),turn=Math.atan2(Math.sin(toYaw-fromYaw),Math.cos(toYaw-fromYaw));
    // Opposite walls pass through the back-wall view, never through a zero look vector.
    if(Math.abs(Math.abs(turn)-PI)<.001)turn=fromYaw>0?-PI:PI;
    var heading=fromYaw+turn*travel,vertical=U.lerp(fromDir.y,toDir.y,travel);
    roomLook.copy(roomEye).add(new T.Vector3(Math.sin(heading),vertical,-Math.cos(heading)).normalize());
  }else roomLook.copy(pose.look);
  roomFov=U.lerp(roomFrom?roomFrom.fov:pose.fov,pose.fov,travel);
  core.camera.fov=U.lerp(32,roomFov,tour);core.camera.near=.04;core.camera.updateProjectionMatrix();
  core.camera.position.copy(outer.lerp(roomEye,tour));core.camera.lookAt(target.lerp(roomLook,tour));
  core.camera.updateMatrixWorld(true);if(fly<.0001)exitPose=null;
  positionHotspot(toggle,new T.Vector3(0,-2.04,.07));
  positionHotspot(flip,new T.Vector3(targetFace==='back'?-1.18:1.18,2.02,targetFace==='back'?-.07:.07));
  positionHotspot(enter,new T.Vector3(0,-.48,.06));
  paper.aim(new T.Vector3(0,U.lerp(.3,1.6,stand),-.2),3.7);
  core.shared.uTime.value=0;core.scene.updateMatrixWorld(true);
  core.render({trail:0,ab:0,grain:.018,vig:0});
  // Shadow texture is allocated by the first render, then bound to the paper shader.
  if(!paper._shadowReady){paper._shadowReady=true;paper.aim(new T.Vector3(0,U.lerp(.3,1.6,stand),-.2),3.7);core.render({trail:0,ab:0,grain:.018,vig:0});}
}
function frame(now){
  raf=0;if(disposed||document.hidden||!core||!popup)return;
  var dt=lastTime?Math.min(.05,(now-lastTime)/1000):1/60;lastTime=now;
  if(motion.matches){progress=targetOpen?1:0;faceProgress=targetFace==='back'?1:0;fly=inside?1:0;roomMove=1;}
  else{
    roomMove=moveTowards(roomMove,1,dt/.7);
    if(fly<.0001&&(!targetOpen||faceProgress<.0001))progress=moveTowards(progress,targetOpen?1:0,dt/1.3);
    if(progress<.0001)faceProgress=moveTowards(faceProgress,targetFace==='back'?1:0,dt/.65);
    if(!inside||progress>.999)fly=moveTowards(fly,inside?1:0,dt/.85);
  }
  draw();updateUI();if(animating())requestRender();else lastTime=0;
}
function requestRender(){if(!disposed&&!document.hidden&&!raf&&core&&popup)raf=requestAnimationFrame(frame);}
function positionHotspot(button,point){
  if(!popup||!core)return;point.applyMatrix4(popup.root.matrixWorld).project(core.camera);
  button.style.left=((point.x+1)*.5*canvas.clientWidth)+'px';button.style.top=((-point.y+1)*.5*canvas.clientHeight)+'px';
}
function rotate(delta){if(!targetOpen||failed)return;var next=Math.max(inside?-1.3:-.65,Math.min(inside?1.3:.85,yaw+delta));if(next===yaw)return;yaw=next;clearHover();sendState();requestRender();}
function hitAt(event){
  if(!popup||failed||animating())return null;
  var rect=canvas.getBoundingClientRect(),point=new core.T.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
  core.camera.updateMatrixWorld(true);core.scene.updateMatrixWorld(true);
  var ray=new core.T.Raycaster();ray.setFromCamera(point,core.camera);
  return ray.intersectObjects(popup.root.children,true)[0]||null;
}
function clearHover(){canvas.style.cursor='default';$('hover-label').hidden=true;}
function hover(event){
  var hit=hitAt(event);if(!hit){clearHover();return;}
  var id=hit.object.userData.workId,w=id&&data.works.find(function(w){return w.id===id;});
  if(w&&targetOpen){canvas.style.cursor='pointer';$('hover-label').textContent=w.name+' · '+t(w.kind==='外链作品'?'打开作品 ↗':'试玩 ↗');$('hover-label').hidden=false;}
  else if(!targetOpen){canvas.style.cursor='pointer';$('hover-label').hidden=true;}else clearHover();
}
function pick(event){
  var hit=hitAt(event);if(!hit)return;
  if(!targetOpen){setOpen(true);return;}
  if(hit.object.userData.workId)openWork(hit.object.userData.workId);
}
listen(window,'message',function(event){
  if(event.source!==parent||event.origin!==location.origin)return;
  var message=event.data;
  if(message&&message.type==='funtrack:gallery:init'){
    // Retransmission acknowledges the same scene without resetting its camera.
    if(message.requestId!==initializedRequestId||initializedRequestId===null){if(!initialize(message.payload))return;initializedRequestId=message.requestId;}
    send({type:'funtrack:gallery:initialized',requestId:message.requestId,state:failed?'fallback':hasWorks()?'rendered':'empty'});
  }
});
listen(toggle,'click',function(){setOpen(!targetOpen);});listen(flip,'click',flipCard);
listen(enter,'click',function(){enterRoom(true);});listen($('leave'),'click',function(){enterRoom(false);});
listen(left,'click',function(){stepWork(-1);});listen(right,'click',function(){stepWork(1);});
listen($('play-current'),'click',function(){if(focusWorkId)openWork(focusWorkId);});
listen($('prev'),'click',function(){changePage(page-1);});listen($('next'),'click',function(){changePage(page+1);});
listen(canvas,'pointerdown',function(event){if(event.button!==0)return;pointer={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,moved:false};canvas.setPointerCapture(event.pointerId);});
listen(canvas,'pointermove',function(event){
  if(!pointer){hover(event);return;}if(pointer.id!==event.pointerId)return;
  if(Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>7)pointer.moved=true;
  if(pointer.moved&&targetOpen&&!inside&&Math.abs(event.clientX-pointer.x)>Math.abs(event.clientY-pointer.y))rotate((event.clientX-pointer.lastX)*.006);pointer.lastX=event.clientX;
});
listen(canvas,'pointerup',function(event){
  if(!pointer||pointer.id!==event.pointerId)return;var wasMoved=pointer.moved,dx=event.clientX-pointer.x,dy=event.clientY-pointer.y;pointer=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
  if(inside&&wasMoved&&Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy)*1.4)stepWork(dx<0?1:-1);else if(!wasMoved)pick(event);
});
listen(canvas,'pointercancel',function(){pointer=null;});listen(canvas,'pointerleave',clearHover);
listen(stage,'keydown',function(event){
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();if(inside)stepWork(event.key==='ArrowLeft'?-1:1);else rotate(event.key==='ArrowLeft'?-.18:.18);}
  else if(event.target===canvas&&(event.key==='Enter'||event.key===' ')){event.preventDefault();if(inside&&focusWorkId)openWork(focusWorkId);else setOpen(!targetOpen);}
  else if(event.key.toLowerCase()==='f'&&!targetOpen){event.preventDefault();flipCard();}
  else if(event.key.toLowerCase()==='g'&&targetOpen){event.preventDefault();enterRoom(true);}
  else if(event.key==='Escape'&&targetOpen){event.preventDefault();if(inside)enterRoom(false);else setOpen(false);}
});
listen(canvas,'webglcontextlost',function(event){event.preventDefault();showFallback(t('3D 显示已暂停。可以通过下方作品按钮继续查看，重新打开名片可重试 3D。'));});
listen(document,'visibilitychange',function(){if(document.hidden){cancelAnimationFrame(raf);raf=0;lastTime=0;}else requestRender();});
function onResize(){if(core){core.resize();requestRender();}if(!heightObserver)reportHeight();}
if(window.ResizeObserver){resizeObserver=new ResizeObserver(onResize);resizeObserver.observe(stage);heightObserver=new ResizeObserver(reportHeight);heightObserver.observe($('shell'));}else listen(window,'resize',onResize);
function onMotion(){if(motion.matches){progress=targetOpen?1:0;faceProgress=targetFace==='back'?1:0;fly=inside?1:0;roomMove=1;updateUI();requestRender();}}
if(motion.addEventListener)listen(motion,'change',onMotion);
function destroy(){if(disposed)return;disposed=true;cancelAnimationFrame(raf);raf=0;if(resizeObserver)resizeObserver.disconnect();if(heightObserver)heightObserver.disconnect();listeners.forEach(function(off){off();});listeners=[];releaseScene();}
listen(window,'pagehide',function(event){if(!event.persisted)destroy();else{cancelAnimationFrame(raf);raf=0;}});
listen(window,'pageshow',function(event){if(event.persisted){lastTime=0;requestRender();}});
send({type:'funtrack:gallery:ready',documentId:documentId});reportHeight();
})();
