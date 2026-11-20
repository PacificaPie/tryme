import {t,registerMessages,localeNumber} from './i18n.js';
import {CARD_TEMPLATES} from './card-templates.js';
import {creatorCardPreview} from './creator-home.js';

registerMessages({
  '名片':'Cards', '更新名片':'Update card',
  '用自己的作品，做一张有你风格的名片。':'Make a card that feels like you, with your own works.',
  '当前名片':'Current card',
  '这是你已保存的名片，可以查看、分享或重新制作。':'Your saved card is ready to view, share or remake.',
  '查看名片':'View card','分享名片':'Share card','重新制作':'Make a new card','删除名片':'Delete card',
  '名片操作':'Card actions',
  '制作你的第一张名片':'Make your first card',
  '选几件自己的作品，配上喜欢的模板。保存后，你的名片就会出现在这里。':'Choose some of your own works and a template you like. Your card will appear here once saved.',
  '制作名片':'Create a card','继续草稿':'Continue draft','发布作品':'Publish work',
  '你有一份未完成的名片草稿。':'You have an unfinished card draft.',
  '继续你的草稿':'Continue your draft',
  '制作中的草稿不会改变这张已保存的名片。':'Your draft does not change this saved card.',
  '探索模板':'Explore templates',
  '先体验，再用自己的作品制作。':'Try a template, then make it yours with your own works.',
  '体验模板':'Try template','体验 {name} 模板':'Try the {name} template',
  '白墙画展':'White wall','平铺浏览作品':'An open collection of your works',
  '卡中展厅':'Gallery card','展开名片，进入展厅':'Unfold your card into a gallery',
  '点亮收藏':'Desk collection','桌面卡片，轻触试玩':'A desk of cards, ready to play',
  '名片中有 {count} 件作品':'{count} works in this card',
  '看看我在 TryMe 制作的名片吧！':'Take a look at the card I made on TryMe!',
});

const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const arrow='<span aria-hidden="true">↗</span>';

// Decorative sketches communicate the layouts without embedding an
// interactive card or displaying someone else's identity or works.
const sketches={
  wall:'<span class="card-workspace-sketch-paper"><i class="card-workspace-sketch-title"></i><span class="card-workspace-sketch-wall">'+Array.from({length:6},()=>'<i></i>').join('')+'</span></span>',
  fold:'<span class="card-workspace-sketch-room"><span class="card-workspace-sketch-room-side"><i></i></span><span class="card-workspace-sketch-room-back"><i></i><i></i></span><span class="card-workspace-sketch-room-floor"></span></span>',
  city:'<span class="card-workspace-sketch-city"><i></i><i></i><i></i><i></i><i></i><i></i></span>',
  collection:'<span class="card-workspace-sketch-stack"><i></i><i></i><i></i><span class="card-workspace-sketch-glow"></span></span>',
  editorial:'<span class="card-workspace-sketch-paper"><i class="card-workspace-sketch-title"></i><span class="card-workspace-sketch-story"><i></i><span><b></b><b></b><b></b></span></span><span class="card-workspace-sketch-notes"><i></i><i></i></span></span>',
  filmstrip:'<span class="card-workspace-sketch-reel"><i></i><i></i><i></i></span><span class="card-workspace-sketch-dots"><i></i><i></i><i></i></span>',
};

function templateCatalog(esc){
  return `<section class="card-workspace-templates" aria-labelledby="card-workspace-templates-title"><header class="card-workspace-section-head"><h2 id="card-workspace-templates-title">${t('探索模板')}</h2><p>${t('先体验，再用自己的作品制作。')}</p></header><ul class="card-workspace-template-grid">${CARD_TEMPLATES.map(template=>`<li class="card-workspace-template"><a class="card-workspace-template-link" href="#/cards/templates/${encodeURIComponent(template.id)}" aria-label="${esc(t('体验 {name} 模板',{name:t(template.name)}))}"><span class="card-workspace-schematic card-workspace-schematic-${template.id}" aria-hidden="true">${sketches[template.id]||''}</span><div class="card-workspace-template-copy"><h3>${esc(t(template.name))}</h3><span class="card-workspace-template-description">${esc(t(template.description))}</span><span class="card-workspace-template-action">${t('体验模板')} ${arrow}</span></div></a></li>`).join('')}</ul></section>`;
}

export function renderCardWorkspace({card,user,esc=escape,safeCover,shareURL='',shareText='',hasDraft=false}={}){
  const ownCard=typeof user?.id==='string'&&Boolean(user.id)&&card?.authorId===user.id&&typeof card.id==='string'&&card.id?card:null;
  let current;
  if(ownCard){
    const href='#/card/'+encodeURIComponent(ownCard.id),template=CARD_TEMPLATES.find(item=>item.id===ownCard.template),count=Array.isArray(ownCard.works)?ownCard.works.length:0;
    const share=shareURL?`<button type="button" class="button" data-share-url="${esc(shareURL)}" data-share-title="${esc(ownCard.name)}" data-share-text="${esc(shareText||t('看看我在 TryMe 制作的名片吧！'))}">${t('分享名片')}</button>`:'';
    current=`<section class="card-workspace-current" aria-labelledby="card-workspace-current-title"><a class="card-workspace-stage" href="${esc(href)}" aria-label="${esc(t('查看名片'))}">${creatorCardPreview(ownCard,{esc,safeCover})}</a><div class="card-workspace-current-copy"><p class="card-workspace-eyebrow">${t('当前名片')}</p><h2 id="card-workspace-current-title">${esc(ownCard.name)}</h2>${ownCard.headline||ownCard.bio?`<p class="card-workspace-card-intro">${esc(ownCard.headline||ownCard.bio)}</p>`:''}<p class="card-workspace-card-meta">${template?esc(t(template.name))+' · ':''}${esc(t('名片中有 {count} 件作品',{count:localeNumber(count)}))}</p><p class="card-workspace-current-note">${t('这是你已保存的名片，可以查看、分享或重新制作。')}</p><div class="card-workspace-actions" role="group" aria-label="${esc(t('名片操作'))}"><a class="button primary" href="${esc(href)}">${t('查看名片')} ${arrow}</a>${share}<a class="button quiet" href="#/cards/me?editCard=${encodeURIComponent(ownCard.id)}">${t('更新名片')}</a><a class="button quiet" href="#/cards/covers/${encodeURIComponent(ownCard.id)}">${t('更新名片封面')}</a><button type="button" class="button quiet danger-text" data-delete-card="${esc(ownCard.id)}" data-card-name="${esc(ownCard.name)}">${t('删除名片')}</button></div>${hasDraft?`<aside class="card-workspace-draft"><div><strong>${t('继续你的草稿')}</strong><p>${t('制作中的草稿不会改变这张已保存的名片。')}</p></div><a class="text-link" href="#/cards/me">${t('继续草稿')}</a></aside>`:''}</div></section>`;
  }else{
    current=`<section class="card-workspace-current card-workspace-empty" aria-labelledby="card-workspace-current-title"><div class="card-workspace-stage" aria-hidden="true"><span class="card-workspace-blank-card"><span>TRYME</span><i></i><i></i><b>＋</b></span></div><div class="card-workspace-current-copy"><h2 id="card-workspace-current-title">${t('制作你的第一张名片')}</h2><p class="card-workspace-empty-description">${t('选几件自己的作品，配上喜欢的模板。保存后，你的名片就会出现在这里。')}</p>${hasDraft?`<p class="card-workspace-draft-note">${t('你有一份未完成的名片草稿。')}</p>`:''}<div class="card-workspace-actions"><a class="button primary" href="#/cards/me">${t(hasDraft?'继续草稿':'制作名片')} ${arrow}</a><a class="button quiet" href="#/publish">${t('发布作品')}</a></div></div></section>`;
  }
  return `<header class="card-workspace-heading"><h1>${t('名片')}</h1><p>${t('用自己的作品，做一张有你风格的名片。')}</p></header>${current}${templateCatalog(esc)}`;
}
