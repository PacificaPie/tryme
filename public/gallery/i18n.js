import {t,getLocale,setLocale,registerMessages} from '../i18n.js';
export {t,getLocale};
export const galleryMessages={
 '卡中展厅':'Fold-out gallery','卡中展厅互动预览':'Interactive fold-out gallery preview','等待作品':'Waiting for works','三维名片预览':'3D creator card preview','交互名片。点击卡面展开，点击画框试玩。展厅内左右滑动或方向键切换作品，Enter 试玩，Escape 返回。':'Interactive card. Select the card to unfold it and a frame to play. Swipe or use the arrow keys to browse, Enter to play, and Escape to go back.','展开展厅 ↗':'Unfold gallery ↗','翻到背面':'Show back','翻到正面':'Show front','走进展厅 ↗':'Enter gallery ↗','展厅导航':'Gallery navigation','← 返回名片':'← Back to card','浏览展厅作品':'Browse gallery works','上一件作品':'Previous work','下一件作品':'Next work','试玩 ↗':'Play ↗','打开作品 ↗':'Open work ↗','正在准备名片':'Preparing card','作品与创作者':'Works and creator','上一组作品':'Previous group','下一组作品':'Next group','Enter 展开 · F 翻面 · G 进入 · ← → 切换作品 · Enter 试玩 · Esc 返回':'Enter: unfold · F: flip · G: enter · ← →: browse · Enter: play · Esc: back','创作者':'Creator','未命名作品':'Untitled work','作品':'Work','外链作品':'External link','站内游戏':'Hosted game','{count} 件作品 · 关于 {name}':'Works: {count} · About {name}','已选 {count} 件作品':'Selected: {count}','还没有选入作品。请返回上一步选择作品。':'No works selected. Go back to choose works.','查看作品：{name}':'View work: {name}','每组展出最多 {size} 件；当前第 {from}–{to} 件。切换分组可查看全部已选作品。':'Up to {size} per group. Showing {from}–{to}. Switch groups to view all selected works.','收起名片':'Fold card','尚未选择作品':'No works selected','作品列表模式':'Work list mode','正在浏览 {name}':'Viewing {name}','已进入展厅':'Inside gallery','正在走进展厅…':'Entering gallery…','正在返回名片…':'Returning to card…','正在展开展厅…':'Unfolding gallery…','正在收起展厅…':'Folding gallery…','正在翻面…':'Flipping card…','展厅已展开':'Gallery unfolded','展厅已收起 · 正面':'Gallery folded · Front','展厅已收起 · 背面':'Gallery folded · Back','作品仍在这里':'Your works are still here','当前浏览器暂时无法显示 3D 展厅。可以通过下方作品按钮继续查看。':'This browser cannot display the 3D gallery. Open a work from the list below.','返回上一步选入作品后，再生成卡中展厅。':'Go back and choose works before creating the gallery.','3D 显示已暂停。可以通过下方作品按钮继续查看，重新打开名片可重试 3D。':'3D rendering paused. Open a work below, or reopen the card to try 3D again.','{count} 件作品':'Works: {count}',
 '点亮收藏':'Collection desk','点亮收藏作品桌面':'Interactive collection desk','作品桌面。点击作品可打开；方向键选择作品，回车打开。':'Work desk. Select a work to open it, or use the arrow keys and Enter.','正在准备作品':'Preparing works','作品列表':'Work list','打开作品：{name}':'Open work: {name}','第 {page} 组，共 {count} 组作品':'Group {page} of {count}','当前设备暂时无法显示作品桌面，可以从下方打开作品。':'This device cannot display the work desk. Open a work from the list below.','先选入作品，再生成收藏桌面。':'Choose works before creating the collection desk.','这张名片的作品资料不完整，请返回后重试。':'This card is missing work details. Go back and try again.'
};
registerMessages(galleryMessages);
// Only explicitly listed interface nodes are translated. Creator text and work
// names/descriptions are never searched, replaced, or passed through this map.
const shared={ '#prev':{'aria-label':'上一组作品'},'#next':{'aria-label':'下一组作品'} };
const chrome={
 gallery:{'#shell':{'aria-label':'卡中展厅互动预览'},'#stage':{'aria-label':'三维名片预览'},'#gallery-canvas':{'aria-label':'交互名片。点击卡面展开，点击画框试玩。展厅内左右滑动或方向键切换作品，Enter 试玩，Escape 返回。'},'#enter':{text:'走进展厅 ↗'},'#room-nav':{'aria-label':'展厅导航'},'#leave':{text:'← 返回名片'},'#work-nav':{'aria-label':'浏览展厅作品'},'#left':{'aria-label':'上一件作品'},'#right':{'aria-label':'下一件作品'},'.keys':{text:'Enter 展开 · F 翻面 · G 进入 · ← → 切换作品 · Enter 试玩 · Esc 返回'}},
 collection:{'#stage':{'aria-label':'点亮收藏作品桌面'},'#canvas':{'aria-label':'作品桌面。点击作品可打开；方向键选择作品，回车打开。'},'#details summary':{text:'作品列表'}}
};
const initial={gallery:{'#gallery-title':'卡中展厅','#gallery-status':'等待作品','#toggle':'展开展厅 ↗','#play-current':'试玩 ↗','#fallback-title':'正在准备名片','#summary-label':'作品与创作者'},collection:{'#fallback-title':'正在准备作品'}};
export function applyGalleryLocale(kind,locale,{first=false}={}){
 if(locale==='en'||locale==='zh-CN')setLocale(locale);
 document.documentElement.lang=getLocale();document.title=kind==='gallery'?'TryMe · '+t('卡中展厅'):t('点亮收藏');
 for(const [selector,attributes] of Object.entries({...shared,...chrome[kind]})){
  const element=document.querySelector(selector);if(!element)continue;
  for(const [attribute,message] of Object.entries(attributes)){if(attribute==='text')element.textContent=t(message);else element.setAttribute(attribute,t(message));}
 }
 if(first){for(const [selector,message] of Object.entries(initial[kind])){const element=document.querySelector(selector);if(element)element.textContent=t(message);}const flip=document.getElementById('flip');if(flip){flip.setAttribute('aria-label',t('翻到背面'));flip.title=t('翻到背面');}}
 if(window.FuntrackGallery)window.FuntrackGallery.t=t;
}
