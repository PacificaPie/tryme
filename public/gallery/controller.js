/* Host-driven adapter for the supplied 卡中展厅 Three.js paper model.
   No autoplay, fake metrics, external dependencies, or embedded game execution. */
(function(){
'use strict';
var PAGE_SIZE=9,SP=window.SP||{},PI=Math.PI;
var $=function(id){return document.getElementById(id);};
var canvas=$('gallery-canvas'),stage=$('stage'),status=$('gallery-status');
var toggle=$('toggle'),flip=$('flip'),enter=$('enter'),left=$('left'),right=$('right');
var core=null,paper=null,popup=null,raf=0,lastTime=0,disposed=false,failed=false;
var data=null,dataKey='',page=0,progress=0,faceProgress=0,targetOpen=false,targetFace='front',yaw=0,inside=false,fly=0;
var pointer=null,resizeObserver=null,heightObserver=null,lastHeight=0;
var motion=window.matchMedia('(prefers-reduced-motion: reduce)');
var listeners=[];
function listen(target,type,fn,options){target.addEventListener(type,fn,options);listeners.push(function(){target.removeEventListener(type,fn,options);});}
function send(message){if(parent!==window)parent.postMessage(message,location.origin);}
function reportHeight(){var height=Math.ceil($('shell').getBoundingClientRect().height);if(height>0&&height!==lastHeight){lastHeight=height;send({type:'funtrack:gallery:resize',height:height});}}
function sendState(){send({type:'funtrack:gallery:state',open:targetOpen,face:targetFace,page:page,yaw:yaw,inside:inside});}
function text(value,fallback,max){return typeof value==='string'?value.trim().slice(0,max||1000):fallback;}
function cleanPayload(payload){
  if(!payload||!payload.author||!Array.isArray(payload.works))return null;
  var a=payload.author,website='';try{var u=new URL(a.website);if(/^https?:$/.test(u.protocol)&&!u.username&&!u.password)website=u.href;}catch(e){}
  var author={id:text(a.id,'creator',128)||'creator',name:text(a.name,'创作者',140)||'创作者',bio:text(a.bio,'',600),signature:text(a.signature,'',80),headline:text(a.headline,'',120),website:website,backStyle:['ink','ivory','cobalt'].includes(a.backStyle)?a.backStyle:'ink'};
  var seen=new Set(),works=[];
  payload.works.forEach(function(w){
    if(!w||typeof w.id!=='string'||!w.id||seen.has(w.id))return;
    seen.add(w.id);var cover='';
    try{if(typeof w.cover==='string'&&w.cover.trim()){var url=new URL(w.cover,location.href);if(url.origin===location.origin&&(url.protocol==='https:'||url.protocol==='http:'))cover=url.href;}}catch(e){}
    works.push({id:w.id,name:text(w.name,'未命名作品',140)||'未命名作品',desc:text(w.desc,'',1000),cover:cover,kind:text(w.kind,'作品',80),version:text(w.version,'',40)});
  });
  return {author:author,works:works,open:!!payload.open,inside:!!payload.inside&&!!payload.open,face:payload.face==='back'?'back':'front',page:Number.isFinite(payload.page)?Math.max(0,Math.min(Math.max(0,Math.ceil(works.length/PAGE_SIZE)-1),Math.floor(payload.page))):0,yaw:Number.isFinite(payload.yaw)?Math.max(-1.3,Math.min(1.3,payload.yaw)):0};
}
function pageWorks(){return data?data.works.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE):[];}
function openWork(id){if(data&&data.works.some(function(w){return w.id===id;}))send({type:'funtrack:gallery:open-work',workId:id,play:true});}
function renderList(){
  var works=pageWorks(),list=$('works');list.replaceChildren();
  $('gallery-title').textContent=data.author.name;
  var a=data.author,copy=$('creator-copy');copy.textContent=[a.name,a.headline,a.bio,a.signature].filter(Boolean).join('\n');
  if(a.website){var link=document.createElement('a');link.href=a.website;link.target='_blank';link.rel='noopener noreferrer';link.textContent=a.website.replace(/^https?:\/\//,'');copy.append(document.createElement('br'),link);}
  $('summary-label').textContent=data.works.length+' 件作品 · 关于 '+a.name;
  $('work-count').textContent='已选 '+data.works.length+' 件作品';
  $('empty').hidden=data.works.length>0;$('empty').textContent='还没有选入作品。请返回上一步选择作品。';
  works.forEach(function(w){
    var li=document.createElement('li'),button=document.createElement('button');button.className='work';button.type='button';button.setAttribute('aria-label','查看作品：'+w.name);
    if(w.cover){var img=document.createElement('img');img.src=w.cover;img.alt='';img.loading='lazy';img.addEventListener('error',function(){img.hidden=true;},{once:true});button.appendChild(img);}
    var copy=document.createElement('span');copy.className='copy';var strong=document.createElement('strong');strong.textContent=w.name;var small=document.createElement('small');small.textContent=w.desc||[w.kind,w.version].filter(Boolean).join(' · ');copy.append(strong,small);button.appendChild(copy);
    var arrow=document.createElement('span');arrow.className='arrow';arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');button.appendChild(arrow);
    button.addEventListener('click',function(){openWork(w.id);});li.appendChild(button);list.appendChild(li);
  });
  var pages=Math.ceil(data.works.length/PAGE_SIZE);$('paging').hidden=pages<=1;$('prev').disabled=page===0;$('next').disabled=page>=pages-1;
  $('page-label').textContent=(page+1)+' / '+pages;$('page-note').hidden=pages<=1;
  $('page-note').textContent='每组展出最多 9 件；当前第 '+(page*PAGE_SIZE+1)+'–'+Math.min((page+1)*PAGE_SIZE,data.works.length)+' 件。切换分组可查看全部已选作品。';
}
function hasWorks(){return !!(data&&data.works.length);}
function animating(){return Math.abs(progress-(targetOpen?1:0))>.0001||Math.abs(faceProgress-(targetFace==='back'?1:0))>.0001||Math.abs(fly-(inside?1:0))>.0001;}
function updateUI(){
  var available=hasWorks()&&!failed&&!!popup;
  toggle.disabled=!available;toggle.hidden=!available||inside||fly>.001;toggle.textContent=targetOpen?'收起名片':'展开展厅 ↗';toggle.setAttribute('aria-pressed',String(targetOpen));
  flip.disabled=!available||targetOpen||progress>.0001;flip.hidden=flip.disabled;flip.setAttribute('aria-label',targetFace==='front'?'翻到背面':'翻到正面');flip.title=flip.getAttribute('aria-label');
  enter.disabled=!available||progress<.999;enter.hidden=!available||!targetOpen||progress<.999||inside||fly>.001;
  $('room-nav').hidden=!available||!inside;left.disabled=right.disabled=!inside;
  stage.dataset.face=targetFace;if(!heightObserver)reportHeight();
  if(!hasWorks()){stage.dataset.state=data?'empty':'waiting';status.textContent=data?'尚未选择作品':'等待作品';return;}
  if(failed){stage.dataset.state='fallback';status.textContent='作品列表模式';return;}
  var moving=animating();stage.dataset.state=moving?(inside?'entering':fly>.001?'leaving':targetOpen?'opening':progress>.0001?'closing':'flipping'):inside?'inside':targetOpen?'open':'closed';
  status.textContent=moving?(inside?'正在走进展厅…':fly>.001?'正在返回名片…':targetOpen?'正在展开展厅…':progress>.0001?'正在收起展厅…':'正在翻面…'):inside?'已进入展厅':targetOpen?'展厅已展开':'展厅已收起 · '+(targetFace==='front'?'正面':'背面');
}
function showFallback(message){
  failed=true;cancelAnimationFrame(raf);raf=0;canvas.hidden=true;$('fallback').hidden=false;
  $('details').open=true;
  $('fallback-title').textContent='作品仍在这里';$('fallback-message').textContent=message||'当前浏览器暂时无法显示 3D 展厅。可以通过下方作品按钮继续查看。';updateUI();
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
    canvas.hidden=true;$('fallback').hidden=false;$('fallback-title').textContent='尚未选择作品';$('fallback-message').textContent='返回上一步选入作品后，再生成卡中展厅。';updateUI();return;
  }
  if(!ensureCore()){showFallback();return;}
  try{
    SP.configurePrints(data.author,pageWorks(),data.works.length,page*PAGE_SIZE);
    popup=SP.createPopup(core,paper,requestRender);canvas.hidden=false;$('fallback').hidden=true;
    core.resize();core.resetTrail();updateUI();requestRender();
  }catch(e){releaseScene();showFallback();}
}
function initialize(payload){
  var next=cleanPayload(payload);if(!next)return;
  var key=JSON.stringify({author:next.author,works:next.works});
  targetOpen=next.open&&next.works.length>0;targetFace=targetOpen?'front':next.face;
  progress=targetOpen?1:0;faceProgress=targetFace==='back'?1:0;
  inside=next.inside&&targetOpen;fly=inside?1:0;
  var mustRebuild=key!==dataKey||page!==next.page;
  data=next;dataKey=key;page=next.page;yaw=next.yaw;
  if(mustRebuild)rebuild();else{updateUI();requestRender();}
  sendState();
}
function setOpen(open){
  if(!popup||failed)return;targetOpen=!!open;if(targetOpen)targetFace='front';else inside=false;
  if(motion.matches){progress=targetOpen?1:0;faceProgress=targetFace==='back'?1:0;fly=inside?1:0;}
  lastTime=0;updateUI();sendState();requestRender();
}
function enterRoom(value){if(!popup||failed||!targetOpen)return;inside=!!value;yaw=0;if(motion.matches)fly=inside?1:0;lastTime=0;clearHover();updateUI();canvas.focus({preventScroll:true});sendState();requestRender();}
function flipCard(){
  if(!popup||targetOpen||progress>.0001||failed)return;
  targetFace=targetFace==='front'?'back':'front';if(motion.matches)faceProgress=targetFace==='back'?1:0;
  lastTime=0;updateUI();sendState();requestRender();
}
function changePage(next){
  if(!data||next<0||next>=Math.ceil(data.works.length/PAGE_SIZE))return;
  page=next;rebuild();sendState();
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
  var outer=target.clone().addScaledVector(direction,d),eye=new T.Vector3(0,.68,.30),look=new T.Vector3(Math.sin(yaw)*2.15,.64,.30-Math.cos(yaw)*2.15);
  core.camera.fov=U.lerp(32,66,tour);core.camera.near=.04;core.camera.updateProjectionMatrix();
  core.camera.position.copy(outer.lerp(eye,tour));core.camera.lookAt(target.lerp(look,tour));
  core.camera.updateMatrixWorld(true);
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
  if(motion.matches){progress=targetOpen?1:0;faceProgress=targetFace==='back'?1:0;fly=inside?1:0;}
  else{
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
function clearHover(){canvas.style.cursor=inside?'grab':'default';$('hover-label').hidden=true;}
function hover(event){
  var hit=hitAt(event);if(!hit){clearHover();return;}
  var id=hit.object.userData.workId,w=id&&data.works.find(function(w){return w.id===id;});
  if(w&&targetOpen){canvas.style.cursor='pointer';$('hover-label').textContent=w.name+' · 试玩 ↗';$('hover-label').hidden=false;}
  else if(!targetOpen){canvas.style.cursor='pointer';$('hover-label').hidden=true;}else clearHover();
}
function pick(event){
  var hit=hitAt(event);if(!hit)return;
  if(!targetOpen){setOpen(true);return;}
  if(hit.object.userData.workId)openWork(hit.object.userData.workId);
}
listen(window,'message',function(event){
  if(event.source!==parent||event.origin!==location.origin)return;
  if(event.data&&event.data.type==='funtrack:gallery:init')initialize(event.data.payload);
});
listen(toggle,'click',function(){setOpen(!targetOpen);});listen(flip,'click',flipCard);
listen(enter,'click',function(){enterRoom(true);});listen($('leave'),'click',function(){enterRoom(false);});
listen(left,'click',function(){rotate(-.18);});listen(right,'click',function(){rotate(.18);});
listen($('prev'),'click',function(){changePage(page-1);});listen($('next'),'click',function(){changePage(page+1);});
listen(canvas,'pointerdown',function(event){if(event.button!==0)return;pointer={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,moved:false};canvas.setPointerCapture(event.pointerId);});
listen(canvas,'pointermove',function(event){
  if(!pointer){hover(event);return;}if(pointer.id!==event.pointerId)return;
  if(Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>7)pointer.moved=true;
  if(pointer.moved&&targetOpen&&Math.abs(event.clientX-pointer.x)>Math.abs(event.clientY-pointer.y))rotate((event.clientX-pointer.lastX)*.006);pointer.lastX=event.clientX;
});
listen(canvas,'pointerup',function(event){
  if(!pointer||pointer.id!==event.pointerId)return;var wasMoved=pointer.moved;pointer=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);if(!wasMoved)pick(event);
});
listen(canvas,'pointercancel',function(){pointer=null;});listen(canvas,'pointerleave',clearHover);
listen(canvas,'keydown',function(event){
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();rotate(event.key==='ArrowLeft'?-.18:.18);}
  else if(event.key==='Enter'||event.key===' '){event.preventDefault();setOpen(!targetOpen);}
  else if(event.key.toLowerCase()==='f'&&!targetOpen){event.preventDefault();flipCard();}
  else if(event.key.toLowerCase()==='g'&&targetOpen){event.preventDefault();enterRoom(true);}
  else if(event.key==='Escape'&&targetOpen){event.preventDefault();if(inside)enterRoom(false);else setOpen(false);}
});
listen(canvas,'webglcontextlost',function(event){event.preventDefault();showFallback('3D 显示已暂停。可以通过下方作品按钮继续查看，重新打开名片可重试 3D。');});
listen(document,'visibilitychange',function(){if(document.hidden){cancelAnimationFrame(raf);raf=0;lastTime=0;}else requestRender();});
function onResize(){if(core){core.resize();requestRender();}if(!heightObserver)reportHeight();}
if(window.ResizeObserver){resizeObserver=new ResizeObserver(onResize);resizeObserver.observe(stage);heightObserver=new ResizeObserver(reportHeight);heightObserver.observe($('shell'));}else listen(window,'resize',onResize);
function onMotion(){if(motion.matches){progress=targetOpen?1:0;faceProgress=targetFace==='back'?1:0;fly=inside?1:0;updateUI();requestRender();}}
if(motion.addEventListener)listen(motion,'change',onMotion);
function destroy(){if(disposed)return;disposed=true;cancelAnimationFrame(raf);raf=0;if(resizeObserver)resizeObserver.disconnect();if(heightObserver)heightObserver.disconnect();listeners.forEach(function(off){off();});listeners=[];releaseScene();}
listen(window,'pagehide',function(event){if(!event.persisted)destroy();else{cancelAnimationFrame(raf);raf=0;}});
listen(window,'pageshow',function(event){if(event.persisted){lastTime=0;requestRender();}});
send({type:'funtrack:gallery:ready'});reportHeight();
})();
