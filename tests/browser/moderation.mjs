// Local Chrome + real router/SQLite; no remote mutations or real identities.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
const {default:puppeteer}=await import(process.env.PUPPETEER_MODULE||'puppeteer-core');
const out='.preview/moderation';await mkdir(out,{recursive:true});
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));const base=`http://127.0.0.1:${port}`;
const fixture=spawn(process.execPath,['tests/fixtures/creator-workspace-browser-server.mjs'],{env:{...process.env,CREATOR_WORKSPACE_PORT:String(port),CREATOR_WORKSPACE_MODERATION:'1'},stdio:['ignore','pipe','pipe']});
let browser,page;const errors=[],attempts=[];
try{
 await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('Fixture timed out')),15000);fixture.stdout.on('data',chunk=>{log+=chunk;if(log.includes('Workspace fixture:')){clearTimeout(timer);resolve();}});fixture.stderr.on('data',chunk=>{log+=chunk;});fixture.once('error',reject);fixture.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited'));});});
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});page=await browser.newPage();await page.setViewport({width:390,height:844});page.setDefaultTimeout(15000);await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);page.on('pageerror',e=>errors.push(e.message));
 const state=()=>fetch(base+'/__workspace').then(r=>r.json()),before=await state();
 await page.setRequestInterception(true);page.on('request',async request=>{
  try{if(request.method()==='POST'&&new URL(request.url()).pathname.startsWith('/api/moderation/')){
   attempts.push({key:request.headers()['idempotency-key'],body:request.postData()});
   if(attempts.length===1){const response=await fetch(request.url(),{method:'POST',headers:request.headers(),body:request.postData()});assert.equal(response.status,200);return request.respond({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'Local lost response'}})});}
  }await request.continue();}catch(e){errors.push(e.message);}
 });
 await page.goto(base+'/site.html#/admin/moderation');await page.waitForSelector('#moderation-id');await page.type('#moderation-id',before.works[0]);await page.click('#moderation-lookup button');await page.waitForSelector('#moderation-reason');await page.type('#moderation-reason','本地验收：内容投诉已核实');await page.click('#moderation-action [type="submit"]');
 await page.waitForFunction(()=>document.querySelector('#moderation-error')?.textContent.includes('Local lost response'));assert.equal((await state()).moderation.length,1);
 await page.click('#moderation-action [type="submit"]');await page.waitForFunction(()=>document.querySelector('#moderation-action [type="submit"]')?.textContent==='恢复访问');assert.deepEqual(attempts[1],attempts[0]);assert.equal((await state()).moderation.length,1);
 assert.equal((await fetch(base+'/api/public/cards/'+before.card)).status,404);assert.equal((await fetch(base+'/c/'+before.card)).status,404);assert.equal((await fetch(base+'/api/works/'+before.works[0])).status,404);
 await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:out+'/blocked-390.png',fullPage:true});
 await page.type('#moderation-reason','本地验收：复核后恢复原内容');await page.click('#moderation-action [type="submit"]');await page.waitForFunction(()=>document.querySelector('#moderation-action [type="submit"]')?.textContent==='下架内容');
 assert.equal((await fetch(base+'/api/public/cards/'+before.card)).status,200);assert.equal((await fetch(base+'/c/'+before.card)).status,200);
 const after=await state();assert.equal(after.moderation.length,2);assert.deepEqual(after.cards,before.cards);assert.deepEqual(after.versions,before.versions);
 await page.goto(base+'/__workspace?account=empty');await page.goto(base+'/site.html#/admin/moderation');await page.waitForFunction(()=>document.body.textContent.includes('此账号没有内容管理权限'));assert.equal(await page.$('#moderation-id'),null);
 assert.deepEqual(errors,[]);const result={passed:true,browser:await browser.version(),width:390,scope:'Local synthetic accounts, real frontend/router/SQLite',checks:['lost committed response retries one decision','block removes work and public card/page','restore retains original snapshots and versions','unprivileged account sees no controls','no horizontal overflow'],uncaughtErrors:errors};await writeFile(out+'/result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();if(fixture.exitCode===null){const closed=once(fixture,'exit');fixture.kill('SIGTERM');await closed;}}
