import {t,getLocale} from './i18n.js';
import {avatarMarkup} from './avatars.js';
import {createNotificationState} from './notification-state.js';
import './notifications.messages.js';

const bell='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg>';
const filterNames={all:'全部',comment:'评论',like:'点赞',follow:'关注'};
export function notificationHref(item,from='/notifications'){
  if(!item.available)return '';
  if(item.kind==='follow')return item.actor.available?'#/author/'+encodeURIComponent(item.actor.id):'';
  return '#/work/'+encodeURIComponent(item.workId)+'?'+new URLSearchParams({from,...item.commentId?{comment:item.commentId}:{}});
}
export function notificationTitle(item){
  let name=item.actor.name||t('一位用户');
  if(item.actorCount>1){
    // Chinese count includes the named person; English “others” does not.
    name=t('{name}等 {count} 人',{name,count:getLocale()==='en'?item.actorCount-1:item.actorCount});
  }
  const label=item.kind==='work_like'?'{name}赞了你的作品':item.kind==='comment_like'?'{name}赞了你的评论':item.kind==='reply'?'{name}回复了你的评论':item.kind==='follow'?'{name}关注了你':item.isReply?'{name}参与了你作品下的讨论':'{name}评论了你的作品';
  return t(label,{name});
}

export function createNotificationCenter({header,api,esc,notify,onSessionChanged}){
  let model=null,owner=null,opened=false,page=null,from='/notifications',expanded=new Set();
  const small=()=>window.matchMedia('(max-width:600px)').matches;
  const date=value=>new Intl.DateTimeFormat(getLocale(),{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
  const profileLink=(actor,content,className='')=>actor.available?`<a class="${className}" href="#/author/${encodeURIComponent(actor.id)}" aria-label="${esc(actor.name||t('一位用户'))}">${content}</a>`:`<span class="${className}">${content}</span>`;
  function returnPath(){const state=model?.state;if(!state)return from;const params=new URLSearchParams();if(state.filter!=='all')params.set('filter',state.filter);if(state.work)params.set('work',state.work);return '/notifications'+(params.size?'?'+params:'');}
  function history(){return `<details class="notification-history"><summary>${t('历史记录')}</summary><a href="#/studio/feedback?tab=history">${t('全部评论记录')}</a><a href="#/studio/feedback?tab=legacy">${t('历史私密反馈')}</a></details>`;}
  function rows(state){return state.items.map(item=>{
    const href=notificationHref(item,returnPath()),isLike=['work_like','comment_like'].includes(item.kind),members=state.members.get(item.id),showMembers=expanded.has(item.id);
    const content=`<span class="notification-title">${esc(notificationTitle(item))}</span>${item.unread?`<span class="notification-unread" aria-label="${t('未读')}"></span>`:''}${item.available?`${item.body?`<span class="notification-body">${esc(item.body)}</span>`:''}<span class="notification-context">${esc(item.workName||'')}${item.archived?' · '+t('已归档'):''}${item.commentId?' · '+esc(item.version||t('版本未知')):''}</span>`:`<span class="notification-body">${t(item.kind==='follow'?'这位用户已不可用':'这条内容已不可用')}</span>`}<time datetime="${esc(item.createdAt)}">${esc(date(item.createdAt))}</time>`;
    return `<article class="notification-row ${item.unread?'is-unread':''}">${profileLink(item.actor,avatarMarkup({name:item.actor.name||t('一位用户'),avatarUrl:item.actor.avatarUrl},{className:'notification-avatar'}),'notification-person')}<div class="notification-main">${href?`<a class="notification-open" href="${esc(href)}" data-notification-open="${item.id}" data-focus-key="item-${item.id}">${content}</a>`:`<button type="button" class="notification-open" data-notification-open="${item.id}" data-focus-key="item-${item.id}">${content}</button>`}${isLike&&item.actorCount>1?`<button type="button" class="notification-members-toggle" data-notification-members="${item.id}" data-focus-key="members-${item.id}" aria-expanded="${showMembers}">${esc(t(showMembers?'收起点赞者':'查看点赞者（{count}）',{count:item.actorCount}))}</button>`:''}${showMembers?`<div class="notification-members">${(members?.actors||[]).map(actor=>profileLink(actor,avatarMarkup({name:actor.name||t('一位用户'),avatarUrl:actor.avatarUrl},{className:'notification-member-avatar'})+esc(actor.name||t('一位用户')))).join('')}${members?.loading?`<p role="status">${t('正在加载…')}</p>`:''}${members?.error?`<p role="alert">${esc(t(members.error))}</p>`:''}${members?.nextCursor||members?.error?`<button type="button" data-members-more="${item.id}" data-focus-key="more-members-${item.id}" ${members.loading?'disabled':''}>${t(members.error?'重试':'更多点赞者')}</button>`:''}</div>`:''}</div></article>`;
  }).join('');}
  function pane(target,full=false){
    if(!model||!target)return;const state=model.state;
    const focus=target.contains(document.activeElement)?document.activeElement.dataset.focusKey:null;
    target.innerHTML=`<header class="notification-panel-heading"><h${full?'1':'2'} tabindex="-1" data-focus-key="heading">${t('互动消息')}</h${full?'1':'2'}><button type="button" class="notification-mark" data-notification-mark data-focus-key="mark" ${!state.loaded||state.pending||!state.hasUnread?'disabled':''}>${t('全部已读')}</button>${!full?`<button type="button" class="notification-close" data-notification-close aria-label="${t('关闭互动消息')}">×</button>`:''}</header><nav class="notification-filters" aria-label="${t('互动类型')}">${Object.entries(filterNames).map(([key,label])=>`<button type="button" data-notification-filter="${key}" data-focus-key="filter-${key}" aria-pressed="${state.filter===key}" ${state.pending?'disabled':''}>${getLocale()==='en'?({all:'All',comment:'Comments',like:'Likes',follow:'Follows'})[key]:t(label)}</button>`).join('')}<button type="button" class="notification-refresh" data-notification-refresh data-focus-key="refresh" aria-label="${t('刷新互动')}" ${state.loading||state.pending?'disabled':''}>${t('刷新')}</button></nav>${state.work?`<p class="notification-scope">${t('当前显示指定作品的互动')} <a href="#/notifications">${t('查看全部作品的互动')}</a></p>`:''}<div class="notification-records" aria-busy="${state.loading}">${rows(state)}${!state.items.length&&!state.error?state.loading?`<p class="notification-empty" role="status">${t('正在加载…')}</p>`:`<div class="notification-empty">${bell}<h3>${t(state.filter==='all'?'还没有收到互动':'这个分类暂时没有互动')}</h3><p>${t('有人点赞、评论或关注你时，会出现在这里。')}</p></div>`:''}</div>${state.error?`<div class="notification-error" role="alert"><p>${esc(t(state.error))}</p><button type="button" data-notification-refresh data-focus-key="retry" ${state.loading||state.pending?'disabled':''}>${t('重试')}</button></div>`:''}${state.nextCursor?`<button type="button" class="notification-more" data-notification-more data-focus-key="more" ${state.loading||state.pending?'disabled':''}>${t(state.loading?'正在加载…':'查看更多')}</button>`:''}<footer class="notification-footer"><span class="notification-status" role="status">${state.summaryKnown?t(state.hasUnread?'打开互动不会自动清除未读。':'没有未读互动'):''}</span>${full?history():`<a href="#/notifications">${t('查看全部互动')}</a>`}</footer>`;
    if(focus)target.querySelector(`[data-focus-key="${CSS.escape(focus)}"]`)?.focus({preventScroll:true});
  }
  function draw(){
    if(!model||!owner)return;
    const state=model.state,button=header.querySelector('.notification-bell');
    button.setAttribute('aria-label',t(state.summaryError?'互动消息，暂时无法检查更新':state.hasUnread?'互动消息，有未读':'互动消息，没有未读'));
    button.setAttribute('aria-expanded',String(opened));
    header.querySelector('.notification-dot').hidden=!state.hasUnread;
    const popover=header.querySelector('.notification-popover');popover.setAttribute('aria-label',t('互动消息'));popover.hidden=!opened;
    if(opened)pane(popover);if(page?.isConnected)pane(page,true);
  }
  function close(returnFocus=false){opened=false;draw();if(returnFocus)header.querySelector('.notification-bell')?.focus();}
  async function click(event){
    if(!model||!owner)return;
    const button=event.target.closest('a,button');if(!button)return;
    if(button.matches('.notification-bell')){
      if(small()||page){close();location.hash='/notifications';return;}
      opened=!opened;draw();if(opened){header.querySelector('.notification-popover h2')?.focus();await model.load({filter:'all',work:''});}return;
    }
    if(button.hasAttribute('data-notification-close')){close(true);return;}
    if(button.dataset.notificationFilter){expanded.clear();await model.load({filter:button.dataset.notificationFilter});return;}
    if(button.hasAttribute('data-notification-refresh')){expanded.clear();await model.load();return;}
    if(button.hasAttribute('data-notification-more')){await model.load({more:true});return;}
    if(button.hasAttribute('data-notification-mark')){await model.mark();return;}
    if(button.dataset.notificationMembers){const id=Number(button.dataset.notificationMembers);if(expanded.has(id)){expanded.delete(id);draw();}else{expanded.add(id);await model.loadMembers(id);}return;}
    if(button.dataset.membersMore){const id=Number(button.dataset.membersMore);await model.loadMembers(id,Boolean(model.state.members.get(id)?.nextCursor));return;}
    if(button.dataset.notificationOpen){
      if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button>0)return;
      event.preventDefault();const current=model,id=Number(button.dataset.notificationOpen),item=current.state.items.find(item=>item.id===id),href=item&&notificationHref(item,returnPath());
      if(!item)return;
      if(await current.mark(id)){if(current!==model)return;if(href){close();location.hash=href.slice(1);}else notify(t(item.kind==='follow'?'这位用户已不可用':'这条内容已不可用'));}
    }
  }
  header.addEventListener('click',click);
  document.addEventListener('pointerdown',event=>{if(opened&&!header.contains(event.target))close();});
  document.addEventListener('keydown',event=>{if(opened&&event.key==='Escape'){event.preventDefault();close(true);}});
  window.addEventListener('focus',()=>model?.refreshSummary());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)model?.refreshSummary();});
  window.addEventListener('resize',()=>{if(opened&&small()){close();location.hash='/notifications';}});
  return {
    setUser(user){
      if(user?.id===owner){draw();model?.refreshSummary();return;}
      model?.dispose();model=null;owner=user?.id||null;opened=false;expanded.clear();header.innerHTML='';header.hidden=!owner;
      if(!owner)return;
      header.innerHTML=`<button type="button" class="notification-bell" aria-label="${t('互动消息')}" aria-expanded="false" aria-controls="notification-popover">${bell}<span class="notification-dot" hidden aria-hidden="true"></span></button><section class="notification-popover" id="notification-popover" aria-label="${t('互动消息')}" hidden></section>`;
      model=createNotificationState({api,owner,onChange:draw,onSessionChanged:()=>{model?.dispose();model=null;owner=null;opened=false;header.innerHTML='';header.hidden=true;if(page?.isConnected)page.innerHTML=`<p role="alert">${t('登录账号已变化，请刷新页面后重试。')}</p>`;onSessionChanged?.();}});
      model.refreshSummary(true);
    },
    mountPage(element,{filter='all',work='',returnTo='/notifications'}={}){
      page=element;from=returnTo;opened=false;expanded.clear();page.addEventListener('click',click);draw();
      model?.load({filter:Object.hasOwn(filterNames,filter)?filter:'all',work});
      return {dispose(){element.removeEventListener('click',click);if(page===element)page=null;}};
    },
    onRoute(){close();from='/notifications';model?.refreshSummary();},
  };
}
