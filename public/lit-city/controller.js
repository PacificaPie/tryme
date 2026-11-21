import {cleanCityCard,cityView,PAGE_SIZE} from './data.js';
import {createCityPlayer} from './player.js';
import {createCityTheme} from './theme.js';
import {THEME_CHANGE_EVENT} from '../theme.js';
const $=id=>document.getElementById(id),SP=window.SP,blueprints=structuredClone(SP.CFG.WORKS);
document.body.dataset.cityPhase='waiting';
const C=SP.CFG;C.OWNER={name:'',latin:'',line:''};
// Use the opening's settled front, centered within a card instead of beside a headline.
C.CAM.cx=C.CAM.cxP=[[0,.5]];C.CAM.cy=C.CAM.cyP=[[0,.53]];
C.CAM.fill=[[0,.72],[5.4,.78],[8.2,.78],[12.6,.90]];
C.CAM.fillP=[[0,.80],[5.4,.84],[8.2,.84],[12.6,.90]];
C.CAM.phiP=[[0,.46],[1.4,.46],[5.2,.60,'eio'],[8.2,.60],[12.6,1.12,'eio']];
C.CAM.city={...C.CAM.city,cx:.5,fill:.82,fillP:.84};
// The shared theme module owns system/storage listeners for this document.
const applyTheme=createCityTheme(SP);
let theme=document.documentElement.dataset.theme;applyTheme(theme);
let data=null,view={page:0,face:'front',focusWorkId:null},player=null,failed=false,disposed=false,presented=false,key='',requestId=null,lastHeight=0,en=false;
const documentId=crypto.randomUUID(),listeners=[],send=message=>{if(parent!==window)parent.postMessage(message,location.origin);};
const say=(zh,english)=>en?english:zh;
function listen(node,type,fn){node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));}
const current=()=>data.works.slice(view.page*PAGE_SIZE,(view.page+1)*PAGE_SIZE);
function state(){send({type:'funtrack:gallery:state',...view,pageSize:PAGE_SIZE,open:true,inside:false,yaw:0});}
function height(){const h=Math.ceil($('shell').getBoundingClientRect().height);if(h>0&&h!==lastHeight){lastHeight=h;send({type:'funtrack:gallery:resize',height:h});}}
function openWork(id){if(!data.works.some(w=>w.id===id))return;view.focusWorkId=id;state();send({type:'funtrack:gallery:open-work',workId:id,play:true});}
function profile(){
  const a=data.author;for(const id of ['name','headline','bio','signature']){$(id).textContent=a[id];$(id).hidden=!a[id];}
  for(const field of ['name','headline']){$('front-'+field).textContent=a[field];$('front-'+field).hidden=!a[field];}
  C.OWNER={name:a.name,latin:'',line:a.headline||a.signature};
  $('avatar').hidden=!a.avatarUrl;if(a.avatarUrl)$('avatar').src=a.avatarUrl;
  $('website').hidden=!a.website;if(a.website){$('website').href=a.website;$('website').textContent=new URL(a.website).hostname+' ↗';}
  $('back').className='face back '+a.backStyle;
}
function text(){
  document.documentElement.lang=en?'en':'zh-CN';$('edition').textContent=say('灯城名片','LIT CITY');
  $('flip').textContent=view.face==='back'?say('回到作品 ↻','View works ↻'):say('翻到背面 ↻','About the creator ↻');
  $('front').setAttribute('aria-label',say('可翻转的作品名片','Rotatable creator card'));$('back').setAttribute('aria-label',say('身份背面','Creator back'));$('prev').setAttribute('aria-label',say('上一组作品','Previous works'));$('next').setAttribute('aria-label',say('下一组作品','Next works'));$('pager').setAttribute('aria-label',say('作品分页','Work pages'));
  $('hint').textContent=say('左右或上下拖动可旋转到名片背面；鼠标悬停抬升，点击进入作品。触屏点一次抬升，再点进入。方向键选择，回车打开；Shift 加方向键旋转，Esc 结束动画并恢复视角。','Drag horizontally or vertically to turn the card, including its reverse. Hover to lift and click to open. On touch, tap to lift, then tap again to open. Arrow keys select, Enter opens, Shift + arrows rotate, Escape ends the intro and resets the view.');$('list-title').textContent=say('作品目录','Work index');$('profile-title').textContent=say('完整资料','Full profile');
  $('count').textContent=String(data.works.length).padStart(2,'0')+say(' 件作品',' WORKS');$('canvas').setAttribute('aria-describedby','hint');$('canvas').setAttribute('aria-label',say('作品城市，方向键选择、回车打开','City of works. Use arrow keys to select and Enter to open.'));
  $('front').hidden=!player&&view.face==='back';$('back').hidden=false;$('profile-details').hidden=view.face!=='back';if(!player&&view.face==='back')$('profile-details').open=true;
  $('front-foot').hidden=false;$('details').hidden=view.face==='back';$('pager').hidden=view.face==='back'||data.works.length<=PAGE_SIZE;
  $('canvas').setAttribute('aria-label',view.face==='back'?say('名片背面的创作者资料，拖动或使用翻面按钮回到正面','Creator profile on the reverse. Drag or use the flip button to return.'):say('作品城市，方向键选择、回车打开','City of works. Use arrow keys to select and Enter to open.'));
  player?.pause(document.hidden);height();
}
function list(){
  $('works').replaceChildren();for(const w of current()){
    const li=document.createElement('li'),b=document.createElement('button'),span=document.createElement('span'),title=document.createElement('strong'),desc=document.createElement('small');
    b.className='work';b.type='button';b.setAttribute('aria-label',say('打开作品：','Open work: ')+w.name);
    if(w.cover){const img=new Image();img.src=w.cover;img.alt='';img.loading='lazy';img.addEventListener('error',()=>{img.hidden=true;},{once:true});b.append(img);}
    title.textContent=w.name;desc.textContent=w.desc||w.version;span.append(title,desc);b.append(span);b.addEventListener('click',()=>openWork(w.id));li.append(b);$('works').append(li);
  }
  const pages=Math.max(1,Math.ceil(data.works.length/PAGE_SIZE));$('pager').hidden=pages===1;$('prev').disabled=view.page===0;$('next').disabled=view.page===pages-1;$('page-label').textContent=(view.page+1)+' / '+pages;
}
function placeholder(work){const c=document.createElement('canvas');c.width=640;c.height=400;const x=c.getContext('2d');x.fillStyle=theme==='light'?'#e2e6ec':'#1c2331';x.fillRect(0,0,640,400);x.strokeStyle=theme==='light'?'#8995a3':'#d4b877';x.strokeRect(24,24,592,352);x.fillStyle=theme==='light'?'#334155':'#e8dbc0';x.font='32px sans-serif';x.textAlign='center';const chars=Array.from(work.name||say('作品','Work'));for(let i=0;i<Math.min(3,Math.ceil(chars.length/16));i++)x.fillText(chars.slice(i*16,i*16+16).join(''),320,170+i*44);return c;}
function fallback(){failed=true;player?.dispose();player=null;$('canvas').hidden=true;$('fallback').hidden=false;$('fallback').textContent=say('当前设备无法显示城市，可从下方打开作品。','This device cannot display the city. Open a work from the list below.');$('details').open=true;text();height();}
function rebuild(preserveView=false){
  const previous=player?.snapshot(),saved=previous&&(preserveView?previous:{...previous,time:C.T.end,playing:false,hoverIndex:-1,touchIndex:-1,flip:null,rotation:previous.face===view.face?previous.rotation:{yaw:view.face==='back'?Math.PI:0,pitch:0}});player?.dispose();player=null;failed=false;profile();list();const works=current();
  $('hover-title').textContent='';
  $('canvas').hidden=!works.length;$('fallback').hidden=!!works.length;$('fallback').textContent=say('先选入作品，点亮你的城市。','Choose works to light up your city.');
  if(works.length){
    C.WORKS=works.map((w,i)=>{const b={...blueprints[i],zh:w.name,en:'',note:'',fx:{gamma:1,gain:1}};if(works.length<=3){b.row='B';b.x=(i-(works.length-1)/2)*3.3;}else if(works.length<=6){const cols=Math.ceil(works.length/2);b.row=i<cols?'A':'C';b.x=((i%cols)-(cols-1)/2)*3.6;}return b;});
    try{player=createCityPlayer($('canvas'),i=>openWork(works[i].id),i=>{$('hover-title').textContent=i>=0?works[i].name:'';},{autoplay:!presented,state:saved,author:data.author,theme,face:view.face,onWebsite:()=>$('website').click(),onFace:face=>{if(view.face!==face){view.face=face;text();state();}}});presented=true;works.forEach((w,i)=>{player.setWork(C.WORKS[i].id,placeholder(w));if(w.cover)player.setWork(C.WORKS[i].id,w.cover);});}catch{fallback();}
  }
  text();
}
function initialize(payload){
  document.body.dataset.cityPhase='initializing';const next=cleanCityCard(payload,location.origin);if(!next){document.body.dataset.cityPhase='invalid-data';return false;}
  $('flip').disabled=false;
  en=payload.locale==='en';const nextKey=JSON.stringify({en,data:next}),oldPage=view.page,oldFace=view.face;data=next;view=cityView(payload,data.works);
  if(key!==nextKey||oldPage!==view.page||(!player&&data.works.length&&!failed)){key=nextKey;rebuild();}else{if(oldFace!==view.face)player?.showFace(view.face,false);text();}state();document.body.dataset.cityPhase=failed?'fallback':'ready';return true;
}
listen(window,'message',event=>{if(event.source!==parent||event.origin!==location.origin||disposed)return;const message=event.data;if(message?.type!=='funtrack:gallery:init')return;if(message.requestId!==requestId||requestId===null){if(!initialize(message.payload))return;requestId=message.requestId;}send({type:'funtrack:gallery:initialized',requestId:message.requestId,state:failed?'fallback':data.works.length?'rendered':'empty'});});
listen($('flip'),'click',()=>{if(player)player.flip();else{view.face=view.face==='back'?'front':'back';text();state();}});
function page(delta){const next=view.page+delta;if(next<0||next>=Math.ceil(data.works.length/PAGE_SIZE))return;view.page=next;view.focusWorkId=current()[0]?.id||null;rebuild();state();}
listen($('prev'),'click',()=>page(-1));listen($('next'),'click',()=>page(1));
listen($('canvas'),'keydown',e=>{if(!data?.works.length)return;if(e.key==='Escape'){e.preventDefault();player?.resetView();return;}if(e.shiftKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();player?.rotate(e.key==='ArrowLeft'?-.18:e.key==='ArrowRight'?.18:0,e.key==='ArrowUp'?.12:e.key==='ArrowDown'?-.12:0);return;}let i=data.works.findIndex(w=>w.id===view.focusWorkId);if(i<0)i=view.page*PAGE_SIZE;if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();i=e.key==='Home'?0:e.key==='End'?data.works.length-1:Math.max(0,Math.min(data.works.length-1,i+(e.key==='ArrowLeft'?-1:1)));const nextPage=Math.floor(i/PAGE_SIZE);view.focusWorkId=data.works[i].id;if(nextPage!==view.page){view.page=nextPage;rebuild();}player?.focus(i%PAGE_SIZE);$('hover-title').textContent=data.works[i].name;$('status').textContent=data.works[i].name;state();}else if(e.key==='Enter'||e.key===' '){e.preventDefault();if(view.face==='front')openWork(data.works[i].id);}});
listen($('canvas'),'webglcontextlost',event=>{event.preventDefault();if(!disposed)fallback();});listen($('details'),'toggle',height);listen($('profile-details'),'toggle',height);listen($('avatar'),'error',()=>{$('avatar').hidden=true;});
listen(document,'visibilitychange',()=>player?.pause(document.hidden));
listen(window,THEME_CHANGE_EVENT,event=>{const next=event.detail.theme;if(next===theme)return;theme=next;applyTheme(theme);if(data)rebuild(true);});
const stageObserver=new ResizeObserver(()=>{player?.resize();}),heightObserver=new ResizeObserver(height);stageObserver.observe($('stage'));heightObserver.observe($('shell'));
listen(window,'pagehide',event=>{if(event.persisted){player?.pause(true);return;}disposed=true;listeners.forEach(off=>off());stageObserver.disconnect();heightObserver.disconnect();player?.dispose();});listen(window,'pageshow',event=>{if(event.persisted)player?.pause(document.hidden);});
send({type:'funtrack:gallery:ready',documentId});height();
