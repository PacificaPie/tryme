// Preserve the selected tab's position across route renders. Only the indicator
// moves; links stay in place and keep their normal keyboard behavior.
const positions = new Map();
const groups = [['.site-header nav','primary','line'],['.studio-nav','studio','pill'],['.cards-nav','cards','line'],['.inbox-tabs','inbox','line']];
export function syncNavigation(root = document, animate = true) {
  for (const [selector,key,kind] of groups) {
    const nav=root.querySelector(selector),active=nav?.querySelector('a.active');if(!nav||!active)continue;
    const bounds=nav.getBoundingClientRect(),target=active.getBoundingClientRect();
    if(!bounds.width||!target.width)continue;
    const next={x:target.left-bounds.left,y:kind==='line'?bounds.height-(key==='primary'?14:2):target.top-bounds.top,width:target.width,height:kind==='line'?2:target.height};
    let indicator=nav.querySelector('.nav-indicator');
    const apply=value=>{indicator.style.width=value.width+'px';indicator.style.height=value.height+'px';indicator.style.transform=`translate(${value.x}px,${value.y}px)`;};
    if(!indicator){indicator=document.createElement('span');indicator.className='nav-indicator '+kind;indicator.setAttribute('aria-hidden','true');nav.append(indicator);const old=positions.get(key);apply(animate&&old&&old.x<bounds.width?old:next);}
    if(!animate)indicator.style.transition='none';
    requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!nav.isConnected)return;if(animate)indicator.style.removeProperty('transition');apply(next);}));
    positions.set(key,next);
    nav.querySelectorAll('a').forEach(link=>{if(link===active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  }
}
window.addEventListener('resize',()=>syncNavigation(document,false),{passive:true});
