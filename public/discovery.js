import { mountFeedLayout } from './feed-layout.js';
import { emptyState } from './empty-state.js';
import { t, getLocale } from './i18n.js';
import './discovery-messages.js';

// Page-sized server queries; keep the current visit when returning from a work.
const visits = new Map();
export function clearDiscovery(){ visits.clear(); }
export function updateDiscoveryWork(id,patch){for(const visit of visits.values())visit.works=visit.works.map(work=>work.id===id?{...work,...patch}:work);}
export async function mountDiscovery(root, options) {
  const { api, esc, workTile, syncSocial, userId, authorId = '', authorCard = null, initial = {}, onQuery, restoreScroll } = options;
  let query={q:initial.q||'',source:['html','url'].includes(initial.source)?initial.source:'all',sort:['likes','comments'].includes(initial.sort)?initial.sort:'newest'};
  let works=[],cursor=null,total=0,pending=false,loaded=false,error='',request=0,timer,composing=false,disposed=false;
  let grid=null,layout=null,tileState=new Map();
  const alive=()=>!disposed&&root.isConnected;
  const cacheKey=()=>JSON.stringify([userId,authorId,query]);
  const authorName=authorCard?.name||t('创作者');
  const searchIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>';
  root.innerHTML=authorId?`<a class="back" href="#/cards">${t('← 名片')}</a><div class="author-heading"><span class="large-avatar" aria-hidden="true">${esc([...authorName][0])}</span><div><h1 id="author-name">${esc(authorName)}</h1>${authorCard?.bio?`<p>${esc(authorCard.bio)}</p>`:''}</div>${authorCard?`<a class="button" href="#/card/${encodeURIComponent(authorCard.id)}">${t('查看名片')}</a>`:''}</div>`:`<div class="feed-heading"><h1>${t('发现作品')}</h1><label class="feed-search">${searchIcon}<input id="work-search" type="search" maxlength="100" placeholder="${esc(t('搜索作品或创作者'))}" aria-label="${esc(t('搜索作品或创作者'))}" value="${esc(query.q)}"></label></div><div class="feed-controls"><div class="filters" aria-label="${esc(t('作品类型'))}">${[['all','全部'],['html','网页游戏'],['url','外链作品']].map(([id,label])=>`<button class="filter ${query.source===id?'active':''}" data-filter="${id}" aria-pressed="${query.source===id}">${t(label)}</button>`).join('')}</div><div class="feed-sort"><select id="work-sort" aria-label="${esc(t('作品排序'))}">${[['newest','最新发布'],['likes','最多点赞'],['comments','最多讨论']].map(([id,label])=>`<option value="${id}" ${query.sort===id?'selected':''}>${t(label)}</option>`).join('')}</select><button class="feed-refresh" aria-label="${esc(t('刷新作品'))}" title="${esc(t('刷新作品'))}">↻</button></div></div>`;
  root.insertAdjacentHTML('beforeend',`<div id="discovery-results"></div><p class="feed-status" role="status" aria-live="polite"></p><div class="feed-pagination"><button class="button" id="load-works" hidden>${t('加载更多')}</button></div>`);
  const results=root.querySelector('#discovery-results'),status=root.querySelector('.feed-status'),more=root.querySelector('#load-works');
  function resetLayout(){layout?.dispose();layout=null;grid=null;tileState.clear();}
  function createTile(work,index){
    const template=document.createElement('template');template.innerHTML=workTile(work,{social:true}).trim();
    const tile=template.content.firstElementChild;tile.dataset.workId=work.id;tile.setAttribute('role','listitem');tile.setAttribute('aria-posinset',String(index+1));tile.setAttribute('aria-setsize',String(total));return tile;
  }
  function draw(){
    if(!alive())return;
    results.setAttribute('aria-busy',String(pending));
    status.textContent=error||(pending?t('正在加载作品…'):'');
    status.classList.toggle('skip-label',!error);
    if(!loaded){
      resetLayout();
      if(error)results.innerHTML=`<div class="empty-state"><h2>${t('暂时没能加载作品')}</h2><button class="button" data-retry>${t('重试')}</button></div>`;
      else if(!results.querySelector('.feed-skeleton'))results.innerHTML=`<div class="store-grid feed-skeleton" aria-hidden="true">${Array.from({length:8},()=>'<div class="skeleton-work"><div></div><span></span></div>').join('')}</div>`;
      more.hidden=true;return;
    }
    if(!works.length){
      resetLayout();const filtered=Boolean(query.q)||query.source!=='all';
      results.innerHTML=emptyState({
        kind:filtered?'search':'works',
        title:t(filtered?'没有找到作品':authorId?'还没有公开作品':'还没有作品'),
        action:filtered?`<button class="button primary" data-clear>${t('清除筛选')}</button>`:authorId?'':`<a class="button primary" href="#/publish">${t('发布作品')}</a>`,
      });
      more.hidden=true;return;
    }
    if(!grid){
      results.innerHTML=`<div class="catalog-heading">${authorId?`<h2>${t('作品')}</h2>`:''}<span class="feed-count"></span></div><div class="store-grid feed-grid" role="list" aria-label="${esc(t('作品列表'))}"></div>`;
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
    more.hidden=!cursor;more.disabled=pending;more.textContent=t(pending?'正在加载…':error?'重试加载':'加载更多');
  }
  async function load(append=false){
    if(append&&(pending||!cursor))return;
    const version=++request,requestedAt=performance.now(),key=cacheKey();pending=true;error='';draw();
    const params=new URLSearchParams({...query,limit:'12'});if(authorId)params.set('author',authorId);if(append)params.set('cursor',cursor);
    try{
      const data=await api('/api/discover?'+params);if(!alive()||version!==request)return;
      data.works.forEach(work=>syncSocial(work,requestedAt));
      if(append){const ids=new Set(works.map(work=>work.id));works.push(...data.works.filter(work=>!ids.has(work.id)));}else works=data.works;
      cursor=data.nextCursor;total=data.total;loaded=true;
      if(authorId&&!authorCard&&works[0]){root.querySelector('#author-name').textContent=works[0].authorName;root.querySelector('.large-avatar').textContent=[...(works[0].authorName||t('创作者'))][0];}
      visits.delete(key);visits.set(key,{works:[...works],cursor,total,at:Date.now()});while(visits.size>8)visits.delete(visits.keys().next().value);
    }catch(e){if(alive()&&version===request)error=e.message;}
    finally{if(alive()&&version===request){pending=false;draw();}}
  }
  function change(next){
    clearTimeout(timer);query={...query,...(search?{q:search.value}:{}),...next};query.q=query.q.trim();onQuery(query);request++;loaded=false;works=[];cursor=null;total=0;pending=false;
    root.querySelectorAll('[data-filter]').forEach(button=>{const selected=button.dataset.filter===query.source;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});load();
  }
  const search=root.querySelector('#work-search');
  const schedule=()=>{if(composing)return;clearTimeout(timer);timer=setTimeout(()=>{if(alive())change({q:search.value});},250);};
  search?.addEventListener('input',schedule);search?.addEventListener('compositionstart',()=>composing=true);search?.addEventListener('compositionend',()=>{composing=false;schedule();});
  root.querySelector('#work-sort')?.addEventListener('change',event=>change({sort:event.target.value}));
  root.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>change({source:button.dataset.filter})));
  root.querySelector('.feed-refresh')?.addEventListener('click',()=>{clearTimeout(timer);if(search&&search.value.trim()!==query.q)change({q:search.value});else load();});
  results.addEventListener('click',event=>{if(event.target.closest('[data-retry]'))load();if(event.target.closest('[data-clear]')){if(search)search.value='';change({q:'',source:'all'});}});
  more.addEventListener('click',()=>load(true));
  const cached=visits.get(cacheKey());
  if(cached){works=[...cached.works];cursor=cached.cursor;total=cached.total;loaded=true;if(authorId&&!authorCard&&works[0]){root.querySelector('#author-name').textContent=works[0].authorName;root.querySelector('.large-avatar').textContent=[...(works[0].authorName||t('创作者'))][0];}draw();requestAnimationFrame(()=>{if(alive())restoreScroll();});}
  else await load();
  return {dispose(){disposed=true;request++;clearTimeout(timer);resetLayout();}};
}
