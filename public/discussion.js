import {t,getLocale} from './i18n.js';
import './creator-module.messages.js';
const drafts=new Map(),discussions=new Map();
export const discussionVersionId=work=>typeof work?.versionId==='string'&&work.versionId?work.versionId:null;
export const discussionDraftKey=(user,work)=>`funtrack.discussion.v2:${encodeURIComponent(user.id)}:${encodeURIComponent(work.id)}:${encodeURIComponent(discussionVersionId(work)||'unknown')}`;
export const commentVersionLabel=comment=>discussionVersionId(comment)&&typeof comment.version==='string'&&comment.version.trim()?comment.version:t('版本未知');
export function commentHref(comment,from='/studio/feedback'){
  const params=new URLSearchParams({from,comment:comment.id});
  return '#/work/'+encodeURIComponent(comment.workId)+'?'+params;
}
function draftFor(key){
  if(drafts.has(key))return drafts.get(key);
  let value;try{value=JSON.parse(sessionStorage.getItem(key));}catch{}
  const draft={text:typeof value?.text==='string'?value.text.slice(0,1000):'',parentId:typeof value?.parentId==='string'?value.parentId:null,parentName:typeof value?.parentName==='string'?value.parentName:'',key:typeof value?.key==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(value.key)?value.key:crypto.randomUUID()};
  drafts.set(key,draft);return draft;
}
function persist(key,draft){try{sessionStorage.setItem(key,JSON.stringify(draft));}catch{}}
function discussionFor(key){
  if(!discussions.has(key))discussions.set(key,{roots:[],rootCache:new Map(),total:0,cursor:null,loaded:false,loading:false,pending:false,status:'',error:'',likes:new Set(),retryLikes:new Map(),social:new Map(),replies:new Set(),localRoots:new Map(),view:null});
  return discussions.get(key);
}
const when=value=>{const d=new Date(typeof value==='number'&&value<1e12?value*1000:value);return Number.isNaN(d.valueOf())?'':d.toLocaleDateString(getLocale(),{month:'short',day:'numeric'});};
const heart='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 4.9a5.3 5.3 0 0 0-7.5 0L12 6l-1.1-1.1a5.3 5.3 0 0 0-7.5 7.5L12 21l8.5-8.6a5.3 5.3 0 0 0 0-7.5Z"/></svg>';
const scrollBehavior=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
const repliesFor=root=>[...(root.replies||[]),...(root.localReplies||[])];
function appendReplies(root,replies){
  root.replies ||= [];
  const seen=new Set(root.replies.map(reply=>reply.id));
  for(const reply of replies)if(!seen.has(reply.id)){root.replies.push(reply);seen.add(reply.id);}
  // Newly acknowledged replies stay after the server's chronological prefix.
  // A later page moves them into that prefix at their authoritative position.
  root.localReplies=(root.localReplies||[]).filter(reply=>!seen.has(reply.id));
}

export function mountDiscussion(element,{work,user,api,esc,onCount=()=>{},notify=()=>{},beforeRootSubmit=()=>{},focusId=''}){
  // Capture the page's version once. A later publication cannot relabel a
  // pending submission, a saved-card view, or an idempotent retry.
  const expectedAuthorId=user.id,versionId=discussionVersionId(work),key=discussionDraftKey(user,work),draft=draftFor(key),state=discussionFor(key);
  const focus={id:focusId,thread:null,loading:false,error:'',highlighted:false,closed:false};
  let contextMarkup='';
  element.innerHTML=`<div class="discussion-head"><h2>${t('讨论')} <span id="discussion-count"></span></h2></div><form class="comment-composer"><span class="comment-avatar" aria-hidden="true">${esc([...(user.name||t('我'))][0])}</span><div class="composer-main"><div class="reply-target" hidden><span></span><button type="button" aria-label="${t('取消回复')}">×</button></div><label class="skip-label" for="comment-input">${t('写评论')}</label><textarea id="comment-input" rows="1" maxlength="1000" placeholder="${t('说点什么…')}" required>${esc(draft.text)}</textarea><div class="composer-footer"><span class="composer-visibility">${t('公开评论')} · ${esc(commentVersionLabel(work))}</span><button type="submit" class="button primary small">${t('发布')}</button></div></div></form><p class="comment-status" role="status" aria-live="polite"></p><div class="comment-context" aria-label="${t('定位评论')}" hidden></div><div class="comment-list"></div><button type="button" class="comments-more" hidden>${t('查看更多评论')}</button>`;
  const form=element.querySelector('form'),input=element.querySelector('textarea'),submit=form.querySelector('[type=submit]'),list=element.querySelector('.comment-list'),context=element.querySelector('.comment-context'),more=element.querySelector('.comments-more'),status=element.querySelector('.comment-status'),target=element.querySelector('.reply-target'),cancel=target.querySelector('button');
  const view={alive:()=>state.view===view&&element.isConnected,refresh:()=>{render();composer();revealFocus();},notify};state.view=view;
  const alive=view.alive;
  const refresh=()=>{if(state.view?.alive())state.view.refresh();};
  const notice=message=>{if(state.view?.alive())state.view.notify(t(message));};
  const all=()=>[...state.roots,...(focus.thread?[focus.thread]:[])].flatMap(root=>[root,...repliesFor(root)]);
  function composer(){
    if(!alive())return;
    if(input.value!==draft.text)input.value=draft.text;
    input.disabled=cancel.disabled=state.pending;submit.disabled=state.pending||!state.loaded||!input.value.trim();submit.textContent=t(state.pending?'发布中…':'发布');
    target.hidden=!draft.parentId;target.querySelector('span').textContent=draft.parentId?t('回复 {name}',{name:draft.parentName}):'';
    input.style.height='auto';input.style.height=Math.min(180,input.scrollHeight)+'px';form.classList.toggle('expanded',!!input.value||document.activeElement===input);
  }
  function syncSocial(c,requestedAt){
    if(state.likes.has(c.id)||(state.social.get(c.id)?.confirmedAt||0)>requestedAt)return;
    state.social.set(c.id,{liked:c.likedByMe===true,count:Number(c.likesCount)||0,confirmedAt:requestedAt});
  }
  function item(c,reply=false,focused=false){
    const pending=state.likes.has(c.id),retry=state.retryLikes.has(c.id),social=state.social.get(c.id),liked=social?social.liked:c.likedByMe,count=social?social.count:c.likesCount;
    return `<article class="comment ${reply?'comment-reply':''}${focused&&c.id===focus.id?' comment-highlight':''}" id="${focused?'context-':''}comment-${esc(c.id)}" data-comment="${esc(c.id)}"${focused?' tabindex="-1"':''}><a class="comment-avatar" href="#/author/${encodeURIComponent(c.authorId)}" aria-label="${esc(c.authorName)}">${esc([...(c.authorName||t('访客'))][0])}</a><div class="comment-main"><div class="comment-byline"><a href="#/author/${encodeURIComponent(c.authorId)}">${esc(c.authorName)}</a>${c.isCreator?`<span class="author-badge">${t('作者')}</span>`:''}</div><p class="comment-body">${esc(c.body)}</p><div class="comment-meta"><time>${when(c.createdAt)}</time><span class="comment-version" aria-label="${esc(t('评论版本：{version}',{version:commentVersionLabel(c)}))}">${esc(commentVersionLabel(c))}</span>${!reply?`<button type="button" data-reply="${esc(c.id)}" ${state.pending?'disabled':''}>${t('回复')}</button>`:''}</div></div><button type="button" class="comment-like ${liked?'liked':''}" data-comment-like="${esc(c.id)}" aria-label="${esc(t(retry?'重试点赞 {name} 的评论':liked?'取消点赞 {name} 的评论':'点赞 {name} 的评论',{name:c.authorName}))}" aria-pressed="${!!liked}" ${pending?'disabled':''}>${heart}<span>${retry?t('重试'):count||''}</span></button></article>`;
  }
  function replaceContext(markup){
    if(contextMarkup===markup)return;
    const active=document.activeElement;
    const id=context.contains(active)?active?.id:'';
    contextMarkup=markup;context.innerHTML=markup;
    // Restore a focused comment only if it was replaced, never after the user
    // has deliberately moved to another control or into the composer.
    if(id)context.querySelector('[id="'+CSS.escape(id)+'"]')?.focus({preventScroll:true});
  }
  function renderContext(){
    context.hidden=!focus.id||focus.closed;
    if(context.hidden)return;
    const heading=`<div class="comment-context-head"><h3>${t('定位评论')}</h3><button type="button" class="text-link" data-close-context>${t('查看全部讨论')}</button></div>`;
    if(focus.error){replaceContext(heading+`<p class="comment-status" role="status">${esc(t(focus.error))}</p><button type="button" class="comments-retry" data-focus-retry>${t('重新定位评论')}</button>`);return;}
    if(!focus.thread){replaceContext(heading+`<div class="comment-loading" role="status">${t('正在定位评论…')}</div>`);return;}
    replaceContext(heading+`<div class="comment-thread">${item(focus.thread,false,true)}${repliesFor(focus.thread).length?`<div class="comment-replies">${repliesFor(focus.thread).map(reply=>item(reply,true,true)).join('')}</div>`:''}</div>`);
  }
  function render(){
    if(!alive())return;
    element.querySelector('#discussion-count').textContent=state.loaded?state.total:'';status.textContent=t(state.status);renderContext();
    if(state.loaded)onCount(state.total);
    if(!state.loaded){list.innerHTML=state.error?`<button type="button" class="comments-retry">${t('重新加载评论')}</button>`:`<div class="comment-loading" role="status">${t('加载讨论…')}</div>`;more.hidden=true;return;}
    list.innerHTML=state.roots.length?state.roots.map(root=>`<div class="comment-thread">${item(root)}${repliesFor(root).length?`<div class="comment-replies">${repliesFor(root).map(reply=>item(reply,true)).join('')}</div>`:''}${root.repliesNextCursor?`<button type="button" class="replies-more" data-more-replies="${esc(root.id)}" ${state.replies.has(root.id)?'disabled':''}>${t(state.replies.has(root.id)?'加载中…':'展开更多回复')}${root.replyCount?' · '+root.replyCount:''}</button>`:''}</div>`).join(''):`<p class="discussion-empty">${t('还没有评论，来聊聊这件作品。')}</p>`;
    more.hidden=!state.cursor;more.disabled=state.loading;more.textContent=t(state.loading?'加载中…':'查看更多评论');
  }
  function revealFocus(){
    if(!alive()||!focus.id||focus.closed||!focus.thread||focus.highlighted)return;
    const found=context.querySelector('[id="context-comment-'+CSS.escape(focus.id)+'"]');
    if(found){found.classList.add('comment-highlight');found.scrollIntoView({block:'center',behavior:scrollBehavior()});found.focus({preventScroll:true});focus.highlighted=true;}
  }
  async function loadContext(){
    if(!focus.id||focus.loading||focus.closed)return;
    focus.loading=true;focus.error='';refresh();
    const requestedAt=performance.now(),controller=new AbortController();let timer;
    try{
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('暂时无法定位这条评论，请重试。'));},12000);});
      const result=await Promise.race([api('/api/comments/'+encodeURIComponent(focus.id)+'/context',{signal:controller.signal}),timeout]);
      if(!alive())return;
      const root=result.thread,replies=root?.replies;
      if(result.workId!==work.id||result.targetId!==focus.id||result.contextOnly!==true||!root||root.workId!==work.id||root.parentId!==null||!Array.isArray(replies)||replies.length>1||replies.some(c=>c.workId!==work.id||c.parentId!==root.id)||!(root.id===focus.id||replies.some(c=>c.id===focus.id)))throw new Error('暂时无法定位这条评论，请重试。');
      syncSocial(root,requestedAt);replies.forEach(c=>syncSocial(c,requestedAt));
      focus.thread={...root,replies:[...replies],localReplies:[]};
    }catch(error){if(alive())focus.error=error.status===404?'这条评论不存在。':'暂时无法定位这条评论，请重试。';}
    finally{clearTimeout(timer);focus.loading=false;refresh();}
  }
  function mergeRoot(incoming,requestedAt){
    syncSocial(incoming,requestedAt);(incoming.replies||[]).forEach(reply=>syncSocial(reply,requestedAt));
    const existing=state.rootCache.get(incoming.id);
    if(!existing){const root={...incoming,replies:[...(incoming.replies||[])],localReplies:[]};state.rootCache.set(root.id,root);return root;}
    const replies=existing.replies,localReplies=existing.localReplies,replyCount=existing.replyCount,cursor=existing.repliesNextCursor;
    Object.assign(existing,incoming,{replies,localReplies,replyCount:Math.max(replyCount||0,incoming.replyCount||0)});
    appendReplies(existing,incoming.replies||[]);
    if(state.replies.has(existing.id)||cursor)existing.repliesNextCursor=cursor;
    return existing;
  }
  async function load(append=false){
    if(state.loading||(append&&!state.cursor))return;
    const requestedAt=performance.now(),cursor=state.cursor;
    if(state.status===state.error)state.status='';state.loading=true;state.error='';refresh();
    try{
      const result=await api('/api/works/'+encodeURIComponent(work.id)+'/comments'+(append?'?cursor='+encodeURIComponent(cursor):''));
      const incoming=result.comments.map(root=>mergeRoot(root,requestedAt)),ids=new Set(incoming.map(root=>root.id));
      if(append){const existing=new Set(state.roots.map(root=>root.id));state.roots.push(...incoming.filter(root=>!existing.has(root.id)));}
      else{
        // A POST may finish after this GET started. Keep that new root ahead of
        // the older response; otherwise use the server's newest-first order.
        const pending=state.roots.filter(root=>!ids.has(root.id)&&(state.localRoots.get(root.id)||0)>requestedAt);
        state.roots=[...pending,...incoming];
      }
      ids.forEach(id=>state.localRoots.delete(id));
      state.total=Math.max(state.total,result.commentsCount);state.cursor=result.nextCursor;state.loaded=true;state.error='';
    }catch(error){state.error=error.message;state.status=error.message;}
    finally{state.loading=false;refresh();}
  }
  form.addEventListener('input',()=>{if(!alive()||state.pending)return;draft.text=input.value;draft.key=crypto.randomUUID();persist(key,draft);state.status='';composer();status.textContent='';});
  input.addEventListener('focus',composer);input.addEventListener('blur',composer);
  cancel.addEventListener('click',()=>{if(!alive()||state.pending)return;draft.parentId=null;draft.parentName='';draft.key=crypto.randomUUID();persist(key,draft);composer();input.focus();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!alive()||state.pending||!state.loaded||!input.value.trim())return;
    const body=input.value.trim(),parentId=draft.parentId,submittedKey=draft.key;state.pending=true;state.status='';persist(key,draft);refresh();
    try{
      if(!parentId){await beforeRootSubmit();if(!alive())return;}
      const result=await api('/api/works/'+encodeURIComponent(work.id)+'/comments',{method:'POST',headers:{'Idempotency-Key':submittedKey},body:{body,parentId,versionId,expectedAuthorId}}),c=result.comment;
      if(!c||typeof c.id!=='string'||c.workId!==work.id||c.authorId!==expectedAuthorId||c.parentId!==parentId||c.body!==body||c.versionId!==versionId||!Number.isInteger(result.commentsCount)||result.commentsCount<0)throw new Error('暂时没有收到评论保存结果，请重试。');
      syncSocial(c,performance.now());
      if(parentId){
        const root=state.rootCache.get(parentId);
        if(root&&!repliesFor(root).some(reply=>reply.id===c.id)){root.localReplies ||= [];root.localReplies.push(c);root.replyCount=(root.replyCount||0)+1;}
        if(focus.thread?.id===parentId&&!repliesFor(focus.thread).some(reply=>reply.id===c.id)){focus.thread.localReplies.push(c);focus.thread.replyCount=(focus.thread.replyCount||0)+1;}
      }else if(!state.roots.some(root=>root.id===c.id)){const root={...c,replies:[],localReplies:[],repliesNextCursor:null};state.roots.unshift(root);state.rootCache.set(c.id,root);state.localRoots.set(c.id,performance.now());}
      state.total=Math.max(state.total,result.commentsCount);
      if(draft.key===submittedKey){Object.assign(draft,{text:'',parentId:null,parentName:'',key:crypto.randomUUID()});persist(key,draft);}
      state.status='评论已发布';
    }catch(error){state.status=error.message;}
    finally{state.pending=false;refresh();}
  });
  function acceptLike(id,result){
    if(result.commentId!==id||typeof result.liked!=='boolean'||!Number.isInteger(result.likesCount)||result.likesCount<0)throw new Error('暂时没有收到点赞结果。');
    state.social.set(id,{liked:result.liked,count:result.likesCount,confirmedAt:performance.now()});
  }
  async function handleCommentClick(event){
    if(!alive())return;
    if(event.target.closest('[data-close-context]')){focus.closed=true;renderContext();list.scrollIntoView({block:'start',behavior:scrollBehavior()});return;}
    if(event.target.closest('[data-focus-retry]')){loadContext();return;}
    const reply=event.target.closest('[data-reply]'),like=event.target.closest('[data-comment-like]'),expand=event.target.closest('[data-more-replies]');
    if(event.target.closest('.comments-retry')){load();return;}
    if(reply){
      if(state.pending)return;const c=state.roots.find(c=>c.id===reply.dataset.reply)||(focus.thread?.id===reply.dataset.reply?focus.thread:null);if(!c)return;
      draft.parentId=c.id;draft.parentName=c.authorName;draft.key=crypto.randomUUID();persist(key,draft);composer();input.focus();form.scrollIntoView({block:'center',behavior:scrollBehavior()});return;
    }
    if(expand){
      const root=state.roots.find(c=>c.id===expand.dataset.moreReplies);if(!root||!root.repliesNextCursor||state.replies.has(root.id))return;
      const requestedAt=performance.now(),cursor=root.repliesNextCursor;state.replies.add(root.id);refresh();
      try{
        const result=await api('/api/comments/'+encodeURIComponent(root.id)+'/replies?cursor='+encodeURIComponent(cursor));
        result.replies.forEach(c=>syncSocial(c,requestedAt));appendReplies(root,result.replies);
        root.replyCount=Math.max(root.replyCount||0,result.replyCount);root.repliesNextCursor=result.nextCursor;
      }catch(error){notice(error.message);}
      finally{state.replies.delete(root.id);refresh();}return;
    }
    if(like){
      const c=all().find(c=>c.id===like.dataset.commentLike);if(!c||state.likes.has(c.id))return;
      const desired=state.retryLikes.has(c.id)?state.retryLikes.get(c.id):!(state.social.get(c.id)?.liked??c.likedByMe);
      state.likes.add(c.id);refresh();
      try{const result=await api('/api/comments/'+encodeURIComponent(c.id)+'/like',{method:'POST',body:{liked:desired}});acceptLike(c.id,result);state.retryLikes.delete(c.id);}
      catch(error){
        let confirmed=false;
        try{const actual=await api('/api/comments/'+encodeURIComponent(c.id)+'/like');acceptLike(c.id,actual);confirmed=actual.liked===desired;}catch{}
        if(confirmed)state.retryLikes.delete(c.id);else{state.retryLikes.set(c.id,desired);notice('点赞暂未确认，点击爱心重试。');}
      }finally{state.likes.delete(c.id);refresh();}
    }
  }
  list.addEventListener('click',handleCommentClick);context.addEventListener('click',handleCommentClick);
  more.addEventListener('click',()=>load(true));refresh();load();loadContext();
}
