import {t,registerMessages} from './i18n.js';
import {avatarMarkup} from './avatars.js';
registerMessages({
  '创作者名片':'Creator card','作品':'Work','内容类型':'Content type','全部内容':'All content','只看作品':'Works','只看名片':'Creator cards',
  '{count} 项内容':'{count} items','发现内容':'Discover','发现内容列表':'Discovery list','打开名片':'Open card','{count} 件精选作品':'{count} selected works',
  '名片按收录时间排序，每位作者展示一张。':'Cards are ordered by listing time, with one card per creator.',
  '发现作品，也认识背后的创作者。':'Discover works and meet the people behind them.',
  '最多点赞（作品）':'Most liked (works)','最多讨论（作品）':'Most discussed (works)',
  '没有找到内容':'No matching content','还没有公开内容':'No public content yet',
  '关注的人还没有公开内容':'No public content from followed creators yet',
  '名片在 Feed 中的展示':'Card discovery in Feed',
  '正在读取展示设置…':'Loading discovery settings…',
  '允许在 Feed 中推荐这张名片':'Include this card in Feed',
  '从 Feed 撤回这张名片':'Remove this card from Feed',
  '分享链接不会自动让名片进入 Feed。每位作者只展示一张，选择这张会替换之前的选择。':'A share link does not list your card in Feed. Each creator can list one card; choosing this card replaces your previous selection.',
  '已选择这张名片，全部精选作品可被发现时才会展示。':'This card is selected. It appears only while all selected works are discoverable.',
  '这张名片未加入 Feed。':'This card is not listed in Feed.',
  '已加入 Feed':'Listed in Feed','已从 Feed 撤回':'Removed from Feed',
  '名片展示状态已变化，请刷新后重试。':'Card discovery changed. Refresh and try again.',
});
export const feedItemKey=item=>(item.type==='card'?'card:':'work:')+item.id;
export function feedCardTile(card,{esc}){
  const safeCover=value=>/^\/api\/public\/discover\/cards\/[A-Za-z0-9_-]+\/works\/[A-Za-z0-9_-]+\/cover$/.test(value||'')?value:'';
  return `<article class="work-tile feed-card-tile"><a class="feed-card-entry" href="/c/${encodeURIComponent(card.id)}" aria-label="${esc(t('打开名片'))} · ${esc(card.name)}"><span class="feed-kind">${t('创作者名片')}</span><div class="feed-card-identity">${avatarMarkup(card,{className:'feed-card-avatar'})}<h3 class="tile-title">${esc(card.name)}</h3>${card.headline?`<p>${esc(card.headline)}</p>`:''}</div>${card.bio?`<p class="feed-card-bio">${esc(card.bio)}</p>`:''}<div class="feed-card-works">${card.works.slice(0,3).map(work=>`<div>${safeCover(work.coverUrl)?`<img src="${esc(work.coverUrl)}" alt="" loading="lazy">`:'<span class="feed-card-work-placeholder" aria-hidden="true">↗</span>'}<span>${esc(work.name)}<small>${esc(work.version)}</small></span></div>`).join('')}</div><div class="feed-card-footer"><span>${t('{count} 件精选作品',{count:card.works.length})}</span><strong>${t('打开名片')} ↗</strong></div></a></article>`;
}

export function mountCardDiscovery(root,{api,cardId,onChange=()=>{}}){
  let disposed=false,pending=false,state=null;const controller=new AbortController();
  const alive=()=>!disposed&&root.isConnected;
  const url='/api/cards/'+encodeURIComponent(cardId)+'/discovery';
  root.innerHTML=`<h2>${t('名片在 Feed 中的展示')}</h2><p>${t('分享链接不会自动让名片进入 Feed。每位作者只展示一张，选择这张会替换之前的选择。')}</p><p data-card-feed-state role="status">${t('正在读取展示设置…')}</p><button type="button" class="button" data-card-feed-choice hidden></button><p class="error" data-card-feed-error role="alert"></p>`;
  const button=root.querySelector('[data-card-feed-choice]'),status=root.querySelector('[data-card-feed-state]'),error=root.querySelector('[data-card-feed-error]');
  function draw(){if(!alive())return;button.hidden=false;button.disabled=pending;button.textContent=t(state?.listed?'从 Feed 撤回这张名片':'允许在 Feed 中推荐这张名片');status.textContent=t(state?.listed?'已选择这张名片，全部精选作品可被发现时才会展示。':'这张名片未加入 Feed。');}
  async function read(){try{const result=await api(url,{signal:controller.signal});if(alive()){state=result.discovery;draw();}}catch(e){if(alive()){status.textContent='';error.textContent=t(e.message);button.hidden=false;button.textContent=t('重试');}}}
  button.addEventListener('click',async()=>{
    if(pending)return;if(!state){void read();return;}pending=true;error.textContent='';draw();
    try{const result=await api(url,{method:'PATCH',body:{listed:!state.listed,expectedRevision:state.revision},signal:controller.signal});if(alive()){state=result.discovery;onChange();}}
    catch(e){if(alive()){error.textContent=t(e.message);await read();}}
    finally{pending=false;if(alive())draw();}
  });
  void read();return {dispose(){disposed=true;controller.abort();}};
}
