import { mountFeedLayout } from './feed-layout.js';
import { mountFeedImpressions } from './feed-impressions.js';
import { mountVideoPreviews } from './video-preview.js';
import { createFeedMediaRefresh, mergeGeneratedMedia } from './feed-media-refresh.js';
import { emptyState, loadingMark } from './empty-state.js';
import { t, getLocale, registerMessages } from './i18n.js';
import './discovery-messages.js';
import './experience.messages.js';
registerMessages({'先随便逛逛，登录后即可试玩、发布作品和制作名片。':'Explore freely. Sign in to play, publish works, and create your card.'});

// Page-sized server queries; keep the current visit when returning from a work.
const visits = new Map();
export function clearDiscovery(){ visits.clear(); }
export function updateDiscoveryWork(id,patch){for(const visit of visits.values())visit.works=visit.works.map(work=>work.id===id?{...work,...patch}:work);}
export async function mountDiscovery(root, options) {
  const { api, esc, workTile, syncSocial, userId, authorId = '', authorCard = null, worksOnly = false, initial = {}, onQuery, restoreScroll, onSignIn } = options;
  const guest=!userId;
  let query={q:initial.q||'',source:['html','url'].includes(initial.source)?initial.source:'all',sort:['recommended','newest','likes','comments'].includes(initial.sort)?initial.sort:authorId?'newest':'recommended',following:!authorId&&initial.following==='1'?'1':'0'};
  let works=[],cursor=null,total=0,pending=false,loaded=false,error='',request=0,timer,slowTimer,slow=false,controller=null,composing=false,disposed=false;
  let grid=null,layout=null,impressions=null,previews=null,tileState=new Map(),restored=false;
  let mediaPages=[];
  const alive=()=>!disposed&&root.isConnected;
  const cacheKey=()=>JSON.stringify([userId,authorId,query]);
  const mediaRefresh=createFeedMediaRefresh({api,getWorks:()=>works,onMedia:fresh=>{
    if(!alive()||pending)return;
    const byId=new Map(fresh.map(work=>[work.id,work]));let changed=false;
    works=works.map(work=>{
      const tile=tileState.get(work.id)?.element;
      if(tile?.contains?.(document.activeElement)||tile?.classList.contains?.('preview-playing'))return work;
      const next=mergeGeneratedMedia(work,byId.get(work.id));if(next!==work)changed=true;return next;
    });
    if(changed){const cached=visits.get(cacheKey());if(cached)cached.works=[...works];draw();}
  }});
  const resumeMedia=()=>{if(alive())mediaRefresh.wake();};
  document.addEventListener?.('visibilitychange',resumeMedia);
  const authorName=authorCard?.name||t('创作者');
  const sortOptions=[['recommended','推荐'],['newest','最新发布'],['likes','最多点赞'],['comments','最多讨论']];
  const sortLabel=()=>t(sortOptions.find(([id])=>id===query.sort)[1]);
  const chevron='<svg class="sort-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg>';
  const check='<svg class="sort-check" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>';
  const refreshIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M20 12a8 8 0 1 0-2.3 5.7M20 7l-3.4-3.4"/></svg>';
  const searchIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>';
  root.innerHTML=authorId?`<a class="back" href="#/cards">${t('← 名片')}</a><div class="author-heading"><span class="large-avatar" aria-hidden="true">${esc([...authorName][0])}</span><div><h1 id="author-name">${esc(authorName)}</h1>${authorCard?.bio?`<p>${esc(authorCard.bio)}</p>`:''}</div>${authorCard?`<a class="button" href="#/card/${encodeURIComponent(authorCard.id)}">${t('查看名片')}</a>`:''}</div>`:`<div class="feed-heading"><h1>${t('发现作品')}</h1><label class="feed-search">${searchIcon}<input id="work-search" type="search" maxlength="100" placeholder="${esc(t('搜索作品或创作者'))}" aria-label="${esc(t('搜索作品或创作者'))}" value="${esc(query.q)}"></label></div><div class="feed-controls"><div class="filters" aria-label="${esc(t('作品类型'))}">${[['all','全部'],['html','网页游戏'],['url','外链作品']].map(([id,label])=>`<button class="filter ${query.source===id?'active':''}" data-filter="${id}" aria-pressed="${query.source===id}">${t(label)}</button>`).join('')}</div><div class="feed-sort"><details class="feed-sort-menu" data-action-menu><summary id="work-sort" aria-label="${esc(t('作品排序：{sort}',{sort:sortLabel()}))}"><span id="work-sort-label">${esc(sortLabel())}</span>${chevron}</summary><div class="action-menu-panel feed-sort-options" role="group" aria-label="${esc(t('作品排序'))}">${sortOptions.map(([id,label])=>`<button type="button" data-sort="${id}" aria-pressed="${query.sort===id}"><span>${t(label)}</span>${check}</button>`).join('')}</div></details><button type="button" class="feed-refresh" aria-label="${esc(t('刷新作品'))}" title="${esc(t('刷新作品'))}">${refreshIcon}</button></div></div>`;
  if(worksOnly)root.innerHTML='';
  else if(!authorId)root.querySelector('.feed-heading').insertAdjacentHTML('afterend',`<div class="feed-scope" aria-label="${esc(t('作品来源'))}"><button type="button" data-feed-scope="0" aria-pressed="${query.following==='0'}">${t('发现')}</button><button type="button" data-feed-scope="1" aria-pressed="${query.following==='1'}">${t('关注')}</button></div>`);
  if(guest)root.insertAdjacentHTML('beforeend',`<p class="muted guest-feed-note">${t('先随便逛逛，登录后即可试玩、发布作品和制作名片。')}</p>`);
  root.insertAdjacentHTML('beforeend',`<div id="discovery-results"></div><p class="feed-status" role="status" aria-live="polite"></p><div class="feed-pagination"><button class="button" id="load-works" hidden>${t('加载更多')}</button></div>`);
  const results=root.querySelector('#discovery-results'),status=root.querySelector('.feed-status'),more=root.querySelector('#load-works');
  function resetLayout(){previews?.dispose();previews=null;impressions?.dispose();impressions=null;layout?.dispose();layout=null;grid=null;tileState.clear();}
  function createTile(work,index){
    const template=document.createElement('template');template.innerHTML=workTile(work,{social:!guest}).trim();
    const tile=template.content.firstElementChild;tile.dataset.workId=work.id;tile.setAttribute('role','listitem');tile.setAttribute('aria-posinset',String(index+1));tile.setAttribute('aria-setsize',String(total));
    if(!restored&&!tileState.has(work.id)){tile.classList.add('feed-arriving');tile.style.setProperty('--enter-index',Math.min(index%12,5));}
    return tile;
  }
  function draw(){
    if(!alive())return;
    results.setAttribute('aria-busy',String(pending));
    const refresh=root.querySelector('.feed-refresh');if(refresh){refresh.disabled=pending&&!slow;refresh.setAttribute('aria-busy',String(pending&&!slow));}
    more.setAttribute('aria-busy',String(pending));
    status.textContent=error||(pending?t(slow?'还在加载，请稍候或重试。':'正在加载作品…'):'');
    status.classList.toggle('skip-label',!error);
    if(!loaded){
      resetLayout();
      if(error)results.innerHTML=`<div class="empty-state"><h2>${t('暂时没能加载作品')}</h2><button class="button" data-retry>${t('重试')}</button></div>`;
      else {
        if(!results.querySelector('.feed-skeleton'))results.innerHTML=`<div class="feed-loading-caption">${loadingMark()}<span class="feed-wait-text"></span><button class="button quiet small" data-retry hidden>${t('重试')}</button></div><div class="store-grid feed-skeleton" aria-hidden="true">${Array.from({length:8},()=>'<div class="skeleton-work"><div></div><span></span></div>').join('')}</div>`;
        results.querySelector('.feed-wait-text').textContent=t(slow?'还在加载，请稍候或重试。':'正在加载作品…');
        results.querySelector('[data-retry]').hidden=!slow;
      }
      more.hidden=true;return;
    }
    if(!works.length){
      resetLayout();const filtered=Boolean(query.q)||query.source!=='all';
      results.innerHTML=emptyState({
        kind:filtered?'search':'works',
        title:t(filtered?'没有找到作品':authorId?'还没有公开作品':query.following==='1'?'关注的人还没有公开作品':'还没有作品'),
        description:!filtered&&query.following==='1'?t('关注创作者后，可以在这里看到他们的作品。'):'',
        action:filtered?`<button class="button primary" data-clear>${t('清除筛选')}</button>`:authorId?'':query.following==='1'?`<a class="button primary" href="#/feed">${t('发现作品')}</a>`:`<a class="button primary" href="#/publish">${t('发布作品')}</a>`,
      });
      more.hidden=true;return;
    }
    if(!grid){
      results.innerHTML=`<div class="catalog-heading">${authorId?`<h2>${t('全部作品')}</h2>`:''}<span class="feed-count"></span></div><div class="store-grid feed-grid" role="list" aria-label="${esc(t('作品列表'))}"></div>`;
      grid=results.querySelector('.feed-grid');
    }
    results.querySelector('.feed-count').textContent=total===1?t('1 件作品'):t('{count} 件作品',{count:total.toLocaleString(getLocale())});
    const nextIds=new Set(works.map(work=>work.id));let changed=false;
    for(const [id,record] of tileState)if(!nextIds.has(id)){record.element.remove();tileState.delete(id);changed=true;}
    works.forEach((work,index)=>{
      const signature=JSON.stringify(work),existing=tileState.get(work.id);let tile=existing?.element;
      if(!tile||existing.signature!==signature){const next=createTile(work,index);if(tile)tile.replaceWith(next);tile=next;tileState.set(work.id,{element:tile,signature});changed=true;}
      tile.setAttribute('aria-posinset',String(index+1));tile.setAttribute('aria-setsize',String(total));
      if(grid.children[index]!==tile){grid.insertBefore(tile,grid.children[index]||null);changed=true;}
    });
    if(!layout)layout=mountFeedLayout(grid,{host:root});else if(changed)layout.refresh();
    if(!previews&&works.some(work=>work.preview))previews=mountVideoPreviews(grid);else if(changed)previews?.refresh();
    if(!guest&&!authorId&&query.following!=='1'){if(!impressions)impressions=mountFeedImpressions(grid,{api,userId,sort:query.sort,host:root});else impressions.refresh();}
    more.hidden=!cursor;more.disabled=pending;more.textContent=t(pending?'正在加载…':error?'重试加载':'加载更多');
  }
  async function load(append=false){
    if(append&&(pending||!cursor))return;
    if(!append){mediaRefresh.reset();mediaPages=[];}
    controller?.abort();controller=new AbortController();clearTimeout(slowTimer);
    const version=++request,requestedAt=performance.now(),key=cacheKey();pending=true;slow=false;error='';draw();
    slowTimer=setTimeout(()=>{if(alive()&&version===request&&pending){slow=true;draw();}},6500);
    const params=new URLSearchParams({...query,limit:'12'});if(authorId)params.set('author',authorId);if(append)params.set('cursor',cursor);
    if(guest)params.delete('following');
    try{
      const data=await api((guest?'/api/public/discover?':'/api/discover?')+params,{signal:controller.signal});if(!alive()||version!==request)return;
      if(!guest)data.works.forEach(work=>syncSocial(work,requestedAt));
      if(append){const ids=new Set(works.map(work=>work.id));works.push(...data.works.filter(work=>!ids.has(work.id)));}else works=data.works;
      cursor=data.nextCursor;total=data.total;loaded=true;
      if(authorId&&!authorCard&&!worksOnly&&works[0]){root.querySelector('#author-name').textContent=works[0].authorName;root.querySelector('.large-avatar').textContent=[...(works[0].authorName||t('创作者'))][0];}
      const mediaURL=(guest?'/api/public/discover?':'/api/discover?')+params;
      mediaPages.push({url:mediaURL,ids:data.works.map(work=>work.id)});mediaRefresh.watch(mediaURL,data.works);
      visits.delete(key);visits.set(key,{works:[...works],cursor,total,mediaPages:[...mediaPages],at:Date.now()});while(visits.size>8)visits.delete(visits.keys().next().value);
    }catch(e){if(alive()&&version===request)error=t(e.message);}
    finally{if(alive()&&version===request){clearTimeout(slowTimer);pending=false;slow=false;draw();}}
  }
  function change(next){
    clearTimeout(timer);restored=false;query={...query,...(search?{q:search.value}:{}),...next};query.q=query.q.trim();onQuery(query);request++;loaded=false;works=[];cursor=null;total=0;pending=false;
    root.querySelectorAll('[data-filter]').forEach(button=>{const selected=button.dataset.filter===query.source;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});load();
  }
  const search=root.querySelector('#work-search');
  const schedule=()=>{if(composing)return;clearTimeout(timer);timer=setTimeout(()=>{if(alive())change({q:search.value});},250);};
  search?.addEventListener('input',schedule);search?.addEventListener('compositionstart',()=>composing=true);search?.addEventListener('compositionend',()=>{composing=false;schedule();});
  const sortMenu=root.querySelector('.feed-sort-menu'),sortTrigger=root.querySelector('#work-sort');
  root.querySelectorAll('[data-sort]').forEach(button=>button.addEventListener('click',()=>{
    sortMenu.open=false;sortTrigger.focus();
    // Reselecting the current order is a dismissal, not another network request.
    if(button.dataset.sort===query.sort)return;
    change({sort:button.dataset.sort});
    root.querySelector('#work-sort-label').textContent=sortLabel();
    sortTrigger.setAttribute('aria-label',t('作品排序：{sort}',{sort:sortLabel()}));
    root.querySelectorAll('[data-sort]').forEach(option=>option.setAttribute('aria-pressed',String(option.dataset.sort===query.sort)));
  }));
  root.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>change({source:button.dataset.filter})));
  root.querySelectorAll('[data-feed-scope]').forEach(button=>button.addEventListener('click',()=>{
    if(guest&&button.dataset.feedScope==='1'){onSignIn?.();return;}
    if(button.dataset.feedScope===query.following)return;
    root.querySelectorAll('[data-feed-scope]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
    change({following:button.dataset.feedScope});
  }));
  root.querySelector('.feed-refresh')?.addEventListener('click',()=>{clearTimeout(timer);if(search&&search.value.trim()!==query.q)change({q:search.value});else load();});
  results.addEventListener('click',event=>{if(event.target.closest('[data-retry]'))load();if(event.target.closest('[data-clear]')){if(search)search.value='';change({q:'',source:'all'});}});
  more.addEventListener('click',()=>load(true));
  const cached=visits.get(cacheKey());
  if(cached){restored=true;works=[...cached.works];cursor=cached.cursor;total=cached.total;mediaPages=[...(cached.mediaPages||[])];loaded=true;if(authorId&&!authorCard&&!worksOnly&&works[0]){root.querySelector('#author-name').textContent=works[0].authorName;root.querySelector('.large-avatar').textContent=[...(works[0].authorName||t('创作者'))][0];}draw();for(const page of mediaPages)mediaRefresh.watch(page.url,works.filter(work=>page.ids.includes(work.id)));requestAnimationFrame(()=>{if(alive())restoreScroll();});}
  // Return disposal immediately, including while the first request is pending.
  else void load();
  return {dispose(){if(disposed)return;disposed=true;request++;controller?.abort();mediaRefresh.dispose();document.removeEventListener?.('visibilitychange',resumeMedia);clearTimeout(timer);clearTimeout(slowTimer);resetLayout();}};
}
