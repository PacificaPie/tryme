// Real local renderer + HTTP fixture acceptance. No production traffic/writes.
// Start CITY_PREVIEW_PORT=18841 node diagnostics/settled-city-preview.mjs first.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.CITY_PREVIEW_ORIGIN||'http://127.0.0.1:18841';
assert.equal(new URL(origin).hostname,'127.0.0.1');
const out='docs/evidence/city-physical-back-2026-11-21';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),results=[],errors=[];
let completed=false;
function report(result){results.push(result);console.log(result.case+': '+result.status);}
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
async function face(f,name){await f.waitForFunction(name=>document.querySelector('canvas').dataset.face===name&&document.querySelector('canvas').dataset.turning==='false',name);}
async function flip(f,name){await f.locator('#flip').click();await face(f,name);}
async function drag(p,f,dx,dy){const b=await f.locator('canvas').boundingBox();const x=b.x+b.width/2,y=b.y+b.height/2;await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+dx,y+dy,{steps:24});await p.mouse.up();await p.mouse.move(2,2);}
async function reverseIs3D(f){assert.equal(await f.locator('canvas').isVisible(),true);assert.equal(await f.locator('#back').isVisible(),false);assert.equal(await f.locator('#profile-details').getAttribute('open'),null);assert.equal(await f.evaluate(()=>{const mesh=reviewScene.group.getObjectByName('creator-card-back');return !!mesh&&[...mesh.geometry.attributes.position.array].filter((_,i)=>i%3===1).every(y=>y<-SP.CFG.CARD.th)&&reviewCore.camera.position.y<-SP.CFG.CARD.th;}),true);}
try{
 const {ctx,page}=await context({viewport:{width:1050,height:1000},deviceScaleFactor:1});
 await page.goto(origin+'/__city');let f=await ready(page);
 assert.equal(await f.locator('#city,#replay,#skip').count(),0);await f.waitForFunction(()=>reviewView.time>2&&reviewView.time<6);
 const initialTime=(await view(f)).time;await mode(page,'dark');assert.ok((await view(f)).time>=initialTime);
 await f.waitForFunction(()=>document.querySelector('canvas').dataset.playback==='settled',null,{timeout:45000});await allDown(f);
 await f.evaluate(()=>window.originalCanvas=document.querySelector('canvas'));
 await flip(f,'back');await reverseIs3D(f);assert.equal(await f.evaluate(()=>originalCanvas===document.querySelector('canvas')),true);await screen(page,'desktop-back-dark');
 const backRotation=(await view(f)).rotation;await mode(page,'light');await reverseIs3D(f);assert.deepEqual((await view(f)).rotation,backRotation);await screen(page,'desktop-back-light');
 await flip(f,'front');await allDown(f);assert.equal(await f.evaluate(()=>originalCanvas===document.querySelector('canvas')),true);
 report({case:'autoplay and theme continuity; flip uses same canvas and underside mesh, HTML profile remains collapsed; theme retains back orientation',status:'passed'});
 let p=await point(f);await page.mouse.move(p.x,p.y);await f.waitForFunction(()=>reviewRise[0]>.98);await page.mouse.move(2,2);await allDown(f);
 await drag(page,f,350,0);await face(f,'back');await reverseIs3D(f);await screen(page,'desktop-dragged-back');
 let box=await f.locator('canvas').boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);assert.equal(await publicCard(page).locator('dialog[open]').count(),0);
 await f.locator('canvas').press('Enter');assert.equal(await publicCard(page).locator('dialog[open]').count(),0);
 await drag(page,f,350,0);await face(f,'front');await f.locator('canvas').press('Escape');await allDown(f);
 await drag(page,f,0,350);await face(f,'back');await screen(page,'desktop-vertical-back');await f.locator('canvas').press('Escape');await face(f,'front');
 p=await point(f);await page.mouse.click(p.x,p.y);await publicCard(page).locator('dialog[open]').waitFor();assert.match(await publicCard(page).locator('.public-work-version').innerText(),/v1/);await publicCard(page).getByRole('button',{name:'关闭作品'}).click();
 report({case:'horizontal and vertical drags reveal physical reverse; no work hit through back; returning front restores hover and saved v1 activation',status:'passed'});
 // Reversing or taking over an in-progress flip must not activate the canvas.
 await f.locator('#flip').click();await page.waitForTimeout(150);await f.locator('#flip').click();await face(f,'front');
 await f.locator('#flip').click();await page.waitForTimeout(180);await drag(page,f,30,0);assert.equal(await f.locator('canvas').getAttribute('data-turning'),'false');assert.equal(await publicCard(page).locator('dialog[open]').count(),0);await f.locator('canvas').press('Escape');
 report({case:'rapid flip reversal and pointer takeover remain responsive without accidental work activation',status:'passed'});
 f=await count(page,30);await f.locator('canvas').press('Escape');await f.locator('#next').click();assert.equal(await f.locator('#page-label').innerText(),'2 / 4');await flip(f,'back');await flip(f,'front');assert.equal(await f.locator('#page-label').innerText(),'2 / 4');
 await f.locator('canvas').press('End');await f.locator('canvas').press('Enter');await publicCard(page).locator('dialog[open]').waitFor();assert.match(await publicCard(page).locator('#public-work-title').innerText(),/测试 30/);
 const fixture=await(await page.request.get(origin+'/__city/state')).json();assert.ok((await publicCard(page).getByRole('link',{name:'登录后试玩'}).getAttribute('href')).includes(fixture.workIds[29]));
 report({case:'pagination and selected saved version survive physical flip; keyboard reaches work 30 and correct sign-in return URL',status:'passed'});
 await ctx.close();
 const mobile=await context({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});const mp=mobile.page;
 await mp.goto(origin+'/__city');f=await ready(mp);await f.waitForFunction(()=>document.querySelector('canvas').dataset.playback==='settled',null,{timeout:45000});await allDown(f);
 p=await point(f);await mp.touchscreen.tap(p.x,p.y);await f.waitForFunction(()=>reviewRise[0]>.98);assert.equal(await publicCard(mp).locator('dialog[open]').count(),0);
 p=await point(f);await mp.touchscreen.tap(p.x,p.y);await publicCard(mp).locator('dialog[open]').waitFor();await publicCard(mp).getByRole('button',{name:'关闭作品'}).click();
 await flip(f,'back');await reverseIs3D(f);await screen(mp,'mobile-back-light');await mode(mp,'dark');await reverseIs3D(f);await screen(mp,'mobile-back-dark');
 await flip(f,'front');await allDown(f);
 const cdp=await mobile.ctx.newCDPSession(mp);
 // Two natural drags within the narrow canvas, continuous angle, no snap-back.
 for(let j=0;j<2;j++){
  box=await f.locator('canvas').boundingBox();const start={x:Math.round(box.x+box.width*.2),y:Math.round(box.y+box.height*.5)};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
  for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+i*19,y:start.y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 }
 await face(f,'back');await reverseIs3D(f);await screen(mp,'mobile-dragged-back');assert.equal(await publicCard(mp).locator('dialog[open]').count(),0);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:Math.round(box.y+80)}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});assert.equal(await publicCard(mp).locator('dialog[open]').count(),0);
 await flip(f,'front');p=await point(f);await mp.touchscreen.tap(p.x,p.y);await f.waitForFunction(()=>reviewRise[0]>.98);assert.equal(await publicCard(mp).locator('dialog[open]').count(),0);
 report({case:'mobile first/second taps still lift/open; real touch drags turn to physical back; light/dark, cancellation and returning front remain correct',status:'passed'});
 for(const n of [1,3,6,9,10]){f=await count(mp,n);await f.locator('canvas').press('Escape');assert.equal(await f.locator('#works li').count(),Math.min(n,9));await flip(f,'back');await reverseIs3D(f);assert.equal(await f.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 report({case:'1/3/6/9/10 selected works use the same two-sided card and fit narrow layout',status:'passed'});
 await mp.goto(origin+'/__city/edge');
 for(const scenario of ['empty','missing','long','reduce','webgl']){
  await mp.locator('#scenario').selectOption(scenario);f=await ready(mp);
  if(scenario==='empty'){assert.equal(await f.locator('canvas').isVisible(),false);await f.locator('#flip').click();assert.equal(await f.locator('#back').isVisible(),true);}
  if(scenario==='missing'){await flip(f,'back');await reverseIs3D(f);}
  if(scenario==='long'){
   await flip(f,'back');await reverseIs3D(f);await screen(mp,'long-profile-printed');await f.locator('#profile-title').click();assert.equal(await f.locator('#name').innerText(),'这是长姓名与英文排版测试 · Alexandra Creative Studio '.repeat(3).trim());assert.equal(await f.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await screen(mp,'long-profile-complete');await f.locator('#profile-title').click();
  }
  if(scenario==='reduce'){assert.equal(await f.locator('canvas').getAttribute('data-playback'),'settled');await flip(f,'back');await reverseIs3D(f);await f.locator('canvas').press('Escape');await face(f,'front');p=await point(f);await mp.touchscreen.tap(p.x,p.y);await f.waitForFunction(()=>reviewRise[0]>.98);}
  if(scenario==='webgl'){assert.equal(await f.locator('canvas').isVisible(),false);await f.locator('#works button').first().click();await mp.waitForFunction(()=>document.querySelector('#result').textContent.includes('已打开'));await f.locator('#flip').click();assert.equal(await f.locator('#back').isVisible(),true);assert.equal(await f.locator('#website').getAttribute('href'),'https://example.com/');}
  await screen(mp,'edge-'+scenario);results.push({case:scenario,status:'passed'});
 }
 // Printed website is a ray-picked target on the physical reverse, not a dead label.
 await mp.locator('#scenario').selectOption('missing');f=await ready(mp);await flip(f,'back');
 await mobile.ctx.route('https://example.com/**',route=>route.fulfill({body:'Local navigation fixture',contentType:'text/html'}));
 p=await f.evaluate(()=>{const cv=reviewScene.group.getObjectByName('creator-card-back').material.uniforms.tMap.value.image,g=cv.getContext('2d'),width=g.measureText('example.com ↗').width;const v=new THREE.Vector3((.5-(1216-width/2)/1280)*SP.CFG.CARD.w,-SP.CFG.CARD.th-.003,(750/810-.5)*SP.CFG.CARD.d).project(reviewCore.camera);return {x:v.x*.5+.5,y:.5-v.y*.5};});
 box=await f.locator('canvas').boundingBox();const popup=mp.waitForEvent('popup');await mp.touchscreen.tap(box.x+p.x*box.width,box.y+p.y*box.height);const site=await popup;await site.waitForLoadState();assert.equal(site.url(),'https://example.com/');await site.close();
 report({case:'printed website opens cleaned author URL via physical back hit test; navigation intercepted locally',status:'passed'});
 await mp.goto(origin+'/__city/compare?size=mobile&theme=light&face=back');await mp.waitForFunction(()=>document.body.dataset.ready==='true');f=city(mp);
 for(const style of ['ivory','cobalt']){
  await mp.evaluate(style=>{const card=window.reviewCard;document.querySelector('#city').contentWindow.postMessage({type:'funtrack:gallery:init',requestId:'review-'+style,payload:{author:{name:card.name,headline:card.headline,bio:card.bio,signature:card.signature,backStyle:style},works:card.works.map(w=>({id:w.id,name:w.name,cover:w.coverUrl,version:w.version})),face:'back'}},location.origin);},style);
  await f.waitForFunction(style=>document.querySelector('#back').className==='face back '+style,style);await face(f,'back');await reverseIs3D(f);await f.locator('canvas').screenshot({path:out+'/back-'+style+'.png'});
 }
 report({case:'creator-selected ivory/cobalt paper renders on physical reverse with actual identity',status:'passed'});
 await mobile.ctx.close();assert.deepEqual(errors,[]);completed=true;
}finally{
 await writeFile(out+'/browser-checks.json',JSON.stringify({checkedAt:new Date().toISOString(),browser:'Chrome '+browser.version(),completed,scope:'Local HTTP fixture and real renderer. Desktop + 390x844/DPR2 touch emulation, not a physical phone. Diagnostic-only wrappers observe Three.js matrices and animation state.',results,pageErrors:errors},null,2)+'\n');await browser.close();
}
console.log(JSON.stringify(results,null,2));
