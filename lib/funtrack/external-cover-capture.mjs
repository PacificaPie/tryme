import {createCaptureNetwork} from './external-cover-network.mjs';
const fail=code=>Object.assign(new Error(code),{code});
export const EXTERNAL_CAPTURE={width:1200,height:750,timeoutMs:35000};
// Geometry, visibility and load state are observed, never changed to force a
// screenshot. Animating backgrounds may continue while the hero is readable.
export function heroReadiness(){
  const visible=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth&&s.visibility==='visible'&&s.display!=='none'&&Number(s.opacity)>.1;};
  if(document.readyState==='loading'||document.fonts?.status==='loading'||document.documentElement.dataset.intro==='running')return {ready:false};
  const overlays=[...document.querySelectorAll('.intro-loader,[aria-busy="true"],[data-loading="true"],[role="dialog"],.preloader,#preloader,.loading-screen')];
  if(overlays.some(el=>visible(el)&&el.getBoundingClientRect().width*el.getBoundingClientRect().height>innerWidth*innerHeight*.4))return {ready:false};
  const hero=[...document.querySelectorAll('#hero,[data-hero],main h1,h1,main')].find(visible)||document.body;
  if(!hero||!visible(hero))return {ready:false};
  const images=[...document.images].filter(visible);if(images.some(image=>!image.complete||image.naturalWidth===0))return {ready:false};
  const h=hero.getBoundingClientRect(),headline=document.querySelector('h1');
  if(!document.body.innerText.trim()&&!images.length&&!document.querySelector('canvas,svg'))return {ready:false};
  if(/^(access denied|just a moment|verify you are human)/i.test(document.title)||/application error:|a client-side exception|failed to load the page/i.test(document.body.innerText.slice(0,600)))return {ready:false};
  // Full-screen fixed loading panels are common even without named selectors.
  const top=document.elementFromPoint(innerWidth/2,Math.min(innerHeight*.4,300));
  for(let el=top;el&&el!==document.body;el=el.parentElement){const s=getComputedStyle(el),r=el.getBoundingClientRect();if(s.position==='fixed'&&visible(el)&&r.width*r.height>innerWidth*innerHeight*.8&&!el.contains(hero))return {ready:false};}
  const measured=[hero,headline,...images.slice(0,6)].filter(Boolean).map(el=>{const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(Math.round);});
  return {ready:true,signature:JSON.stringify(measured),hero:hero.id||hero.tagName,top:Math.round(h.top),images:images.length};
}
export async function captureExternalCover(binding,url,{waitMs=5000,launch,fetcher=fetch,timers=globalThis,timeoutMs=EXTERNAL_CAPTURE.timeoutMs}={}){
  if(!binding?.fetch)throw fail('BROWSER_UNAVAILABLE');
  let browser,expired=false,deadline;const abort=new AbortController(),network=createCaptureNetwork({fetcher,signal:abort.signal});
  const close=async()=>{try{await browser?.close();}catch{}};
  const timeout=new Promise((_,reject)=>{deadline=timers.setTimeout(()=>{expired=true;abort.abort();void close();reject(fail('CAPTURE_TIMEOUT'));},timeoutMs);});
  const work=(async()=>{
    const target=await network.check(url);
    const open=launch||(await import('@cloudflare/puppeteer')).default.launch;
    browser=await open(binding,{guardrails:{allowedDomains:[]}});if(expired){await close();throw fail('CAPTURE_TIMEOUT');}
    const page=await browser.newPage();await page.setViewport({...EXTERNAL_CAPTURE,deviceScaleFactor:1});await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument(()=>{
      for(const key of ['RTCPeerConnection','webkitRTCPeerConnection','mozRTCPeerConnection','WebTransport','WebSocket','Worker','SharedWorker'])Object.defineProperty(globalThis,key,{value:undefined,writable:false,configurable:false});
    });
    await page.setRequestInterception(true);let mainError=null;
    page.on('request',request=>{void (async()=>{
      try{
        if(/^(?:data:|blob:|about:)/i.test(request.url())){await request.continue();return;}
        if(expired||request.redirectChain().length>5||request.method()!=='GET'||['media','websocket','eventsource'].includes(request.resourceType())){await request.abort();return;}
        const result=await network.resource(request.url(),request.headers());if(request.isNavigationRequest()&&request.frame()===page.mainFrame()&&result.status>=400)mainError=fail('CAPTURE_NOT_READY');
        await request.respond({...result,body:Buffer.from(result.body)});
      }catch(error){if(request.isNavigationRequest()&&request.frame()===page.mainFrame())mainError=error;try{await request.abort();}catch{}}
    })();});
    page.on('dialog',dialog=>{void dialog.dismiss().catch(()=>{});});
    page.on('popup',popup=>{void popup.close().catch(()=>{});});
    await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:15000});
    if(mainError)throw mainError;
    const start=Date.now();let previous='',stable=0,ready;
    while(!expired&&Date.now()-start<22000){
      await new Promise(resolve=>timers.setTimeout(resolve,400));
      const state=await page.evaluate(heroReadiness);
      if(state.ready&&state.signature===previous)stable++;else stable=0;
      previous=state.ready?state.signature:'';
      if(state.ready&&stable>=2&&Date.now()-start>=waitMs){ready=state;break;}
    }
    if(!ready||mainError)throw mainError||fail('CAPTURE_NOT_READY');
    const bytes=new Uint8Array(await page.screenshot({type:'jpeg',quality:83,fullPage:false,captureBeyondViewport:false}));
    if(!bytes.length||bytes.length>2*1024*1024)throw fail('CAPTURE_TOO_LARGE');
    return {bytes,mime:'image/jpeg',ready,waitedMs:Date.now()-start};
  })();
  try{return await Promise.race([work,timeout]);}
  finally{expired=true;abort.abort();timers.clearTimeout(deadline);let closeTimer;try{await Promise.race([close(),new Promise(resolve=>{closeTimer=timers.setTimeout(resolve,1000);})]);}finally{timers.clearTimeout(closeTimer);}}
}
