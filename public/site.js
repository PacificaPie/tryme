import { t, getLocale, setLocale } from './i18n.js';
import './site.messages.js';
import { emptyState, pageSkeleton } from './empty-state.js';
import { syncNavigation } from './navigation.js';
import { mountDiscussion } from './discussion.js';
import { createPlayClock } from './play-clock.js';
import { mountAnalytics } from './analytics.js';
import { renderVersioning, disposeVersioning, hasPendingVersionMutation } from './versioning.js';
import { previewReferences, isPinnedPreview, prepareCardPreview, frozenAction } from './versioning-state.js';
import { mountDiscovery, clearDiscovery, updateDiscoveryWork } from './discovery.js';
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const main = $('#main');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => crypto.randomUUID();
const read = (key, fallback) => { try { return JSON.parse(sessionStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key,value) => { try { sessionStorage.setItem(key,JSON.stringify(value)); } catch {} };
const storage = {publish:'funtrack.real.publish',card:'funtrack.real.card',preview:'funtrack.real.preview',feedback:'funtrack.real.feedback',views:'funtrack.real.gallery'};
const storageBase={...storage};let draftOwner=null,fileScope='';
let startPending=false, analyticsPanel=null, visitRecorded=false;
let me=null, authChecked=false, routeNumber=0, currentRoute='', noticeTimer, currentGallery=null, activeSession=null;
const scrolls=new Map();
const galleryViews=new Map(Object.entries(read(storage.views,{})));
const feedbackDrafts=read(storage.feedback,{});
let publishDraft={name:'',desc:'',source:'html',url:'',key:uid(),...read(storage.publish,{})},publishFile=null,coverFile=null,coverPreview='',publishPending=false,publishError='',githubPending=false,githubJob=0,buildPollTimer,buildPollRevision=0,buildCancelPending=false,buildPollError='';
let cardDraft={ids:[],template:'wall',name:'',bio:'',signature:'',headline:'',website:'',backStyle:'ink',...read(storage.card,{})},preview=read(storage.preview,null),cardPending=false,cardError='',cardKey=uid();
let sessionQueues=new Set(),actionQueue=new Map();
const socialState=new Map(),likePending=new Set(),likeRetry=new Map();
class ApiError extends Error { constructor(message,status,code){super(message);this.status=status;this.code=code;} }
async function api(path, options={}) {
  const headers={...(options.headers||{})};
  if(options.method&&options.method!=='GET')headers['X-Funtrack-CSRF']='1';
  if(options.body && !(options.body instanceof FormData)) {headers['Content-Type']='application/json';options={...options,body:JSON.stringify(options.body)};}
  let response;
  try {response=await fetch(path,{credentials:'same-origin',...options,headers});} catch {throw new ApiError("连接暂时中断，请重试。",0,'NETWORK');}
  let data;try{data=await response.json();}catch{throw new ApiError("服务暂时不可用，请稍后重试。",response.status,'BAD_RESPONSE');}
  if(!response.ok){const error=new ApiError(data.error?.message||"暂时无法完成，请重试。",response.status,data.error?.code);if(data.error?.current)error.current=data.error.current;throw error;}
  return data;
}
function signinURL(){return '/signin-with-chatgpt?return_to='+encodeURIComponent('/site.html'+(location.hash||'#/'));}
function signinLink(label=t("登录")){return `<a class="button primary" href="${esc(signinURL())}" target="_top">${esc(label)}</a>`;}
function identity(){ $('#identity').innerHTML=me?`<a href="#/studio/works" class="avatar" aria-label="${t("打开创作中心")}">${esc([...me.name][0]||t("我"))}</a><span class="identity-name">${esc(me.name)}</span>`:`<a class="button quiet" href="${esc(signinURL())}" target="_top">${t("登录")}</a>`; }
function notify(message){message=t(message);clearTimeout(noticeTimer);$('#notice').textContent=message;$('#notice').hidden=false;noticeTimer=setTimeout(()=>$('#notice').hidden=true,3500);}
function urlFor(path){return '#'+path;}
function go(path){if(location.hash==='#'+path)renderRoute();else location.hash=path;}
function canonicalPath(path){if(path==='/'||path==='/discover')return '/feed';if(path==='/creators')return '/cards';if(path==='/studio/card'||path.startsWith('/studio/card/'))return '/cards/me'+path.slice('/studio/card'.length);return path;}
function route(){const raw=(location.hash.slice(1)||'/');const index=raw.indexOf('?');return {path:canonicalPath(index<0?raw:raw.slice(0,index)),params:new URLSearchParams(index<0?'':raw.slice(index+1)),raw};}
function safeCover(value){try{const u=new URL(value,location.origin);return value&&u.origin===location.origin?u.href:'';}catch{return '';}}
function safeExternal(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}}
function date(value){if(!value)return '';const d=new Date(typeof value==='number'&&value<1e12?value*1000:value);return Number.isNaN(d.valueOf())?'':d.toLocaleDateString(getLocale(),{month:'short',day:'numeric'});}
function n(value){return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString(getLocale()):'—';}
function workHref(work, from=route().raw, cardId=''){return '#/work/'+encodeURIComponent(work.id)+'?from='+encodeURIComponent(from)+(cardId?'&card='+encodeURIComponent(cardId):'');}
function cover(work, href, label=true){const src=safeCover(work.coverUrl);return `<a class="cover${src?'':' empty-cover'}" href="${esc(href)}" aria-label="${t("查看")} ${esc(work.name)}">${src?`<img src="${esc(src)}" alt="${esc(work.name)}" loading="lazy">`:`<span aria-hidden="true">${esc(work.name)}</span>`}${label?`<span class="tag">${work.source==='url'?t("外链作品"):t("网页游戏")}</span>`:''}</a>`;}
function workTile(work,{from=route().raw,creator=true,cardId='',social=false}={}){
  const href=workHref(work,from,cardId),src=safeCover(work.coverUrl);
  return `<article class="work-tile"><a class="work-entry" href="${esc(href)}" aria-label="${t("查看")} ${esc(work.name)}"><div class="cover${src?'':' empty-cover'}">${src?`<img src="${esc(src)}" alt="" loading="lazy">`:`<span>${esc(work.name)}</span>`}<span class="cover-action" aria-hidden="true">${t("查看作品")} ↗</span></div><div class="tile-info"><div class="tile-copy"><h3 class="tile-title">${esc(work.name)}</h3><p class="tile-desc">${esc(work.desc)}</p></div></div></a><div class="tile-bottom">${creator?`<a class="creator-link" href="#/author/${encodeURIComponent(work.authorId)}">${esc(work.authorName||t("创作者"))}</a>`:''}${social?socialControls(work,{share:false,comments:true}):''}</div></article>`;
}
function workImage(work,className=''){const src=safeCover(work.coverUrl);return src?`<img class="${className}" src="${esc(src)}" alt="${esc(work.name)}">`:`<div class="image-placeholder ${className}">${esc(work.name)}</div>`;}
function playIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg>';}
function commentIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8 8H4l1.7-4.1A8 8 0 1 1 20 11.5Z"/></svg>';}


function empty(title,description,action=''){const path=route().path;return emptyState({kind:path.includes('feedback')?'activity':path.startsWith('/cards')?'cards':'works',title,description,action});}
function studio(content,tab){return `<div class="page"><div class="studio"><nav class="studio-nav" aria-label="${t("创作中心")}">${[['works',t("我的作品")],['data',t("数据")],['feedback',t("互动")]].map(([id,name])=>`<a href="#/studio/${id}" class="${tab===id?'active':''}">${name}</a>`).join('')}</nav><div class="studio-main">${content}</div></div></div>`;}
function cardsPage(content,tab='mine'){return `<div class="page cards-page"><nav class="cards-nav" aria-label="${t("名片")}"><a href="#/cards" class="${tab==='browse'?'active':''}">${t("浏览名片")}</a><a href="#/cards/me" class="${tab==='mine'?'active':''}">${t("我的名片")}</a></nav>${content}</div>`;}
function cardProfile(card){return {signature:typeof card.signature==='string'?card.signature:'',headline:typeof card.headline==='string'?card.headline:'',website:safeExternal(card.website),backStyle:['ink','ivory','cobalt'].includes(card.backStyle)?card.backStyle:'ink'};}
function pageError(error){if(error.status===401){me=null;identity();return `<div class="page narrow">${empty(t("登录后继续"),t("使用 ChatGPT 账号访问作品和创作中心。"),signinLink(t("使用 ChatGPT 登录")))}</div>`;}return `<div class="page narrow"><section class="error-state"><h2>${t("暂时没能加载")}</h2><p>${esc(t(error.message))}</p><button class="button" data-action="reload">${t("重试")}</button></section></div>`;}
function head(title,subtitle='',action=''){return `<div class="page-head"><div><h1>${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div>${action}</div>`;}
function saveCardDraft(){write(storage.card,cardDraft);}
function savePublish(){write(storage.publish,publishDraft);}
function saveFeedback(){write(storage.feedback,feedbackDrafts);}
function contentKey(){return JSON.stringify({ids:cardDraft.ids,template:cardDraft.template,name:cardDraft.name,bio:cardDraft.bio});}
function invalidatePreview(){cardError='';cardKey=uid();saveCardDraft();}
async function readMine(){
  const works=[];let cursor=null;
  do{const params=new URLSearchParams({author:me.id,limit:'48'});if(cursor)params.set('cursor',cursor);const page=await api('/api/discover?'+params);works.push(...page.works);cursor=page.nextCursor;}while(cursor);
  return works;
}
async function activateDrafts(user){
  if(draftOwner===user.id)return;
  const legacyOwner=read('funtrack.real.owner',null),canMigrate=(!legacyOwner||legacyOwner===user.id)&&!read('funtrack.real.migrated:'+user.id,false);
  draftOwner=user.id;stopBuildPolling();githubJob++;githubPending=false;clearDiscovery();socialState.clear();likePending.clear();likeRetry.clear();fileScope=user.id+':';Object.keys(storage).forEach(key=>storage[key]=storageBase[key]+':'+user.id);
  const stored=(key,fallback)=>read(storage[key],canMigrate?read(storageBase[key],fallback):fallback);
  publishDraft={name:'',desc:'',source:'html',url:'',key:uid(),...stored('publish',{})};
  cardDraft={ids:[],template:'wall',name:user.name,bio:user.bio||'',signature:user.signature||'',headline:user.headline||'',website:user.website||'',backStyle:user.backStyle||'ink',...stored('card',{})};
  preview=stored('preview',null);if(preview&&!preview.fingerprint&&typeof preview.signature==='string'){preview.fingerprint=preview.signature;preview.signature='';}Object.keys(feedbackDrafts).forEach(key=>delete feedbackDrafts[key]);Object.assign(feedbackDrafts,stored('feedback',{}));Object.values(feedbackDrafts).forEach(d=>d.pending=false);
  galleryViews.clear();Object.entries(stored('views',{})).forEach(([key,value])=>galleryViews.set(key,value));
  [publishFile,coverFile]=await Promise.all([fileStore('get','game'),fileStore('get','cover')]);
  if(canMigrate){if(!publishFile){publishFile=await fileStore('get','game',null,true);if(publishFile)await fileStore('put','game',publishFile);}if(!coverFile){coverFile=await fileStore('get','cover',null,true);if(coverFile)await fileStore('put','cover',coverFile);}}
  refreshCoverPreview();savePublish();saveCardDraft();saveFeedback();write(storage.preview,preview);write(storage.views,Object.fromEntries(galleryViews));if(!legacyOwner)write('funtrack.real.owner',user.id);write('funtrack.real.migrated:'+user.id,true);
}
async function loadMe(){try{me=(await api('/api/me')).user;}catch(e){if(e.status!==401)throw e;me=null;}authChecked=true;if(me)await activateDrafts(me);identity();}

function applyHTML(html,number){if(number!==routeNumber)return false;main.innerHTML=html;syncNavigation();const key=route().raw;requestAnimationFrame(()=>{if(number===routeNumber)window.scrollTo(0,scrolls.get(key)||0);});return true;}
async function renderRoute(options={}){
  if(!options.localeOnly)visitRecorded=false;
  const r=route(),number=++routeNumber;stopBuildPolling();disposeVersioning();analyticsPanel?.dispose();analyticsPanel=null;
  if(currentRoute&&currentRoute!==r.raw)scrolls.set(currentRoute,window.scrollY);
  endSession('exit');currentGallery=null;currentRoute=r.raw;
  $$('.site-header nav a').forEach(a=>a.classList.toggle('active',a.dataset.nav===(r.path.startsWith('/cards')||r.path.startsWith('/card/')||r.path.startsWith('/author')?'cards':r.path.startsWith('/studio')||r.path==='/publish'?'studio':'feed')));
  syncNavigation();main.innerHTML=pageSkeleton(t("正在加载…"));
  try{
    if(!authChecked)await loadMe();
    if(!me){applyHTML(pageError(new ApiError('',401)),number);return;}
    if(r.path==='/feed'||r.path.startsWith('/author/'))await renderDiscover(r,number);
    else if(r.path==='/cards')await renderCreators(number);
    else if(r.path.startsWith('/work/'))await renderWork(r,number,!visitRecorded,options.localeOnly!==true);
    else if(r.path==='/publish')renderPublish(number);
    else if(r.path.startsWith('/published/'))await renderPublished(r,number);
    else if(/^\/studio\/works\/[^/]+\/(update|versions)(\/[^/]+)?$/.test(r.path))await renderVersioning(r,{api,esc,owner:me.id,fileStore,signinURL,notify,go,workImage,startGame,isPlaying:()=>Boolean(activeSession),isCurrent:()=>number===routeNumber,render:html=>applyHTML(html,number),onChanged:()=>clearDiscovery()});
    else if(r.path==='/studio'||r.path==='/studio/works')await renderMyWorks(number);
    else if(r.path==='/studio/data')await renderData(r,number);
    else if(r.path==='/studio/feedback')await renderFeedback(r,number);
    else if(r.path.startsWith('/cards/me'))await renderBuilder(r,number);
    else if(r.path.startsWith('/card/'))await renderCard(r,number,!visitRecorded);
    else applyHTML(`<div class="page narrow">${empty(t("页面不存在"),t("可以回到发现页继续看看。"),`<a class="button" href="#/">${t("发现作品")}</a>`)}</div>`,number);
  }catch(error){if(number===routeNumber)applyHTML(pageError(error),number);}
}
async function renderDiscover(r,number){
  const authorId=r.path.startsWith('/author/')?decodeURIComponent(r.path.split('/')[2]):'';
  let authorCard=null;if(authorId){try{authorCard=(await api('/api/cards')).cards.find(c=>c.authorId===authorId)||null;}catch{}}
  if(!applyHTML('<div class="page discovery-page"></div>',number))return;
  await mountDiscovery($('.discovery-page'),{api,esc,workTile,syncSocial,userId:me.id,authorId,authorCard,initial:{q:r.params.get('q'),source:r.params.get('source'),sort:r.params.get('sort')},onQuery:query=>{
    const params=new URLSearchParams();if(query.q)params.set('q',query.q);if(query.source!=='all')params.set('source',query.source);if(query.sort!=='newest')params.set('sort',query.sort);
    const next=r.path+(params.size?'?'+params:'');history.replaceState(null,'','#'+next);currentRoute=next;
  },restoreScroll:()=>window.scrollTo(0,scrolls.get(route().raw)||0)});
}

async function renderCreators(number){
  const {cards}=await api('/api/cards');
  applyHTML(cardsPage(`${head(t("名片"))}${cards.length?`<div class="creator-grid">${cards.map(c=>`<a class="creator-card" href="#/card/${encodeURIComponent(c.id)}"><div class="creator-covers">${c.works.slice(0,3).map(w=>safeCover(w.coverUrl)?`<img src="${esc(safeCover(w.coverUrl))}" alt="" loading="lazy">`:'<span></span>').join('')}</div><footer><div><h2>${esc(c.name)}</h2>${c.headline||c.bio?`<p>${esc(c.headline||c.bio)}</p>`:''}</div><span aria-hidden="true">↗</span></footer></a>`).join('')}</div>`:empty(t("还没有名片"),t("选几件自己的作品，制作第一张名片。"),`<a class="button primary" href="#/cards/me">${t("制作我的名片")}</a>`)}`,'browse'),number);
}

async function renderWork(r,number,countView=true,autoPlay=true){
  const id=decodeURIComponent(r.path.split('/')[2]);let work;
  if(r.params.get('card')){const {card}=await api('/api/cards/'+encodeURIComponent(r.params.get('card')));work=card.works.find(w=>w.id===id);if(!work)throw new ApiError("这件作品不在该名片中。",404,'SNAPSHOT_WORK_NOT_FOUND');}
  else if(canonicalPath((r.params.get('from')||'').split('?')[0])==='/cards/me/preview'){work=preview?.works.find(w=>w.id===id);if(!work)throw new ApiError("预览已失效，请返回名片重新生成。",404,'PREVIEW_EXPIRED');}
  else work=(await api('/api/works/'+encodeURIComponent(id))).work;
  const from=r.params.get('from')||'/feed',href=work.source==='url'?safeExternal(work.url):'';
  if(typeof work.likedByMe!=='boolean'){try{const live=(await api('/api/works/'+encodeURIComponent(id))).work;syncSocial(live);}catch{}}else syncSocial(work);
  const action=work.source==='url'?`<a class="button primary play-launch" href="${esc(href)}" target="_blank" rel="noopener noreferrer" data-outbound="${esc(id)}" data-version="${esc(work.versionId)}">${t("打开作品 ↗")}</a>`:`<button class="button primary play-launch" data-action="start-game" data-work="${esc(id)}">${playIcon()}${t("开始试玩")}</button>`;
  if(!applyHTML(`<div class="page work-page"><a class="back" href="#${esc(from)}">${t("← 返回")}</a><div class="work-detail"><div id="play-area" class="work-media" data-built-project="${Boolean(work.build)}"><div class="detail-cover">${workImage(work)}</div></div><aside class="work-summary"><h1>${esc(work.name)}</h1><a class="detail-author" href="#/author/${encodeURIComponent(work.authorId)}"><span class="avatar">${esc([...(work.authorName||t("创作者"))][0])}</span>${esc(work.authorName)}</a><p class="work-description">${esc(work.desc)}</p><dl class="work-facts"><div><dt>${t("形式")}</dt><dd>${work.source==='url'?t("外部网站"):t("网页游戏")}</dd></div><div><dt>${t("版本")}</dt><dd>${esc(work.version)}</dd></div>${work.createdAt?`<div><dt>${t("发布日期")}</dt><dd>${date(work.createdAt)}</dd></div>`:''}</dl>${work.build?`<p class="work-origin">${t("来源")} <a href="${esc(safeExternal(work.build.sourceUrl||'https://github.com/'+work.build.repository+'/tree/'+work.build.commitSha))}" target="_blank" rel="noopener noreferrer">${esc(work.build.repository)}</a><span>${esc((work.build.commitSha||'').slice(0,7))}</span></p>`:''}<div class="work-launch">${action}</div><div class="detail-social">${socialControls(work)}<button class="discussion-jump" data-action="discussion" aria-label="${t("查看讨论")}">${commentIcon()}<span>${t("讨论")}</span></button></div></aside></div><div class="work-lower"><section id="discussion" class="discussion" aria-label="${t("作品讨论")}"></section><aside id="related-works" class="related-works"></aside></div></div>`,number))return;
  if(countView){postAction('work_view',{workId:id,versionId:work.versionId});visitRecorded=true;}
  $$('[data-action="start-game"]').forEach(b=>b.addEventListener('click',()=>startGame(work)));
  $('[data-action="discussion"]').addEventListener('click',()=>{$('#discussion').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});$('#comment-input')?.focus({preventScroll:true});});
  mountDiscussion($('#discussion'),{work,user:me,api,esc,notify,focusId:r.params.get('comment')||'',onCount:count=>{updateDiscoveryWork(work.id,{commentsCount:count});const label=$('.discussion-jump span');if(label)label.textContent=count?t("讨论 ")+n(count):t("讨论");}});
  api('/api/discover?author='+encodeURIComponent(work.authorId)+'&limit=4').then(({works})=>{if(number!==routeNumber)return;const others=works.filter(w=>w.authorId===work.authorId&&w.id!==id).slice(0,3);if(others.length)$('#related-works').innerHTML=`<h2>${t("作者的其他作品")}</h2>${others.map(w=>`<a class="related-work" href="${esc(workHref(w,from))}">${workImage(w)}<div><strong>${esc(w.name)}</strong><p>${esc(w.desc)}</p></div></a>`).join('')}`;}).catch(()=>{});
  if(autoPlay&&r.params.get('play')==='1'&&work.source==='html')startGame(work);
  if(r.params.get('discussion')==='1')requestAnimationFrame(()=>{if(number===routeNumber)$('#discussion')?.scrollIntoView({block:'start'});});
}

async function renderMyWorks(number){const works=await readMine();applyHTML(studio(`${head(t("我的作品"),works.length?`${works.length} ${t("件已发布作品")}`:'',works.length?`<a class="button primary" href="#/publish">${t("＋ 发布作品")}</a>`:'')}${works.length?works.map(w=>`<article class="work-row">${cover(w,workHref(w),false)}<div><a href="${esc(workHref(w))}"><h3>${esc(w.name)}</h3></a><p>${esc(w.desc)}</p><span class="tiny muted">${esc(w.version)} · ${w.source==='url'?t("外链"):'HTML'} · ${date(w.createdAt)}</span></div><div class="row-actions"><details class="work-row-more"><summary>${t("更多")}</summary>${w.source==='html'?`<a href="#/studio/works/${encodeURIComponent(w.id)}/update">${t("更新版本")}</a><a href="#/studio/works/${encodeURIComponent(w.id)}/versions">${t("版本历史")}</a>`:''}<a href="#/studio/data?work=${encodeURIComponent(w.id)}">${t("数据")}</a><a href="#/studio/feedback?work=${encodeURIComponent(w.id)}">${t("互动")}</a><a href="${esc(workHref(w))}">${t("打开作品")}</a></details></div></article>`).join(''):empty(t("发布你的第一件作品"),t("上传一个 HTML 小游戏，或放入已经部署好的作品链接。"),`<a class="button primary" href="#/publish">${t("发布作品")}</a>`)}`,'works'),number);}
async function renderData(r,number){
  const works=await readMine();
  if(!applyHTML(studio('<div id="analytics-panel"></div>','data'),number))return;
  const panel=await mountAnalytics($('#analytics-panel'),{api,esc,works,initial:Object.fromEntries(r.params),onQuery:query=>{
    if(number!==routeNumber)return;
    const params=new URLSearchParams();for(const [key,value] of Object.entries(query))if(value!==undefined&&value!==null&&value!=='')params.set(key,String(value));
    const next='/studio/data'+(params.size?'?'+params:'');history.replaceState(null,'','#'+next);currentRoute=next;
  }});
  if(number===routeNumber)analyticsPanel=panel;else panel?.dispose();
}
async function renderFeedback(r,number){
  const work=r.params.get('work')||'',legacy=r.params.get('tab')==='legacy';
  const scope=work?'&work='+encodeURIComponent(work):'';
  const [data,works]=await Promise.all([api(legacy?'/api/feedback'+(work?'?work='+encodeURIComponent(work):''):'/api/comments?mine=1'+scope),readMine()]);
  if(!works.length){applyHTML(studio(head(t('互动'))+empty(t('还没有作品'),t('发布作品后，评论会出现在这里。'),`<a class="button primary" href="#/publish">${t('发布作品')}</a>`),'feedback'),number);return;}
  const target=tab=>'/studio/feedback?tab='+tab+scope;
  const legacyRecords=(data.feedback||[]).map(f=>`<article class="feedback-record"><header><a href="#/work/${encodeURIComponent(f.workId)}">${esc(f.workName)} · ${esc(f.type)}</a><time>${date(f.createdAt)}</time></header><p>${esc(f.text)}</p><span class="tiny muted">${esc(f.authorName||t("访客"))}</span></article>`).join('');
  if(!applyHTML(studio(`${head(t("互动"))}<nav class="inbox-tabs" aria-label="${t("互动类型")}"><a class="${legacy?'':'active'}" href="#${target('comments')}">${t("评论")}</a><a class="${legacy?'active':''}" href="#${target('legacy')}">${t("历史私密反馈")}</a></nav><div class="field inbox-filter"><label for="feedback-work">${t("作品")}</label><select id="feedback-work"><option value="">${t("全部作品")}</option>${works.map(w=>`<option value="${esc(w.id)}" ${work===w.id?'selected':''}>${esc(w.name)}</option>`).join('')}</select></div><div id="inbox-records">${legacy?(legacyRecords||empty(t("暂无历史反馈"),'')):''}</div><p class="error" id="inbox-error" role="status"></p><button class="comments-more" id="inbox-more" hidden>${t("查看更多")}</button>`,'feedback'),number))return;
  $('#feedback-work').addEventListener('change',e=>go('/studio/feedback?tab='+(legacy?'legacy':'comments')+(e.target.value?'&work='+encodeURIComponent(e.target.value):'')));
  if(legacy)return;
  let comments=data.comments,nextCursor=data.nextCursor,pending=false;
  const draw=()=>{
    if(number!==routeNumber)return;
    $('#inbox-records').innerHTML=comments.length?comments.map(c=>`<article class="inbox-comment"><span class="comment-avatar" aria-hidden="true">${esc([...(c.authorName||t("创作者"))][0])}</span><div class="inbox-main"><header><span>${esc(c.authorName)}</span>${c.isCreator?`<span class="author-badge">${t("作者")}</span>`:''}<span>${c.parentId?t("回复"):t("评论")}</span><time>${date(c.createdAt)}</time></header><p>${esc(c.body)}</p><a class="inbox-work" href="#/work/${encodeURIComponent(c.workId)}?from=${encodeURIComponent(r.raw)}&discussion=1">${esc(c.workName)} ${t("· 查看讨论")}</a></div></article>`).join(''):empty(t("还没有评论"),'');
    $('#inbox-more').hidden=!nextCursor;
  };draw();
  $('#inbox-more').addEventListener('click',async()=>{
    if(pending||!nextCursor)return;pending=true;const button=$('#inbox-more');button.disabled=true;button.textContent=t("正在加载…");$('#inbox-error').textContent='';
    try{const result=await api('/api/comments?mine=1'+scope+'&cursor='+encodeURIComponent(nextCursor));if(number!==routeNumber)return;const ids=new Set(comments.map(c=>c.id));comments.push(...result.comments.filter(c=>!ids.has(c.id)));nextCursor=result.nextCursor;draw();}
    catch(error){if(number===routeNumber)$('#inbox-error').textContent=t(error.message);}
    finally{pending=false;if(number===routeNumber){button.disabled=false;button.textContent=t("查看更多");}}
  });
}
function openDraftDB(){return new Promise((resolve,reject)=>{if(!window.indexedDB){reject(new Error('unavailable'));return;}const req=indexedDB.open('funtrack-real-drafts',1);req.onupgradeneeded=()=>req.result.createObjectStore('files');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function fileStore(action,key,value,unscoped=false){key=(unscoped?'':fileScope)+key;let db;try{db=await openDraftDB();return await new Promise((resolve,reject)=>{const tx=db.transaction('files',action==='get'?'readonly':'readwrite'),store=tx.objectStore('files');const req=action==='get'?store.get(key):action==='delete'?store.delete(key):store.put(value,key);tx.oncomplete=()=>resolve(req.result);tx.onabort=()=>reject(tx.error||req.error);tx.onerror=()=>reject(tx.error||req.error);});}catch{return null;}finally{db?.close();}}
function refreshCoverPreview(){if(coverPreview)URL.revokeObjectURL(coverPreview);coverPreview=coverFile?URL.createObjectURL(coverFile):'';}
const buildSteps=['queued','fetching','installing','building','packaging'];
const buildLabels={queued:"等待构建",fetching:"导入源码",installing:"安装依赖",building:"构建项目",packaging:"整理运行包",ready:"构建完成",failed:"构建失败",cancelled:"已取消"};
function matchingBuild(){const build=publishDraft.githubBuild;return build?.id&&build.inputURL===publishDraft.githubURL?.trim()?build:null;}
function activeBuild(build=matchingBuild()){return Boolean(build&&buildSteps.includes(build.status));}
function githubFileLink(value){try{const u=new URL(value);return u.hostname==='raw.githubusercontent.com'||u.hostname==='github.com'&&/\/blob\/.+\.html?$/i.test(u.pathname);}catch{return false;}}
function githubReady(){return matchingBuild()?.status==='ready'||Boolean(publishFile&&publishDraft.githubImport?.url&&publishDraft.githubImport?.commitSha&&publishDraft.githubImport.url===publishDraft.githubURL?.trim());}
function stopBuildPolling(){clearTimeout(buildPollTimer);buildPollRevision++;}
function refreshPublishState(){
  const form=$('#publish-form');if(!form)return;
  const d=publishDraft,build=matchingBuild(),building=activeBuild(build),ready=githubReady(),isFile=githubFileLink(d.githubURL);
  for(const source of ['html','url','github'])$('#'+source+'-field').hidden=d.source!==source;
  $$('input,textarea',form).forEach(input=>input.disabled=publishPending);
  $('#publish-url').disabled=publishPending||d.source!=='url';
  $('#github-url').disabled=publishPending||d.source!=='github'||building;
  const readButton=$('#github-read');readButton.disabled=publishPending||githubPending||building||!d.githubURL?.trim();readButton.textContent=githubPending?t("正在导入…"):building?t("构建中…"):isFile?t("读取文件"):build?.status==='failed'||build?.status==='cancelled'?t("重新构建"):t("导入并构建");
  readButton.classList.toggle('primary',d.source==='github'&&!ready);
  $('#github-status').textContent=githubPending?t("正在读取 GitHub…"):build?`${t(buildLabels[build.status]||build.status)}${build.status==='ready'?' · '+Math.ceil(build.artifactBytes/1024)+' KB':''}`:ready?`${publishFile.name} ${t("· 已读取")} ${d.githubImport.commitSha.slice(0,7)}`:'';
  $('#github-build-panel').hidden=!build;
  if(build){
    const progress=$('#build-progress');progress.hidden=!building;progress.value=Math.max(0,buildSteps.indexOf(build.status))+1;
    const preview=$('#build-preview');preview.hidden=build.status!=='ready';preview.href='/api/builds/'+encodeURIComponent(build.id)+'/preview';
    const cancel=$('#build-cancel');cancel.hidden=!building;cancel.disabled=buildCancelPending;cancel.textContent=buildCancelPending?t("正在取消…"):t("取消构建");
    $('#build-source').textContent=build.repository+' · '+(build.commitSha||'').slice(0,7);
    const nextLogs=build.logs||'';if($('#build-logs').textContent!==nextLogs)$('#build-logs').textContent=nextLogs;
    $('#build-poll-error').textContent=t(buildPollError);
  }
  $('#game-file-name').textContent=publishFile?.name||'';
  const submit=$('[type="submit"]',form);submit.disabled=publishPending||githubPending||(d.source==='github'&&!ready);submit.classList.toggle('primary',d.source!=='github'||ready);submit.textContent=publishPending?t("正在发布…"):t("发布作品");
  $('#publish-error').textContent=t(publishError||(build?.status==='failed'?build.error||"构建失败，请查看构建记录。":''));
}
async function pollGithubBuild(){
  clearTimeout(buildPollTimer);const build=matchingBuild();if(route().path!=='/publish'||publishDraft.source!=='github'||!activeBuild(build))return;
  const owner=draftOwner,id=build.id,inputURL=build.inputURL,revision=++buildPollRevision;
  try{
    const result=await api('/api/builds/'+encodeURIComponent(id));
    if(revision!==buildPollRevision||owner!==draftOwner||matchingBuild()?.id!==id)return;
    publishDraft.githubBuild={...result.build,inputURL};buildPollError='';savePublish();refreshPublishState();
  }catch(error){if(revision!==buildPollRevision||owner!==draftOwner||matchingBuild()?.id!==id)return;buildPollError=error.message;refreshPublishState();}
  if(revision===buildPollRevision&&activeBuild()&&route().path==='/publish')buildPollTimer=setTimeout(pollGithubBuild,buildPollError?5000:1500);
}
async function cancelGithubBuild(){
  const build=matchingBuild();if(!activeBuild(build)||buildCancelPending)return;
  const owner=draftOwner,id=build.id,inputURL=build.inputURL;buildCancelPending=true;refreshPublishState();
  try{const result=await api('/api/builds/'+encodeURIComponent(id)+'/cancel',{method:'POST',body:{}});if(owner===draftOwner&&matchingBuild()?.id===id){stopBuildPolling();publishDraft.githubBuild={...result.build,inputURL};savePublish();}}
  catch(error){if(owner===draftOwner)publishError=error.message;}
  finally{buildCancelPending=false;refreshPublishState();}
}
function renderPublish(number){
  const d=publishDraft;
  if(!applyHTML(`<div class="page narrow"><a class="back" href="#/studio/works">${t("← 我的作品")}</a>${head(t("发布作品"))}
    <form id="publish-form" class="form">
      <div class="field"><label for="publish-name">${t("作品名称")}</label><input id="publish-name" name="name" value="${esc(d.name)}" maxlength="80" required></div>
      <div class="field"><label for="publish-desc">${t("一句介绍")}</label><textarea id="publish-desc" name="desc" maxlength="500" required>${esc(d.desc)}</textarea></div>
      <fieldset class="field source-picker"><legend>${t("作品来源")}</legend><div class="segmented">${[['html',t("本地 HTML")],['github','GitHub'],['url',t("已有网站")]].map(([value,label])=>`<label><input type="radio" name="source" value="${value}" ${d.source===value?'checked':''}>${label}</label>`).join('')}</div></fieldset>
      <div class="field" id="html-field"><label for="game-file">${t("游戏文件")}</label><input id="game-file" type="file" accept=".html,.htm,text/html"><small>${t("单个 HTML，最大 1 MB，图片、样式和脚本包含在文件里。")}</small><p id="game-file-name" class="file-selected"></p></div>
      <div class="field" id="github-field"><label for="github-url">${t("GitHub 链接")}</label><div class="github-input"><input id="github-url" name="githubURL" type="url" placeholder="${t("https://github.com/作者/仓库")}" value="${esc(d.githubURL||'')}"><button id="github-read" class="button" type="button">${t("导入并构建")}</button></div><small>${t("公开 Vite 静态项目（根目录 npm 锁文件），或独立 HTML 文件链接。")}</small><p id="github-status" class="file-selected" role="status"></p><section id="github-build-panel" class="build-panel" hidden><progress id="build-progress" max="5" aria-label="${t("构建进度")}"></progress><div class="build-actions"><a id="build-preview" class="button small" target="_blank" rel="noopener">${t("预览试玩 ↗")}</a><button id="build-cancel" class="button quiet small" type="button">${t("取消构建")}</button></div><details class="build-details"><summary>${t("构建记录")}</summary><p id="build-source"></p><pre id="build-logs"></pre></details><p id="build-poll-error" class="error" role="status"></p></section></div>
      <div class="field" id="url-field"><label for="publish-url">${t("作品链接")}</label><input id="publish-url" name="url" type="url" placeholder="https://" value="${esc(d.url)}"><small>${t("已部署的网站（含 GitHub Pages），将在新窗口打开。")}</small></div>
      <div class="field"><label for="cover-file">${t("封面")}</label><div class="cover-picker">${coverPreview?`<img id="cover-preview" src="${esc(coverPreview)}" alt="${t("所选封面")}">`:`<img id="cover-preview" alt="${t("所选封面")}" hidden>`}<input id="cover-file" type="file" accept="image/png,image/jpeg,image/webp"></div><small>${t("PNG、JPG 或 WebP，最大 2 MB。")}</small></div>
      <p id="publish-error" class="error" role="alert"></p><div class="form-footer"><button class="button primary" type="submit">${t("发布作品")}</button><a class="button quiet" href="#/studio/works">${t("保存草稿并返回")}</a></div>
      <details class="sample-links"><summary>${t("示例文件")}</summary><div><a class="text-link" href="/examples/more.html" target="_blank" rel="noopener">${t("浏览 9 个可玩示例 ↗")}</a></div></details>
    </form></div>`,number))return;
  const form=$('#publish-form');refreshPublishState();
  form.addEventListener('input',event=>{
    if(!['name','desc','url','source','githubURL'].includes(event.target.name))return;
    if(['source','githubURL'].includes(event.target.name)){githubJob++;githubPending=false;stopBuildPolling();buildPollError='';}
    publishDraft[event.target.name]=event.target.value;publishDraft.key=uid();publishError='';savePublish();refreshPublishState();if(event.target.name==='source')pollGithubBuild();
  });
  $('#game-file').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file)return;
    if(!/\.html?$/i.test(file.name)||file.size>1024*1024){publishError="请选择不超过 1 MB 的 HTML 文件。";event.target.value='';refreshPublishState();return;}
    githubJob++;githubPending=false;publishFile=file;publishDraft.githubImport=null;publishDraft.key=uid();publishError='';savePublish();refreshPublishState();await fileStore('put','game',file);
  });
  $('#github-read').addEventListener('click',importGithub);$('#build-cancel').addEventListener('click',cancelGithubBuild);pollGithubBuild();
  $('#cover-file').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024){publishError="请选择不超过 2 MB 的 PNG、JPG 或 WebP 图片。";event.target.value='';refreshPublishState();return;}
    coverFile=file;publishDraft.key=uid();publishError='';savePublish();refreshCoverPreview();refreshPublishState();const img=$('#cover-preview');img.src=coverPreview;img.hidden=false;await fileStore('put','cover',file);
  });
  form.addEventListener('submit',event=>{event.preventDefault();submitPublish(form);});
}
async function importGithub(){
  if(githubPending||publishPending||publishDraft.source!=='github'||activeBuild())return;
  const url=publishDraft.githubURL?.trim();if(!url)return;
  const owner=draftOwner,job=++githubJob,isFile=githubFileLink(url);githubPending=true;publishError='';buildPollError='';
  if(!isFile){
    if(publishDraft.githubRequest?.url!==url||['ready','failed','cancelled'].includes(matchingBuild()?.status))publishDraft.githubRequest={url,key:uid()};
    publishDraft.githubImport=null;publishDraft.githubBuild=null;savePublish();
  }
  const requestKey=publishDraft.githubRequest?.key;refreshPublishState();
  try{
    if(isFile){
      const data=await api('/api/imports/github',{method:'POST',body:{url}});
      if(owner!==draftOwner||job!==githubJob||publishDraft.source!=='github'||publishDraft.githubURL?.trim()!==url)return;
      publishFile=new File([data.html],data.filename,{type:'text/html'});publishDraft.githubBuild=null;publishDraft.githubImport={url,sourceUrl:data.sourceUrl,repository:data.repository,commitSha:data.commitSha,path:data.path};publishDraft.key=uid();savePublish();await fileStore('put','game',publishFile);
    }else{
      const {build}=await api('/api/builds',{method:'POST',headers:{'Idempotency-Key':requestKey},body:{url}});
      if(owner!==draftOwner||publishDraft.githubRequest?.key!==requestKey||publishDraft.githubURL?.trim()!==url)return;
      publishDraft.githubBuild={...build,inputURL:url};if(job===githubJob&&publishDraft.source==='github'&&!publishPending)publishDraft.key=uid();savePublish();pollGithubBuild();
    }
  }catch(error){if(owner===draftOwner&&job===githubJob&&publishDraft.githubURL?.trim()===url)publishError=error.message;}
  finally{if(job===githubJob){githubPending=false;refreshPublishState();}}
}
async function submitPublish(form){
  if(publishPending||githubPending)return;
  const d=publishDraft;publishError='';
  if(d.source==='html'&&!publishFile){publishError="请先选择 HTML 游戏文件。";refreshPublishState();return;}
  if(d.source==='github'&&!githubReady()){publishError="请先完成当前 GitHub 项目的导入。";refreshPublishState();return;}
  if(d.source==='url'&&!safeExternal(d.url)){publishError="请输入完整的 http:// 或 https:// 链接。";refreshPublishState();return;}
  if(d.source==='url'&&new URL(d.url).hostname==='github.com'){publishError="这是 GitHub 仓库页面，请选择 GitHub 导入，或填写部署后的 GitHub Pages 地址。";refreshPublishState();return;}
  const body=new FormData();body.set('name',d.name.trim());body.set('desc',d.desc.trim());body.set('source',d.source==='github'?'html':d.source);
  if(d.source==='github'&&matchingBuild()?.status==='ready')body.set('buildId',matchingBuild().id);else if(d.source!=='url')body.set('file',publishFile.type==='text/html'?publishFile:new File([publishFile],publishFile.name,{type:'text/html'}));else body.set('url',d.url.trim());if(coverFile)body.set('cover',coverFile);
  publishPending=true;refreshPublishState();
  try{
    const {work}=await api('/api/works',{method:'POST',headers:{'Idempotency-Key':d.key},body});stopBuildPolling();publishDraft={name:'',desc:'',source:'html',url:'',key:uid()};publishFile=null;coverFile=null;refreshCoverPreview();savePublish();await Promise.all([fileStore('delete','game'),fileStore('delete','cover')]);publishPending=false;clearDiscovery();if(route().path==='/publish')go('/published/'+encodeURIComponent(work.id));else notify(t("作品已发布。"));
  }catch(error){publishPending=false;publishError=error.message;refreshPublishState();if(route().path==='/publish'&&error.status===401)$('#publish-error').innerHTML=esc(t(error.message))+` <a class="text-link" target="_top" href="${esc(signinURL())}">${t("重新登录")}</a>`;}
}
async function renderPublished(r,number){const {work}=await api('/api/works/'+encodeURIComponent(r.path.split('/')[2]));applyHTML(`<div class="page narrow">${head(t("作品已发布"),work.name)}<div class="work-grid" style="max-width:560px;grid-template-columns:1fr">${workTile(work)}</div><div class="form-footer"><a class="button primary" href="${esc(workHref(work,'/studio/works'))}">${t("试玩作品")}</a><a class="button" href="#/cards/me">${t("放进名片")}</a><a class="button quiet" href="#/studio/works">${t("我的作品")}</a></div></div>`,number);}
const steps = current => `<div class="steps" aria-label="${t("制作步骤")}">${[t("选择作品"),t("选择模板"),t("预览与保存")].map((name,index)=>`<span class="${index===current?'active':''}" ${index===current?'aria-current="step"':''}><b>${index+1}</b>${name}</span>`).join('')}</div>`;
async function renderBuilder(r,number){
  const works=await readMine();const ids=new Set(works.map(w=>w.id));cardDraft.ids=cardDraft.ids.filter(id=>ids.has(id));saveCardDraft();
  if(!works.length){applyHTML(cardsPage(`${head(t("我的名片"))}${empty(t("先放进一件作品"),t("名片会复用作品已有的封面和介绍。"),`<a class="button primary" href="#/publish">${t("发布作品")}</a>`)}`,'mine'),number);return;}
  const step=r.path.endsWith('/preview')?2:r.path.endsWith('/template')?1:0;
  if(step>0&&!cardDraft.ids.length){go('/cards/me');return;}
  if(step===2&&!preview){go('/cards/me/template');return;}
  if(step===0){
    let published=null;try{published=(await api('/api/cards/me')).card;}catch(e){if(e.status!==404)throw e;}
    if(!applyHTML(cardsPage(`${head(t("我的名片"),'',published?`<a class="button" href="#/card/${encodeURIComponent(published.id)}">${t("已保存的名片 ↗")}</a>`:'')}${steps(0)}<h2>${t("选择要展示的作品")}</h2><div class="select-grid">${works.map(w=>`<label class="select-work ${cardDraft.ids.includes(w.id)?'selected':''}"><input type="checkbox" value="${esc(w.id)}" ${cardDraft.ids.includes(w.id)?'checked':''}><div class="cover ${safeCover(w.coverUrl)?'':'empty-cover'}">${safeCover(w.coverUrl)?`<img src="${esc(safeCover(w.coverUrl))}" alt="" loading="lazy">`:`<span>${esc(w.name)}</span>`}</div><div class="select-copy">${esc(w.name)}<small>${esc(w.version)}</small></div></label>`).join('')}</div><div id="selection-order" class="selection-order"></div><div class="form-footer"><button class="button primary" id="to-template" ${cardDraft.ids.length?'':'disabled'}>${t("选择模板 →")}</button><span id="selection-count" class="tiny muted"></span></div>`,'mine'),number))return;
    const refresh=()=>{const selected=cardDraft.ids.map(id=>works.find(w=>w.id===id));$('#selection-count').textContent=`${t("已选")} ${selected.length} ${t("/ 30 件")}`;$('#to-template').disabled=!selected.length;$('#selection-order').innerHTML=selected.map((w,i)=>`<span class="order-chip">${i+1}. ${esc(w.name)}<button data-reorder="${esc(w.id)}" data-direction="-1" ${i===0?'disabled':''} aria-label="${t("前移")} ${esc(w.name)}">←</button><button data-reorder="${esc(w.id)}" data-direction="1" ${i===selected.length-1?'disabled':''} aria-label="${t("后移")} ${esc(w.name)}">→</button></span>`).join('');$$('.select-work input').forEach(input=>{input.disabled=!input.checked&&selected.length>=30;input.closest('label').classList.toggle('selected',input.checked);});};refresh();
    $$('.select-work input').forEach(input=>input.addEventListener('change',()=>{if(input.checked)cardDraft.ids.push(input.value);else cardDraft.ids=cardDraft.ids.filter(id=>id!==input.value);invalidatePreview();refresh();}));
    $('#selection-order').addEventListener('click',event=>{const button=event.target.closest('[data-reorder]');if(!button)return;const from=cardDraft.ids.indexOf(button.dataset.reorder),to=from+Number(button.dataset.direction);if(to<0||to>=cardDraft.ids.length)return;[cardDraft.ids[from],cardDraft.ids[to]]=[cardDraft.ids[to],cardDraft.ids[from]];invalidatePreview();refresh();});$('#to-template').addEventListener('click',()=>go('/cards/me/template'));return;
  }
  if(step===1){
    if(!applyHTML(cardsPage(`${head(t("选择模板"))}${steps(1)}<div class="template-grid">${[['wall',t("白墙画展"),t("平铺浏览作品")],['fold',t("卡中展厅"),t("展开名片，进入展厅")],['collection',t("点亮收藏"),t("桌面卡片，轻触试玩")]].map(([id,title,desc])=>`<button class="template ${cardDraft.template===id?'selected':''}" data-template="${id}" aria-pressed="${cardDraft.template===id}"><span class="template-art has-covers ${id==='wall'?'white':id}">${cardDraft.ids.slice(0,3).map(workId=>{const w=works.find(w=>w.id===workId),src=safeCover(w.coverUrl);return src?`<img src="${esc(src)}" alt="">`:`<span class="template-cover-title">${esc(w.name)}</span>`;}).join('')}</span><span class="template-copy"><strong>${title}</strong><p>${desc}</p></span></button>`).join('')}</div><form id="card-profile"><div class="profile-fields"><div class="field"><label for="card-name">${t("你的名字")}</label><input id="card-name" name="name" maxlength="80" required value="${esc(cardDraft.name||me.name)}"></div><div class="field"><label for="card-bio">${t("简介")}</label><input id="card-bio" name="bio" maxlength="500" value="${esc(cardDraft.bio)}" placeholder="${t("简单介绍你自己")}"></div></div><details class="personalization"><summary>${t("个性设置")}</summary><div class="personalization-fields"><div class="field"><label for="card-headline">${t("身份 / 角色")}</label><input id="card-headline" name="headline" maxlength="120" value="${esc(cardDraft.headline||'')}" placeholder="${t("你想如何介绍自己")}"></div><div class="field"><label for="card-signature">${t("签名")}</label><input id="card-signature" name="signature" maxlength="80" value="${esc(cardDraft.signature||'')}" placeholder="${t("留下一句话")}"></div><div class="field"><label for="card-website">${t("个人网址")}</label><input id="card-website" name="website" type="url" maxlength="2000" value="${esc(cardDraft.website||'')}" placeholder="https://"></div><fieldset class="field back-styles" data-fold-options ${cardDraft.template==='fold'?'':'hidden'}><legend>${t("卡背样式")}</legend><div class="theme-options">${[['ink',t("墨黑")],['ivory',t("象牙白")],['cobalt',t("钴蓝")]].map(([value,label])=>`<label class="theme-option"><input type="radio" name="backStyle" value="${value}" ${cardDraft.backStyle===value?'checked':''}><span class="theme-swatch ${value}" aria-hidden="true"></span>${label}</label>`).join('')}</div></fieldset></div></details><div class="form-footer"><button class="button primary" type="submit">${t("生成预览 →")}</button><a class="button quiet" href="#/cards/me">${t("← 返回选作品")}</a></div></form>`,'mine'),number))return;
    $$('[data-template]').forEach(b=>b.addEventListener('click',()=>{cardDraft.template=b.dataset.template;invalidatePreview();$$('[data-template]').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b));});$('[data-fold-options]').hidden=cardDraft.template!=='fold';}));
    const form=$('#card-profile');
    const captureProfile=()=>{for(const key of ['name','bio','headline','signature','website','backStyle'])cardDraft[key]=form.elements[key].value;invalidatePreview();};
    form.addEventListener('input',()=>{form.elements.name.setCustomValidity('');form.elements.website.setCustomValidity('');captureProfile();});
    form.addEventListener('submit',event=>{
      event.preventDefault();captureProfile();
      if(!cardDraft.name.trim()){form.elements.name.setCustomValidity(t("请输入你的名字。"));form.elements.name.reportValidity();return;}
      if(cardDraft.website.trim()&&!safeExternal(cardDraft.website.trim())){form.elements.website.setCustomValidity(t("请填写不含账号密码的 http:// 或 https:// 网址。"));form.elements.website.reportValidity();return;}
      for(const key of ['name','bio','headline','signature','website'])cardDraft[key]=cardDraft[key].trim();saveCardDraft();
      const selected=cardDraft.ids.map(id=>works.find(w=>w.id===id)),key=JSON.stringify({name:cardDraft.name,bio:cardDraft.bio,...cardProfile(cardDraft),template:cardDraft.template,works:selected});
      preview=prepareCardPreview(preview,{id:'preview',authorId:me.id,name:cardDraft.name,bio:cardDraft.bio,...cardProfile(cardDraft),template:cardDraft.template,workIds:[...cardDraft.ids],works:structuredClone(selected),fingerprint:key},uid());write(storage.preview,preview);go('/cards/me/preview');
    });return;
  }
  if(!applyHTML(cardsPage(`${head(t("名片预览"))}${steps(2)}${cardMarkup(preview,'/cards/me/preview')}<p id="card-error" class="error" role="alert">${esc(t(cardError)||(!isPinnedPreview(preview)?t("这份预览来自旧版，请重新生成后保存。"):''))}</p><div class="card-actions"><a class="button quiet" href="#/cards/me/template">${t("← 返回选模板")}</a><button class="button primary" id="save-card" ${cardPending?'disabled':''}>${cardPending?t("正在保存…"):!isPinnedPreview(preview)?t("重新生成预览"):cardError?t("重试保存"):t("保存名片")}</button></div>`,'mine'),number))return;
  mountCard(preview,'/cards/me/preview');$('#save-card').addEventListener('click',saveCard);
}
function cardMarkup(card,from,cardId=''){
  if(['fold','collection'].includes(card.template))return `<div class="card-preview"><iframe id="gallery-frame" class="gallery-frame" src="/${card.template==='collection'?'collection':'gallery'}/index.html?lang=${getLocale()}" title="${card.template==='collection'?t("点亮收藏"):t("卡中展厅")}" loading="eager"></iframe></div>`;
  const profile=cardProfile(card);
  return `<div class="card-preview"><article class="white-card"><header><h2>${esc(card.name)}</h2>${profile.headline?`<p class="card-headline">${esc(profile.headline)}</p>`:''}${card.bio?`<p class="bio">${esc(card.bio)}</p>`:''}${profile.website?`<a class="profile-website" href="${esc(profile.website)}" target="_blank" rel="noopener noreferrer">${esc(new URL(profile.website).hostname)} ↗</a>`:''}</header><div class="work-grid">${card.works.map(w=>workTile(w,{from,creator:false,cardId})).join('')}</div>${profile.signature?`<footer class="card-signature">${esc(profile.signature)}</footer>`:''}</article></div>`;
}

function normalizeGalleryView(card,view={}){
  view=view&&typeof view==='object'?view:{};
  const pageSize=window.FuntrackGallery.pageSize,pages=Math.max(1,Math.ceil(card.works.length/pageSize)),focusIndex=typeof view.focusWorkId==='string'?card.works.findIndex(work=>work.id===view.focusWorkId):-1,inside=view.inside===true;
  const sourcePageSize=Number.isInteger(view.pageSize)&&view.pageSize>0?view.pageSize:9,sourcePages=Math.max(1,Math.ceil(card.works.length/sourcePageSize));
  const sourcePage=Number.isInteger(view.page)?Math.max(0,Math.min(sourcePages-1,view.page)):0,mappedPage=Math.floor(sourcePage*sourcePageSize/pageSize);
  return {open:view.open===true,face:view.face==='back'?'back':'front',inside,focusWorkId:focusIndex>=0?card.works[focusIndex].id:null,page:focusIndex>=0?Math.floor(focusIndex/pageSize):Math.min(pages-1,mappedPage),pageSize,yaw:Number.isFinite(view.yaw)?Math.max(inside?-1.3:-.65,Math.min(inside?1.3:.85,view.yaw)):0};
}

function mountCard(card,key){
  if(!['fold','collection'].includes(card.template)){currentGallery=null;return;}
  const frame=$('#gallery-frame');if(!frame)return;
  const gallery={frame,card,key,initialized:false,restoreScroll:scrolls.get(key)||0,restoreTimer:null,view:normalizeGalleryView(card,galleryViews.get(key))};currentGallery=gallery;
  frame.addEventListener('load',()=>initializeGallery(gallery));
}
function initializeGallery(gallery){if(!gallery||gallery!==currentGallery||gallery.initialized||!gallery.frame.contentWindow)return;gallery.initialized=true;gallery.view=normalizeGalleryView(gallery.card,gallery.view);gallery.frame.contentWindow.postMessage({type:'funtrack:gallery:init',payload:{locale:getLocale(),author:{id:gallery.card.authorId,name:gallery.card.name,bio:gallery.card.bio,...cardProfile(gallery.card)},works:gallery.card.works.map(w=>({id:w.id,name:w.name,desc:w.desc,cover:safeCover(w.coverUrl),kind:w.source==='url'?"外链作品":"网页游戏",version:w.version})),...gallery.view}},location.origin);}
async function saveCard(){
  if(cardPending||!preview)return;if(!isPinnedPreview(preview)){go('/cards/me/template');return;}cardPending=true;cardError='';const button=$('#save-card');button.disabled=true;button.textContent=t("正在保存…");const saving=preview;
  try{const {card}=await api('/api/cards',{method:'POST',headers:{'Idempotency-Key':saving.saveKey},body:{workIds:saving.workIds,workRefs:previewReferences(saving),template:saving.template,name:saving.name,bio:saving.bio,...cardProfile(saving)}});cardPending=false;me={...me,name:card.name,bio:card.bio,...cardProfile(card)};identity();if(route().path==='/cards/me/preview')go('/card/'+encodeURIComponent(card.id)+'?saved=1');else notify(t("名片已保存。"));}
  catch(error){cardPending=false;cardError=error.message;if($('#save-card')){$('#save-card').disabled=false;$('#save-card').textContent=t("重试保存");$('#card-error').textContent=t(error.message);}}
}
async function renderCard(r,number,countView=true){
  const {card}=await api('/api/cards/'+encodeURIComponent(decodeURIComponent(r.path.split('/')[2]))),own=card.authorId===me.id,shared=location.origin+'/site.html#/card/'+encodeURIComponent(card.id);
  if(!applyHTML(`<div class="page card-view"><div class="card-view-top"><a class="back" href="${own?'#/cards/me':'#/cards'}">← ${own?t("我的名片"):t("名片")}</a>${r.params.has('saved')?`<span class="saved-label" role="status">${t("已保存")}</span>`:''}<button class="button small" data-share-url="${esc(shared)}" data-share-title="${esc(card.name)}">${t("分享名片")}</button></div>${cardMarkup(card,r.raw,card.id)}<details class="card-secondary"><summary>${t("更多")}</summary>${own?`<a class="text-link" href="#/cards/me">${t("重新制作")}</a>`:''}<button class="button quiet small" data-copy-url="${esc(shared)}">${t("复制名片链接")}</button><p class="tiny muted">${t("访问范围沿用当前站点设置。")}</p></details></div>`,number))return;
  mountCard(card,r.raw);if(countView){postAction('card_view',{cardId:card.id});visitRecorded=true;}
}

function syncSocial(work,requestedAt=performance.now()){
  if(likePending.has(work.id)||(socialState.get(work.id)?.confirmedAt||0)>requestedAt)return;
  if(typeof work.likesCount==='number'&&typeof work.likedByMe==='boolean'){socialState.set(work.id,{liked:work.likedByMe,likesCount:work.likesCount});likeRetry.delete(work.id);}
}
function heartIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 4.9a5.3 5.3 0 0 0-7.5 0L12 6l-1.1-1.1a5.3 5.3 0 0 0-7.5 7.5L12 21l8.5-8.6a5.3 5.3 0 0 0 0-7.5Z"/></svg>';}
function shareIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M5 12v8h14v-8"/></svg>';}
function socialControls(work,{share=true,comments=false}={}){const state=socialState.get(work.id),liked=state?.liked===true,pending=likePending.has(work.id),retry=likeRetry.has(work.id);return `<div class="work-actions"><button class="${liked?'liked':''}" data-like="${esc(work.id)}" data-work-name="${esc(work.name)}" aria-pressed="${liked}" aria-label="${retry?t("重试"):liked?t("取消点赞"):t("点赞")} ${esc(work.name)}" ${pending?'disabled':''}>${heartIcon()}<span class="${retry?'retry':''}">${pending?'…':retry?t("重试"):state?n(state.likesCount):''}</span></button>${comments?`<a class="work-comment-count" href="${esc(workHref(work))}&discussion=1" aria-label="${esc(t("查看 {name} 的讨论",{name:work.name}))}">${commentIcon()}<span>${n(work.commentsCount||0)}</span></a>`:''}${share?`<button data-share-url="${esc(location.origin+'/site.html#/work/'+encodeURIComponent(work.id))}" data-share-title="${esc(work.name)}" aria-label="${t("分享")} ${esc(work.name)}">${shareIcon()}</button>`:''}</div>`;}
function refreshSocial(id){const state=socialState.get(id),liked=state?.liked===true,pending=likePending.has(id),retry=likeRetry.has(id);$$('[data-like]').filter(button=>button.dataset.like===id).forEach(button=>{button.disabled=pending;button.classList.toggle('liked',liked);button.setAttribute('aria-pressed',String(liked));button.setAttribute('aria-label',(retry?t("重试"):liked?t("取消点赞"):t("点赞"))+' '+button.dataset.workName);const count=$('span',button);count.textContent=pending?'…':retry?t("重试"):state?n(state.likesCount):'';count.className=retry?'retry':'';});}
function acceptLike(id,response){if(response.workId!==id||typeof response.liked!=='boolean'||!Number.isInteger(response.likesCount)||response.likesCount<0)throw new Error(t("暂时没有收到点赞结果。"));socialState.set(id,{liked:response.liked,likesCount:response.likesCount,confirmedAt:performance.now()});}
async function toggleLike(id){
  if(likePending.has(id))return;
  const account=draftOwner,desired=likeRetry.has(id)?likeRetry.get(id):!socialState.get(id)?.liked;likePending.add(id);refreshSocial(id);
  try{const response=await api('/api/works/'+encodeURIComponent(id)+'/like',{method:'POST',body:{liked:desired}});if(account!==draftOwner)return;acceptLike(id,response);likeRetry.delete(id);}
  catch(error){
    if(account!==draftOwner)return;let confirmed=false;
    try{const actual=await api('/api/works/'+encodeURIComponent(id)+'/like');if(account!==draftOwner)return;acceptLike(id,actual);confirmed=actual.liked===desired;}catch{}
    if(confirmed)likeRetry.delete(id);else{likeRetry.set(id,desired);notify(error.status===401?t("请重新登录后重试。"):t("暂时没能保存点赞，点击重试。"));}
  }finally{if(account===draftOwner){likePending.delete(id);refreshSocial(id);}}
}
function manualShare(url,title=''){
  const old=$('#share-link-dialog');if(old)old.remove();
  const dialog=document.createElement('dialog');dialog.id='share-link-dialog';dialog.className='share-dialog';dialog.setAttribute('aria-labelledby','share-title');
  dialog.innerHTML=`<div class="share-dialog-head"><h2 id="share-title">${t("分享链接")}</h2><button class="share-close" type="button" aria-label="${t("关闭")}">×</button></div>${title?`<p class="share-item-title">${esc(title)}</p>`:''}<input readonly aria-label="${t("可分享的链接")}" value="${esc(url)}"><div class="share-dialog-actions"><button class="button primary share-copy" type="button">${t("复制链接")}</button>${typeof navigator.share==='function'?`<button class="button quiet share-native" type="button">${t("更多分享方式")}</button>`:''}</div><p class="share-status" role="status" aria-live="polite"></p>`;
  document.body.appendChild(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  $('.share-close',dialog).addEventListener('click',()=>{if(typeof dialog.close==='function')dialog.close();else dialog.remove();});
  $('.share-copy',dialog).addEventListener('click',async()=>{
    const button=$('.share-copy',dialog),status=$('.share-status',dialog);button.disabled=true;
    try{await navigator.clipboard.writeText(url);button.textContent=t("已复制");status.className='share-status success';status.textContent=t("链接已复制。");}
    catch{const input=$('input',dialog);input.focus();input.select();button.textContent=t("复制链接");status.className='share-status';status.textContent=t("请选中上方链接手动复制。");}
    finally{button.disabled=false;}
  });
  $('.share-native',dialog)?.addEventListener('click',async()=>{
    try{await navigator.share({title:title||'Funtrack',url});}
    catch(error){if(error?.name!=='AbortError'){$('.share-status',dialog).className='share-status';$('.share-status',dialog).textContent=t("未能打开系统分享，请复制链接。");}}
  });
  if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
  $('.share-copy',dialog).focus();return dialog;
}
async function copyLink(url){try{await navigator.clipboard.writeText(url);notify(t("链接已复制。"));return true;}catch{manualShare(url);return false;}}
function shareLink(title,url){return manualShare(url,title);}

function postAction(type,fields){const item=frozenAction(uid(),type,fields);actionQueue.set(item.eventId,{body:item,attempts:0,timer:null});flushAction(item.eventId);}
async function flushAction(id){const item=actionQueue.get(id);if(!item||item.sending)return;item.sending=true;try{const result=await api('/api/events',{method:'POST',body:item.body,keepalive:true});if(result.receipt?.clientEventId===id||result.duplicate)actionQueue.delete(id);else throw new Error('Missing receipt');}catch(error){if([400,403,404,422].includes(error.status)){actionQueue.delete(id);return;}item.attempts++;clearTimeout(item.timer);item.timer=setTimeout(()=>flushAction(id),Math.min(30000,700*2**Math.min(item.attempts,6)));}finally{item.sending=false;}}

function makeQueue(session){const queue={id:session.id,token:session.token,pending:[],sending:false,timer:null,seq:0,attempts:0,startedAt:performance.now(),expiresAt:Date.parse(session.expiresAt)||Date.now()+3600000};sessionQueues.add(queue);return queue;}
function enqueueSession(queue,type,result){const event={id:uid(),type,seq:++queue.seq,elapsedMs:Math.min(3600000,Math.max(0,Math.round(performance.now()-queue.startedAt)))};if(result)event.result=result;queue.pending.push(event);flushSession(queue);return event.id;}
async function flushSession(queue){
  if(queue.sending||!queue.pending.length)return;if(Date.now()>queue.expiresAt){clearTimeout(queue.timer);sessionQueues.delete(queue);return;}
  queue.sending=true;clearTimeout(queue.timer);const batch=queue.pending.slice(0,20);
  try{const response=await api('/api/sessions/'+encodeURIComponent(queue.id)+'/events',{method:'POST',body:{token:queue.token,events:batch},keepalive:true});const acknowledged=new Set([...(response.accepted||[]).map(e=>e.clientEventId),...(response.duplicates||[])]);queue.pending=queue.pending.filter(e=>!acknowledged.has(e.id));if(!acknowledged.size)throw new Error('Missing acknowledgment');queue.attempts=0;}
  catch(error){if([400,403,404,410,422].includes(error.status)){queue.pending=[];sessionQueues.delete(queue);}else queue.attempts++;}
  finally{queue.sending=false;if(queue.pending.length)queue.timer=setTimeout(()=>flushSession(queue),queue.attempts?Math.min(30000,500*2**Math.min(queue.attempts,6)):0);else if(queue.closed)sessionQueues.delete(queue);}
}
function endSession(reason='exit'){
  const session=activeSession;if(!session)return;activeSession=null;
  if(!session.ended){session.ended=true;enqueueSession(session.queue,'session_end',session.clock.finish());}session.queue.closed=true;if(!session.queue.pending.length&&!session.queue.sending)sessionQueues.delete(session.queue);
}
async function startGame(work){
  if(startPending)return;const previousCover=activeSession?.coverHTML;endSession('exit');startPending=true;const originRoute=routeNumber;
  const buttons=$$('[data-action="start-game"]');buttons.forEach(b=>{b.disabled=true;b.textContent=t("正在打开…");});
  try{
    const session=await api('/api/sessions',{method:'POST',body:{workId:work.id,versionId:work.versionId}}),queue=makeQueue(session);
    if(originRoute!==routeNumber){queue.closed=true;enqueueSession(queue,'session_end',{label:'exit'});return;}
    const gameUrl=new URL(session.gameUrl,location.origin);if(gameUrl.origin!==location.origin)throw new Error(t("作品地址不正确，请重试。"));
    const bridge=uid();gameUrl.hash='bridge='+encodeURIComponent(bridge);
    const area=$('#play-area'),coverHTML=previousCover||area.innerHTML;
    area.innerHTML=`<section class="game-shell"><div class="game-tools"><span>${esc(work.name)} · ${esc(work.version)}</span><button class="button quiet small" id="exit-game">${t("退出试玩")}</button></div><iframe id="game-frame" class="game-frame" sandbox="allow-scripts" referrerpolicy="no-referrer" title="${esc(work.name)}"></iframe><div id="game-result" class="game-result" hidden></div></section>`;
    const frame=$('#game-frame');activeSession={...session,queue,bridge,frame,work,started:false,completed:false,ended:false,coverHTML,clock:createPlayClock(()=>performance.now(),!document.hidden)};frame.src=gameUrl.href;
    $('#exit-game').addEventListener('click',()=>restoreGameCover(work,coverHTML));
    buttons.filter(b=>b.isConnected).forEach(b=>{b.hidden=true;});
    area.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  }catch(error){if(originRoute===routeNumber){notify(error.message);buttons.filter(b=>b.isConnected).forEach(b=>{b.disabled=false;b.textContent=t("重试打开");});}}
  finally{startPending=false;}
}
function restoreGameCover(work,html){endSession('exit');const area=$('#play-area');if(!area)return;area.innerHTML=html;$$('[data-action="start-game"]').forEach(b=>{b.hidden=false;b.disabled=false;b.innerHTML=playIcon()+t("开始试玩");});$$('[data-action="start-game"]',area).forEach(b=>b.addEventListener('click',()=>startGame(work)));}
function receiveGame(event){
  const session=activeSession,message=event.data;if(!session||event.source!==session.frame.contentWindow||event.origin!=='null'||!message||message.channel!=='funtrack-game'||message.version!==1||message.bridge!==session.bridge)return;
  if(message.type==='input'&&!session.started&&!session.ended){session.started=true;session.clock.start();enqueueSession(session.queue,'play_start');}
  else if(message.type==='complete'&&session.started&&!session.completed&&!session.ended){
    session.completed=true;const result={};if(message.result&&typeof message.result==='object'){if(typeof message.result.score==='number'&&Number.isFinite(message.result.score))result.score=message.result.score;if(typeof message.result.label==='string')result.label=message.result.label.slice(0,120);}
    const timing=session.clock.finish();enqueueSession(session.queue,'game_complete',result);session.ended=true;enqueueSession(session.queue,'session_end',timing);session.queue.closed=true;
    const area=$('#game-result');if(area){area.hidden=false;area.innerHTML=`<p>${t("本次试玩已结束")}${typeof result.score==='number'?` · ${esc(t("{score} 分",{score:result.score}))}`:''}</p><button class="button small" id="replay-game">${t("再玩一次")}</button><button class="button quiet small" id="to-feedback">${t("参与讨论")}</button>`;$('#replay-game').addEventListener('click',()=>startGame(session.work));$('#to-feedback').addEventListener('click',()=>{$('#comment-input')?.focus();$('#discussion')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});});}
  }
}
function receiveGallery(event){
  const gallery=currentGallery,message=event.data;if(!gallery||event.origin!==location.origin||event.source!==gallery.frame.contentWindow||!message||typeof message!=='object')return;
  if(message.type==='funtrack:gallery:ready')initializeGallery(gallery);
  else if(message.type==='funtrack:gallery:state'){
    gallery.view=normalizeGalleryView(gallery.card,message);galleryViews.set(gallery.key,gallery.view);write(storage.views,Object.fromEntries(galleryViews));
  }else if(message.type==='funtrack:gallery:resize'&&Number.isFinite(message.height)){gallery.frame.style.height=Math.max(400,Math.min(1600,Math.ceil(message.height)))+'px';if(gallery.restoreScroll!==null){requestAnimationFrame(()=>{if(gallery===currentGallery&&gallery.restoreScroll!==null)window.scrollTo(0,gallery.restoreScroll);});clearTimeout(gallery.restoreTimer);gallery.restoreTimer=setTimeout(()=>gallery.restoreScroll=null,700);}}
  else if(message.type==='funtrack:gallery:open-work'){
    const work=gallery.card.works.find(w=>w.id===message.workId);if(!work)return;scrolls.set(gallery.key,window.scrollY);const id=gallery.card.id==='preview'?'':gallery.card.id;go(workHref(work,gallery.key,id).slice(1)+(message.play===true&&work.source==='html'?'&play=1':''));
  }
}
window.addEventListener('message',event=>{receiveGame(event);receiveGallery(event);});
document.addEventListener('visibilitychange',()=>activeSession?.clock.setVisible(!document.hidden));
window.addEventListener('hashchange',renderRoute);
for(const type of ['wheel','touchstart'])window.addEventListener(type,()=>{if(currentGallery)currentGallery.restoreScroll=null;},{passive:true});
window.addEventListener('online',()=>{actionQueue.forEach((_,id)=>flushAction(id));sessionQueues.forEach(flushSession);});
window.addEventListener('pagehide',()=>{endSession('exit');actionQueue.forEach((_,id)=>flushAction(id));sessionQueues.forEach(queue=>{if(queue.pending.length)api('/api/sessions/'+encodeURIComponent(queue.id)+'/events',{method:'POST',body:{token:queue.token,events:queue.pending.slice(0,20)},keepalive:true}).catch(()=>{});});});
document.addEventListener('click',async event=>{
  const outbound=event.target.closest('[data-outbound]');if(outbound)postAction('outbound_click',{workId:outbound.dataset.outbound,versionId:outbound.dataset.version});
  const button=event.target.closest('[data-action="reload"]');if(button){authChecked=false;clearDiscovery();renderRoute();}
  const like=event.target.closest('[data-like]');if(like)toggleLike(like.dataset.like);
  const share=event.target.closest('[data-share-url]');if(share)shareLink(share.dataset.shareTitle,share.dataset.shareUrl);
  const copy=event.target.closest('[data-copy-url]');if(copy)copyLink(copy.dataset.copyUrl);
});
function renderChrome(){
  document.documentElement.lang=getLocale();
  $('.skip').textContent=t('跳至内容');
  $('.brand').setAttribute('aria-label',t('Funtrack 首页'));
  $('.site-header nav').setAttribute('aria-label',t('主导航'));
  $('[data-nav="studio"]').textContent=t('创作中心');
  $('[data-nav="cards"]').textContent=t('名片');
  const button=$('#locale-toggle');button.textContent=getLocale()==='en'?'中':'EN';
  button.setAttribute('aria-label',getLocale()==='en'?'切换为中文':'Switch to English');
  button.title=getLocale()==='en'?'中文':'English';
  identity();
}
$('#locale-toggle').addEventListener('click',()=>{
  if(activeSession&&!activeSession.ended){notify(t('结束试玩后可切换语言'));return;}
  if(publishPending||cardPending||startPending||hasPendingVersionMutation()){notify(t('正在提交，请稍后切换语言'));return;}
  setLocale(getLocale()==='en'?'zh-CN':'en');
});
window.addEventListener('funtrack:localechange',()=>{
  scrolls.set(currentRoute,window.scrollY);renderChrome();
  $('#share-link-dialog')?.remove();renderRoute({localeOnly:true});
});
for(const draft of Object.values(feedbackDrafts))draft.pending=false;
renderChrome();renderRoute();
