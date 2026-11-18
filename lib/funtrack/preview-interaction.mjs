// Only the reviewed immutable artifact receives this demonstration. Other
// uploads retain the conservative single Start-button behavior.
export const RAIN_DEMO_HASH='68fd02ac95f03a11baa7c7d56b8e2bbcca8add7235a75b90bfeaaf03b65b046e';
export async function previewProfile(html){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(html));
 const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 return hash===RAIN_DEMO_HASH?'rain-mailbox-v1':null;
}
// Serialized into the opaque game frame. It only activates real controls;
// there is no save injection, puzzle solution, game SDK or network access.
export function startPreviewInteraction(profile){
 const visible=element=>{if(!element||element.disabled||element.getAttribute('aria-disabled')==='true')return false;const r=element.getBoundingClientRect();if(r.width<=0||r.height<=0||r.bottom<=0||r.right<=0||r.top>=innerHeight||r.left>=innerWidth)return false;for(let el=element;el;el=el.parentElement){const s=getComputedStyle(el);if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0)return false;}return true;};
 const report=globalThis.__trymeInteraction={profile,completed:[],failed:false};
 if(profile==='rain-mailbox-v1'){
  const steps=[[0,'#enter'],[1000,'[data-control="mail"]'],[2100,'[data-control="wheel-0"]'],[2900,'[data-control="wheel-1"]'],[3700,'[data-control="wheel-1"]'],[4600,'[data-control="wheel-2"]'],[5500,'#back']];
  report.expected=steps.length;
  const click=selector=>{if(report.failed)return;const element=document.querySelector(selector);if(!visible(element)){report.failed=true;return;}element.click();report.completed.push(selector);};
  for(const [delay,selector] of steps)delay?setTimeout(()=>click(selector),delay):click(selector);
  return 'rain-mailbox-v1';
 }
 const allowed=/^(开始|开始游戏|开始体验|进入游戏|start|start game|play|play game)$/i;
 const button=[...document.querySelectorAll('button, [role="button"]')].find(element=>allowed.test(element.textContent.trim())&&visible(element));
 button?.click();return button?'start-button':'opening';
}
