import { t, registerMessages } from './i18n.js';
import {avatarMarkup} from './avatars.js';

registerMessages({
  '创作者名片': 'Creator cards', '制作名片': 'Create a card', '我的已保存名片': 'My saved card',
  '制作步骤': 'Card steps', '选作品': 'Choose works', '选模板': 'Choose a layout', '生成名片': 'Generate card',
  '作品顺序': 'Work order', '调整作品顺序': 'Arrange works', '已选 {count} 件': '{count} selected',
  '你的名片': 'Your card', '返回名片': 'Back to cards', '保存并分享': 'Save and share',
  '灯城名片':'Lit city','作品点亮一座城，翻面认识你':'A city of works, your identity on the back',
  '作品手记': 'Field notes', '代表作与创作故事': 'A lead work and its story',
  '放映册': 'Screening room', '逐件看作品': 'One work at a time',
  '上一件作品': 'Previous work', '下一件作品': 'Next work', '作品目录': 'Work index',
  '查看': 'View', '查看作品': 'View work', '第 {current} 件，共 {total} 件': 'Work {current} of {total}',
  '选择作品 {name}': 'Select work {name}', '在名片中查看 {name}': 'Show {name} in this card',
});

export const CARD_TEMPLATES = Object.freeze([
  { id:'wall', name:'白墙画展', description:'平铺浏览作品' },
  { id:'fold', name:'卡中展厅', description:'展开名片，进入展厅' },
  { id:'city', name:'灯城名片', description:'作品点亮一座城，翻面认识你' },
  { id:'collection', name:'点亮收藏', description:'桌面卡片，轻触试玩' },
  { id:'editorial', name:'作品手记', description:'代表作与创作故事' },
  { id:'filmstrip', name:'放映册', description:'逐件看作品' },
]);

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderPortfolioCard(card, { profile, safeCover, workHref, from, cardId='' }) {
  if (!['editorial','filmstrip'].includes(card.template)) return '';
  const href = work => escape(workHref(work, from, cardId));
  const image = work => {
    const src=safeCover(work.coverUrl);
    return src ? `<img src="${escape(src)}" alt="${escape(work.name)}" loading="lazy">` : `<span class="portfolio-placeholder">${escape(work.name)}</span>`;
  };
  const header = `<header class="portfolio-header"><div>${card.avatarUrl?avatarMarkup(card,{className:'card-profile-avatar'}):''}<h2>${escape(card.name)}</h2>${profile.headline?`<p class="portfolio-role">${escape(profile.headline)}</p>`:''}</div><div class="portfolio-intro">${card.bio?`<p>${escape(card.bio)}</p>`:''}${profile.website?`<a class="profile-website" href="${escape(profile.website)}" target="_blank" rel="noopener noreferrer">${escape(new URL(profile.website).hostname)} ↗</a>`:''}</div></header>`;
  const footer = profile.signature?`<footer class="portfolio-signature">${escape(profile.signature)}</footer>`:'';
  const works=card.works || [];
  if (card.template==='editorial') {
    return `<div class="card-preview portfolio-preview"><article class="portfolio-card portfolio-editorial">${header}<div class="portfolio-stories">${works.map((work,index)=>`<a class="portfolio-story ${index===0?'portfolio-lead':''}" data-card-work="${escape(work.id)}" href="${href(work)}"><div class="portfolio-story-art">${image(work)}</div><div class="portfolio-story-copy"><span class="portfolio-index" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><h3>${escape(work.name)}</h3>${work.desc?`<p>${escape(work.desc)}</p>`:''}<span class="portfolio-work-link">${t('查看作品')} <span aria-hidden="true">↗</span></span></div></a>`).join('')}</div>${footer}</article></div>`;
  }
  return `<div class="card-preview portfolio-preview"><article class="portfolio-card portfolio-filmstrip">${header}<section class="portfolio-reel" aria-label="${t('放映册')}"><div class="reel-track" tabindex="0" aria-label="${t('逐件看作品')}">${works.map((work,index)=>`<article class="reel-slide" data-reel-index="${index}"><a class="reel-art" data-card-work="${escape(work.id)}" href="${href(work)}" aria-label="${escape(t('查看')+' '+work.name)}">${image(work)}</a><div class="reel-caption"><div><h3><a href="${href(work)}">${escape(work.name)}</a></h3>${work.desc?`<p>${escape(work.desc)}</p>`:''}</div><span class="reel-number" aria-hidden="true">${String(index+1).padStart(2,'0')} / ${String(works.length).padStart(2,'0')}</span></div></article>`).join('')}</div>${works.length>1?`<div class="reel-controls"><button type="button" class="reel-arrow" data-reel-prev aria-label="${t('上一件作品')}">←</button><p class="reel-status" aria-live="polite" aria-atomic="true">${t('第 {current} 件，共 {total} 件',{current:1,total:works.length})}</p><button type="button" class="reel-arrow" data-reel-next aria-label="${t('下一件作品')}">→</button></div><nav class="reel-index" aria-label="${t('作品目录')}">${works.map((work,index)=>`<button type="button" data-reel-go="${index}" aria-label="${escape(t('在名片中查看 {name}',{name:work.name}))}" aria-pressed="${index===0}">${image(work)}</button>`).join('')}</nav>`:''}</section>${footer}</article></div>`;
}

const reelPositions = new Map();
export function mountPortfolioCard(root, key) {
  const track=root?.querySelector('.reel-track');
  if (!track) return;
  const slides=[...track.querySelectorAll('.reel-slide')],previous=root.querySelector('[data-reel-prev]'),next=root.querySelector('[data-reel-next]'),status=root.querySelector('.reel-status'),choices=[...root.querySelectorAll('[data-reel-go]')];
  let current=Math.max(0,Math.min(slides.length-1,reelPositions.get(key)||0)),destination=null;
  const paint=()=>{
    reelPositions.set(key,current);
    while(reelPositions.size>80)reelPositions.delete(reelPositions.keys().next().value);
    if(previous)previous.disabled=current===0;
    if(next)next.disabled=current===slides.length-1;
    if(status)status.textContent=t('第 {current} 件，共 {total} 件',{current:current+1,total:slides.length});
    choices.forEach((button,index)=>button.setAttribute('aria-pressed',String(index===current)));
  };
  const move=(index,animate=true)=>{
    current=Math.max(0,Math.min(slides.length-1,index));paint();
    const x=slides[current].offsetLeft-slides[0].offsetLeft;
    const smooth=animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
    destination=smooth?x:null;
    track.scrollTo({left:x,behavior:smooth?'smooth':'instant'});
  };
  previous?.addEventListener('click',()=>move(current-1));next?.addEventListener('click',()=>move(current+1));
  choices.forEach(button=>button.addEventListener('click',()=>move(Number(button.dataset.reelGo))));
  track.addEventListener('keydown',event=>{
    if(event.target!==track)return;
    const destinations={ArrowLeft:current-1,ArrowRight:current+1,Home:0,End:slides.length-1};
    if(Object.hasOwn(destinations,event.key)){event.preventDefault();move(destinations[event.key]);}
  });
  // Intermediate smooth-scroll events must not turn a rapid Next, Next into
  // two requests for the same slide or repeatedly announce changing positions.
  const syncScroll=()=>{
    if(destination!==null){if(Math.abs(track.scrollLeft-destination)>1)return;destination=null;}
    const index=Math.round(track.scrollLeft/Math.max(1,track.clientWidth));
    if(index!==current){current=Math.max(0,Math.min(slides.length-1,index));paint();}
  };
  track.addEventListener('scroll',syncScroll,{passive:true});
  track.addEventListener('scrollend',()=>{destination=null;syncScroll();},{passive:true});
  for(const type of ['pointerdown','touchstart','wheel'])track.addEventListener(type,()=>{destination=null;syncScroll();},{passive:true});
  requestAnimationFrame(()=>{if(track.isConnected&&slides.length)move(current,false);});
}
