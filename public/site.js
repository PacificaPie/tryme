import { mountCardDiscovery } from './feed-card.js';
import { mountOnboarding, onboardingRoute, createOnboardingInvitation, onboardingInvitationMarkup } from './onboarding.js';
import { createOpening } from './opening.js';
import { renderCardDraftStart } from './card-draft-flow.js';
import { createNotificationCenter } from './notifications.js';
import { mountPublishWizard, publishProgress } from './publish-wizard.js';
import { mountPublishMedia, sourceForm } from './publish-media.js';
import {WORK_CATEGORIES,workCategoryLabel} from './work-categories.js';
import { creationMenuMarkup } from './creation-menu.js';
import { mountCoverReview } from './cover-review.js';
import { previewMarkup, previewButton, mountVideoPreviews, mountAutoPreview } from './video-preview.js';
import { t, getLocale, setLocale, registerMessages } from './i18n.js';
import { createGalleryBridge } from './gallery/embed.js';
import { publicCardPath, legacyPublicCardPath } from './public-card-links.js';
import {discoveryPath,discoveryState,changeVisibility,renderDiscoverySettings,disposePublicationControls,hasPendingPublicationControl,publicationFailureMessage,publicationFailureActions} from './publication-controls.js';
import './site.messages.js';
import { changeArchive, isArchived, archivedWorksPath } from './archive-controls.js';
import { emptyState, pageSkeleton, loadingMark } from './empty-state.js';
import { beginRouteLoading, mountMenus } from './experience.js?v=20261117-creator-actions';
import './experience.messages.js';
import { cardShareText, openShareDialog } from './sharing.js';
import { confirmCardDeletion, hasPendingCardDeletion } from './card-actions.js';
import { avatarMarkup } from './avatars.js';
import { openProfileEditor } from './profile-editor.js';
import { mountCreatorHome } from './creator-home.js';
import { mountCreatorDirectory } from './creator-directory.js';
import { renderCardWorkspace } from './card-workspace.js';
import { renderCardCoverUpdates } from './card-cover-updates.js';
import { mountTemplateExperience } from './card-template-experience.js';
import { createRemixDraft, remixStyle } from './card-remix.js';
import { withCardIdentity, cardPreviewFingerprint } from './card-identity.js';
import './creator-social.messages.js';
import { signInState } from './sign-in-state.js';
import { CARD_TEMPLATES, renderPortfolioCard, mountPortfolioCard } from './card-templates.js';
import { syncNavigation } from './navigation.js';
import { mountDiscussion, commentHref, commentVersionLabel } from './discussion.js';
import { createPlayClock } from './play-clock.js';
import { waitForPendingPlayStart } from './play-start-order.js';
import { mountGameDisplay } from './game-display.js';
import { authHeaders, assertAuthAccount, authURL, getAuthConfig } from './auth-client.js';
import { mountAnalytics } from './analytics.js';
import { renderVersioning, disposeVersioning, hasPendingVersionMutation } from './versioning.js';
import { renderWorkEdit, disposeWorkEdit, hasPendingWorkEdit } from './work-edit.js';
import { previewReferences, isPinnedPreview, prepareCardPreview, frozenAction } from './versioning-state.js';
import { mountDiscovery, clearDiscovery, updateDiscoveryWork } from './discovery.js';
import { HTML_UPLOAD_HINT, htmlFileError, htmlImportSizeNotice, isGithubHTMLURL, importErrorText, repositoryImportBlocked, buildAvailabilityMarkup, createBuildAvailability } from './import-status.js';
let templateExperiencePanel=null, notificationPage=null;
registerMessages({'名片会自动使用你的最新个人资料。':'Your card automatically uses your latest profile.','模板已选好，继续制作你的名片。':'The template is selected. Continue making your card.','这个名片模板不存在。':'This card template does not exist.','登录后试玩':'Sign in to play'});
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const main = $('#main');
const opening = createOpening();
let onboardingState=null, onboardingPanel=null;
const onboardingInvitation=createOnboardingInvitation();
mountMenus();
let discussionPanel = null;
let finishRouteLoading = null, publishedExternalCover = null, publishCoverDraft = null, publishWizard = null, publishedAutoCover = null, publishedAutoPreview = null, publishedVideos = null;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => crypto.randomUUID();
const read = (key, fallback) => { try { return JSON.parse(sessionStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key,value) => { try { sessionStorage.setItem(key,JSON.stringify(value)); } catch {} };
const storage = {publish:'funtrack.real.publish',card:'funtrack.real.card',preview:'funtrack.real.preview',feedback:'funtrack.real.feedback',views:'funtrack.real.gallery'};
const storageBase={...storage};let draftOwner=null,fileScope='';
let startPending=false, analyticsPanel=null, discoveryPanel=null, creatorPanel=null, visitRecorded=false, publishAvailability=null;
let publishFailure=null,publishRelatedWorks=[];
let me=null, authChecked=false, routeNumber=0, currentRoute='', noticeTimer, currentGallery=null, activeSession=null;
const scrolls=new Map();
const galleryViews=new Map(Object.entries(read(storage.views,{})));
const feedbackDrafts=read(storage.feedback,{});
let publishDraft={name:'',desc:'',source:'html',url:'',key:uid(),...read(storage.publish,{})},publishFile=null,coverFile=null,coverPreview='',publishPending=false,publishError='',githubPending=false,githubJob=0,buildPollTimer,buildPollRevision=0,buildCancelPending=false,buildPollError='';
let cardDraft={ids:[],template:'wall',signature:'',backStyle:'ink',...read(storage.card,{})},preview=read(storage.preview,null),cardPending=false,cardError='',cardKey=uid();
let sessionQueues=new Set(),actionQueue=new Map();
const socialState=new Map(),likePending=new Set(),likeRetry=new Map();
class ApiError extends Error { constructor(message,status,code){super(message);this.status=status;this.code=code;} }
async function api(path, options={}) {
  const publicRead=path.startsWith('/api/public/')&&(!options.method||options.method==='GET');
  // draftOwner pins this document to the account that loaded its drafts.
  // Switching accounts needs a fresh document, never rebinding old callbacks.
  const expectedUserId=publicRead?null:draftOwner;
  const assertCurrent=()=>{
    if(expectedUserId&&draftOwner!==expectedUserId)throw new ApiError('登录账号已变化，请刷新页面后重试。',409,'AUTH_SESSION_CHANGED');
    if(!publicRead)assertAuthAccount(expectedUserId);
  };
  const headers={...publicRead?{}:await authHeaders(expectedUserId),...(options.headers||{})};
  assertCurrent();
  if(expectedUserId)headers['X-Funtrack-Expected-User']=expectedUserId;
  if(options.method&&options.method!=='GET')headers['X-Funtrack-CSRF']='1';
  if(options.body && !(options.body instanceof FormData)) {headers['Content-Type']='application/json';options={...options,body:JSON.stringify(options.body)};}
  let response;
  try {response=await fetch(path,{...options,credentials:publicRead?'omit':'same-origin',headers});} catch {throw new ApiError("连接暂时中断，请重试。",0,'NETWORK');}
  let data;try{data=await response.json();}catch{throw new ApiError("服务暂时不可用，请稍后重试。",response.status,'BAD_RESPONSE');}
  assertCurrent();
  if(path==='/api/me'&&response.ok)assertAuthAccount(data.user?.id);
  if(!response.ok){const error=new ApiError(data.error?.message||"暂时无法完成，请重试。",response.status,data.error?.code);for(const field of ['current','existingWork','existingVersion'])if(data.error?.[field])error[field]=data.error[field];throw error;}
  return data;
}
const notificationCenter=createNotificationCenter({header:$('#notification-entry'),api,esc,notify,onSessionChanged:()=>{me=null;authChecked=false;identity();}});
function signinURL(){return authURL('sign-in','/site.html'+(location.hash||'#/'));}
function signinLink(label=t("登录")){return `<a class="button primary" href="${esc(signinURL())}" target="_top">${esc(label)}</a>`;}
function identity(){ notificationCenter.setUser(me); $('#identity').innerHTML=me?`<details class="account-menu"><summary class="avatar" aria-label="${t("账号菜单")}">${avatarMarkup(me,{className:'account-avatar'})}</summary><div class="account-options"><span>${esc(me.name)}</span><a href="#/author/${encodeURIComponent(me.id)}">${t('个人主页')}</a><a href="#/following">${t('关注列表')}</a><button type="button" data-edit-profile>${t('编辑个人资料')}</button><a href="#/studio/works">${t("创作中心")}</a><a href="#/cards">${t("我的名片")}</a><a href="#/welcome">${t('开始创作')}</a><a href="${esc(authURL('sign-out','/site.html#/feed'))}" target="_top">${t("退出登录")}</a></div></details><span class="identity-name">${esc(me.name)}</span>`:getAuthConfig().provider==='unknown'?'':`<a class="button quiet" href="${esc(signinURL())}" target="_top">${t("登录")}</a>`; }
function editProfile(){
  if(!me)return;const owner=me.id;
  const profileAPI=(path,options)=>{if(me?.id!==owner||draftOwner!==owner)throw new ApiError(t('请重新登录后重试。'),401,'AUTH_SESSION_CHANGED');return api(path,options);};
  openProfileEditor({user:me,api:profileAPI,notify,onSaved:user=>{
    if(me?.id!==owner||user?.id!==owner)return;
    me={...me,...user};identity();clearDiscovery();syncCardPreview(me);
    const r=route();if(r.path==='/feed'||r.path==='/cards'||r.path==='/following'||r.path.startsWith('/card/')||r.path.startsWith('/cards/')||r.path==='/author/'+encodeURIComponent(me.id)||r.path==='/author/'+me.id)renderRoute();
  }});
}
function notify(message){message=t(message);clearTimeout(noticeTimer);$('#notice').textContent=message;$('#notice').hidden=false;noticeTimer=setTimeout(()=>$('#notice').hidden=true,3500);}
function urlFor(path){return '#'+path;}
function go(path){if(location.hash==='#'+path)renderRoute();else location.hash=path;}
function canonicalPath(path){if(path==='/'||path==='/discover')return '/feed';if(path==='/creators')return '/cards';if(path==='/studio/review')return '/studio/works';if(path==='/studio/card'||path.startsWith('/studio/card/'))return '/cards/me'+path.slice('/studio/card'.length);return path;}
function route(){const raw=(location.hash.slice(1)||'/');const index=raw.indexOf('?');return {path:canonicalPath(index<0?raw:raw.slice(0,index)),params:new URLSearchParams(index<0?'':raw.slice(index+1)),raw};}
function safeCover(value){try{const u=new URL(value,location.origin);return value&&u.origin===location.origin?u.href:'';}catch{return '';}}
function safeExternal(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}}
function date(value){if(!value)return '';const d=new Date(typeof value==='number'&&value<1e12?value*1000:value);return Number.isNaN(d.valueOf())?'':d.toLocaleDateString(getLocale(),{month:'short',day:'numeric'});}
function n(value){return typeof value==='number'&&Number.isFinite(value)?value.toLocaleString(getLocale()):'—';}
function workHref(work, from=route().raw, cardId=''){return '#/work/'+encodeURIComponent(work.id)+'?from='+encodeURIComponent(from)+(cardId?'&card='+encodeURIComponent(cardId):'');}
function cover(work, href, label=true){const src=safeCover(work.coverUrl);return `<a class="cover${src?'':' empty-cover'}" href="${esc(href)}" aria-label="${t("查看")} ${esc(work.name)}">${src?`<img src="${esc(src)}" alt="${esc(work.name)}" loading="lazy">`:`<span aria-hidden="true">${esc(work.name)}</span>`}${label?`<span class="tag">${t(workCategoryLabel(work.category))}</span>`:''}</a>`;}
function workTile(work,{from=route().raw,creator=true,cardId='',social=false}={}){
  const href=workHref(work,from,cardId),src=safeCover(work.coverUrl);
  const author=avatarMarkup({name:work.authorName,avatarUrl:work.authorAvatarUrl},{className:'feed-author-avatar'})+esc(work.authorName||t('创作者'));
  const creatorMarkup=work.authorId?`<a class="creator-link" href="#/author/${encodeURIComponent(work.authorId)}">${author}</a>`:`<span class="creator-link">${author}</span>`;
  return `<article class="work-tile"><a class="work-entry" href="${esc(href)}" aria-label="${t("查看")} ${esc(work.name)}"><div class="cover${src?'':' empty-cover'}">${src?`<img src="${esc(src)}" alt="" loading="lazy">`:`<span>${esc(work.name)}</span>`}${previewMarkup(work.preview)}<span class="cover-action" aria-hidden="true">${t(me?"查看作品":"登录后试玩")} ↗</span></div><div class="tile-info"><div class="tile-copy"><h3 class="tile-title">${esc(work.name)}</h3><p class="tile-desc">${esc(work.desc)}</p></div></div></a>${previewButton(work.preview)}<div class="tile-bottom">${creator?creatorMarkup:''}${social?socialControls(work,{share:false,comments:true}):''}</div></article>`;
}
function workImage(work,className=''){const src=safeCover(work.coverUrl);return src?`<img class="${className}" src="${esc(src)}" alt="${esc(work.name)}">`:`<div class="image-placeholder ${className}">${esc(work.name)}</div>`;}
function playIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg>';}
function commentIcon(){return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8 8H4l1.7-4.1A8 8 0 1 1 20 11.5Z"/></svg>';}


function empty(title,description,action=''){const path=route().path;return emptyState({kind:path.includes('feedback')?'activity':path.startsWith('/cards')?'cards':'works',title,description,action});}
function studio(content,tab){return `<div class="page"><div class="studio"><nav class="studio-nav" aria-label="${t("创作中心")}">${[['works',t("我的作品")],['data',t("数据")]].map(([id,name])=>`<a href="#/studio/${id}" class="${tab===id?'active':''}">${name}</a>`).join('')}</nav><div class="studio-main">${content}</div></div></div>`;}
function cardsPage(content,tab='mine'){return `<div class="page cards-page ${tab==='mine'?'card-builder-page':''}">${content}</div>`;}
function cardBuilderTop(saved=null){return `<div class="card-builder-top"><a class="back" href="#/cards">← ${t("返回名片")}</a>${saved?`<a class="text-link" href="#/card/${encodeURIComponent(saved.id)}">${t("我的已保存名片")} ↗</a>`:''}</div>`;}
function cardProfile(card){return {signature:typeof card.signature==='string'?card.signature:'',headline:typeof card.headline==='string'?card.headline:'',website:safeExternal(card.website),backStyle:['ink','ivory','cobalt'].includes(card.backStyle)?card.backStyle:'ink'};}
function pageError(error){if(error.status===401){me=null;identity();const standalone=getAuthConfig().provider==='clerk';return signInState(signinLink(t(standalone?"登录 / 注册":"使用 ChatGPT 登录")));}return `<div class="page narrow"><section class="error-state"><h2>${t("暂时没能加载")}</h2><p>${esc(t(error.message))}</p><button class="button" data-action="reload">${t("重试")}</button></section></div>`;}
function head(title,subtitle='',action=''){return `<div class="page-head"><div><h1>${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div>${action}</div>`;}
function saveCardDraft(){for(const key of ['name','bio','headline','website','avatarUrl'])delete cardDraft[key];write(storage.card,cardDraft);}
function syncCardPreview(user){
  if(!preview||preview.authorId!==user?.id)return;
  const updated=withCardIdentity(preview,user),fingerprint=cardPreviewFingerprint(updated);
  if(cardPreviewFingerprint(preview)===fingerprint)return;
  preview={...updated,fingerprint,saveKey:uid()};write(storage.preview,preview);
}
function savePublish(){write(storage.publish,publishDraft);}
function saveFeedback(){write(storage.feedback,feedbackDrafts);}
function contentKey(){return JSON.stringify({ids:cardDraft.ids,template:cardDraft.template,signature:cardDraft.signature,backStyle:cardDraft.backStyle});}
function invalidatePreview(){cardError='';cardKey=uid();saveCardDraft();}
async function readMine(state='active'){
  const works=[];let cursor=null;
  do{const params=new URLSearchParams({mine:'1',state,limit:'48'});if(cursor)params.set('cursor',cursor);const page=await api('/api/works?'+params);works.push(...page.works);cursor=page.nextCursor;}while(cursor);
  return works;
}

async function activateDrafts(user){
  if(draftOwner===user.id){syncCardPreview(user);return;}
  const legacyOwner=read('funtrack.real.owner',null),canMigrate=(!legacyOwner||legacyOwner===user.id)&&!read('funtrack.real.migrated:'+user.id,false);
  draftOwner=user.id;cardPending=false;cardError='';stopBuildPolling();githubJob++;githubPending=false;clearDiscovery();socialState.clear();likePending.clear();likeRetry.clear();fileScope=user.id+':';Object.keys(storage).forEach(key=>storage[key]=storageBase[key]+':'+user.id);
  const stored=(key,fallback)=>read(storage[key],canMigrate?read(storageBase[key],fallback):fallback);
  publishDraft={name:'',desc:'',source:'html',url:'',key:uid(),...stored('publish',{})};
  cardDraft={ids:[],template:'wall',signature:'',backStyle:'ink',...stored('card',{})};
  preview=stored('preview',null);if(preview&&!preview.fingerprint&&typeof preview.signature==='string'){preview.fingerprint=preview.signature;preview.signature='';}Object.keys(feedbackDrafts).forEach(key=>delete feedbackDrafts[key]);Object.assign(feedbackDrafts,stored('feedback',{}));Object.values(feedbackDrafts).forEach(d=>d.pending=false);
  syncCardPreview(user);galleryViews.clear();Object.entries(stored('views',{})).forEach(([key,value])=>galleryViews.set(key,value));
  [publishFile,coverFile]=await Promise.all([fileStore('get','game'),fileStore('get','cover')]);
  if(canMigrate){if(!publishFile){publishFile=await fileStore('get','game',null,true);if(publishFile)await fileStore('put','game',publishFile);}if(!coverFile){coverFile=await fileStore('get','cover',null,true);if(coverFile)await fileStore('put','cover',coverFile);}}
  refreshCoverPreview();savePublish();saveCardDraft();saveFeedback();write(storage.preview,preview);write(storage.views,Object.fromEntries(galleryViews));if(!legacyOwner)write('funtrack.real.owner',user.id);write('funtrack.real.migrated:'+user.id,true);
}
async function loadMe(){try{const data=await api('/api/me');me=data.user;onboardingState=data.onboarding||null;}catch(e){if(e.status!==401)throw e;me=null;}finally{identity();}authChecked=true;if(me)await activateDrafts(me);}

function applyHTML(html,number){if(number!==routeNumber)return false;finishRouteLoading?.();finishRouteLoading=null;main.innerHTML=html;syncNavigation();const key=route().raw;requestAnimationFrame(()=>{if(number===routeNumber)window.scrollTo(0,scrolls.get(key)||0);});return true;}
async function renderRoute(options={}){
  // Existing shared hash links should reach the public card before Clerk or
  // private APIs load. In-app navigation keeps the signed-in management view.
  const publicPath=(!authChecked||!me)&&legacyPublicCardPath(location.hash);
  if(publicPath){location.replace(publicPath);return;}
  if(!options.localeOnly)visitRecorded=false;
  onboardingPanel?.dispose();onboardingPanel=null;
  notificationPage?.dispose();notificationPage=null;notificationCenter.onRoute();
  const r=route(),number=++routeNumber;discussionPanel?.dispose();discussionPanel=null;publishWizard?.dispose();publishWizard=null;publishCoverDraft?.dispose();publishCoverDraft=null;publishedExternalCover?.dispose();publishedExternalCover=null;publishedAutoCover?.dispose();publishedAutoCover=null;publishedAutoPreview?.dispose();publishedAutoPreview=null;publishedVideos?.dispose();publishedVideos=null;stopBuildPolling();publishAvailability?.dispose();publishAvailability=null;disposeVersioning();disposeWorkEdit();disposePublicationControls();analyticsPanel?.dispose();analyticsPanel=null;discoveryPanel?.dispose();discoveryPanel=null;creatorPanel?.dispose();creatorPanel=null;templateExperiencePanel?.dispose();templateExperiencePanel=null;
  if(currentRoute&&currentRoute!==r.raw)scrolls.set(currentRoute,window.scrollY);
  endSession('exit');currentGallery?.dispose?.();currentGallery=null;currentRoute=r.raw;
  const activeNav=r.path.startsWith('/cards')||r.path.startsWith('/card/')?'cards':r.path.startsWith('/studio')||r.path==='/publish'?'studio':r.path.startsWith('/author/')||r.path==='/following'?null:'feed';
  $$('.site-header nav a').forEach(a=>a.classList.toggle('active',a.dataset.nav===activeNav));
  syncNavigation();finishRouteLoading?.();finishRouteLoading=beginRouteLoading(main,{html:pageSkeleton(t("正在加载…"),r.path),slowText:t('还在加载，请稍候或重试。'),retryText:t('重试')});
  try{
    if(!authChecked){try{await loadMe();}catch(error){if(r.path!=='/feed'||r.params.get('following')==='1')throw error;me=null;}}
    if(number!==routeNumber)return;
    identity();
    opening.resolve({authenticated:Boolean(me),checked:authChecked,path:r.path});
    const welcome=me&&onboardingRoute(onboardingState,r.path);
    if(welcome){location.replace('#'+welcome);return;}
    if(!me&&(r.path!=='/feed'||r.params.get('following')==='1')){applyHTML(pageError(new ApiError('',401)),number);return;}
    if(r.path==='/welcome')onboardingPanel=mountOnboarding(main,{route:r,user:me,state:onboardingState,api,render:html=>applyHTML(html,number),esc,current:()=>number===routeNumber&&me?.id===draftOwner,onSaved:result=>{me=result.user;onboardingState=result.onboarding;identity();syncCardPreview(me);},onBrowse:()=>onboardingInvitation.dismiss(me),go});
    else if(r.path==='/feed')await renderDiscover(r,number);
    else if(r.path.startsWith('/author/'))await renderCreator(r,number);
    else if(r.path==='/following'||(r.path==='/cards'&&r.params.get('following')==='1'))await renderFollowing(r,number);
    else if(r.path==='/cards')await renderCards(number);
    else if(r.path.startsWith('/work/'))await renderWork(r,number,!visitRecorded,options.localeOnly!==true);
    else if(r.path==='/publish')renderPublish(number);
    else if(r.path.startsWith('/published/'))await renderPublished(r,number);
    else if(/^\/studio\/works\/[^/]+\/discovery$/.test(r.path))await renderDiscoverySettings(r,publicationHelpers(number));
    else if(/^\/studio\/works\/[^/]+\/edit$/.test(r.path))await renderWorkEdit(r,{api,esc,owner:me.id,fileStore,signinURL,notify,go,isCurrent:()=>number===routeNumber,render:html=>applyHTML(html,number),onChanged:()=>clearDiscovery()});
    else if(/^\/studio\/works\/[^/]+\/(update|versions)(\/[^/]+)?$/.test(r.path))await renderVersioning(r,{api,esc,owner:me.id,fileStore,signinURL,notify,go,workImage,startGame,isPlaying:()=>Boolean(activeSession),isCurrent:()=>number===routeNumber,render:html=>applyHTML(html,number),onChanged:()=>clearDiscovery()});
    else if(r.path==='/studio'||r.path==='/studio/works')await renderMyWorks(r,number);
    else if(r.path==='/studio/data')await renderData(r,number);
    else if(r.path==='/notifications'){
      if(applyHTML(`<div class="page notifications-page"><a class="back" href="#/feed">${t('返回发现')}</a><section id="notification-page" aria-label="${t('互动消息')}"></section></div>`,number))notificationPage=notificationCenter.mountPage($('#notification-page'),{filter:r.params.get('filter')||'all',work:r.params.get('work')||'',returnTo:r.raw});
    }
    else if(r.path==='/studio/feedback'){
      if(['legacy','history'].includes(r.params.get('tab')))await renderFeedback(r,number);
      else{const params=new URLSearchParams({filter:'comment'});if(r.params.get('work'))params.set('work',r.params.get('work'));location.replace('#/notifications?'+params);}
    }
    else if(r.path.startsWith('/cards/covers/')){const owner=me.id;await renderCardCoverUpdates(decodeURIComponent(r.path.split('/')[3]),{api,owner,esc,safeCover,root:main,isCurrent:()=>number===routeNumber&&me?.id===owner,render:html=>applyHTML(html,number),onSaved:card=>go('/card/'+encodeURIComponent(card.id)+'?saved=1')});}
    else if(r.path.startsWith('/cards/templates/'))renderTemplateExperience(r,number);
    else if(r.path.startsWith('/cards/me'))await renderBuilder(r,number);
    else if(r.path.startsWith('/card/'))await renderCard(r,number,!visitRecorded);
    else applyHTML(`<div class="page narrow">${empty(t("页面不存在"),t("可以回到发现页继续看看。"),`<a class="button" href="#/">${t("发现作品")}</a>`)}</div>`,number);
  }catch(error){if(number===routeNumber){opening.cancel();applyHTML(pageError(error),number);}}
}
async function renderDiscover(r,number){
  const authorId='',authorCard=null;
  const owner=me?.id,showInvitation=onboardingInvitation.visible(me,onboardingState);
  if(!applyHTML(`<div class="page discovery-page">${showInvitation?onboardingInvitationMarkup():''}<div class="discovery-content"></div></div>`,number))return;
  $('[data-onboarding-browse]')?.addEventListener('click',()=>{
    if(number!==routeNumber||me?.id!==owner)return;
    onboardingInvitation.dismiss(me);
    $('.onboarding-invitation')?.remove();
    $('#work-search')?.focus();
  });
  const panel=await mountDiscovery($('.discovery-content'),{api,esc,workTile,syncSocial,mixed:!authorId,userId:me?.id||null,authorId,authorCard,onSignIn:()=>go('/following'),initial:{type:r.params.get('type'),q:r.params.get('q'),category:r.params.get('category'),sort:r.params.get('sort'),following:r.params.get('following')},onQuery:query=>{
    if(number!==routeNumber)return;
    const params=new URLSearchParams();if(query.type&&query.type!=='all')params.set('type',query.type);if(query.q)params.set('q',query.q);if(query.category!=='all')params.set('category',query.category);if(query.sort!==(authorId?'newest':'recommended'))params.set('sort',query.sort);if(query.following==='1')params.set('following','1');
    const next=r.path+(params.size?'?'+params:'');history.replaceState(null,'','#'+next);currentRoute=next;identity();
  },restoreScroll:()=>window.scrollTo(0,scrolls.get(route().raw)||0)});
  if(number===routeNumber)discoveryPanel=panel;else panel?.dispose();
}

async function renderCards(number){
  const owner=me.id;let card=null;
  try{card=(await api('/api/cards/me')).card;}catch(error){if(error.status!==404)throw error;}
  if(number!==routeNumber||me?.id!==owner)return;
  applyHTML(`<div class="page card-workspace-page">${renderCardWorkspace({card,user:me,esc,safeCover,shareURL:card?location.origin+publicCardPath(card.id):'',shareText:card?cardShareText(card,true):''})}</div>`,number);
}
function renderTemplateExperience(r,number){
  const id=r.path.split('/')[3],template=CARD_TEMPLATES.find(item=>item.id===id);
  if(!template||r.path!=='/cards/templates/'+id)throw new ApiError(t('这个名片模板不存在。'),404,'TEMPLATE_NOT_FOUND');
  const owner=me.id,current=()=>number===routeNumber&&me?.id===owner&&draftOwner===owner;
  if(!current()||!applyHTML('<div class="page card-template-experience-page"></div>',number))return;
  templateExperiencePanel=mountTemplateExperience($('.card-template-experience-page'),{template,user:me,onUse:()=>{
    if(!current())return;
    cardDraft={...cardDraft,template:template.id};preview=null;write(storage.preview,null);cardError='';cardKey=uid();saveCardDraft();
    notify(t('模板已选好，继续制作你的名片。'));go(cardDraft.ids.length?'/cards/me/template':'/cards/me');
  }});
}

async function renderFollowing(r,number){
  if(!applyHTML('<div class="page creator-directory-page"></div>',number))return;
  creatorPanel=mountCreatorDirectory($('.creator-directory-page'),{api,esc,me});
}
async function renderCreator(r,number){
  const id=decodeURIComponent(r.path.split('/')[2]);
  const {creator,card}=await api('/api/creators/'+encodeURIComponent(id));
  if(!applyHTML('<div class="page creator-home-page"></div>',number))return;
  const home=mountCreatorHome($('.creator-home-page'),{creator,card,me,api,esc,notify,backHref:r.params.get('from')==='/following'?'#/following':'#/feed',onEditProfile:editProfile,onFollowChange:()=>clearDiscovery()});
  creatorPanel=home;
  const panel=await mountDiscovery(home.worksRoot,{api,esc,workTile:(work,options)=>workTile(work,{...options,creator:false,from:r.raw}),syncSocial,userId:me.id,authorId:id,authorCard:card,worksOnly:true,initial:{sort:'newest'},onQuery(){},restoreScroll:()=>window.scrollTo(0,scrolls.get(r.raw)||0)});
  if(number===routeNumber)discoveryPanel=panel;else {panel.dispose();home.dispose();}
}

async function renderWork(r,number,countView=true,autoPlay=true){
  const id=decodeURIComponent(r.path.split('/')[2]);let work;
  if(r.params.get('card')){const {card}=await api('/api/cards/'+encodeURIComponent(r.params.get('card')));work=card.works.find(w=>w.id===id);if(!work)throw new ApiError("这件作品不在该名片中。",404,'SNAPSHOT_WORK_NOT_FOUND');}
  else if(canonicalPath((r.params.get('from')||'').split('?')[0])==='/cards/me/preview'){work=preview?.works.find(w=>w.id===id);if(!work)throw new ApiError("预览已失效，请返回名片重新生成。",404,'PREVIEW_EXPIRED');}
  else work=(await api('/api/works/'+encodeURIComponent(id))).work;
  const from=r.params.get('from')||'/feed',href=work.source==='url'?safeExternal(work.url):'';
  if(typeof work.likedByMe!=='boolean'){try{const live=(await api('/api/works/'+encodeURIComponent(id))).work;syncSocial(live);}catch{}}else syncSocial(work);
  const action=work.source==='url'?`<a class="button primary play-launch" href="${esc(href)}" target="_blank" rel="noopener noreferrer" data-outbound="${esc(id)}" data-version="${esc(work.versionId)}">${t("打开作品 ↗")}</a>`:`<button class="button primary play-launch" data-action="start-game" data-work="${esc(id)}">${playIcon()}${t("开始试玩")}</button>`;
  const pinned=r.params.get('card')?t('名片中的版本'):canonicalPath(from.split('?')[0])==='/cards/me/preview'?t('名片预览版本'):'';
  const ownerActions=work.authorId===me.id&&!pinned?`<div class="owner-work-actions"><a href="#/studio/works/${encodeURIComponent(work.id)}/edit?from=${encodeURIComponent(r.raw)}">${t("编辑作品信息")}</a><a href="#/studio/data?work=${encodeURIComponent(work.id)}">${t("数据")}</a></div>`:'';
  if(!applyHTML(`<div class="page work-page">
    <a class="back" href="#${esc(from)}">${t("← 返回")}</a>
    <div class="work-detail">
      <div id="play-area" class="work-media" data-built-project="${Boolean(work.build)}"><div class="detail-cover">${workImage(work)}</div></div>
      <aside class="work-summary">
        ${pinned?`<p class="work-pinned">${esc(pinned)} · ${esc(work.version)}</p>`:''}
        <h1>${esc(work.name)}</h1>
        <a class="detail-author" href="#/author/${encodeURIComponent(work.authorId)}">${avatarMarkup({name:work.authorName,avatarUrl:work.authorAvatarUrl})}${esc(work.authorName||t('创作者'))}</a>
        <div class="work-launch">${action}</div>
        ${work.desc?`<p class="work-description">${esc(work.desc)}</p>`:''}
        <div class="detail-social">${socialControls(work)}<button class="discussion-jump" data-action="discussion" aria-label="${t("查看讨论")}">${commentIcon()}<span>${t("讨论")}</span></button></div>
        <details class="work-metadata"><summary>${t('作品信息')}<span>${esc(work.version)}</span></summary>
          <dl class="work-facts"><div><dt>${t('作品类型')}</dt><dd>${t(workCategoryLabel(work.category))}</dd></div><div><dt>${t("版本")}</dt><dd>${esc(work.version)}</dd></div>${work.createdAt?`<div><dt>${t("发布日期")}</dt><dd>${date(work.createdAt)}</dd></div>`:''}</dl>
          ${work.build?`<p class="work-origin">${t("来源")} <a href="${esc(safeExternal(work.build.sourceUrl||'https://github.com/'+work.build.repository+'/tree/'+work.build.commitSha))}" target="_blank" rel="noopener noreferrer">${esc(work.build.repository)}</a><span>${esc((work.build.commitSha||'').slice(0,7))}</span></p>`:''}
          ${ownerActions}
        </details>
      </aside>
    </div>
    <div class="work-lower"><section id="discussion" class="discussion" aria-label="${t("作品讨论")}"></section><aside id="related-works" class="related-works"></aside></div>
    <div class="work-browse-back"><a class="button quiet" href="#${esc(from)}">← ${t('继续浏览')}</a></div>
  </div>`,number))return;
  if(countView){postAction('work_view',{workId:id,versionId:work.versionId});visitRecorded=true;}
  $$('[data-action="start-game"]').forEach(b=>b.addEventListener('click',()=>startGame(work)));
  $('[data-action="discussion"]').addEventListener('click',()=>{$('#discussion').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});$('#comment-input')?.focus({preventScroll:true});});
  const discussionOwner=me.id;
  discussionPanel=mountDiscussion($('#discussion'),{work,user:me,api,esc,notify,beforeRootSubmit:async()=>{await waitForPendingPlayStart(sessionQueues,{workId:work.id,ownerId:discussionOwner,flush:flushSession});if(draftOwner!==discussionOwner)throw new ApiError(t('请重新登录后重试。'),401,'AUTH_SESSION_CHANGED');},focusId:r.params.get('comment')||'',onCount:count=>{updateDiscoveryWork(work.id,{commentsCount:count});const label=$('.discussion-jump span');if(label)label.textContent=count?t("讨论 ")+n(count):t("讨论");}});
  api('/api/discover?author='+encodeURIComponent(work.authorId)+'&limit=4').then(({works})=>{if(number!==routeNumber)return;const others=works.filter(w=>w.authorId===work.authorId&&w.id!==id).slice(0,3);if(others.length)$('#related-works').innerHTML=`<h2>${t("作者的其他作品")}</h2>${others.map(w=>`<a class="related-work" href="${esc(workHref(w,from))}">${workImage(w)}<div><strong>${esc(w.name)}</strong><p>${esc(w.desc)}</p></div></a>`).join('')}`;}).catch(()=>{});
  if(autoPlay&&r.params.get('play')==='1'&&work.source==='html')startGame(work);
  if(r.params.get('discussion')==='1')requestAnimationFrame(()=>{if(number===routeNumber)$('#discussion')?.scrollIntoView({block:'start'});});
}

function publicationHelpers(number){return {api,esc,owner:me.id,notify,isCurrent:()=>number===routeNumber,render:html=>applyHTML(html,number),onChanged:()=>clearDiscovery(),reload:()=>renderRoute()};}
async function renderMyWorks(r,number){
  const archived=r.params.get('state')==='archived',works=await readMine(archived?'archived':'active');
  const actions=archived?'':`<div class="works-page-actions">${works.length?`<a class="button primary" href="#/publish">${t("＋ 发布作品")}</a>`:''}<a class="button quiet" href="#${archivedWorksPath}">${t('查看归档作品')}</a></div>`;
  const rows=works.map(w=>{
    const d=discoveryState(w),id=encodeURIComponent(w.id),archivedWork=isArchived(w);
    const management=archivedWork
      ? `<a href="#/studio/works/${id}/versions">${t("版本历史")}</a>`
      : `<a href="#/studio/works/${id}/edit">${t("编辑作品信息")}</a>${w.source==='html'?`<a href="#/studio/works/${id}/update">${t("更新版本")}</a><a href="#/studio/works/${id}/versions">${t("版本历史")}</a>`:''}<a href="#${discoveryPath(w.id)}">${t('展示设置')}</a>${d.canHide?`<button type="button" data-discovery-visibility="hide" data-work-id="${esc(w.id)}">${t('从 Feed 隐藏')}</button>`:d.canRestore?`<button type="button" data-discovery-visibility="restore" data-work-id="${esc(w.id)}">${t('恢复到 Feed')}</button>`:''}`;
    return `<article class="work-row" data-work-row-id="${esc(w.id)}" data-archived="${archivedWork}">${cover(w,workHref(w),false)}<div><a href="${esc(workHref(w))}"><h3>${esc(w.name)}</h3></a><p>${esc(w.desc)}</p><span class="tiny muted">${esc(w.version)} · ${w.source==='url'?t("外链"):'HTML'} · ${date(w.createdAt)}</span><span class="discovery-status work-discovery-status">${esc(t(d.label))}</span></div><div class="row-actions">${archivedWork?`<button type="button" class="button small" data-work-archive="restore" data-work-id="${esc(w.id)}">${t('恢复作品')}</button>`:''}<details class="work-row-more" data-action-menu><summary aria-label="${esc(t('管理 {name}',{name:w.name}))}"><span aria-hidden="true">···</span></summary><div class="action-menu-panel">${archivedWork&&w.source!=='html'?'':management}<a href="#/studio/data?work=${id}">${t("数据")}</a><a href="#/studio/feedback?work=${id}">${t("互动")}</a><a href="${esc(workHref(w))}">${t("打开作品")}</a>${!archivedWork?`<span class="archive-menu-separator" role="separator"></span><button type="button" data-work-archive="archive" data-work-id="${esc(w.id)}">${t('归档作品')}</button>`:''}</div></details></div></article>`;
  }).join('');
  const none=archived?empty(t('还没有归档作品'),t('归档的作品会保留在这里，可以随时恢复。'),`<a class="button primary" href="#/studio/works">${t('返回我的作品')}</a>`):empty(t("发布你的第一件作品"),t("上传一个 HTML 小游戏，或放入已经部署好的作品链接。"),`<a class="button primary" href="#/publish">${t("发布作品")}</a>`);
  if(!applyHTML(studio(`${archived?`<a class="back" href="#/studio/works">${t('← 我的作品')}</a>`:''}${head(t(archived?'已归档作品':'我的作品'),works.length?`${works.length} ${t("件已发布作品")}`:'',actions)}${archived&&works.length?`<p class="archive-note">${t('归档后仍可查看历史和数据；编辑或更新前请先恢复。')}</p>`:''}${rows||none}`,'works'),number))return;
  $$('[data-discovery-visibility]').forEach(button=>button.onclick=()=>{const work=works.find(w=>w.id===button.dataset.workId);if(work)changeVisibility(work,button.dataset.discoveryVisibility,publicationHelpers(number));});
  $$('[data-work-archive]').forEach(button=>button.onclick=()=>{const work=works.find(w=>w.id===button.dataset.workId);if(work)changeArchive(work,button.dataset.workArchive,publicationHelpers(number));});
  const focusId=r.params.get('work'),focused=focusId&&$('[data-work-row-id="'+CSS.escape(focusId)+'"]');
  if(focused){focused.classList.add('archive-highlight');requestAnimationFrame(()=>{if(number===routeNumber)focused.scrollIntoView({block:'center'});});}
}
async function renderData(r,number){
  const works=await readMine('all');
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
  const [data,works]=await Promise.all([api(legacy?'/api/feedback'+(work?'?work='+encodeURIComponent(work):''):'/api/comments?mine=1'+scope),readMine('all')]);
  if(!works.length){applyHTML(studio(head(t('历史互动'))+empty(t('还没有作品'),t('发布作品后，评论会出现在这里。'),`<a class="button primary" href="#/publish">${t('发布作品')}</a>`),'feedback'),number);return;}
  const archivedWorkIds=new Set(works.filter(isArchived).map(w=>w.id));
  const archivedBadge=id=>archivedWorkIds.has(id)?`<span class="work-archived"> · ${t('已归档')}</span>`:'';
  const target=tab=>'/studio/feedback?tab='+tab+scope;
  const legacyRecords=(data.feedback||[]).map(f=>`<article class="feedback-record"><header><a href="#/work/${encodeURIComponent(f.workId)}">${esc(f.workName)} · ${esc(f.type)}</a>${archivedBadge(f.workId)}<time>${date(f.createdAt)}</time></header><p>${esc(f.text)}</p><span class="tiny muted">${esc(f.authorName||t("访客"))}</span></article>`).join('');
  if(!applyHTML(studio(`${head(t("历史互动"),'',`<a class="text-link" href="#/notifications">${t("返回互动消息")}</a>`)}<nav class="inbox-tabs" aria-label="${t("互动类型")}"><a class="${legacy?'':'active'}" href="#${target('history')}">${t("全部评论记录")}</a><a class="${legacy?'active':''}" href="#${target('legacy')}">${t("历史私密反馈")}</a></nav><div class="field inbox-filter"><label for="feedback-work">${t("作品")}</label><select id="feedback-work"><option value="">${t("全部作品")}</option>${works.map(w=>`<option value="${esc(w.id)}" ${work===w.id?'selected':''}>${esc(w.name)}${isArchived(w)?' · '+t('已归档'):''}</option>`).join('')}</select></div><div id="inbox-records">${legacy?(legacyRecords||empty(t("暂无历史反馈"),'')):''}</div><p class="error" id="inbox-error" role="status"></p><button class="comments-more" id="inbox-more" hidden>${t("查看更多")}</button>`,'feedback'),number))return;
  $('#feedback-work').addEventListener('change',e=>go('/studio/feedback?tab='+(legacy?'legacy':'history')+(e.target.value?'&work='+encodeURIComponent(e.target.value):'')));
  if(legacy)return;
  let comments=data.comments,nextCursor=data.nextCursor,pending=false;
  const draw=()=>{
    if(number!==routeNumber)return;
    $('#inbox-records').innerHTML=comments.length?comments.map(c=>`<article class="inbox-comment">${c.authorId?`<a href="#/author/${encodeURIComponent(c.authorId)}" aria-label="${esc(c.authorName)}">${avatarMarkup({name:c.authorName,avatarUrl:c.authorAvatarUrl},{className:"comment-avatar"})}</a>`:avatarMarkup({name:c.authorName,avatarUrl:c.authorAvatarUrl},{className:"comment-avatar"})}<div class="inbox-main"><header>${c.authorId?`<a href="#/author/${encodeURIComponent(c.authorId)}">${esc(c.authorName)}</a>`:`<span>${esc(c.authorName)}</span>`}${c.isCreator?`<span class="author-badge">${t("作者")}</span>`:''}<span>${c.parentId?t("回复"):t("评论")}</span><span class="comment-version" aria-label="${esc(t('评论版本：{version}',{version:commentVersionLabel(c)}))}">${esc(commentVersionLabel(c))}</span><time>${date(c.createdAt)}</time></header><p>${esc(c.body)}</p><a class="inbox-work" href="${esc(commentHref(c,r.raw))}">${esc(c.workName)} ${t("· 查看讨论")}</a>${archivedBadge(c.workId)}</div></article>`).join(''):empty(t("还没有评论"),'');
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
const githubFileLink=isGithubHTMLURL;
function githubReady(){return matchingBuild()?.status==='ready'||Boolean(publishFile&&publishDraft.githubImport?.url&&publishDraft.githubImport?.commitSha&&publishDraft.githubImport.url===publishDraft.githubURL?.trim());}
function stopBuildPolling(){clearTimeout(buildPollTimer);buildPollRevision++;}
function publishMediaSource(){const d=publishDraft;return {source:d.source,url:d.source==='url'?d.url:'',buildId:d.source==='github'&&matchingBuild()?.status==='ready'?matchingBuild().id:null,file:d.source==='html'?publishFile:d.source==='github'&&githubReady()&&!matchingBuild()?publishFile:null};}
function refreshPublishState(){
  const form=$('#publish-form');if(!form)return;
  const d=publishDraft,build=matchingBuild(),building=activeBuild(build),ready=githubReady(),isFile=githubFileLink(d.githubURL),availability=publishAvailability?.state||{status:'checking'},blocked=repositoryImportBlocked(availability,d.githubURL);
  for(const source of ['html','url','github'])$('#'+source+'-field').hidden=d.source!==source;
  $$('input,textarea,select',form).forEach(input=>input.disabled=publishPending);
  $('#publish-url').disabled=publishPending||d.source!=='url';
  $('#github-url').disabled=publishPending||d.source!=='github'||building;
  const readButton=$('#github-read');readButton.disabled=publishPending||githubPending||building||!d.githubURL?.trim()||blocked;readButton.textContent=githubPending?t("正在导入…"):building?t("构建中…"):isFile?t("读取文件"):build?.status==='failed'||build?.status==='cancelled'?t("重新构建"):t("导入并构建");
  readButton.classList.toggle('primary',d.source==='github'&&!ready&&!blocked);
  const availabilityNode=$('#publish-import-availability');availabilityNode.hidden=d.source!=='github';
  availabilityNode.innerHTML=buildAvailabilityMarkup(availability,{selected:d.source==='github',directFile:isFile,ready,disabled:publishPending||githubPending});
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
  const sizeNotice=$('#publish-size-notice');sizeNotice.textContent=htmlImportSizeNotice({source:d.source,file:publishFile,build,ready,pending:githubPending});sizeNotice.hidden=!sizeNotice.textContent;
  $('#game-file-remove').hidden=!publishFile;$('#game-file-remove').disabled=publishPending||githubPending;
  $('#cover-file-remove').hidden=!coverFile;$('#cover-file-remove').disabled=publishPending;
  $('#cover-upload-hint').textContent=t('PNG、JPG 或 WebP，最大 2 MiB。');
  const selectedCover=$('#cover-preview');if(coverPreview){if(selectedCover.getAttribute('src')!==coverPreview)selectedCover.src=coverPreview;selectedCover.hidden=false;}else{selectedCover.removeAttribute('src');selectedCover.hidden=true;}
  const draftRoot=$('#publish-cover-draft');draftRoot.hidden=false;draftRoot.inert=publishPending;
  publishCoverDraft?.sync(publishMediaSource());
  const submit=$('[type="submit"]',form);submit.disabled=!publishCoverDraft?.canPublish||publishPending||githubPending||(d.source==='github'&&!ready);submit.classList.toggle('primary',d.source!=='github'||ready);submit.textContent=publishPending?t("正在发布…"):t("发布作品");
  $('#publish-error').textContent=t(publishError||(d.source==='github'&&build?.status==='failed'?importErrorText(build):''));
  const related=$('#publish-related');if(related){let repository='';try{const u=new URL(d.githubURL);if(u.hostname==='github.com')repository=u.pathname.replace(/^\/|\/$/g,'').replace(/\.git$/i,'').toLowerCase();}catch{}const matches=d.source==='github'&&repository?publishRelatedWorks.filter(w=>w.source==='html'&&w.build?.repository?.toLowerCase()===repository):[];related.hidden=!matches.length;related.innerHTML=matches.length?`<summary>${t('已有同源作品')}</summary><div>${matches.slice(0,5).map(w=>`<a class="text-link" href="#/studio/works/${encodeURIComponent(w.id)}/update">${esc(t('更新 {name}',{name:w.name}))}</a>`).join('')}</div>`:'';}
  const actions=$('#publish-recovery');if(actions){actions.innerHTML=publishFailure&&publishError===publicationFailureMessage(publishFailure)?publicationFailureActions(publishFailure,{esc}):'';actions.hidden=!actions.innerHTML;}
  publishWizard?.refresh();
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
  // Old URL-only drafts stored generated covers as uploaded files. Reconfirm
  // these through the private controller so a source switch cannot reuse them.
  if(d.coverSourceURL){coverFile=null;delete d.coverSourceURL;refreshCoverPreview();void fileStore('delete','cover');savePublish();}
  if(!applyHTML(`<div class="page narrow"><a class="back" href="#/studio/works">${t("← 我的作品")}</a>${head(t("发布作品"))}
    <form id="publish-form" class="form">
      <div class="field"><label for="publish-name">${t("作品名称")}</label><input id="publish-name" name="name" value="${esc(d.name)}" maxlength="80" required></div>
      <div class="field"><label for="publish-desc">${t("一句介绍")}</label><textarea id="publish-desc" name="desc" maxlength="500" required>${esc(d.desc)}</textarea></div>
      <div class="field"><label for="publish-category">${t('作品类型')}</label><select id="publish-category" name="category" required><option value="" disabled ${!d.category?'selected':''}>${t('选择作品类型')}</option>${WORK_CATEGORIES.map(({id,label})=>`<option value="${id}" ${d.category===id?'selected':''}>${t(label)}</option>`).join('')}</select><small>${t('按作品内容选择，与上传方式无关。之后可在展示设置中修改。')}</small></div>
      <fieldset class="field source-picker"><legend>${t("作品来源")}</legend><div class="segmented">${[['html',t("本地 HTML")],['github','GitHub'],['url',t("已有网站")]].map(([value,label])=>`<label><input type="radio" name="source" value="${value}" ${d.source===value?'checked':''}>${label}</label>`).join('')}</div></fieldset>
      <div id="publish-import-availability" class="import-availability" aria-live="polite"></div>
      <div class="field" id="html-field"><label for="game-file">${t("游戏文件")}</label><input id="game-file" type="file" accept=".html,.htm,text/html"><small>${t(HTML_UPLOAD_HINT)}</small><div class="publish-file-selection"><span id="game-file-name" class="file-selected"></span><button id="game-file-remove" type="button" class="button quiet small" aria-label="${t("移除游戏文件")}" hidden>${t("移除")}</button></div></div>
      <div class="field" id="github-field"><label for="github-url">${t("GitHub 链接")}</label><div class="github-input"><input id="github-url" name="githubURL" type="url" placeholder="${t("https://github.com/作者/仓库")}" value="${esc(d.githubURL||'')}"><button id="github-read" class="button" type="button">${t("导入并构建")}</button></div><p id="github-status" class="file-selected" role="status"></p><section id="github-build-panel" class="build-panel" hidden><progress id="build-progress" max="5" aria-label="${t("构建进度")}"></progress><div class="build-actions"><a id="build-preview" class="button small" target="_blank" rel="noopener">${t("预览试玩 ↗")}</a><button id="build-cancel" class="button quiet small" type="button">${t("取消构建")}</button></div><details class="build-details"><summary>${t("构建记录")}</summary><p id="build-source"></p><pre id="build-logs"></pre></details><p id="build-poll-error" class="error" role="status"></p></section></div>
      <div class="field" id="url-field"><label for="publish-url">${t("作品链接")}</label><input id="publish-url" name="url" type="url" placeholder="https://" value="${esc(d.url)}"><small>${t("已部署的网站（含 GitHub Pages），将在新窗口打开。")}</small></div>
      <section id="publish-cover-draft" class="external-cover" hidden></section>
      <p id="publish-size-notice" class="tiny muted" role="status" hidden></p>
      <div class="field"><label for="cover-file">${t("封面")}</label><div class="cover-picker">${coverPreview?`<img id="cover-preview" src="${esc(coverPreview)}" alt="${t("所选封面")}">`:`<img id="cover-preview" alt="${t("所选封面")}" hidden>`}<input id="cover-file" type="file" accept="image/png,image/jpeg,image/webp"><button id="cover-file-remove" type="button" class="button quiet small" aria-label="${t("移除封面")}" hidden>${t("移除")}</button></div><small id="cover-upload-hint">${t("PNG、JPG 或 WebP，最大 2 MiB。")}</small></div>
      <p id="publish-error" class="error" role="alert"></p><div id="publish-recovery" class="publication-recovery" hidden></div><details id="publish-related" class="sample-links" hidden></details><div class="form-footer"><button class="button primary" type="submit">${t("发布作品")}</button><a class="button quiet" href="#/studio/works">${t("保存草稿并返回")}</a></div>
      <details class="sample-links"><summary>${t("示例文件")}</summary><div><a class="text-link" href="/examples/more.html" target="_blank" rel="noopener">${t("浏览 9 个可玩示例 ↗")}</a></div></details>
    </form></div>`,number))return;
  publishRelatedWorks=[];readMine().then(works=>{if(number===routeNumber){publishRelatedWorks=works;refreshPublishState();}}).catch(()=>{});
  const form=$('#publish-form');
  publishCoverDraft=mountPublishMedia($('#publish-cover-draft'),{api,saved:publishDraft.media,onPersist:value=>{publishDraft.media=value;savePublish();},onChange:()=>refreshPublishState(),onChoice:(kind)=>{publishDraft.key=uid();if(kind==='cover'){coverFile=null;refreshCoverPreview();void fileStore('delete','cover');}}});
  if(coverFile)publishCoverDraft.manual(true);

  publishAvailability=createBuildAvailability(api,refreshPublishState);refreshPublishState();publishAvailability.refresh();
  form.addEventListener('input',event=>{
    if(!['name','desc','url','source','githubURL','category'].includes(event.target.name))return;
    if(['source','githubURL'].includes(event.target.name)){githubJob++;githubPending=false;stopBuildPolling();buildPollError='';}
    if(event.target.name==='url'&&publishDraft.coverSourceURL){coverFile=null;delete publishDraft.coverSourceURL;refreshCoverPreview();void fileStore('delete','cover');}
    publishDraft[event.target.name]=event.target.value;publishDraft.key=uid();publishError='';savePublish();refreshPublishState();if(event.target.name==='source'){pollGithubBuild();if(event.target.value==='github')publishAvailability?.refresh();}
  });
  $('#game-file').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file)return;
    const error=htmlFileError(file);if(error){publishError=error;event.target.value='';refreshPublishState();return;}
    githubJob++;githubPending=false;publishFile=file;publishDraft.githubImport=null;publishDraft.key=uid();publishError='';savePublish();refreshPublishState();await fileStore('put','game',file);
  });
  $('#game-file-remove').addEventListener('click',async()=>{
    if(publishPending||githubPending)return;githubJob++;publishFile=null;publishDraft.githubImport=null;delete publishDraft.html;delete publishDraft.htmlName;publishDraft.key=uid();publishError='';publishFailure=null;$('#game-file').value='';savePublish();refreshPublishState();await fileStore('delete','game');$('#game-file')?.focus();
  });
  $('#cover-file-remove').addEventListener('click',async()=>{
    if(publishPending)return;publishCoverDraft?.manual(false);coverFile=null;delete publishDraft.coverSourceURL;publishDraft.key=uid();publishError='';$('#cover-file').value='';refreshCoverPreview();const img=$('#cover-preview');img.removeAttribute('src');img.hidden=true;savePublish();refreshPublishState();await fileStore('delete','cover');$('#cover-file')?.focus();
  });
  $('#github-read').addEventListener('click',importGithub);$('#build-cancel').addEventListener('click',cancelGithubBuild);pollGithubBuild();
  $('#publish-import-availability').addEventListener('click',event=>{
    if(event.target.closest('[data-import-check]'))publishAvailability?.refresh();
    if(event.target.closest('[data-import-local]')&&!publishPending&&!githubPending){const input=$('input[name="source"][value="html"]',form);input.checked=true;input.dispatchEvent(new Event('input',{bubbles:true}));$('#game-file').focus();}
  });
  $('#cover-file').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024){publishError="请选择不超过 2 MB 的 PNG、JPG 或 WebP 图片。";event.target.value='';refreshPublishState();return;}
    coverFile=file;publishCoverDraft?.manual(true);delete publishDraft.coverSourceURL;publishDraft.key=uid();publishError='';savePublish();refreshCoverPreview();refreshPublishState();const img=$('#cover-preview');img.src=coverPreview;img.hidden=false;await fileStore('put','cover',file);
  });
  publishWizard=mountPublishWizard(form,{initialStep:d.step,getState:()=>({...publishDraft,file:publishFile,ready:githubReady(),pending:publishPending||githubPending,cover:Boolean(coverFile),captureStatus:publishCoverDraft?.state.cover?.status}),onStep:step=>{publishDraft.step=step;savePublish();},onError:message=>{publishError=message;refreshPublishState();}});
  form.addEventListener('submit',event=>{event.preventDefault();submitPublish(form);});
}
async function importGithub(){
  if(githubPending||publishPending||publishDraft.source!=='github'||activeBuild())return;
  const url=publishDraft.githubURL?.trim();if(!url)return;
  if(repositoryImportBlocked(publishAvailability?.state,url)){refreshPublishState();return;}
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
  }catch(error){if(owner===draftOwner&&job===githubJob&&publishDraft.githubURL?.trim()===url){publishError=importErrorText(error);if(['BUILD_RUNNER_OFFLINE','BUILD_RUNNER_UNCONFIGURED'].includes(error.code))publishAvailability?.markUnavailable(error.code);}}
  finally{if(job===githubJob){githubPending=false;refreshPublishState();}}
}
async function submitPublish(form){
  if(publishPending||githubPending)return;
  const d=publishDraft;publishError='';publishFailure=null;
  if(d.source==='html'&&!publishFile){publishError="请先选择 HTML 游戏文件。";refreshPublishState();return;}
  if(d.source==='html'&&htmlFileError(publishFile)){publishError=htmlFileError(publishFile);refreshPublishState();return;}
  if(d.source==='github'&&!githubReady()){publishError="请先完成当前 GitHub 项目的导入。";refreshPublishState();return;}
  if(!publishCoverDraft?.canPublish){publishError='请先确认封面和视频，或明确选择跳过。';refreshPublishState();return;}
  if(d.source==='url'&&!safeExternal(d.url)){publishError="请输入完整的 http:// 或 https:// 链接。";refreshPublishState();return;}
  if(d.source==='url'&&new URL(d.url).hostname==='github.com'){publishError="这是 GitHub 仓库页面，请选择 GitHub 导入，或填写部署后的 GitHub Pages 地址。";refreshPublishState();return;}
  const body=sourceForm(publishMediaSource());body.set('category',d.category);body.set('name',d.name.trim());body.set('desc',d.desc.trim());
  if(coverFile)body.set('cover',coverFile);
  for(const [key,value] of Object.entries(publishCoverDraft.choices))body.set(key,value);
  publishPending=true;refreshPublishState();
  try{
    const {work}=await api('/api/works',{method:'POST',headers:{'Idempotency-Key':d.key},body});stopBuildPolling();publishDraft={name:'',desc:'',source:'html',url:'',key:uid()};publishFile=null;coverFile=null;refreshCoverPreview();savePublish();await Promise.all([fileStore('delete','game'),fileStore('delete','cover')]);publishPending=false;clearDiscovery();if(route().path==='/publish')go('/published/'+encodeURIComponent(work.id));else notify(t("作品已发布。"));
  }catch(error){publishPending=false;publishFailure=error;publishError=['DUPLICATE_WORK','VERSION_UNCHANGED','VERSION_ALREADY_EXISTS'].includes(error.code)?publicationFailureMessage(error):importErrorText(error);refreshPublishState();if(route().path==='/publish'&&error.status===401)$('#publish-error').innerHTML=esc(t(error.message))+` <a class="text-link" target="_top" href="${esc(signinURL())}">${t("重新登录")}</a>`;}
}
async function renderPublished(r,number){
  const {work}=await api('/api/works/'+encodeURIComponent(r.path.split('/')[2]));
  if(!applyHTML(`<div class="page narrow published-result">${publishProgress(3)}${head(t("作品已发布"),work.name)}<p class="published-result-note">${t('作品已发布，已保存你确认的封面和视频选择。')}</p><div id="published-work-tile" class="work-grid" style="max-width:560px;grid-template-columns:1fr">${workTile(work)}</div><div class="form-footer"><a class="button primary" href="#/cards/me?addWork=${encodeURIComponent(work.id)}">${t(onboardingState?.intent==='create'&&!onboardingState.hasCard?"制作我的名片":"加入或更新名片")}</a><a class="button quiet" href="#/feed">${t("完成，去看 Feed")}</a><a class="button quiet" href="${esc(workHref(work,'/studio/works'))}">${t("试玩作品")}</a><details class="version-secondary"><summary>${t('更多')}</summary><a class="button quiet" href="#${discoveryPath(work.id)}">${t('展示设置')}</a><a class="button quiet" href="#/studio/works">${t("我的作品")}</a></details></div></div>`,number))return;
  publishedVideos=mountVideoPreviews($('#published-work-tile'));

}
const steps = current => `<nav class="steps" aria-label="${t("制作步骤")}">${[t("选作品"),t("选模板"),t("生成名片")].map((name,index)=>index<current?`<a href="${index===0?'#/cards/me':'#/cards/me/template'}"><b>${index+1}</b>${name}</a>`:`<span class="${index===current?'active':''}" ${index===current?'aria-current="step"':''}><b>${index+1}</b>${name}</span>`).join('')}</nav>`;
async function renderBuilder(r,number){
  if(r.params.has('addWork')||r.params.has('editCard')){
    const owner=draftOwner;
    return renderCardDraftStart(r,{api,readMine,owner,current:()=>number===routeNumber&&draftOwner===owner&&me?.id===owner,getDraft:()=>cardDraft,getPreview:()=>preview,
      commit:draft=>{cardDraft=draft;preview=null;cardError='';cardKey=uid();saveCardDraft();write(storage.preview,null);},
      render:html=>applyHTML(html,number),esc,notify,go});
  }
  if(r.params.has('templateFrom'))return renderCardRemix(r,number);
  const owner=draftOwner,current=()=>number===routeNumber&&draftOwner===owner&&me?.id===owner;
  const works=await readMine();if(!current())return;
  const ids=new Set(works.map(w=>w.id));cardDraft.ids=[...new Set(cardDraft.ids)].filter(id=>ids.has(id)).slice(0,30);if(!CARD_TEMPLATES.some(item=>item.id===cardDraft.template))cardDraft.template='wall';saveCardDraft();
  const step=r.path.endsWith('/preview')?2:r.path.endsWith('/template')?1:0;
  let published=null;if(step===0||!works.length){try{published=(await api('/api/cards/me')).card;}catch(e){if(e.status!==404)throw e;}}
  if(!current())return;
  if(!works.length){
    const archived=(await api('/api/works?mine=1&state=archived&limit=1')).total>0;
    if(!current())return;
    const primary=published?`<a class="button primary" href="#/card/${encodeURIComponent(published.id)}">${t('我的已保存名片')}</a>`:archived?`<a class="button primary" href="#${archivedWorksPath}">${t('前往归档恢复')}</a>`:`<a class="button primary" href="#/publish">${t('发布作品')}</a>`;
    const more=published||archived?`<details class="version-secondary"><summary>${t('更多')}</summary>${published&&archived?`<a class="text-link" href="#${archivedWorksPath}">${t('前往归档恢复')}</a>`:''}<a class="text-link" href="#/publish">${t('发布作品')}</a></details>`:'';
    applyHTML(cardsPage(`${cardBuilderTop()}${head(t('你的名片'))}${empty(t(published||archived?'没有可选作品':'先放进一件作品'),t(published?'已保存的名片仍可访问。':'名片会复用作品已有的封面和介绍。'),primary+more)}`,'mine'),number);return;
  }
  if(step>0&&!cardDraft.ids.length){go('/cards/me');return;}
  if(step===2&&!preview){go('/cards/me/template');return;}
  if(step===2)syncCardPreview(me);
  if(step===0){
    if(!applyHTML(cardsPage(`${cardBuilderTop(published)}${steps(0)}${head(t("选作品"))}<div class="select-grid">${works.map(w=>`<label class="select-work ${cardDraft.ids.includes(w.id)?'selected':''}"><input type="checkbox" value="${esc(w.id)}" ${cardDraft.ids.includes(w.id)?'checked':''}><div class="cover ${safeCover(w.coverUrl)?'':'empty-cover'}">${safeCover(w.coverUrl)?`<img src="${esc(safeCover(w.coverUrl))}" alt="" loading="lazy">`:`<span>${esc(w.name)}</span>`}</div><div class="select-copy">${esc(w.name)}<small>${esc(w.version)}</small></div></label>`).join('')}</div><div id="selection-order" class="selection-order"></div><div class="card-builder-footer"><span id="selection-count" class="selection-count" role="status"></span><button class="button primary" id="to-template" ${cardDraft.ids.length?'':'disabled'}>${t("选择模板 →")}</button></div>`,'mine'),number))return;
    const refresh=()=>{const selected=cardDraft.ids.map(id=>works.find(w=>w.id===id)),order=$('#selection-order'),wasOpen=Boolean(order.querySelector('details')?.open);$('#selection-count').textContent=t("已选 {count} 件",{count:selected.length})+' / 30';$('#to-template').disabled=!selected.length;order.innerHTML=selected.length>1?`<details ${wasOpen?'open':''}><summary>${t("调整作品顺序")}</summary><div class="order-chips">${selected.map((w,i)=>`<span class="order-chip">${i+1}. ${esc(w.name)}<button data-reorder="${esc(w.id)}" data-direction="-1" ${i===0?'disabled':''} aria-label="${t("前移")} ${esc(w.name)}">←</button><button data-reorder="${esc(w.id)}" data-direction="1" ${i===selected.length-1?'disabled':''} aria-label="${t("后移")} ${esc(w.name)}">→</button></span>`).join('')}</div></details>`:'';$$('.select-work input').forEach(input=>{input.disabled=!input.checked&&selected.length>=30;input.closest('label').classList.toggle('selected',input.checked);});};refresh();
    $$('.select-work input').forEach(input=>input.addEventListener('change',()=>{if(input.checked)cardDraft.ids.push(input.value);else cardDraft.ids=cardDraft.ids.filter(id=>id!==input.value);invalidatePreview();refresh();}));
    $('#selection-order').addEventListener('click',event=>{const button=event.target.closest('[data-reorder]');if(!button)return;const from=cardDraft.ids.indexOf(button.dataset.reorder),to=from+Number(button.dataset.direction);if(to<0||to>=cardDraft.ids.length)return;[cardDraft.ids[from],cardDraft.ids[to]]=[cardDraft.ids[to],cardDraft.ids[from]];invalidatePreview();refresh();});$('#to-template').addEventListener('click',()=>go('/cards/me/template'));return;
  }
  if(step===1){
    if(!applyHTML(cardsPage(`${cardBuilderTop()}${steps(1)}${head(t("选模板"))}<div class="template-grid">${CARD_TEMPLATES.map(({id,name,description})=>`<button class="template ${cardDraft.template===id?'selected':''}" data-template="${id}" aria-pressed="${cardDraft.template===id}"><span class="template-art has-covers ${id==='wall'?'white':id}">${cardDraft.ids.slice(0,3).map(workId=>{const w=works.find(w=>w.id===workId),src=safeCover(w.coverUrl);return src?`<img src="${esc(src)}" alt="">`:`<span class="template-cover-title">${esc(w.name)}</span>`;}).join('')}</span><span class="template-copy"><strong>${t(name)}</strong><p>${t(description)}</p></span></button>`).join('')}</div><form id="card-profile"><section class="card-profile-source"><div class="card-profile-person">${avatarMarkup(me,{className:'card-profile-avatar'})}<div><strong>${esc(me.name)}</strong>${me.headline?`<p>${esc(me.headline)}</p>`:''}${me.bio?`<p>${esc(me.bio)}</p>`:''}<small>${t('名片会自动使用你的最新个人资料。')}</small></div></div><button class="button small quiet" type="button" data-edit-profile>${t('编辑个人资料')}</button></section><details class="personalization"><summary>${t("个性设置")}</summary><div class="personalization-fields"><div class="field"><label for="card-signature">${t("签名")}</label><input id="card-signature" name="signature" maxlength="80" value="${esc(cardDraft.signature||'')}" placeholder="${t("留下一句话")}"></div><fieldset class="field back-styles" data-fold-options ${['fold','city'].includes(cardDraft.template)?'':'hidden'}><legend>${t("卡背样式")}</legend><div class="theme-options">${[['ink',t("墨黑")],['ivory',t("象牙白")],['cobalt',t("钴蓝")]].map(([value,label])=>`<label class="theme-option"><input type="radio" name="backStyle" value="${value}" ${cardDraft.backStyle===value?'checked':''}><span class="theme-swatch ${value}" aria-hidden="true"></span>${label}</label>`).join('')}</div></fieldset></div></details><div class="card-builder-footer"><a class="button quiet" href="#/cards/me">${t("← 返回选作品")}</a><button class="button primary" type="submit">${t("生成预览 →")}</button></div></form>`,'mine'),number))return;
    $$('[data-template]').forEach(b=>b.addEventListener('click',()=>{cardDraft.template=b.dataset.template;invalidatePreview();$$('[data-template]').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b));});$('[data-fold-options]').hidden=!['fold','city'].includes(cardDraft.template);}));
    const form=$('#card-profile');
    const captureProfile=()=>{for(const key of ['signature','backStyle'])cardDraft[key]=form.elements[key].value;invalidatePreview();};
    form.addEventListener('input',captureProfile);
    form.addEventListener('submit',event=>{
      event.preventDefault();captureProfile();cardDraft.signature=cardDraft.signature.trim();saveCardDraft();
      const selected=cardDraft.ids.map(id=>works.find(w=>w.id===id));
      const next=withCardIdentity({id:'preview',authorId:me.id,signature:cardDraft.signature,backStyle:cardDraft.backStyle,template:cardDraft.template,workIds:[...cardDraft.ids],works:structuredClone(selected)},me);
      preview=prepareCardPreview(preview,{...next,fingerprint:cardPreviewFingerprint(next)},uid());write(storage.preview,preview);go('/cards/me/preview');
    });return;
  }
  if(!applyHTML(cardsPage(`${cardBuilderTop()}${steps(2)}<h1 class="card-preview-title">${t("名片预览")}</h1><p class="card-save-note">${t("保存会生成新链接，旧名片链接与作品快照保持不变。")}</p><div class="card-actions"><a class="button quiet" href="#/cards/me/template">${t("← 返回选模板")}</a><button class="button primary" id="save-card" ${cardPending?'disabled':''}>${cardPending?t("正在保存…"):!isPinnedPreview(preview)?t("重新生成预览"):cardError?t("重试保存"):t("保存为新名片")}</button></div><p id="card-error" class="error" role="alert">${esc(t(cardError)||(!isPinnedPreview(preview)?t("这份预览来自旧版，请重新生成后保存。"):''))}</p>${cardMarkup(preview,'/cards/me/preview')}`,'mine'),number))return;
  mountCard(preview,'/cards/me/preview');$('#save-card').addEventListener('click',saveCard);
}
async function renderCardRemix(r,number){
  const owner=draftOwner,current=()=>number===routeNumber&&draftOwner===owner&&me?.id===owner;
  const id=r.params.get('templateFrom');
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id||''))throw new ApiError(t('这张名片暂时无法用于同款制作。'),404,'CARD_NOT_FOUND');
  const {card}=await api('/api/cards/'+encodeURIComponent(id)),style=remixStyle(card),template=CARD_TEMPLATES.find(item=>item.id===style.template);
  if(!current())return;
  const hasDraft=cardDraft.ids.length>0||Boolean(preview)||Boolean(cardDraft.signature);
  if(!applyHTML(`<div class="page narrow"><a class="back" href="#/card/${encodeURIComponent(id)}">← ${t('返回名片')}</a>${head(t('用同款制作'))}<section class="remix-confirmation"><h2>${esc(t(template.name))}</h2><p>${esc(t(template.description))}${style.template==='fold'?' · '+esc(t({ink:'墨黑',ivory:'象牙白',cobalt:'钴蓝'}[style.backStyle])):''}</p><p>${t('沿用名片的模板和卡背样式，选择你自己的作品。')}</p>${hasDraft?`<p class="remix-draft-notice">${t('你有一份未完成的名片草稿。使用同款后会开始新的草稿，已保存的名片不受影响。')}</p>`:''}<div class="form-footer">${hasDraft?`<a class="button quiet" href="#/cards/me">${t('继续原草稿')}</a>`:''}<button type="button" class="button primary" id="apply-card-remix">${t('使用这个模板')}</button></div></section></div>`,number))return;
  $('#apply-card-remix').addEventListener('click',()=>{if(!current())return;cardDraft=createRemixDraft(card,me);preview=null;cardError='';saveCardDraft();write(storage.preview,null);notify(t('同款模板已选好，先选择自己的作品。'));go('/cards/me');});
}
function cardMarkup(card,from,cardId=''){
  if(['fold','collection','city'].includes(card.template))return `<div class="card-preview"><iframe id="gallery-frame" class="gallery-frame" src="/${card.template==='city'?'lit-city':card.template==='collection'?'collection':'gallery'}/?lang=${getLocale()}" title="${card.template==='city'?t("灯城名片"):card.template==='collection'?t("点亮收藏"):t("卡中展厅")}" loading="eager"></iframe></div>`;
  const profile=cardProfile(card);
  if(['editorial','filmstrip'].includes(card.template))return renderPortfolioCard(card,{profile,safeCover,workHref,from,cardId});
  return `<div class="card-preview"><article class="white-card"><header>${card.avatarUrl?avatarMarkup(card,{className:"card-profile-avatar"}):""}<h2>${esc(card.name)}</h2>${profile.headline?`<p class="card-headline">${esc(profile.headline)}</p>`:''}${card.bio?`<p class="bio">${esc(card.bio)}</p>`:''}${profile.website?`<a class="profile-website" href="${esc(profile.website)}" target="_blank" rel="noopener noreferrer">${esc(new URL(profile.website).hostname)} ↗</a>`:''}</header><div class="work-grid">${card.works.map(w=>workTile(w,{from,creator:false,cardId})).join('')}</div>${profile.signature?`<footer class="card-signature">${esc(profile.signature)}</footer>`:''}</article></div>`;
}

function normalizeGalleryView(card,view={}){
  view=view&&typeof view==='object'?view:{};
  const pageSize=card.template==='city'?9:window.FuntrackGallery.pageSize,pages=Math.max(1,Math.ceil(card.works.length/pageSize)),focusIndex=typeof view.focusWorkId==='string'?card.works.findIndex(work=>work.id===view.focusWorkId):-1,inside=view.inside===true;
  const sourcePageSize=Number.isInteger(view.pageSize)&&view.pageSize>0?view.pageSize:9,sourcePages=Math.max(1,Math.ceil(card.works.length/sourcePageSize));
  const sourcePage=Number.isInteger(view.page)?Math.max(0,Math.min(sourcePages-1,view.page)):0,mappedPage=Math.floor(sourcePage*sourcePageSize/pageSize);
  return {open:view.open===true,face:view.face==='back'?'back':'front',inside,focusWorkId:focusIndex>=0?card.works[focusIndex].id:null,page:focusIndex>=0?Math.floor(focusIndex/pageSize):Math.min(pages-1,mappedPage),pageSize,yaw:Number.isFinite(view.yaw)?Math.max(inside?-1.3:-.65,Math.min(inside?1.3:.85,view.yaw)):0};
}

registerMessages({
  '没有可选作品':'No works available to select',
  '已保存的名片仍可访问。':'Your saved card is still available.',
  '正在加载 3D 名片…':'Loading 3D card…',
  '3D 名片加载超时，请重试。':'The 3D card took too long to load. Try again.',
  '当前浏览器暂未显示 3D，作品列表仍可查看。':'3D is unavailable in this browser. Your works are still available below.',
  '重新加载 3D':'Reload 3D',
});
function mountCard(card,key){
  currentGallery?.dispose?.();
  if(!['fold','collection','city'].includes(card.template)){currentGallery=null;mountPortfolioCard(main,key+':'+(card.saveKey||card.id));return;}
  const frame=$('#gallery-frame');if(!frame)return;
  const status=document.createElement('div');status.className='gallery-load-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');frame.before(status);
  const gallery={frame,card,key,restoreScroll:scrolls.get(key)||0,restoreTimer:null,view:normalizeGalleryView(card,galleryViews.get(key))};currentGallery=gallery;
  const bridge=createGalleryBridge({frame,...(card.template==='city'?{timeout:30000,recoveryDelay:10000}:{}),isCurrent:()=>gallery===currentGallery,payload:()=>initializeGallery(gallery),onStatus:state=>{
    const busy=state==='loading';frame.setAttribute('aria-busy',String(busy));frame.style.visibility=(busy&&card.template!=='city')||state==='timeout'?'hidden':'';
    status.hidden=state==='rendered'||state==='empty';status.dataset.state=state;
    if(!status.hidden){status.innerHTML=busy?`${loadingMark()}<span>${t('正在加载 3D 名片…')}</span>`:`<span>${t(state==='fallback'?'当前浏览器暂未显示 3D，作品列表仍可查看。':'3D 名片加载超时，请重试。')}</span><button type="button" class="button small">${t('重新加载 3D')}</button>`;status.querySelector('button')?.addEventListener('click',()=>bridge.retry());}
  }});
  gallery.dispose=()=>{bridge.dispose();clearTimeout(gallery.restoreTimer);};
}
function initializeGallery(gallery){
  gallery.view=normalizeGalleryView(gallery.card,gallery.view);
  return {locale:getLocale(),author:{id:gallery.card.authorId,name:gallery.card.name,bio:gallery.card.bio,avatarUrl:gallery.card.avatarUrl||"",...cardProfile(gallery.card)},works:gallery.card.works.map(w=>({id:w.id,name:w.name,desc:w.desc,cover:safeCover(w.coverUrl),kind:w.source==='url'?"外链作品":"网页游戏",version:w.version})),...gallery.view};
}
async function saveCard(){
  if(cardPending||!preview)return;syncCardPreview(me);if(!isPinnedPreview(preview)){go('/cards/me/template');return;}
  const saving=preview,owner=draftOwner,saveKey=saving.saveKey,operation={owner,saveKey};
  const current=()=>draftOwner===owner&&me?.id===owner&&preview===saving&&preview.saveKey===saveKey;
  cardPending=operation;cardError='';const button=$('#save-card');button.disabled=true;button.textContent=t("正在保存…");
  try{
    const {card}=await api('/api/cards',{method:'POST',headers:{'Idempotency-Key':saveKey},body:{workIds:saving.workIds,workRefs:previewReferences(saving),template:saving.template,name:saving.name,bio:saving.bio,...cardProfile(saving),avatarUrl:saving.avatarUrl||''}});
    if(!current())return;
    if(onboardingState)onboardingState={...onboardingState,hasCard:true,creatorReady:true,needsCreatorProfile:false,required:false};
    if(route().path==='/cards/me/preview')go('/card/'+encodeURIComponent(card.id)+'?saved=1');else notify(t("名片已保存。"));
  }catch(error){
    if(!current())return;
    if(error.code==='CARD_DELETED'){preview=null;write(storage.preview,null);cardError='';notify(error.message);if(route().path==='/cards/me/preview')go('/cards/me/template');return;}
    cardError=error.message;if($('#save-card')){$('#save-card').disabled=false;$('#save-card').textContent=t("重试保存");$('#card-error').textContent=t(error.message);}
  }finally{
    if(cardPending===operation){
      cardPending=false;
      // A newer preview may have been opened while this save was in flight.
      const activeButton=$('#save-card');if(activeButton){activeButton.disabled=false;activeButton.textContent=t(!isPinnedPreview(preview)?'重新生成预览':cardError?'重试保存':'保存为新名片');}
    }
  }
}
async function renderCard(r,number,countView=true){
  const {card}=await api('/api/cards/'+encodeURIComponent(decodeURIComponent(r.path.split('/')[2]))),own=card.authorId===me.id,shared=location.origin+publicCardPath(card.id),template=CARD_TEMPLATES.find(item=>item.id===card.template)||CARD_TEMPLATES[0];
  if(!applyHTML(`<div class="page card-view"><div class="card-view-top"><a class="back" href="#/cards">← ${t("名片")}</a>${r.params.has('saved')?`<span class="saved-label" role="status">${t("已保存")}</span>`:''}<button class="button small" data-share-url="${esc(shared)}" data-share-title="${esc(card.name)}" data-share-text="${esc(cardShareText(card,own))}">${t("分享名片")}</button></div>${own?'<section class="card-feed-settings" data-card-feed-settings></section>':''}${cardMarkup(card,r.raw,card.id)}<section class="card-template-reuse"><div><h2>${esc(t(template.name))}</h2><p>${esc(t(template.description))}</p></div><a class="button" href="#/cards/me?templateFrom=${encodeURIComponent(card.id)}">${t('用同款制作')} ↗</a></section><div class="card-management"><a class="text-link" href="#/author/${encodeURIComponent(card.authorId)}">${t('查看作者主页')}</a>${own?`<a class="text-link" href="#/cards/me?editCard=${encodeURIComponent(card.id)}">${t("更新名片")}</a><a class="text-link" href="#/cards/covers/${encodeURIComponent(card.id)}">${t("更新名片封面")}</a>`:''}<button class="button quiet small" data-copy-url="${esc(shared)}">${t("复制名片链接")}</button>${own?`<button type="button" class="button quiet small danger-text" data-delete-card="${esc(card.id)}" data-card-name="${esc(card.name)}">${t('删除名片')}</button>`:''}<p class="tiny muted">${t("朋友无需登录即可查看名片，试玩时再登录。")}</p></div></div>`,number))return;
  if(own)discoveryPanel=mountCardDiscovery($('[data-card-feed-settings]'),{api,cardId:card.id,onChange:clearDiscovery});
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
  try{if(desired)await waitForPendingPlayStart(sessionQueues,{workId:id,ownerId:account,flush:flushSession});if(account!==draftOwner)return;const response=await api('/api/works/'+encodeURIComponent(id)+'/like',{method:'POST',body:{liked:desired}});if(account!==draftOwner)return;acceptLike(id,response);likeRetry.delete(id);}
  catch(error){
    if(account!==draftOwner)return;let confirmed=false;
    try{const actual=await api('/api/works/'+encodeURIComponent(id)+'/like');if(account!==draftOwner)return;acceptLike(id,actual);confirmed=actual.liked===desired;}catch{}
    if(confirmed)likeRetry.delete(id);else{likeRetry.set(id,desired);notify(error.status===401?t("请重新登录后重试。"):t("暂时没能保存点赞，点击重试。"));}
  }finally{if(account===draftOwner){likePending.delete(id);refreshSocial(id);}}
}
function manualShare(url,title='',text=''){return openShareDialog({url,title,text});}
async function copyLink(url){try{await navigator.clipboard.writeText(url);notify(t("链接已复制。"));return true;}catch{manualShare(url);return false;}}
function shareLink(title,url,text=''){return manualShare(url,title,text);}

function postAction(type,fields){const item=frozenAction(uid(),type,fields);actionQueue.set(item.eventId,{body:item,attempts:0,timer:null});flushAction(item.eventId);}
async function flushAction(id){const item=actionQueue.get(id);if(!item||item.sending)return;item.sending=true;try{const result=await api('/api/events',{method:'POST',body:item.body,keepalive:true});if(result.receipt?.clientEventId===id||result.duplicate)actionQueue.delete(id);else throw new Error('Missing receipt');}catch(error){if([400,403,404,422].includes(error.status)){actionQueue.delete(id);return;}item.attempts++;clearTimeout(item.timer);item.timer=setTimeout(()=>flushAction(id),Math.min(30000,700*2**Math.min(item.attempts,6)));}finally{item.sending=false;}}

function makeQueue(session,workId,ownerId){const queue={id:session.id,token:session.token,workId,ownerId,pending:[],sending:false,inFlight:null,timer:null,seq:0,attempts:0,startedAt:performance.now(),expiresAt:Date.parse(session.expiresAt)||Date.now()+3600000};sessionQueues.add(queue);return queue;}
function enqueueSession(queue,type,result){const event={id:uid(),type,seq:++queue.seq,elapsedMs:Math.min(3600000,Math.max(0,Math.round(performance.now()-queue.startedAt)))};if(result)event.result=result;queue.pending.push(event);flushSession(queue);return event.id;}
function flushSession(queue){
  if(queue.inFlight)return queue.inFlight;if(!queue.pending.length)return Promise.resolve();if(Date.now()>queue.expiresAt){clearTimeout(queue.timer);sessionQueues.delete(queue);return Promise.resolve();}
  queue.sending=true;clearTimeout(queue.timer);const batch=queue.pending.slice(0,20);
  queue.inFlight=(async()=>{
    try{const response=await api('/api/sessions/'+encodeURIComponent(queue.id)+'/events',{method:'POST',body:{token:queue.token,events:batch},keepalive:true});const acknowledged=new Set([...(response.accepted||[]).map(e=>e.clientEventId),...(response.duplicates||[])]);queue.pending=queue.pending.filter(e=>!acknowledged.has(e.id));if(!acknowledged.size)throw new Error('Missing acknowledgment');queue.attempts=0;}
    catch(error){if([400,403,404,410,422].includes(error.status)){queue.pending=[];sessionQueues.delete(queue);}else queue.attempts++;}
    finally{queue.sending=false;queue.inFlight=null;if(queue.pending.length)queue.timer=setTimeout(()=>flushSession(queue),queue.attempts?Math.min(30000,500*2**Math.min(queue.attempts,6)):0);else if(queue.closed)sessionQueues.delete(queue);}
  })();return queue.inFlight;
}
function endSession(reason='exit'){
  const session=activeSession;if(!session)return;activeSession=null;
  clearGameLoad(session);
  session.display?.dispose();
  if(!session.ended){session.ended=true;enqueueSession(session.queue,'session_end',session.clock.finish());}session.queue.closed=true;if(!session.queue.pending.length&&!session.queue.sending)sessionQueues.delete(session.queue);
}
function clearGameLoad(session){
  clearTimeout(session.loadTimer);session.loadTimer=null;
  if(session.loadError)session.frame.removeEventListener('error',session.loadError);
  session.loadError=null;
}
function watchGameLoad(session){
  session.loadError=()=>failGameLoad(session);
  session.frame.addEventListener('error',session.loadError,{once:true});
  session.loadTimer=setTimeout(()=>failGameLoad(session),30000);
}
function failGameLoad(session){
  if(activeSession!==session||session.ready)return;
  endSession('load_error');
  session.frame.removeAttribute('src');
  session.shell.dataset.gameStatus='failed';session.shell.setAttribute('aria-busy','false');
  session.loadState.innerHTML=`<p>${t("试玩暂时未能加载")}</p><button class="button primary" type="button" data-game-retry>${t("重试打开")}</button>`;
  $('[data-game-retry]',session.loadState).addEventListener('click',()=>{restoreGameCover(session.work,session.coverHTML);void startGame(session.work);},{once:true});
}
function gameLoadReady(session){
  if(activeSession!==session||session.ready)return;
  session.ready=true;clearGameLoad(session);
  session.shell.dataset.gameStatus='ready';session.shell.setAttribute('aria-busy','false');session.loadState.hidden=true;
  session.frame.removeAttribute('aria-hidden');session.frame.removeAttribute('tabindex');
  const button=$('#expand-game',session.shell);button.hidden=false;
  session.display=mountGameDisplay(session.shell,{button,labels:{enter:t("全屏"),exitNative:t("退出全屏"),exitExpanded:t("退出大屏")}});
}
async function startGame(work){
  if(startPending)return;const previousCover=activeSession?.coverHTML;endSession('exit');startPending=true;const originRoute=routeNumber,ownerId=draftOwner;
  const buttons=$$('[data-action="start-game"]');buttons.forEach(b=>{b.disabled=true;b.textContent=t("正在打开…");});
  try{
    const session=await api('/api/sessions',{method:'POST',body:{workId:work.id,versionId:work.versionId}}),queue=makeQueue(session,work.id,ownerId);
    if(originRoute!==routeNumber){queue.closed=true;enqueueSession(queue,'session_end',{label:'exit'});return;}
    const gameUrl=new URL(session.gameUrl,location.origin);if(gameUrl.origin!==location.origin)throw new Error(t("作品地址不正确，请重试。"));
    const bridge=uid();gameUrl.hash='bridge='+encodeURIComponent(bridge);
    const area=$('#play-area'),coverHTML=previousCover||area.innerHTML;
    area.innerHTML=`<section class="game-shell" data-game-status="loading" aria-busy="true"><div class="game-tools"><span class="game-title">${esc(work.name)} · ${esc(work.version)}</span><div class="game-tool-actions"><button class="button quiet small" id="expand-game" type="button" aria-controls="game-frame" aria-pressed="false" hidden>${t("全屏")}</button><button class="button quiet small" id="exit-game" type="button">${t("退出试玩")}</button></div></div><div class="game-load-state" role="status" aria-live="polite">${loadingMark()}<p>${t("正在加载试玩…")}</p></div><iframe id="game-frame" class="game-frame" sandbox="allow-scripts allow-pointer-lock" referrerpolicy="no-referrer" title="${esc(work.name)}" aria-hidden="true" tabindex="-1"></iframe><div id="game-result" class="game-result" hidden></div></section>`;
    const frame=$('#game-frame');activeSession={...session,queue,bridge,frame,work,ready:false,started:false,completed:false,ended:false,coverHTML,shell:$('.game-shell',area),loadState:$('.game-load-state',area),clock:createPlayClock(()=>performance.now(),!document.hidden)};
    watchGameLoad(activeSession);frame.src=gameUrl.href;
    $('#exit-game').addEventListener('click',()=>restoreGameCover(work,coverHTML));
    buttons.filter(b=>b.isConnected).forEach(b=>{b.hidden=true;});
    area.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  }catch(error){if(originRoute===routeNumber){notify(error.message);buttons.filter(b=>b.isConnected).forEach(b=>{b.disabled=false;b.textContent=t("重试打开");});}}
  finally{startPending=false;}
}
function restoreGameCover(work,html){endSession('exit');const area=$('#play-area');if(!area)return;area.innerHTML=html;$$('[data-action="start-game"]').forEach(b=>{b.hidden=false;b.disabled=false;b.innerHTML=playIcon()+t("开始试玩");});$$('[data-action="start-game"]',area).forEach(b=>b.addEventListener('click',()=>startGame(work)));}
function receiveGame(event){
  const session=activeSession,message=event.data;if(!session||event.source!==session.frame.contentWindow||event.origin!=='null'||!message||message.channel!=='funtrack-game'||message.version!==1||message.bridge!==session.bridge)return;
  if(message.type==='ready')gameLoadReady(session);
  else if(message.type==='input'&&session.ready&&!session.started&&!session.ended){session.started=true;session.clock.start();enqueueSession(session.queue,'play_start');}
  else if(message.type==='complete'&&session.started&&!session.completed&&!session.ended){
    session.completed=true;const result={};if(message.result&&typeof message.result==='object'){if(typeof message.result.score==='number'&&Number.isFinite(message.result.score))result.score=message.result.score;if(typeof message.result.label==='string')result.label=message.result.label.slice(0,120);}
    const timing=session.clock.finish();enqueueSession(session.queue,'game_complete',result);session.ended=true;enqueueSession(session.queue,'session_end',timing);session.queue.closed=true;
    const area=$('#game-result');if(area){area.hidden=false;area.innerHTML=`<p>${t("本次试玩已结束")}${typeof result.score==='number'?` · ${esc(t("{score} 分",{score:result.score}))}`:''}</p><button class="button small" id="replay-game">${t("再玩一次")}</button><button class="button quiet small" id="to-feedback">${t("参与讨论")}</button>`;$('#replay-game').addEventListener('click',()=>startGame(session.work));$('#to-feedback').addEventListener('click',async()=>{await session.display?.exit({restoreFocus:false,restoreScroll:false});$('#comment-input')?.focus();$('#discussion')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});});}
  }
}
function receiveGallery(event){
  const gallery=currentGallery,message=event.data;if(!gallery||event.origin!==location.origin||event.source!==gallery.frame.contentWindow||!message||typeof message!=='object')return;
  if(message.type==='funtrack:gallery:state'){
    gallery.view=normalizeGalleryView(gallery.card,message);galleryViews.set(gallery.key,gallery.view);write(storage.views,Object.fromEntries(galleryViews));
  }else if(message.type==='funtrack:gallery:resize'&&Number.isFinite(message.height)){gallery.frame.style.height=Math.max(400,Math.min(1600,Math.ceil(message.height)))+'px';if(gallery.restoreScroll!==null){requestAnimationFrame(()=>{if(gallery===currentGallery&&gallery.restoreScroll!==null)window.scrollTo(0,gallery.restoreScroll);});clearTimeout(gallery.restoreTimer);gallery.restoreTimer=setTimeout(()=>gallery.restoreScroll=null,700);}}
  else if(message.type==='funtrack:gallery:open-work'){
    const work=gallery.card.works.find(w=>w.id===message.workId);if(!work)return;scrolls.set(gallery.key,window.scrollY);const id=gallery.card.id==='preview'?'':gallery.card.id;go(workHref(work,gallery.key,id).slice(1)+(message.play===true&&work.source==='html'?'&play=1':''));
  }
}
window.addEventListener('message',event=>{receiveGame(event);receiveGallery(event);});
document.addEventListener('visibilitychange',()=>activeSession?.clock.setVisible(!document.hidden));
window.addEventListener('hashchange',()=>{opening.cancel();renderRoute();});
for(const type of ['wheel','touchstart'])window.addEventListener(type,()=>{if(currentGallery)currentGallery.restoreScroll=null;},{passive:true});
window.addEventListener('online',()=>{actionQueue.forEach((_,id)=>flushAction(id));sessionQueues.forEach(flushSession);});
window.addEventListener('pagehide',()=>{endSession('exit');actionQueue.forEach((_,id)=>flushAction(id));sessionQueues.forEach(queue=>{if(queue.pending.length)api('/api/sessions/'+encodeURIComponent(queue.id)+'/events',{method:'POST',body:{token:queue.token,events:queue.pending.slice(0,20)},keepalive:true}).catch(()=>{});});});
document.addEventListener('click',async event=>{
  const creation=$('.creation-menu');if(creation&&(!creation.contains(event.target)||event.target.closest('a')))creation.open=false;
  const account=$('.account-menu');if(account&&(!account.contains(event.target)||event.target.closest('a,button')))account.open=false;
  const edit=event.target.closest('[data-edit-profile]');if(edit&&!edit.closest('.creator-home-page'))editProfile();
  const outbound=event.target.closest('[data-outbound]');if(outbound)postAction('outbound_click',{workId:outbound.dataset.outbound,versionId:outbound.dataset.version});
  const button=event.target.closest('[data-action="reload"]');if(button){authChecked=false;clearDiscovery();renderRoute();}
  const like=event.target.closest('[data-like]');if(like)toggleLike(like.dataset.like);
  const share=event.target.closest('[data-share-url]');if(share)shareLink(share.dataset.shareTitle,share.dataset.shareUrl,share.dataset.shareText);
  const remove=event.target.closest('[data-delete-card]');if(remove){const originRoute=routeNumber;confirmCardDeletion({id:remove.dataset.deleteCard,name:remove.dataset.cardName},{api,notify,onDeleted:()=>{if(preview){preview={...preview,saveKey:uid()};write(storage.preview,preview);}cardError='';if(originRoute===routeNumber){if(route().path.startsWith('/author/'))renderRoute();else go('/cards');}}});}
  const copy=event.target.closest('[data-copy-url]');if(copy)copyLink(copy.dataset.copyUrl);
});
function renderChrome(){
  document.documentElement.lang=getLocale();
  $('.skip').textContent=t('跳至内容');
  $('.brand').setAttribute('aria-label',t('TryMe 首页'));
  $('#creation-menu').innerHTML=creationMenuMarkup();
  const button=$('#locale-toggle');button.textContent=getLocale()==='en'?'中':'EN';
  button.setAttribute('aria-label',getLocale()==='en'?'切换为中文':'Switch to English');
  button.title=getLocale()==='en'?'中文':'English';
  identity();
}
$('#locale-toggle').addEventListener('click',()=>{
  if(activeSession&&!activeSession.ended){notify(t('结束试玩后可切换语言'));return;}
  if(onboardingPanel?.pending||publishPending||cardPending||startPending||hasPendingCardDeletion()||hasPendingVersionMutation()||hasPendingWorkEdit()||hasPendingPublicationControl()){notify(t('正在提交，请稍后切换语言'));return;}
  setLocale(getLocale()==='en'?'zh-CN':'en');
});
window.addEventListener('funtrack:localechange',()=>{
  scrolls.set(currentRoute,window.scrollY);renderChrome();
  $('#share-link-dialog')?.remove();renderRoute({localeOnly:true});
});
for(const draft of Object.values(feedbackDrafts))draft.pending=false;
renderChrome();renderRoute();

document.addEventListener('keydown',event=>{if(event.key==='Escape'){const menu=$('.creation-menu[open]');if(menu){menu.open=false;menu.querySelector('summary')?.focus();}}});
