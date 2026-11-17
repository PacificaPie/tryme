import {t,getLocale} from './i18n.js';
import {avatarMarkup} from './avatars.js';
import {emptyState,loadingMark} from './empty-state.js';
import './creator-social.messages.js';

export function mountCreatorDirectory(root,{api,esc,me,following=false,onQuery}){
  let disposed=false,controller=null,request=0,pending=false,creators=[],nextAfter=null,error='';
  root.innerHTML=`<div class="page-head"><h1>${t('创作者')}</h1><a class="button" href="#/author/${encodeURIComponent(me.id)}">${t('我的主页')}</a></div><div class="creator-directory-tabs" aria-label="${t('创作者列表')}"><button type="button" data-creators="all">${t('全部')}</button><button type="button" data-creators="following">${t('我关注的')}</button></div><div class="creator-directory-results" aria-live="polite"></div><div class="feed-pagination"><button type="button" class="button" data-more hidden>${t('加载更多')}</button></div>`;
  const result=root.querySelector('.creator-directory-results'),more=root.querySelector('[data-more]');
  const alive=()=>!disposed&&root.isConnected;
  function draw(){
    root.querySelectorAll('[data-creators]').forEach(button=>button.setAttribute('aria-pressed',String((button.dataset.creators==='following')===following)));
    result.setAttribute('aria-busy',String(pending));
    if(!creators.length){
      if(pending)result.innerHTML=`<div class="feed-loading-caption">${loadingMark()}<span>${t('正在加载创作者…')}</span></div>`;
      else if(error)result.innerHTML=emptyState({kind:'cards',title:t('暂时没能加载创作者'),description:error,action:`<button type="button" class="button" data-retry>${t('重试')}</button>`});
      else result.innerHTML=emptyState({kind:'cards',title:t(following?'还没有关注创作者':'还没有公开的创作者'),description:t(following?'遇到喜欢的作品，可以进入作者主页关注。':'发布作品或制作名片，让别人认识你。'),action:following?`<button type="button" class="button primary" data-discover>${t('发现创作者')}</button>`:`<a class="button primary" href="#/publish">${t('发布作品')}</a>`});
    }else{
      result.innerHTML=`<div class="creator-people-grid">${creators.map(person=>`<article class="creator-person"><a href="#/author/${encodeURIComponent(person.id)}" class="creator-person-link">${avatarMarkup(person,{className:'creator-person-avatar'})}<div class="creator-person-copy"><h2>${esc(person.name)}</h2>${person.headline||person.bio?`<p>${esc(person.headline||person.bio)}</p>`:''}<div class="creator-person-meta"><span>${t('{count} 件作品',{count:Number(person.worksCount||0).toLocaleString(getLocale())})}</span>${person.id===me.id?`<span>${t('我的主页')}</span>`:person.followedByMe?`<span>${t('已关注')}</span>`:''}</div></div><span class="creator-person-arrow" aria-hidden="true">↗</span></a></article>`).join('')}</div>${error?`<p class="error" role="alert">${esc(error)}</p>`:''}`;
    }
    more.hidden=!nextAfter;more.disabled=pending;more.textContent=t(pending?'正在加载…':error?'重试加载':'加载更多');
  }
  async function load(append=false){
    if(append&&(pending||!nextAfter))return;
    controller?.abort();controller=new AbortController();const version=++request;pending=true;error='';draw();
    const params=new URLSearchParams({limit:'48'});if(following)params.set('following','1');if(append)params.set('after',nextAfter);
    try{const data=await api('/api/creators?'+params,{signal:controller.signal});if(!alive()||request!==version)return;
      const seen=new Set(append?creators.map(person=>person.id):[]);creators=[...(append?creators:[]),...data.creators.filter(person=>!seen.has(person.id))];nextAfter=data.nextAfter||null;
    }catch(cause){if(alive()&&request===version)error=t(cause.message);}
    finally{if(alive()&&request===version){pending=false;draw();}}
  }
  function select(value){if(value===following)return;following=value;creators=[];nextAfter=null;onQuery?.(following);void load();}
  root.addEventListener('click',event=>{const scope=event.target.closest('[data-creators]');if(scope)select(scope.dataset.creators==='following');if(event.target.closest('[data-discover]'))select(false);if(event.target.closest('[data-retry]'))void load();});
  more.addEventListener('click',()=>load(true));void load();
  return {dispose(){disposed=true;request++;controller?.abort();}};
}
