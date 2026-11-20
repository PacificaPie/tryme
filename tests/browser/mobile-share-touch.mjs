// Supplemental English/mobile viewport smoke. This is not physical iOS testing.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(new URL('../../.preview/browser-runtime/package.json',import.meta.url));
const {chromium,webkit}=require('playwright');
const base=process.env.QA_ORIGIN||'http://127.0.0.1:4898';
assert.equal(new URL(base).hostname,'127.0.0.1');
const out='.preview/mobile-share';await mkdir(out,{recursive:true});
const state=await(await fetch(base+'/fixture-state')).json(),results=[];
for(const [name,engine] of [['chrome',chromium],['webkit',webkit]]){
  const browser=await engine.launch(name==='chrome'?{channel:'chrome'}:{});
  try{
    const page=await browser.newPage({viewport:{width:320,height:640},isMobile:true,hasTouch:true,colorScheme:'dark',reducedMotion:'reduce'});
    for(const card of state.cards){
      await page.goto(base+'/c/'+card.id);await page.locator('[data-public-card-share]').waitFor();
      if(card.template==='wall'){
        await page.locator('[data-public-card-share]').tap();await page.locator('.share-qr-row').waitFor();
        await page.screenshot({path:out+'/'+name+'-after-320-dialog.png',animations:'disabled'});
        await page.locator('.share-close').tap();await page.locator('#share-link-dialog').waitFor({state:'detached'});
      }
      if(await page.locator('#public-card-locale').textContent()==='EN')await page.locator('#public-card-locale').tap();
      await page.locator('[data-public-card-share]').tap();await page.locator('.share-qr-row').waitFor();
      await page.locator('.share-copy').tap();
      await page.waitForFunction(()=>document.querySelector('.share-status').textContent.includes('Message and link copied'));
      const dimensions=await page.locator('#share-link-dialog').evaluate(el=>{
        const rect=el.getBoundingClientRect();
        return {width:innerWidth,touch:navigator.maxTouchPoints,client:el.clientWidth,scroll:el.scrollWidth,lang:document.documentElement.lang,visible:rect.top>=0&&rect.bottom<=innerHeight&&getComputedStyle(el).opacity==='1'};
      });
      assert(dimensions.scroll<=dimensions.client+1);assert.equal(dimensions.width,320);assert.equal(dimensions.lang,'en');assert(dimensions.visible);
      await page.locator('.share-close').tap();await page.locator('#share-link-dialog').waitFor({state:'detached'});
      assert(await page.locator('[data-public-card-share]').evaluate(el=>el===document.activeElement));
      results.push({engine:name,template:card.template,...dimensions});
    }
  }finally{await browser.close();}
}
await writeFile(out+'/touch-english.json',JSON.stringify({scope:'Emulated touch/viewport; 3D renderer visuals not assessed; macOS WebKit reports maxTouchPoints=0 even with hasTouch',results},null,2)+'\n');
console.log('Mobile English wrapper smoke passed for all six templates in both engines');
