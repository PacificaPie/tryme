import {gameCatalog,mountGame} from './games.js';
import {createStore,escapeHTML as esc,validURL,publishDraft,uid} from './store.js';

const $=(s,root=document)=>root.querySelector(s);
const icons={grid:'<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/>',folder:'<path d="M3 7V5a1 1 0 0 1 1-1h6l2 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"/>',arrow:'<path d="m14 6-6 6 6 6M8 12h12"/>',more:'<circle cx="5" cy="12" r=".8"/><circle cx="12" cy="12" r=".8"/><circle cx="19" cy="12" r=".8"/>',plus:'<path d="M12 5v14M5 12h14"/>',chevron:'<path d="m9 5 7 7-7 7"/>',check:'<path d="m5 12 4 4L19 6"/>',card:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="M6 16h5M14 9h4M14 13h4"/>',exit:'<path d="M10 4H5v16h5M10 12h11m-4-4 4 4-4 4"/>',play:'<path d="m9 5 11 7-11 7V5Z"/>',edit:'<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z"/>',image:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m3 17 5-5 4 4 4-6 5 7"/><circle cx="8" cy="8" r="1"/>'};
const icon=name=>`<svg class="icon" aria-hidden="true" viewBox="0 0 24 24">${icons[name]||icons.grid}</svg>`;
let storage;
try {storage=window.localStorage;}catch {storage={getItem(){throw new Error('Storage unavailable');},setItem(){throw new Error('Storage unavailable');}};}
const store=createStore(storage);
const state=()=>store.get();
const allWorks=()=>[...state().works,...gameCatalog];
const findWork=id=>allWorks().find(w=>w.id===id);
const ownWorks=()=>state().works.filter(w=>w.authorId===state().profile.id);
const authorName=w=>w.authorId===state().profile.id?state().profile.name:w.author;
const view=$('#view'),dialog=$('#auth-dialog');
let game=null,playState=null,toastTimer=null,pendingAuth=null,authTrigger=null,submitting=false,uploading=false,coverRequest=0;
let renderCount=0;

function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>{$('#toast').classList.remove('visible');},4000);}
function save(update){try{store.commit(update);return true;}catch{toast('未能保存。请检查浏览器存储空间后重试。');return false;}}
function route(){let h=location.hash.slice(1)||'/discover';const [path,q='']=h.split('?');return {path,params:new URLSearchParams(q)};}
function navigate(path,{replace=false}={}){
  if(path===location.hash.slice(1)){render();return;}
  const depth=(history.state?.ftDepth||0)+(replace?0:1);
  history[replace?'replaceState':'pushState']({ftDepth:depth},'',`#${path}`);render();
}
function back(fallback='/discover'){if((history.state?.ftDepth||0)>0)history.back();else navigate(fallback,{replace:true});}
function closeMenus(){document.querySelectorAll('details[open]').forEach(d=>d.removeAttribute('open'));}
function moreMenu(items){return `<details class="menu"><summary class="icon-button" aria-label="更多操作">${icon('more')}</summary><div class="menu-items">${items}</div></details>`;}
const menuLink=(path,label,symbol)=>`<a href="#${path}">${icon(symbol)}${esc(label)}</a>`;
function nav(path){
  $('#nav').innerHTML=`<a class="nav-link" href="#/discover" ${path==='/discover'?'aria-current="page"':''}>${icon('grid')}发现</a><a class="nav-link" href="#/works" ${['/works','/publish'].includes(path)||path.startsWith('/published')?'aria-current="page"':''}>${icon('folder')}我的作品</a>`;
  $('#account').innerHTML=state().signedIn?`<details class="menu"><summary class="account-button" aria-label="账户菜单"><span class="account-avatar">${esc(state().profile.name.slice(0,1))}</span><span>${esc(state().profile.name)}</span>${icon('more')}</summary><div class="menu-items">${menuLink('/card/me','我的名片','card')}<button data-action="logout">${icon('exit')}退出登录</button><span class="menu-caption">本地演示账号</span></div></details>`:`<button class="account-button" data-action="login"><span class="account-avatar">${icon('card')}</span>登录</button>`;
}
function topbar({backLabel='',fallback='/discover',fixedBack=false,menu=''}={}){
  $('#topbar').innerHTML=`${backLabel?`<button class="back-button" data-action="${fixedBack?'navigate-back':'back'}" data-target="${esc(fallback)}">${icon('arrow')}${esc(backLabel)}</button>`:''}<div class="topbar-actions">${menu?moreMenu(menu):''}</div>`;
}
function heading(title){return `<div class="page-heading"><h1>${esc(title)}</h1></div>`;}
function empty(title,text,button){return `<div class="empty-state"><div class="empty-illustration">${icon('folder')}</div><h1>${esc(title)}</h1>${text?`<p class="surface-subtitle">${esc(text)}</p>`:''}${button}</div>`;}
function workTile(w){return `<a class="work-tile" href="#/work/${encodeURIComponent(w.id)}" aria-label="试玩 ${esc(w.title)}"><div class="cover-wrap"><img src="${esc(w.cover)}" alt="${esc(w.title)}" width="600" height="440" loading="eager"></div><div class="tile-meta"><h2>${esc(w.title)}</h2><span class="author-name">${esc(authorName(w))}</span></div></a>`;}
function discover(){topbar({menu:menuLink('/publish','发布作品','plus')+menuLink('/card/me','我的名片','card')});view.innerHTML=heading('发现游戏')+`<div class="discovery-grid">${allWorks().map(workTile).join('')}</div>`;}

function works(){
  topbar({menu:menuLink('/publish','发布作品','plus')+menuLink('/card/me','我的名片','card')});
  if(!state().signedIn){view.innerHTML=empty('我的作品','登录后发布作品，整理你的名片。','<button class="button primary" data-action="login">登录</button>');return;}
  const list=ownWorks();
  if(!list.length){view.innerHTML=empty('还没有作品','',`<a class="button primary" href="#/publish">发布第一件作品</a>`);return;}
  view.innerHTML=heading('我的作品')+`<div class="my-work-list">${list.map(w=>{const count=state().feedback.filter(f=>f.workId===w.id).length;return `<div class="my-work-row"><a href="#/work/${w.id}"><img src="${esc(w.cover)}" alt=""><div class="work-row-content"><h2>${esc(w.title)}</h2><p>${count?`${count} 条反馈`:'暂无反馈'}</p></div></a><span class="row-actions" aria-hidden="true">${icon('chevron')}</span></div>`;}).join('')}</div>`;
}

function publishPage(){
  topbar({backLabel:'返回',fallback:'/works'});
  const d=state().draft;
  view.innerHTML=`<div class="form-page">${heading('发布作品')}<form id="publish-form" class="publish-form" novalidate>
    <div class="form-field"><label for="work-url">作品链接</label><input id="work-url" name="url" type="url" required maxlength="1500" autocomplete="url" placeholder="https://" value="${esc(d.url)}"><p class="form-error" id="url-error"></p></div>
    <div class="form-field"><label for="work-title">名称</label><input id="work-title" name="title" required maxlength="50" placeholder="作品叫什么" value="${esc(d.title)}"><p class="form-error" id="title-error"></p></div>
    <div class="form-field"><label for="work-description">怎么玩</label><textarea id="work-description" name="description" required maxlength="240" rows="3" placeholder="用一句话介绍玩法">${esc(d.description)}</textarea><p class="form-error" id="description-error"></p></div>
    <div class="form-field"><label>封面<span class="optional">可选</span></label><div class="cover-picker"><label for="work-cover"><div class="cover-preview" id="cover-preview">${d.cover?`<img src="${esc(d.cover)}" alt="已选择的封面">`:`${icon('image')}<span>添加图片</span>`}</div></label><input id="work-cover" name="cover" type="file" accept="image/png,image/jpeg,image/webp" aria-label="添加封面图片"></div><div id="cover-actions">${d.cover?'<button type="button" class="button quiet cover-remove" data-action="remove-cover">移除封面</button>':''}</div><p class="form-error" id="cover-error"></p></div>
    <p class="form-error" id="publish-error" role="alert"></p><div class="form-footer"><button class="button primary" type="submit">发布作品</button></div>
  </form></div>`;
  $('#publish-form').addEventListener('input',e=>{
    const field=e.target.name;if(!['title','url','description'].includes(field))return;
    save(s=>{s.draft[field]=e.target.value;return s;});
    e.target.removeAttribute('aria-invalid');const error=$(`#${field}-error`);if(error)error.textContent='';
  });
  $('#work-cover').addEventListener('change',handleCover);
  $('#publish-form').addEventListener('submit',e=>{e.preventDefault();submitPublish();});
}
function validateDraft(){
  const d=state().draft,errors={};
  if(!validURL(d.url.trim()))errors.url='填写有效的 http 或 https 链接';
  if(!d.title.trim())errors.title='填写作品名称';
  if(!d.description.trim())errors.description='写一句玩法介绍';
  for(const [key,msg] of Object.entries(errors)){const input=$(`[name="${key}"]`);input?.setAttribute('aria-invalid','true');if($(`#${key}-error`))$(`#${key}-error`).textContent=msg;}
  if(Object.keys(errors).length){$(`[name="${Object.keys(errors)[0]}"]`)?.focus();return false;}
  return true;
}
function submitPublish(){
  if(submitting||uploading)return;
  if(!validateDraft())return;
  if(!state().signedIn){openAuth(submitPublish);return;}
  submitting=true;const button=$('#publish-form button[type=submit]');if(button)button.disabled=true;
  try{
    const result=publishDraft(state());
    if(save(result.state))navigate(`/published/${result.work.id}`,{replace:true});
  }catch(error){if($('#publish-error'))$('#publish-error').textContent=error.message;}
  finally{submitting=false;if(button?.isConnected)button.disabled=false;}
}
async function handleCover(e){
  const file=e.target.files?.[0];if(!file)return;
  const error=$('#cover-error');error.textContent='';
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024){error.textContent='请选择 8 MB 以内的 PNG、JPG 或 WebP 图片';e.target.value='';return;}
  const request=++coverRequest;
  uploading=true;const button=$('#publish-form button[type=submit]');button.disabled=true;
  const draftId=state().draft.id;
  try{
    const bitmap=await createImageBitmap(file);const canvas=document.createElement('canvas');const scale=Math.min(1,1000/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();const cover=canvas.toDataURL('image/webp',.82);
    if(state().draft.id!==draftId||request!==coverRequest)return;
    if(save(s=>{s.draft.cover=cover;return s;}) && route().path==='/publish'){$('#cover-preview').innerHTML=`<img src="${esc(cover)}" alt="已选择的封面">`;$('#cover-actions').innerHTML='<button type="button" class="button quiet cover-remove" data-action="remove-cover">移除封面</button>';}
  }catch{if(error.isConnected&&request===coverRequest)error.textContent='图片无法读取，请换一张图片';}
  finally{if(request===coverRequest){uploading=false;if(button.isConnected)button.disabled=false;}}
}
function published(id){
  const w=findWork(id);if(!w)return notFound();
  topbar({backLabel:'我的作品',fallback:'/works',fixedBack:true});
  view.innerHTML=`<div class="success-state"><div class="success-icon">${icon('check')}</div><h1>作品已发布</h1><img src="${esc(w.cover)}" alt=""><p>${esc(w.title)}</p><a class="button primary" href="#/card/me">${state().cardGenerated?'查看我的名片':'生成我的名片'}</a></div>`;
}

function detail(id){
  const w=findWork(id);if(!w)return notFound();
  topbar({backLabel:'返回',fallback:'/discover',menu:menuLink(`/card/${w.authorId===state().profile.id?'me':w.authorId}`,'查看创作者','card')});
  const isOwn=w.authorId===state().profile.id;
  view.innerHTML=`<div class="work-page"><div class="work-header"><h1>${esc(w.title)}</h1><div class="work-byline"><a class="text-link" href="#/card/${isOwn?'me':w.authorId}">${esc(authorName(w))}</a><span aria-hidden="true">·</span><span>${esc(w.description)}</span></div></div>
  <div class="play-layout"><div class="game-stage" id="game-stage"><div class="game-cover"><img src="${esc(w.cover)}" alt=""></div><div class="start-overlay"><button class="button primary" data-action="start-play" data-id="${esc(w.id)}">${icon(w.kind==='external'?'chevron':'play')}${w.kind==='external'?'打开作品 ↗':'开始试玩'}</button></div></div><div class="play-toolbar" id="play-toolbar"></div></div>
  <section class="feedback-panel" id="feedback-panel" aria-label="试玩反馈" hidden></section>
  <section class="feedback-list" id="feedback-list" aria-label="已有反馈"></section></div>`;
  renderFeedbackList(w);
}
function playInstructions(kind){return {'salt-run':'空格或轻点跳跃','tiles':'点击方块，点亮整个棋盘','orbit':'移动指针或方向键收集光点'}[kind]||'';}
function startPlay(id){
  const w=findWork(id);if(!w||playState?.status==='playing')return;
  playState={id,status:'playing'};
  if(w.kind==='external'){
    const url=validURL(w.url);if(!url){toast('作品链接无效');return;}
    window.open(url,'_blank','noopener,noreferrer');
    $('#game-stage').innerHTML=`<div class="external-stage"><img src="${esc(w.cover)}" alt=""><a class="text-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">在新窗口打开 ${esc(w.title)} ↗</a></div>`;
    $('#play-toolbar').innerHTML='';playState.status='finished';showFeedback(w);return;
  }
  $('#game-stage').innerHTML='<div class="game-host" id="game-host"></div>';
  $('#play-toolbar').innerHTML=`<span class="play-instructions">${esc(playInstructions(w.kind))}</span><button class="button secondary" data-action="end-play">结束试玩</button>`;
  game=mountGame($('#game-host'),w.kind,{onComplete:result=>{
    if(playState?.id!==id||playState.status!=='playing')return;
    playState.status='finished';$('#play-toolbar').innerHTML=`<span class="play-result">${icon('check')}${esc(result?.label||'试玩完成')}</span><button class="button quiet" data-action="replay" data-id="${esc(id)}">再玩一次</button>`;showFeedback(w);
  }});
  $('#game-host canvas')?.focus({preventScroll:true});
}
function endPlay(){
  if(!playState)return;game?.destroy();game=null;playState.status='finished';
  const w=findWork(playState.id);if(!w)return;
  $('#game-stage').innerHTML=`<div class="stage-idle-art"><img src="${esc(w.cover)}" alt="${esc(w.title)}"></div>`;
  $('#play-toolbar').innerHTML=`<span class="play-result">${icon('check')}试玩结束</span><button class="button quiet" data-action="replay" data-id="${esc(w.id)}">再玩一次</button>`;
  showFeedback(w);$('#feedback-text')?.focus({preventScroll:true});
}
function showFeedback(w){
  const panel=$('#feedback-panel');panel.hidden=false;
  const draft=state().feedbackDrafts[w.id]||'';
  panel.innerHTML=`<h2>玩得怎么样？</h2><form id="feedback-form" class="feedback-form"><label for="feedback-text" class="visually-hidden">试玩反馈</label><textarea id="feedback-text" name="feedback" rows="3" required maxlength="1000" placeholder="哪里有趣，或者哪里卡住了">${esc(draft)}</textarea><p class="form-error" id="feedback-error" role="alert"></p><div class="feedback-actions"><button class="button primary" type="submit">提交反馈</button></div></form>`;
  $('#feedback-text').addEventListener('input',e=>save(s=>{s.feedbackDrafts[w.id]=e.target.value;return s;}));
  const submit=()=>{
    if(submitting)return;
    const text=(state().feedbackDrafts[w.id]||'').trim();if(!text){$('#feedback-error').textContent='写下你的体验再提交';$('#feedback-text').focus();return;}
    if(!state().signedIn){openAuth(submit);return;}
    submitting=true;
    const receipt={id:uid(),workId:w.id,version:w.version||1,text,authorId:state().profile.id,author:state().profile.name,createdAt:new Date().toISOString()};
    try{if(save(s=>{s.feedback.push(receipt);delete s.feedbackDrafts[w.id];return s;})){
      if(panel.isConnected){panel.innerHTML=`<div class="feedback-success" role="status">${icon('check')}反馈已提交</div>`;renderFeedbackList(w);}toast('反馈已保存');
    }}finally{submitting=false;}
  };
  $('#feedback-form').addEventListener('submit',e=>{e.preventDefault();submit();});
}
function renderFeedbackList(w){
  if(!$('#feedback-list'))return;
  const list=state().feedback.filter(f=>f.workId===w.id);
  $('#feedback-list').innerHTML=list.length?`<h2>反馈 <span class="muted">${list.length}</span></h2>${list.slice().reverse().map(f=>`<article class="feedback-item"><div class="feedback-meta"><span>${esc(f.author)}</span><time datetime="${esc(f.createdAt)}">${new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric'}).format(new Date(f.createdAt))}</time></div><p>${esc(f.text)}</p></article>`).join('')}`:'';
}

function card(id,params){
  const me=id==='me'||id===state().profile.id;
  topbar({backLabel:'返回',fallback:me?'/works':'/discover',menu:me&&state().signedIn?menuLink('/publish','发布作品','plus')+menuLink('/card/me?edit=1','编辑名片','edit'):''});
  if(me&&!state().signedIn){view.innerHTML=empty('我的名片','登录后，把作品整理在一起。','<button class="button primary" data-action="login">登录</button>');return;}
  const list=me?ownWorks():gameCatalog.filter(w=>w.authorId===id);
  if(!me&&!list.length)return notFound();
  if(me&&!list.length){view.innerHTML=empty('从一件作品开始','',`<a class="button primary" href="#/publish">发布作品</a>`);return;}
  const name=me?state().profile.name:list[0].author;
  const bio=me?state().profile.bio:'独立创作者';
  if(me&&params.get('edit')==='1'){
    view.innerHTML=`<div class="form-page">${heading('编辑名片')}<form id="card-edit-form"><div class="form-field"><label for="card-name">名字</label><input id="card-name" name="name" required maxlength="24" value="${esc(name)}"></div><div class="form-field"><label for="card-bio">简介<span class="optional">可选</span></label><textarea id="card-bio" name="bio" maxlength="100" rows="3" placeholder="一句关于你的话">${esc(bio)}</textarea></div><div class="form-footer"><button class="button primary" type="submit">保存名片</button></div></form></div>`;
    $('#card-edit-form').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.currentTarget);const n=String(f.get('name')).trim();if(!n){$('#card-name').setCustomValidity('填写名字');$('#card-name').reportValidity();return;}if(save(s=>{s.profile.name=n;s.profile.bio=String(f.get('bio')).trim();return s;})){navigate('/card/me',{replace:true});toast('名片已更新');}});
    $('#card-name').addEventListener('input',e=>e.target.setCustomValidity(''));return;
  }
  const generated=!me||state().cardGenerated;
  const tiles=list.slice(0,6).map(w=>`<a href="#/work/${w.id}" aria-label="试玩 ${esc(w.title)}"><img src="${esc(w.cover)}" alt="${esc(w.title)}"></a>`).join('');
  const feedbackCount=state().feedback.filter(f=>list.some(w=>w.id===f.workId)).length;
  view.innerHTML=`<div class="card-page ${generated?'':'card-pending'}">${heading(me?(generated?'我的名片':'生成名片'):`${name}的名片`)}
    <div class="exhibition-stage" id="exhibition-stage"><div class="card-face"><article class="creator-card" aria-label="${esc(name)}的创作者名片"><div class="card-heading"><div class="monogram">${esc(name.slice(0,1))}</div><span class="card-note">TryMe</span></div><h2>${esc(name)}</h2>${bio?`<p class="card-bio">${esc(bio)}</p>`:''}<div class="card-mosaic count-${Math.min(3,list.length)}">${tiles}</div><div class="card-foot"><span>${list.length} 件作品</span>${feedbackCount?`<span>${feedbackCount} 条反馈</span>`:''}</div></article></div>
    <div class="room" id="room" inert aria-hidden="true" aria-label="${esc(name)}的作品展厅"><div class="room-back" aria-hidden="true"></div><div class="room-left" aria-hidden="true"></div><div class="room-right" aria-hidden="true"></div><div class="room-floor" aria-hidden="true"></div><div class="room-works count-${Math.min(3,list.length)}">${list.map(w=>`<a class="room-work" href="#/work/${w.id}" aria-label="试玩 ${esc(w.title)}"><img src="${esc(w.cover)}" alt=""><span>${esc(w.title)}</span></a>`).join('')}</div><p class="room-label">${esc(name)}</p></div></div>
    <div class="card-controls"><button class="button primary" data-action="${generated?'toggle-card':'generate-card'}" aria-controls="exhibition-stage" ${generated?'aria-expanded="false"':''}>${generated?'展开名片':'生成名片'}</button></div></div>`;
}
function notFound(){topbar();view.innerHTML=empty('找不到这个作品','',`<a class="button primary" href="#/discover">返回发现</a>`);}

function openAuth(after=null){
  if(state().signedIn){after?.();return;}
  closeMenus();authTrigger=document.activeElement;pendingAuth=after;$('#login-name').value=state().profile.name||'';$('#auth-error').textContent='';dialog.showModal();$('#login-name').focus();
}
function cancelAuth(){pendingAuth=null;dialog.close();authTrigger?.focus?.();}
$('#auth-form').addEventListener('submit',e=>{
  e.preventDefault();const name=$('#login-name').value.trim();if(!name){$('#auth-error').textContent='填写名字';return;}
  if(!save(s=>{s.signedIn=true;s.profile.name=name;return s;}))return;
  const next=pendingAuth;pendingAuth=null;dialog.close();nav(route().path);if(next)next();else render();
});
dialog.addEventListener('cancel',e=>{e.preventDefault();cancelAuth();});
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)cancelAuth();}});

document.addEventListener('click',e=>{
  if(e.target.closest('.skip-link')){e.preventDefault();view.focus();return;}
  const a=e.target.closest('a[href^="#/"]');
  if(a&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey){e.preventDefault();closeMenus();navigate(a.getAttribute('href').slice(1));return;}
  const b=e.target.closest('[data-action]');if(!b)return;
  const action=b.dataset.action;
  if(action==='login')openAuth();
  else if(action==='cancel-auth')cancelAuth();
  else if(action==='back')back(b.dataset.target);
  else if(action==='navigate-back')navigate(b.dataset.target);
  else if(action==='logout'){if(save({signedIn:false})){closeMenus();render();toast('已退出登录');}}
  else if(action==='remove-cover'){coverRequest++;uploading=false;if(save(s=>{s.draft.cover='';return s;}))publishPage();}
  else if(action==='start-play')startPlay(b.dataset.id);
  else if(action==='end-play')endPlay();
  else if(action==='replay'){game?.destroy();game=null;playState=null;$('#feedback-panel').hidden=true;startPlay(b.dataset.id);}
  else if(action==='generate-card'){if(save({cardGenerated:true})){render();toast('名片已生成');}}
  else if(action==='toggle-card'){const open=$('#exhibition-stage').classList.toggle('is-open');const face=$('.card-face');face.inert=open;face.setAttribute('aria-hidden',String(open));$('#room').inert=!open;$('#room').setAttribute('aria-hidden',String(!open));b.textContent=open?'收起名片':'展开名片';b.setAttribute('aria-expanded',String(open));}
});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('details'))closeMenus();});
window.addEventListener('popstate',render);
window.addEventListener('hashchange',()=>{if(lastRenderedHash!==location.hash)render();});
let lastRenderedHash='';
function render(){
  if(dialog.open)cancelAuth();
  game?.destroy();game=null;playState=null;
  lastRenderedHash=location.hash;const r=route();nav(r.path);
  view.className='page';
  if(r.path==='/discover'||r.path==='/')discover();
  else if(r.path==='/works')works();
  else if(r.path==='/publish')publishPage();
  else if(r.path.startsWith('/published/'))published(decodeURIComponent(r.path.slice(11)));
  else if(r.path.startsWith('/work/'))detail(decodeURIComponent(r.path.slice(6)));
  else if(r.path.startsWith('/card/'))card(decodeURIComponent(r.path.slice(6)),r.params);
  else notFound();
  document.title=`${$('h1',view)?.textContent||'发现游戏'} · TryMe`;
  if(renderCount++)view.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});
}
history.replaceState({ftDepth:history.state?.ftDepth||0},'',location.hash?location.href:'#/discover');
render();
if(store.readError)toast('历史记录无法读取，已打开空白原型。');
