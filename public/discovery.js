// Page-sized server queries; keep the current visit when returning from a work.
const visits = new Map();
export function clearDiscovery(){ visits.clear(); }
export function updateDiscoveryWork(id,patch){for(const visit of visits.values())visit.works=visit.works.map(work=>work.id===id?{...work,...patch}:work);}
export async function mountDiscovery(root, options) {
  const { api, esc, workTile, syncSocial, userId, authorId = '', authorCard = null, initial, onQuery, restoreScroll } = options;
  let query={q:initial.q||'',source:['html','url'].includes(initial.source)?initial.source:'all',sort:['likes','comments'].includes(initial.sort)?initial.sort:'newest'};
  let works=[],cursor=null,total=0,pending=false,loaded=false,error='',request=0,timer,composing=false;
  const alive=()=>root.isConnected;
  const cacheKey=()=>JSON.stringify([userId,authorId,query]);
  const authorName=authorCard?.name||'创作者';
  const searchIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>';
  root.innerHTML=authorId?`<a class="back" href="#/cards">← 名片</a><div class="author-heading"><span class="large-avatar" aria-hidden="true">${esc([...authorName][0])}</span><div><h1 id="author-name">${esc(authorName)}</h1>${authorCard?.bio?`<p>${esc(authorCard.bio)}</p>`:''}</div>${authorCard?`<a class="button" href="#/card/${encodeURIComponent(authorCard.id)}">查看名片</a>`:''}</div>`:`<div class="feed-heading"><h1>发现作品</h1><label class="feed-search">${searchIcon}<input id="work-search" type="search" maxlength="100" placeholder="搜索作品或创作者" aria-label="搜索作品或创作者" value="${esc(query.q)}"></label></div><div class="feed-controls"><div class="filters" aria-label="作品类型">${[['all','全部'],['html','网页游戏'],['url','外链作品']].map(([id,label])=>`<button class="filter ${query.source===id?'active':''}" data-filter="${id}" aria-pressed="${query.source===id}">${label}</button>`).join('')}</div><div class="feed-sort"><select id="work-sort" aria-label="作品排序">${[['newest','最新发布'],['likes','最多点赞'],['comments','最多讨论']].map(([id,label])=>`<option value="${id}" ${query.sort===id?'selected':''}>${label}</option>`).join('')}</select><button class="feed-refresh" aria-label="刷新作品" title="刷新作品">↻</button></div></div>`;
  root.insertAdjacentHTML('beforeend','<div id="discovery-results"></div><p class="feed-status" role="status" aria-live="polite"></p><div class="feed-pagination"><button class="button" id="load-works" hidden>加载更多</button></div>');
  const results=root.querySelector('#discovery-results'),status=root.querySelector('.feed-status'),more=root.querySelector('#load-works');
  function draw(){
    if(!alive())return;
    results.setAttribute('aria-busy',String(pending));status.textContent=error;
    if(!loaded){results.innerHTML=error?'<div class="empty-state"><h2>暂时没能加载作品</h2><button class="button" data-retry>重试</button></div>':`<div class="store-grid skeleton-grid" aria-hidden="true">${Array.from({length:6},()=>'<div class="skeleton-work"><div></div><span></span><small></small></div>').join('')}</div>`;more.hidden=true;return;}
    if(!works.length){results.innerHTML=`<div class="empty-state"><h2>${query.q||query.source!=='all'?'没有找到作品':'还没有作品'}</h2>${query.q||query.source!=='all'?'<button class="button" data-clear>清除筛选</button>':authorId?'':'<a class="button primary" href="#/publish">发布作品</a>'}</div>`;more.hidden=true;return;}
    results.innerHTML=`<div class="catalog-heading">${authorId?'<h2>作品</h2>':''}<span>${total.toLocaleString('zh-CN')} 件作品</span></div><div class="store-grid">${works.map(w=>workTile(w,{social:true})).join('')}</div>`;
    more.hidden=!cursor;more.disabled=pending;more.textContent=pending?'正在加载…':error?'重试加载':'加载更多';
  }
  async function load(append=false){
    if(append&&(pending||!cursor))return;
    const version=++request,requestedAt=performance.now(),key=cacheKey();pending=true;error='';draw();
    const params=new URLSearchParams({...query,limit:'12'});if(authorId)params.set('author',authorId);if(append)params.set('cursor',cursor);
    try{
      const data=await api('/api/discover?'+params);if(!alive()||version!==request)return;
      data.works.forEach(w=>syncSocial(w,requestedAt));
      if(append){const ids=new Set(works.map(w=>w.id));works.push(...data.works.filter(w=>!ids.has(w.id)));}else works=data.works;
      cursor=data.nextCursor;total=data.total;loaded=true;
      if(authorId&&!authorCard&&works[0]){root.querySelector('#author-name').textContent=works[0].authorName;root.querySelector('.large-avatar').textContent=[...(works[0].authorName||'创作者')][0];}
      visits.delete(key);visits.set(key,{works:[...works],cursor,total,at:Date.now()});while(visits.size>8)visits.delete(visits.keys().next().value);
    }catch(e){if(alive()&&version===request)error=e.message;}
    finally{if(alive()&&version===request){pending=false;draw();}}
  }
  function change(next){
    clearTimeout(timer);query={...query,...(search?{q:search.value}:{}),...next};query.q=query.q.trim();onQuery(query);request++;loaded=false;works=[];cursor=null;total=0;pending=false;
    root.querySelectorAll('[data-filter]').forEach(b=>{const selected=b.dataset.filter===query.source;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});load();
  }
  const search=root.querySelector('#work-search');
  const schedule=()=>{if(composing)return;clearTimeout(timer);timer=setTimeout(()=>{if(alive())change({q:search.value});},250);};
  search?.addEventListener('input',schedule);search?.addEventListener('compositionstart',()=>composing=true);search?.addEventListener('compositionend',()=>{composing=false;schedule();});
  root.querySelector('#work-sort')?.addEventListener('change',e=>change({sort:e.target.value}));
  root.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>change({source:b.dataset.filter})));
  root.querySelector('.feed-refresh')?.addEventListener('click',()=>{clearTimeout(timer);if(search&&search.value.trim()!==query.q)change({q:search.value});else load();});
  results.addEventListener('click',e=>{if(e.target.closest('[data-retry]'))load();if(e.target.closest('[data-clear]')){if(search)search.value='';change({q:'',source:'all'});}});
  more.addEventListener('click',()=>load(true));
  const cached=visits.get(cacheKey());
  if(cached){works=cached.works;cursor=cached.cursor;total=cached.total;loaded=true;if(authorId&&!authorCard&&works[0]){root.querySelector('#author-name').textContent=works[0].authorName;root.querySelector('.large-avatar').textContent=[...(works[0].authorName||'创作者')][0];}draw();requestAnimationFrame(()=>{if(alive())restoreScroll();});}
  else await load();
}
