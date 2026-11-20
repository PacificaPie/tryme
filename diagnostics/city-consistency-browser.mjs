// Optional local browser acceptance. Run the fixture server first; this never
// visits production or changes browser preferences outside its isolated context.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node diagnostics/city-consistency-browser.mjs
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.CITY_PREVIEW_ORIGIN||'http://127.0.0.1:18821';
assert.equal(new URL(origin).hostname,'127.0.0.1');
const out='docs/evidence/city-consistency-2026-11-20';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[],errors=[];
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
const city=()=>page.frames().find(f=>new URL(f.url()||origin,origin).pathname==='/lit-city/');
async function ready(){await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>f.contentDocument?.querySelector('iframe')?.contentDocument?.body?.dataset.cityPhase==='ready'||['ready','fallback'].includes(f.contentDocument?.body?.dataset.cityPhase)));}
async function theme(mode){await page.locator('#'+mode).click();await page.waitForTimeout(500);assert.equal(await city().evaluate(()=>document.documentElement.dataset.theme),mode);}
try {
 await page.goto(origin+'/__city');await ready();
 for(const count of [1,3,6,9,10,30]){
  await page.locator('#count').selectOption(String(count));await ready();
  await page.waitForFunction(count=>document.querySelector('#preview')?.contentDocument?.querySelector('iframe')?.contentDocument?.querySelector('#count')?.textContent.startsWith(String(count).padStart(2,'0')),count);
  assert.equal(await city().locator('#works li').count(),Math.min(9,count));
  assert.equal(await city().locator('#front-name').innerText(),'林间 · 本地测试');
  assert.equal(await city().evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  results.push({case:'saved card '+count+' works',status:'passed'});
 }
 let f=city();await f.locator('#next').click();await f.locator('#city').click();await page.waitForTimeout(1800);
 await theme('dark');assert.equal(await f.locator('#page-label').innerText(),'2 / 4');assert.equal(await f.locator('#city').getAttribute('aria-pressed'),'true');
 await f.locator('#flip').click();await theme('light');assert.equal(await f.locator('#back').isVisible(),true);
 await f.locator('#flip').click();assert.equal(await f.locator('#page-label').innerText(),'2 / 4');assert.equal(await f.locator('#city').getAttribute('aria-pressed'),'true');
 await page.waitForTimeout(1400);await page.screenshot({path:out+'/mobile-expanded-after-theme.png',fullPage:true});
 await f.locator('#city').click();await page.waitForTimeout(1200);assert.equal(await f.locator('#city').getAttribute('aria-pressed'),'false');
 await f.locator('#replay').click();await f.locator('#skip').click();
 await f.locator('#canvas').press('End');assert.equal(await f.locator('#page-label').innerText(),'4 / 4');
 assert.match(await f.locator('#hover-title').innerText(),/测试 30/);
 await f.locator('#canvas').press('Enter');
 const publicCard=page.frames().find(fr=>new URL(fr.url(),origin).pathname.startsWith('/c/'));
 await publicCard.locator('.public-work-dialog[open]').waitFor();
 assert.match(await publicCard.locator('#public-work-title').innerText(),/测试 30/);
 assert.match(await publicCard.locator('.public-work-version').innerText(),/v1/);
 const fixtureState=await(await page.request.get(origin+'/__city/state')).json();
 assert.ok((await publicCard.getByRole('link',{name:'登录后试玩'}).getAttribute('href')).includes(fixtureState.workIds[29]));
 await page.screenshot({path:out+'/work-30-public-dialog.png',fullPage:true});
 results.push({case:'theme round trip keeps page/face/expanded; fold/replay/skip/keyboard opens work 30 v1 public dialog and correct sign-in return link',status:'passed'});
 await page.goto(origin+'/__city/edge');
 for(const mode of ['empty','missing','long','reduce','webgl']){
  await page.locator('#scenario').selectOption(mode);await ready();f=city();
  if(mode==='empty') {assert.equal(await f.locator('#works li').count(),0);assert.equal(await f.locator('#city').isDisabled(),true);}
  if(mode==='missing') {await page.waitForTimeout(500);assert.equal(await f.locator('#works li').count(),3);assert.equal(await f.locator('#canvas').isVisible(),true);}
  if(mode==='long'){
   await f.locator('#flip').click();await theme('dark');assert.equal(await f.locator('#back').isVisible(),true);
   assert.equal(await f.locator('#name').innerText(),'这是长姓名与英文排版测试 · Alexandra Creative Studio '.repeat(3).trim());
   assert.equal(await f.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  if(mode==='reduce'){await f.locator('#city').click();await page.waitForTimeout(200);assert.equal(await f.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);assert.equal(await f.locator('#city').getAttribute('aria-pressed'),'true');await theme('light');}
  if(mode==='webgl'){assert.equal(await f.locator('#canvas').isVisible(),false);assert.equal(await f.locator('#details').getAttribute('open'),'');}
  await page.waitForTimeout(450); // Capture after the face's CSS reveal finishes.
  await page.screenshot({path:out+'/edge-'+mode+'.png',fullPage:true});
  if(mode==='webgl'){await f.locator('#works button').first().click();await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('已打开'));}
  results.push({case:mode,status:'passed'});
 }
 // Verify optional creator paper choices still work, independently of theme.
 await page.goto(origin+'/__city/compare?size=mobile&theme=light&face=back');await page.waitForFunction(()=>document.body.dataset.ready==='true');f=city();
 for(const style of ['ivory','cobalt']){
  await page.evaluate(style=>{const card=window.reviewCard;document.querySelector('#city').contentWindow.postMessage({type:'funtrack:gallery:init',requestId:'review-'+style,payload:{author:{name:card.name,headline:card.headline,bio:card.bio,signature:card.signature,backStyle:style},works:card.works.map(w=>({id:w.id,name:w.name,cover:w.coverUrl,version:w.version})),face:'back'}},location.origin);},style);
  await page.waitForTimeout(500);assert.equal(await f.locator('#back').getAttribute('class'),'face back '+style);assert.equal(await f.locator('#name').innerText(),'林间 · 本地测试');
  await f.locator('#back').screenshot({path:out+'/back-'+style+'.png'});
 }
 results.push({case:'creator-selected ivory/cobalt back paper and actual identity',status:'passed'});
 assert.deepEqual(errors,[]);
} finally {
 await writeFile(out+'/browser-checks.json',JSON.stringify({checkedAt:new Date().toISOString(),browser:'Chrome '+browser.version(),viewport:{width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true},scope:'Local fixture author/API/media, real city/public-card renderers; no production writes or physical phone',results,pageErrors:errors},null,2)+'\n');await browser.close();
}
console.log(JSON.stringify(results,null,2));
