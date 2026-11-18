import {t,getLocale,setLocale,registerMessages} from './i18n.js';
import {CARD_TEMPLATES,renderPortfolioCard,mountPortfolioCard} from './card-templates.js';
import {createGalleryBridge} from './gallery/embed.js';
import {publicCardId,publicCoverPath,publicPlaySignInPath,publicCardRemixSignInPath,isCardId,isPublicWorkId} from './public-card-links.js';

registerMessages({
  '正在加载名片…':'Loading card…', '名片暂时无法打开':'This card is unavailable',
  '这张名片不存在或已不可访问。':'This card does not exist or is no longer available.',
  '连接暂时中断，请重试。':'The connection was interrupted. Please try again.',
  '重试':'Retry', '关闭作品':'Close work', '登录后试玩':'Sign in to play',
  '加入 TryMe':'Join TryMe', '查看作品':'View work', '名片中的版本':'Version saved in this card',
  '正在加载 3D 名片…':'Loading 3D card…', '重新加载 3D':'Reload 3D',
  '3D 名片加载超时，请重试。':'The 3D card took too long to load. Try again.',
  '当前浏览器暂未显示 3D，作品列表仍可查看。':'3D is unavailable in this browser. Your works are still available below.',
  '网页游戏':'Browser game','外链作品':'External work','卡中展厅':'Fold-out gallery','点亮收藏':'Collection desk',
});

import {avatarMarkup} from './avatars.js';
import './creator-social.messages.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const website=value=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}};
const joinPath='/auth/sign-in.html?return_to='+encodeURIComponent('/site.html#/feed');
const spinner=()=>'<span class="public-loading-mark" aria-hidden="true"></span>';

export function renderPublicCard(card, origin = globalThis.location?.origin) {
  const profile={headline:card.headline||'',signature:card.signature||'',website:website(card.website),backStyle:card.backStyle||'ink'};
  const safeCover=value=>{const work=card.works.find(item=>item.coverUrl===value);return work?publicCoverPath(value,card.id,work.id,origin):'';};
  const workHref=work=>'#work='+encodeURIComponent(work.id);
  if (['fold','collection'].includes(card.template)) {
    return `<section class="card-preview public-gallery"><div class="gallery-load-status" role="status" aria-live="polite">${spinner()}<span>${t('正在加载 3D 名片…')}</span></div><iframe id="public-gallery-frame" class="gallery-frame" src="/${card.template==='collection'?'collection':'gallery'}/?lang=${getLocale()}" title="${t(card.template==='collection'?'点亮收藏':'卡中展厅')}" loading="eager" aria-busy="true"></iframe></section>`;
  }
  if (['editorial','filmstrip'].includes(card.template)) return renderPortfolioCard(card,{profile,safeCover,workHref,from:'/card/'+card.id,cardId:card.id});
  return `<div class="card-preview"><article class="white-card"><header>${card.avatarUrl?avatarMarkup(card,{className:'card-profile-avatar'}):''}<h2>${escape(card.name)}</h2>${profile.headline?`<p class="card-headline">${escape(profile.headline)}</p>`:''}${card.bio?`<p class="bio">${escape(card.bio)}</p>`:''}${profile.website?`<a class="profile-website" href="${escape(profile.website)}" target="_blank" rel="noopener noreferrer">${escape(new URL(profile.website).hostname)} ↗</a>`:''}</header><div class="work-grid">${card.works.map(work=>{
    const cover=publicCoverPath(work.coverUrl,card.id,work.id,origin);
    return `<article class="work-tile"><a class="work-entry" href="${escape(workHref(work))}" data-card-work="${escape(work.id)}"><div class="cover${cover?'':' empty-cover'}">${cover?`<img src="${escape(cover)}" alt="${escape(work.name)}" loading="lazy">`:`<span>${escape(work.name)}</span>`}<span class="cover-action" aria-hidden="true">${t('查看作品')} ↗</span></div><div class="tile-info"><h3 class="tile-title">${escape(work.name)}</h3>${work.desc?`<p class="tile-desc">${escape(work.desc)}</p>`:''}</div></a></article>`;
  }).join('')}</div>${profile.signature?`<footer class="card-signature">${escape(profile.signature)}</footer>`:''}</article></div>`;
}

export async function fetchPublicCard(id,{fetchImpl=globalThis.fetch,signal}={}) {
  if(!isCardId(id))throw Object.assign(new Error('这张名片不存在或已不可访问。'),{status:404});
  const response=await fetchImpl('/api/public/cards/'+encodeURIComponent(id),{credentials:'omit',cache:'no-store',redirect:'error',signal});
  if(!response.ok)throw Object.assign(new Error(response.status===404?'这张名片不存在或已不可访问。':'连接暂时中断，请重试。'),{status:response.status});
  const data=await response.json();
  if(data?.card?.id!==id||!Array.isArray(data.card.works)||!data.card.works.every(work=>isPublicWorkId(work.id)))throw new Error('连接暂时中断，请重试。');
  return data.card;
}

function mountPublicPage(root) {
  const id=publicCardId(location.pathname),localeButton=document.querySelector('#public-card-locale');
  let card=null,bridge=null,fetchController=null,selectedWork=null,lastFocused=null,view={};
  const syncLocale=()=>{
    document.documentElement.lang=getLocale();
    if(localeButton){localeButton.textContent=getLocale()==='en'?'中文':'EN';localeButton.setAttribute('aria-label',getLocale()==='en'?'切换到中文':'Switch to English');}
  };
  const dialog=()=>root.querySelector('.public-work-dialog');
  const closeWork=()=>{dialog()?.close();selectedWork=null;lastFocused?.focus?.({preventScroll:true});};
  function openWork(workId) {
    const work=card?.works.find(item=>item.id===workId);if(!work)return;
    selectedWork=work.id;lastFocused=document.activeElement;
    const cover=publicCoverPath(work.coverUrl,card.id,work.id);
    const modal=dialog();modal.innerHTML=`<button type="button" class="public-work-close" aria-label="${t('关闭作品')}">×</button>${cover?`<div class="public-work-art"><img src="${escape(cover)}" alt="${escape(work.name)}"></div>`:''}<div class="public-work-copy"><p class="public-work-version">${t('名片中的版本')}${work.version?' · '+escape(work.version):''}</p><h2 id="public-work-title">${escape(work.name)}</h2>${work.desc?`<p class="public-work-description">${escape(work.desc)}</p>`:''}<a class="button primary" href="${escape(publicPlaySignInPath(card.id,work.id))}">${t('登录后试玩')} ↗</a></div>`;
    modal.querySelector('button').addEventListener('click',closeWork);
    if(!modal.open)modal.showModal();
  }
  const payload=()=>({locale:getLocale(),author:{id:'public-card:'+card.id,name:card.name,bio:card.bio,avatarUrl:card.avatarUrl||'',headline:card.headline,signature:card.signature,website:website(card.website),backStyle:card.backStyle},works:card.works.map(work=>({id:work.id,name:work.name,desc:work.desc,cover:publicCoverPath(work.coverUrl,card.id,work.id),kind:work.source==='url'?'外链作品':'网页游戏',version:work.version})),...view});
  function render() {
    bridge?.dispose();bridge=null;syncLocale();document.title=card.name+' · TryMe';
    const template=CARD_TEMPLATES.find(item=>item.id===card.template)||CARD_TEMPLATES[0];
    root.innerHTML=`<h1 class="public-card-title">${escape(card.name)}</h1>${renderPublicCard(card)}<section class="public-card-remix"><div><h2>${escape(t(template.name))}</h2><p>${escape(t(template.description))}</p></div><a class="button" href="${escape(publicCardRemixSignInPath(card.id))}">${t('用同款制作')} ↗</a></section><footer class="public-card-footer"><a href="${joinPath}">${t('加入 TryMe')} <span aria-hidden="true">↗</span></a></footer><dialog class="public-work-dialog" aria-labelledby="public-work-title"></dialog>`;
    const modal=dialog();modal.addEventListener('cancel',event=>{event.preventDefault();closeWork();});modal.addEventListener('click',event=>{if(event.target!==modal)return;const rect=modal.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeWork();});
    const frame=root.querySelector('#public-gallery-frame');
    if(frame){
      const status=root.querySelector('.gallery-load-status');
      bridge=createGalleryBridge({frame,payload,onStatus:state=>{
        const busy=state==='loading';frame.setAttribute('aria-busy',String(busy));frame.style.visibility=busy||state==='timeout'?'hidden':'';status.hidden=state==='rendered'||state==='empty';
        if(!status.hidden){status.innerHTML=busy?`${spinner()}<span>${t('正在加载 3D 名片…')}</span>`:`<span>${t(state==='fallback'?'当前浏览器暂未显示 3D，作品列表仍可查看。':'3D 名片加载超时，请重试。')}</span><button type="button" class="button small">${t('重新加载 3D')}</button>`;status.querySelector('button')?.addEventListener('click',()=>bridge.retry());}
      }});
    }else mountPortfolioCard(root,'public-card:'+id);
    if(selectedWork)openWork(selectedWork);
  }
  async function load() {
    fetchController?.abort();fetchController=new AbortController();const controller=fetchController;
    bridge?.dispose();bridge=null;card=null;
    root.innerHTML=`<div class="public-card-loading" role="status">${spinner()}<span>${t('正在加载名片…')}</span></div>`;
    const timeout=setTimeout(()=>controller.abort(),15000);
    try{const loaded=await fetchPublicCard(id,{signal:controller.signal});if(controller!==fetchController||controller.signal.aborted)return;card=loaded;render();}
    catch(error){if(controller!==fetchController)return;root.innerHTML=`<section class="public-card-error"><h1>${t('名片暂时无法打开')}</h1><p>${t(error.status===404?'这张名片不存在或已不可访问。':'连接暂时中断，请重试。')}</p>${error.status===404?'':`<button type="button" class="button" data-public-retry>${t('重试')}</button>`}</section>`;root.querySelector('[data-public-retry]')?.addEventListener('click',load);}
    finally{clearTimeout(timeout);}
  }
  root.addEventListener('click',event=>{const link=event.target.closest('a[href^="#work="]');if(!link)return;event.preventDefault();openWork(new URLSearchParams(link.getAttribute('href').slice(1)).get('work'));});
  window.addEventListener('message',event=>{
    const frame=root.querySelector('#public-gallery-frame');if(!frame||event.source!==frame.contentWindow||event.origin!==location.origin)return;
    const message=event.data;if(message?.type==='funtrack:gallery:open-work')openWork(message.workId);
    else if(message?.type==='funtrack:gallery:resize'&&Number.isFinite(message.height))frame.style.height=Math.max(400,Math.min(1600,Math.ceil(message.height)))+'px';
    else if(message?.type==='funtrack:gallery:state')view={open:message.open===true,face:message.face==='back'?'back':'front',page:Number.isInteger(message.page)?message.page:0,inside:message.inside===true,focusWorkId:card.works.some(work=>work.id===message.focusWorkId)?message.focusWorkId:null,yaw:Number.isFinite(message.yaw)?message.yaw:0};
  });
  localeButton?.addEventListener('click',()=>{setLocale(getLocale()==='en'?'zh-CN':'en');syncLocale();if(card)render();});
  window.addEventListener('pagehide',()=>{bridge?.dispose();fetchController?.abort();});
  window.addEventListener('pageshow',event=>{if(event.persisted)load();});
  syncLocale();load();
}

if(typeof document!=='undefined'){
  const root=document.querySelector('#public-card-root');if(root)mountPublicPage(root);
}
