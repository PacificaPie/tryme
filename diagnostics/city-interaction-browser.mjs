// Real local renderer + HTTP fixture acceptance. No production traffic/writes.
// Start CITY_PREVIEW_PORT=18831 node diagnostics/settled-city-preview.mjs first.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.CITY_PREVIEW_ORIGIN||'http://127.0.0.1:18831';
assert.equal(new URL(origin).hostname,'127.0.0.1');
const out='docs/evidence/city-interaction-2026-11-20';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[],errors=[];
let completed=false;
// Observe actual Three.js matrices/uniform inputs. These wrappers only exist in
// browser-intercepted local responses; no testing globals ship in public/.
async function context(options){
 const ctx=await browser.newContext(options);
 ctx.setDefaultTimeout(15000);
 for(const kind of ['Core','Scene','Cam']){
  const file=kind==='Cam'?'camera':kind.toLowerCase();
  await ctx.route('**/lit-city/'+file+'.js',async route=>{
   const response=await route.fetch();let extra='';
   if(kind==='Scene')extra="const update=value.update;value.update=s=>{window.reviewRise=[...s.rise];return update(s);};";
   if(kind==='Cam')extra="const at=value.at;value.at=(...args)=>{window.reviewView={time:args[0],rotation:{...args[3].rotation}};return at(...args);};";
   await route.fulfill({response,body:(await response.text())+`\n{const original=SP.create${kind};SP.create${kind}=(...args)=>{const value=original(...args);window.review${kind}=value;${extra}return value;};}`});
  });
 }
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));return {ctx,page};
}
const city=p=>p.frames().find(f=>f.url().includes('/lit-city/'));
const publicCard=p=>p.frames().find(f=>new URL(f.url(),origin).pathname.startsWith('/c/'));
async function ready(p){await p.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>f.contentDocument?.querySelector('iframe')?.contentDocument?.body?.dataset.cityPhase==='ready'||['ready','fallback'].includes(f.contentDocument?.body?.dataset.cityPhase)));return city(p);}
async function count(p,value){const old=city(p),detached=p.waitForEvent('framedetached',{predicate:f=>f===old});await p.locator('#count').selectOption(String(value));await detached;return ready(p);}
async function screen(p,name){await p.waitForTimeout(500);await p.screenshot({path:out+'/'+name+'.png',fullPage:true});}
async function point(f,index=0){
 const pos=await f.evaluate(index=>{const h=reviewScene.heroes[index],lift=reviewRise[index]>.5,v=new THREE.Vector3(h.x,lift?h.yc:.02,lift?h.zf+.02:h.zf-SP.CFG.WIN.h/2).project(reviewCore.camera);return {x:v.x*.5+.5,y:.5-v.y*.5};},index);
 const box=await f.locator('canvas').boundingBox();return {x:box.x+pos.x*box.width,y:box.y+pos.y*box.height};
}
const view=f=>f.evaluate(()=>window.reviewView);
async function allDown(f){await f.waitForFunction(()=>window.reviewRise?.every(v=>v<.01));}
async function mode(p,value){await p.locator('#'+value).click();await city(p).waitForFunction(theme=>document.documentElement.dataset.theme===theme,value);}
try{
 const {ctx,page}=await context({viewport:{width:1000,height:1100},deviceScaleFactor:1});
 await page.goto(origin+'/__city');let f=await ready(page);
 assert.equal(await f.locator('#city,#replay,#skip').count(),0);
 await f.waitForFunction(()=>reviewView.time>2&&reviewView.time<6);
 assert.equal(await f.locator('canvas').getAttribute('data-playback'),'intro');
 await screen(page,'desktop-autoplay');
 await f.locator('#flip').click();const paused=(await view(f)).time;await page.waitForTimeout(700);assert.equal((await view(f)).time,paused);
 await f.locator('#flip').click();await f.waitForFunction(time=>reviewView.time>time+.2,paused);
 const beforeTheme=(await view(f)).time;await mode(page,'dark');assert.ok((await view(f)).time>=beforeTheme);
 await f.waitForFunction(()=>document.querySelector('canvas').dataset.playback==='settled',null,{timeout:45000});await allDown(f);
 results.push({case:'autoplay, removed controls, flip pauses/resumes, theme continues current animation',status:'passed'});
 let p=await point(f);await page.mouse.move(p.x,p.y);await f.waitForFunction(()=>reviewRise[0]>.98);await screen(page,'desktop-hover-dark');
 await page.mouse.move(5,5);await allDown(f);
 let box=await f.locator('canvas').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+190,box.y+box.height/2+40,{steps:20});await page.mouse.up();await page.mouse.move(5,5);await allDown(f);
 assert.ok(Math.abs((await view(f)).rotation.yaw)>1);assert.equal(await publicCard(page).locator('dialog[open]').count(),0);
 const rotated=(await view(f)).rotation;await mode(page,'light');assert.deepEqual((await view(f)).rotation,rotated);
 await f.locator('#flip').click();await f.locator('#flip').click();assert.deepEqual((await view(f)).rotation,rotated);
 await screen(page,'desktop-free-rotation');
 for(const tilt of ['ArrowUp','ArrowDown','ArrowUp']){
  for(let i=0;i<12;i++)await f.locator('canvas').press('Shift+'+tilt);
  for(let turn=0;turn<4;turn++){
   for(let i=0;i<9;i++)await f.locator('canvas').press('Shift+ArrowRight');
   const corners=await f.evaluate(()=>[-1,1].flatMap(x=>[-1,1].map(z=>{const p=new THREE.Vector3(x*SP.CFG.CARD.w/2,0,z*SP.CFG.CARD.d/2).project(reviewCore.camera);return [p.x,p.y,p.z];})));
   assert.ok(corners.flat().every(v=>Math.abs(v)<=1),'card corners stay inside the view while orbiting at tilt limits');
  }
 }
 await f.locator('canvas').press('Escape');await allDown(f);assert.deepEqual((await view(f)).rotation,{yaw:0,pitch:0});
 p=await point(f);await page.mouse.click(p.x,p.y);await publicCard(page).locator('dialog[open]').waitFor();assert.match(await publicCard(page).locator('.public-work-version').innerText(),/v1/);await publicCard(page).getByRole('button',{name:'关闭作品'}).click();
 results.push({case:'desktop hover lifts/leaves fold, drag rotates without opening, theme/flip keep rotation, full orbit at tilt limits stays in frame, click opens saved v1',status:'passed'});
 f=await count(page,30);await f.waitForFunction(()=>document.querySelector('#count').textContent.startsWith('30'));
 await f.locator('canvas').press('Shift+ArrowRight');const firstPageRotation=(await view(f)).rotation;
 await f.locator('#next').click();assert.equal(await f.locator('#page-label').innerText(),'2 / 4');assert.equal(await f.locator('canvas').getAttribute('data-playback'),'settled');assert.deepEqual((await view(f)).rotation,firstPageRotation);
 await f.locator('canvas').press('End');assert.equal(await f.locator('#page-label').innerText(),'4 / 4');await f.locator('canvas').press('Enter');await publicCard(page).locator('dialog[open]').waitFor();assert.match(await publicCard(page).locator('#public-work-title').innerText(),/测试 30/);
 const fixture=await(await page.request.get(origin+'/__city/state')).json();assert.ok((await publicCard(page).getByRole('link',{name:'登录后试玩'}).getAttribute('href')).includes(fixture.workIds[29]));
 results.push({case:'30 works remain reachable; page changes keep rotation without replay; keyboard selects/opens last work',status:'passed'});
 await ctx.close();
 const mobile=await context({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});const mp=mobile.page;
 await mp.goto(origin+'/__city');f=await ready(mp);assert.equal(await f.locator('canvas').getAttribute('data-playback'),'intro');await f.waitForFunction(()=>document.querySelector('canvas').dataset.playback==='settled',null,{timeout:45000});await allDown(f);
 p=await point(f);await mp.touchscreen.tap(p.x,p.y);await f.waitForFunction(()=>reviewRise[0]>.98);assert.equal(await publicCard(mp).locator('dialog[open]').count(),0);await screen(mp,'mobile-tap-lift');
 await mode(mp,'dark');await f.waitForFunction(()=>reviewRise[0]>.98);await f.locator('#flip').click();await f.locator('#flip').click();await f.waitForFunction(()=>reviewRise[0]>.98);
 p=await point(f);await mp.touchscreen.tap(p.x,p.y);await publicCard(mp).locator('dialog[open]').waitFor();assert.match(await publicCard(mp).locator('#public-work-title').innerText(),/轨道游乐场/);await publicCard(mp).getByRole('button',{name:'关闭作品'}).click();
 results.push({case:'first real emulated touch lifts only; theme/flip keep lifted state; second tap opens correct work',status:'passed'});
 const cdp=await mobile.ctx.newCDPSession(mp);box=await f.locator('canvas').boundingBox();const start={x:Math.round(box.x+box.width*.45),y:Math.round(box.y+box.height*.55)};
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
 for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+i*14,y:start.y-i*5}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await mp.waitForTimeout(500);
 assert.ok(Math.abs((await view(f)).rotation.yaw)>.5);assert.equal(await publicCard(mp).locator('dialog[open]').count(),0);await screen(mp,'mobile-drag-rotation');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});assert.equal(await publicCard(mp).locator('dialog[open]').count(),0);
 results.push({case:'touch dragging changes yaw/pitch without navigation; cancelled touch does not open a work',status:'passed'});
 for(const n of [1,3,6,9,10]){f=await count(mp,n);await f.waitForFunction(n=>document.querySelector('#count').textContent.startsWith(String(n).padStart(2,'0')),n);await f.locator('canvas').press('Escape');assert.equal(await f.locator('#works li').count(),Math.min(9,n));assert.equal(await f.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 results.push({case:'1/3/6/9/10 works and narrow layout',status:'passed'});
 await mp.goto(origin+'/__city/edge');
 for(const scenario of ['empty','missing','long','reduce','webgl']){
  await mp.locator('#scenario').selectOption(scenario);f=await ready(mp);
  if(scenario==='empty'){assert.equal(await f.locator('#works li').count(),0);assert.equal(await f.locator('canvas').isVisible(),false);}
  if(scenario==='missing'){await f.locator('canvas').press('Escape');assert.equal(await f.locator('#works li').count(),3);assert.equal(await f.locator('canvas').isVisible(),true);}
  if(scenario==='long'){await f.locator('#flip').click();assert.equal(await f.locator('#name').innerText(),'这是长姓名与英文排版测试 · Alexandra Creative Studio '.repeat(3).trim());assert.equal(await f.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  if(scenario==='reduce'){assert.equal(await f.locator('canvas').getAttribute('data-playback'),'settled');p=await point(f);await mp.touchscreen.tap(p.x,p.y);await f.waitForFunction(()=>reviewRise[0]>.98);await f.locator('canvas').press('Shift+ArrowLeft');assert.ok((await view(f)).rotation.yaw<0);}
  if(scenario==='webgl'){assert.equal(await f.locator('canvas').isVisible(),false);assert.equal(await f.locator('#details').getAttribute('open'),'');await f.locator('#works button').first().click();await mp.waitForFunction(()=>document.querySelector('#result').textContent.includes('已打开'));}
  await screen(mp,'edge-'+scenario);results.push({case:scenario,status:'passed'});
 }
 await mp.goto(origin+'/__city/compare?size=mobile&theme=light&face=back');await mp.waitForFunction(()=>document.body.dataset.ready==='true');f=city(mp);
 for(const style of ['ivory','cobalt']){
  await mp.evaluate(style=>{const card=window.reviewCard;document.querySelector('#city').contentWindow.postMessage({type:'funtrack:gallery:init',requestId:'review-'+style,payload:{author:{name:card.name,headline:card.headline,bio:card.bio,signature:card.signature,backStyle:style},works:card.works.map(w=>({id:w.id,name:w.name,cover:w.coverUrl,version:w.version})),face:'back'}},location.origin);},style);
  await f.waitForFunction(style=>document.querySelector('#back').className==='face back '+style,style);assert.equal(await f.locator('#name').innerText(),'林间 · 本地测试');
 }
 results.push({case:'creator-selected ivory/cobalt back paper and actual identity',status:'passed'});
 await mobile.ctx.close();assert.deepEqual(errors,[]);completed=true;
}finally{
 await writeFile(out+'/browser-checks.json',JSON.stringify({checkedAt:new Date().toISOString(),browser:'Chrome '+browser.version(),completed,scope:'Local HTTP fixture author/storage; real renderer and pointer events. Camera/state observed with diagnostic-only response wrappers. Desktop + 390x844/DPR2 touch emulation, not a physical phone.',results,pageErrors:errors},null,2)+'\n');await browser.close();
}
console.log(JSON.stringify(results,null,2));
