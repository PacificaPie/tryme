import {t,getLocale,registerMessages} from './i18n.js';
import {CARD_TEMPLATES,renderPortfolioCard,mountPortfolioCard} from './card-templates.js';
import {avatarMarkup,safeAvatarURL} from './avatars.js';
import {createGalleryBridge} from './gallery/embed.js';
import {loadingMark} from './empty-state.js';
import {closeDialog} from './experience.js?v=20261117-creator-actions';

registerMessages({
  '模板体验':'Template preview','示例名片':'Sample card','示例作品':'Sample works',
  '{name}的示例名片':'{name}’s sample card','使用这个模板':'Use this template',
  '挑一张喜欢的名片，再放入你自己的作品。':'Choose a card you like, then add your own works.',
  '示例作品，制作时可换成你的作品。':'These are sample works. Replace them with your own when creating a card.',
  '查看示例作品':'View sample work','关闭示例作品':'Close sample work','返回模板体验':'Back to template preview',
  '暂时无法使用这个模板，请重试。':'Could not select this template. Please retry.',
  '正在加载 3D 名片…':'Loading 3D card…','重新加载 3D':'Reload 3D',
  '3D 名片加载超时，请重试。':'The 3D card took too long to load. Try again.',
  '当前浏览器暂未显示 3D，作品列表仍可查看。':'3D is unavailable in this browser. The works are still available below.',
  '弧线投篮 · 演示':'Arc hoops · Demo','点亮九宫格 · 演示':'Nine lights · Demo','潮汐记忆 · 演示':'Memory tide · Demo',
  '调整抛物线的角度与力度，在五次机会中尽可能多投进篮筐。':'Adjust the angle and power. Score as many baskets as you can in five shots.',
  '翻转相邻方格，让九格同时亮起。':'Flip neighboring squares until all nine light up.',
  '翻开十二张卡片，配对六种海边图案。':'Turn over twelve cards and match six seaside pairs.',
});

const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
// Curated, bundled examples: no work IDs, signed-in APIs or uploaded content.
const samples=Object.freeze([
  {id:'arc-hoops',name:'弧线投篮 · 演示',desc:'调整抛物线的角度与力度，在五次机会中尽可能多投进篮筐。',coverUrl:'/examples/arc-hoops.png'},
  {id:'tiles',name:'点亮九宫格 · 演示',desc:'翻转相邻方格，让九格同时亮起。',coverUrl:'/examples/tiles.png'},
  {id:'memory-tide',name:'潮汐记忆 · 演示',desc:'翻开十二张卡片，配对六种海边图案。',coverUrl:'/examples/memory-tide.png'},
].map(sample=>Object.freeze(sample)));
const safeSampleCover=value=>samples.some(work=>work.coverUrl===value)?value:'';

export function createTemplateSample(template,user={}){
  const chosen=CARD_TEMPLATES.find(item=>item.id===(typeof template==='string'?template:template?.id));
  if(!chosen)throw new TypeError('Unknown card template');
  const name=typeof user?.name==='string'?user.name.trim().slice(0,80):'';
  return {id:'template-sample-'+chosen.id,authorId:'template-sample',template:chosen.id,
    name:name?t('{name}的示例名片',{name}):t('示例名片'),bio:t('挑一张喜欢的名片，再放入你自己的作品。'),
    headline:t('模板体验'),signature:'',website:'',backStyle:'ink',avatarUrl:safeAvatarURL(user?.avatarUrl),
    works:samples.map(work=>({...work,name:t(work.name),desc:t(work.desc),source:'html',version:t('示例作品')}))};
}

const sampleHref=(card,work)=>'#/cards/templates/'+card.template+'?sample='+encodeURIComponent(work.id);
function sampleTiles(card){
  return `<div class="work-grid">${card.works.map(work=>`<article class="work-tile"><a class="work-entry" data-card-work="${work.id}" href="${escape(sampleHref(card,work))}"><div class="cover"><img src="${work.coverUrl}" alt="${escape(work.name)}" loading="lazy"><span class="cover-action" aria-hidden="true">${t('查看示例作品')} ↗</span></div><div class="tile-info"><h3 class="tile-title">${escape(work.name)}</h3><p class="tile-desc">${escape(work.desc)}</p></div></a></article>`).join('')}</div>`;
}
export function renderTemplateSample(card){
  if(['fold','collection'].includes(card.template))return `<section class="card-preview template-experience-3d"><div class="gallery-load-status" role="status" aria-live="polite"></div><iframe class="gallery-frame" data-template-frame src="/${card.template==='fold'?'gallery':'collection'}/?lang=${getLocale()}" title="${escape(t('示例名片')+' · '+t(CARD_TEMPLATES.find(item=>item.id===card.template).name))}" loading="eager"></iframe><div class="template-experience-fallback" hidden><h2>${t('示例作品')}</h2>${sampleTiles(card)}</div></section>`;
  if(['editorial','filmstrip'].includes(card.template))return renderPortfolioCard(card,{profile:card,safeCover:safeSampleCover,workHref:work=>sampleHref(card,work),from:'/cards/templates/'+card.template});
  return `<div class="card-preview"><article class="white-card"><header>${card.avatarUrl?avatarMarkup(card,{className:'card-profile-avatar'}):''}<h2>${escape(card.name)}</h2><p class="card-headline">${t('模板体验')}</p><p class="bio">${escape(card.bio)}</p></header>${sampleTiles(card)}</article></div>`;
}

export function mountTemplateExperience(root,{template,user,onUse=()=>{},onBack}={}){
  const card=createTemplateSample(template,user),chosen=CARD_TEMPLATES.find(item=>item.id===card.template);
  let disposed=false,bridge=null,modal=null,closing=false,using=false,lastFocused=null,view={open:false,face:'front',inside:false,page:0,yaw:0,focusWorkId:null};
  root.innerHTML=`<div class="template-experience-shell"><a class="back" data-template-back href="#/cards">← ${t('返回名片')}</a><header class="template-experience-head"><div><p class="template-experience-eyebrow">${t('模板体验')}</p><h1>${escape(t(chosen.name))}</h1><p class="template-experience-description">${escape(t(chosen.description))}</p></div><button type="button" class="button primary" data-use-template>${t('使用这个模板')}</button></header><p class="template-experience-note">${t('示例作品，制作时可换成你的作品。')}</p><p class="template-experience-error error" role="alert"></p>${renderTemplateSample(card)}</div>`;
  const shell=root.querySelector('.template-experience-shell'),frame=root.querySelector('[data-template-frame]'),useButton=root.querySelector('[data-use-template]'),error=root.querySelector('.template-experience-error');
  const alive=()=>!disposed&&shell.isConnected;
  const knownWork=id=>card.works.find(work=>work.id===id);
  function closeSample(){if(!modal?.open||closing)return;closing=true;void closeDialog(modal);}
  function openSample(id){
    const work=knownWork(id);if(!alive()||!work||closing)return;
    if(!modal){
      modal=document.createElement('dialog');modal.className='template-sample-dialog';modal.setAttribute('aria-labelledby','template-sample-title');
      modal.addEventListener('cancel',event=>{event.preventDefault();closeSample();});
      modal.addEventListener('click',event=>{
        if(event.target.closest('[data-close-sample]')){closeSample();return;}
        if(event.target!==modal)return;const b=modal.getBoundingClientRect();
        if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)closeSample();
      });
      modal.addEventListener('close',()=>{closing=false;if(!disposed&&lastFocused?.isConnected)lastFocused.focus({preventScroll:true});});
      document.body.append(modal);
    }
    if(!modal.open)lastFocused=document.activeElement;
    modal.innerHTML=`<button type="button" class="template-sample-close" data-close-sample aria-label="${t('关闭示例作品')}">×</button><div class="template-sample-art"><img src="${work.coverUrl}" alt="${escape(work.name)}"></div><div class="template-sample-copy"><p class="template-experience-eyebrow">${t('示例作品')}</p><h2 id="template-sample-title">${escape(work.name)}</h2><p>${escape(work.desc)}</p><p class="template-sample-note">${t('示例作品，制作时可换成你的作品。')}</p><button type="button" class="button" data-close-sample>${t('返回模板体验')}</button></div>`;
    if(!modal.open)modal.showModal();modal.querySelector('[data-close-sample]').focus();
  }
  const sampleLinks=new Map(card.works.map(work=>[sampleHref(card,work),work.id]));
  async function clicked(event){
    if(!alive())return;
    const target=event.target.closest('a,button');if(!target||!root.contains(target))return;
    const id=target.dataset.cardWork||sampleLinks.get(target.getAttribute('href'));
    if(id){event.preventDefault();if(event.type!=='auxclick')openSample(id);return;}
    if(event.type==='auxclick')return;
    if(target.hasAttribute('data-template-back')&&typeof onBack==='function'&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onBack();return;}
    if(target.hasAttribute('data-template-retry')){bridge?.retry();return;}
    if(target!==useButton||using)return;
    using=true;useButton.disabled=true;error.textContent='';
    try{await onUse(chosen.id);}catch{if(alive())error.textContent=t('暂时无法使用这个模板，请重试。');}
    finally{using=false;if(alive())useButton.disabled=false;}
  }
  root.addEventListener('click',clicked);root.addEventListener('auxclick',clicked);
  function received(event){
    if(!alive()||!frame||event.source!==frame.contentWindow||event.origin!==location.origin)return;
    const message=event.data;
    if(message?.type==='funtrack:gallery:open-work')openSample(message.workId);
    else if(message?.type==='funtrack:gallery:resize'&&Number.isFinite(message.height))frame.style.height=Math.max(400,Math.min(1600,Math.ceil(message.height)))+'px';
    else if(message?.type==='funtrack:gallery:state')view={open:message.open===true,face:message.face==='back'?'back':'front',inside:message.inside===true,page:0,yaw:Number.isFinite(message.yaw)?Math.max(-1.3,Math.min(1.3,message.yaw)):0,focusWorkId:knownWork(message.focusWorkId)?.id||null};
  }
  if(frame){
    const status=root.querySelector('.gallery-load-status'),fallback=root.querySelector('.template-experience-fallback');
    window.addEventListener('message',received);
    bridge=createGalleryBridge({frame,isCurrent:alive,payload:()=>({locale:getLocale(),author:{id:card.authorId,name:card.name,bio:card.bio,headline:card.headline,signature:'',website:'',backStyle:card.backStyle,avatarUrl:card.avatarUrl},works:card.works.map(work=>({id:work.id,name:work.name,desc:work.desc,cover:work.coverUrl,kind:t('示例作品'),version:''})),...view}),onStatus:state=>{
      if(!alive())return;const loading=state==='loading',failed=state==='timeout'||state==='fallback';
      frame.setAttribute('aria-busy',String(loading));frame.hidden=failed;frame.style.visibility=loading?'hidden':'';fallback.hidden=!failed;
      status.hidden=state==='rendered'||state==='empty';status.dataset.state=state;
      status.innerHTML=loading?`${loadingMark()}<span>${t('正在加载 3D 名片…')}</span>`:failed?`<span>${t(state==='fallback'?'当前浏览器暂未显示 3D，作品列表仍可查看。':'3D 名片加载超时，请重试。')}</span><button type="button" class="button small" data-template-retry>${t('重新加载 3D')}</button>`:'';
    }});
  }else mountPortfolioCard(root,'template-experience:'+card.template);
  return {dispose(){
    if(disposed)return;disposed=true;bridge?.dispose();window.removeEventListener('message',received);
    root.removeEventListener('click',clicked);root.removeEventListener('auxclick',clicked);
    if(modal){if(modal.open)modal.close();modal.remove();modal=null;}
    // Removing this owned subtree also releases the portfolio reel's local
    // listeners; its queued animation frame checks isConnected before running.
    shell.remove();
  }};
}
