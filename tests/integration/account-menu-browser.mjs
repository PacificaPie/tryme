import assert from 'node:assert/strict';
// Install the optional browser runner without changing application dependencies:
// npm install --prefix .preview --no-save playwright@1.65.1
// ./.preview/node_modules/.bin/playwright install chromium
// Start account-menu-preview.mjs first; this runner only uses local fixtures.
const {chromium}=await import(new URL('../../.preview/node_modules/playwright/index.mjs',import.meta.url));
import {writeFile,mkdir} from 'node:fs/promises';
const browser=await chromium.launch({headless:true});
const report={browser:browser.version(),matrix:[],interaction:[],knownLimits:[],errors:[]};
await mkdir('.preview/account-menu',{recursive:true});
const page=await browser.newPage({viewport:{width:1280,height:850},reducedMotion:'reduce'});
page.on('pageerror',e=>report.errors.push(e.message));
const origin='http://127.0.0.1:8898';
const menu=page.locator('.account-menu'),trigger=page.locator('.account-menu>summary'),panel=page.locator('.account-options');
const opened=()=>menu.evaluate(el=>el.open);
const active=()=>page.evaluate(()=>document.activeElement?.className);
const screenshot=name=>page.screenshot({path:`.preview/account-menu/${name}.png`,animations:'disabled'});
try{
 await page.goto(`${origin}/site.html?theme=light#/feed`);await trigger.click();await screenshot('after-desktop');
 for(const width of [1280,768,390,320])for(const locale of ['zh-CN','en'])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:width===320?568:850});
  await page.goto(`${origin}/site.html?long=1&new=1&theme=${theme}&locale=${locale}#/feed`);
  await trigger.click();
  const m=await page.evaluate(()=>{
   const panel=document.querySelector('.account-options'),box=panel.getBoundingClientRect(),items=[...panel.querySelectorAll('a,button')];
   return {left:box.left,right:box.right,bottom:box.bottom,viewport:{w:innerWidth,h:innerHeight},overflow:document.documentElement.scrollWidth>innerWidth,items:items.map(el=>({text:el.textContent.trim(),height:el.getBoundingClientRect().height,font:getComputedStyle(el).font,weight:getComputedStyle(el).fontWeight})),name:document.querySelector('.account-identity strong').textContent};
  });
  assert(m.left>=0&&m.right<=width+.5&&m.bottom<=m.viewport.h,JSON.stringify(m));if(m.overflow){assert.equal(width,320);assert.equal(locale,'en');report.knownLimits.push('Existing English Feed overflow at 320px; account panel stays inside viewport');}assert(m.items.every(x=>x.height>=44));assert.equal(new Set(m.items.map(x=>x.font)).size,1);assert(m.name.length>70);
  assert.equal(await page.locator('.account-options a[href="#/welcome"]').count(),1);
  if(locale==='en')assert.deepEqual(await page.locator('.account-group-label').allTextContents(),['Personal & browsing','Create']);
  const header=await page.locator('.header-actions').boundingBox();assert(header.x>=0&&header.x+header.width<=width);
  await page.locator('.account-session a').focus();await page.keyboard.press('Escape');assert.equal(await opened(),false);assert.equal(await active(),'account-trigger');
  report.matrix.push({width,locale,theme,pass:true});
  if(width===390&&locale==='en'&&theme==='dark'){await trigger.click();await screenshot('after-mobile-dark-long');await page.keyboard.press('Escape');}
 }
 await page.setViewportSize({width:1280,height:850});await page.goto(`${origin}/site.html?theme=light&case=keyboard#/feed`);
 await trigger.focus();await page.keyboard.press('Enter');assert.equal(await opened(),true);
 for(const target of ['a[href^="#/author/"]','a[href="#/following"]','button[data-edit-profile]','a[href="#/studio/works"]','a[href="#/cards"]','.account-session a']){
  await page.keyboard.press('Tab');assert.equal(await page.locator('.account-options '+target).evaluate(el=>el===document.activeElement),true,target);
 }
 await page.keyboard.press('Tab');assert.equal(await opened(),false);report.interaction.push('Native Enter/Tab order; focus-out closes');
 await trigger.focus();await page.keyboard.press('Space');assert.equal(await opened(),true);await page.keyboard.press('Escape');assert.equal(await opened(),false);assert.equal(await active(),'account-trigger');report.interaction.push('Space opens; Escape closes and restores trigger');
 await trigger.click();await page.locator('.feed-search input').click();assert.equal(await opened(),false);report.interaction.push('Outside click closes');
 await trigger.click();await page.locator('.appearance-menu>summary').click();assert.equal(await opened(),false);report.interaction.push('Opening appearance menu closes account');
 await trigger.click();assert.equal(await page.locator('.appearance-menu').evaluate(el=>el.open),false);
 await page.locator('.account-options [data-edit-profile]').click();assert.equal(await opened(),false);await page.locator('dialog[open]').waitFor();await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});assert.equal(await active(),'account-trigger');report.interaction.push('Profile cancel returns focus');
 await trigger.click();await page.locator('.account-options [data-edit-profile]').click();await page.locator('#profile-name').fill('Updated preview name');await page.locator('dialog button[type=submit]').click();await page.locator('dialog').waitFor({state:'detached'});assert.equal(await active(),'account-trigger');assert.match(await trigger.getAttribute('aria-label'),/Updated preview name/);report.interaction.push('Profile save returns focus to refreshed trigger');
 for(const path of ['/author/account-preview','/following','/studio/works','/cards']){
  await page.goto(`${origin}/site.html?case=routes#/feed`);await trigger.click();await page.locator(`.account-options a[href="#${path}"]`).click();await page.waitForURL(`**#${path}`);assert.equal(await opened(),false);
 }
 report.interaction.push('Profile, Following, Studio and My card navigate and close');
 await page.goto(`${origin}/site.html?new=1&case=optional#/feed`);await trigger.click();await page.locator('.account-options a[href="#/welcome"]').click();await page.waitForURL('**#/welcome');
 const writes=[];const record=req=>{if(req.method()==='POST')writes.push(req.url());};page.on('request',record);
 await page.locator('#main [data-onboarding-browse]').click();await page.waitForURL('**#/feed');assert.deepEqual(writes,[]);page.off('request',record);
 await page.locator('.creation-menu>summary').click();await page.locator('.creation-options a[href="#/publish"]').click();await page.waitForURL('**#/welcome?intent=create&next=*');await page.locator('#onboarding-name').waitFor();
 report.interaction.push('Optional welcome still allows browsing without a write; plus still opens creator setup');
 await page.setViewportSize({width:667,height:320});await page.goto(`${origin}/site.html?new=1&long=1&locale=en&theme=dark#/feed`);await trigger.click();await page.locator('.account-session a').focus();const small=await page.locator('.account-session a').boundingBox();assert(small.y+small.height<=320);assert.equal(await opened(),true);report.interaction.push('Short landscape scroll reaches sign out');await screenshot('after-landscape-scroll');
 await page.setViewportSize({width:1280,height:850});await page.goto(`${origin}/site.html?case=signout#/feed`);await trigger.click();await page.locator('.account-session a').click();await page.waitForURL('**?guest=1#/feed');await page.locator('#identity a').waitFor();assert.equal(await menu.count(),0);report.interaction.push('Signed-out state has no account menu');
 assert.equal(report.errors.length,0,report.errors.join('\n'));console.log(JSON.stringify(report,null,2));
}finally{await writeFile('.preview/account-menu/browser-report.json',JSON.stringify(report,null,2));await browser.close();}
