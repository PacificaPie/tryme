// Real Chrome + frontend/router/SQLite; synthetic accounts and in-memory R2.
// Capture failure is injected. No Clerk, cloud capture, production or deployment.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
const {default:puppeteer}=await import(process.env.PUPPETEER_MODULE||'puppeteer-core');
const out=process.env.OPERATIONS_EVIDENCE||'.preview/operations-review';
await mkdir(out,{recursive:true});
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const base=`http://127.0.0.1:${port}`;
const fixture=spawn(process.execPath,['tests/fixtures/creator-workspace-browser-server.mjs'],{env:{...process.env,CREATOR_WORKSPACE_PORT:String(port)},stdio:['ignore','pipe','pipe']});
let browser,page;
const records=[],errors=[];
try{
  await new Promise((resolve,reject)=>{
    let log='';const timer=setTimeout(()=>reject(Error('Fixture timeout: '+log)),15000);
    fixture.once('error',e=>{clearTimeout(timer);reject(e);});fixture.once('exit',code=>{clearTimeout(timer);reject(Error('Fixture exited: '+code+' '+log));});
    fixture.stderr.on('data',chunk=>{log+=chunk;});fixture.stdout.on('data',chunk=>{log+=chunk;if(log.includes('Workspace fixture:')){clearTimeout(timer);resolve();}});
  });
  browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  page=await browser.newPage();await page.setViewport({width:390,height:844});page.setDefaultTimeout(15000);
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  page.on('pageerror',e=>errors.push(e.message));await page.evaluateOnNewDocument(()=>{if(!localStorage.getItem('funtrack.locale'))localStorage.setItem('funtrack.locale','zh-CN');});
  const state=()=>fetch(base+'/__workspace').then(r=>r.json());
  const before=await state();const attempts=[];let committed;
  await page.setRequestInterception(true);
  page.on('request',async request=>{
    try{
      const url=new URL(request.url());
      if(url.pathname==='/api/cards'&&request.method()==='POST'){
        attempts.push({key:request.headers()['idempotency-key'],body:request.postData()});
        if(attempts.length===1){
          // Commit the real write but lose its response. Let the application's
          // real 30-second timer expire; do not shorten timers in the browser.
          const response=await fetch(request.url(),{method:'POST',headers:request.headers(),body:request.postData()});
          assert.equal(response.status,201);committed=(await response.json()).card;
          return;
        }
      }
      if(/\/api\/publish-drafts\/[^/]+\/capture$/.test(url.pathname))return request.respond({status:429,contentType:'application/json',body:JSON.stringify({error:{code:'CAPTURE_LIMIT',message:'Daily preview limit'}})});
      await request.continue();
    }catch(error){errors.push(error.message);}
  });
  await page.goto(base+'/site.html#/cards/me?addWork='+before.works[2]);
  await page.waitForSelector('[data-add-source="card"]');await page.click('[data-add-source="card"]');
  await page.waitForSelector('#to-template');await page.click('#to-template');
  await page.waitForSelector('#card-profile');await page.click('#card-profile [type="submit"]');
  await page.waitForSelector('#save-card');const started=Date.now();await page.click('#save-card');
  await page.waitForFunction(()=>document.querySelector('#card-error')?.textContent.includes('请求超时'),{timeout:35000});
  const elapsed=Date.now()-started;assert(elapsed>=29000&&elapsed<35000);
  assert.equal(await page.$eval('#save-card',el=>el.disabled),false);
  assert(committed);assert.equal((await state()).cards.length,before.cards.length+1);
  await page.screenshot({path:out+'/card-timeout-390.png',fullPage:true});
  await page.click('#save-card');await page.waitForSelector('.saved-label');
  assert.equal(new URL(page.url()).hash,'#/card/'+committed.id+'?saved=1');
  assert.equal(attempts.length,2);assert.deepEqual(attempts[1],attempts[0]);
  const after=await state();assert.equal(after.cards.length,before.cards.length+1);
  assert.deepEqual(after.cards.find(c=>c.id===before.card),before.cards.find(c=>c.id===before.card));
  records.push({scenario:'committed card response lost, real timeout, same-key retry',width:390,elapsedMs:elapsed,attempts:attempts.length,newCards:1,originalSnapshotUnchanged:true});
  await page.screenshot({path:out+'/card-retry-390.png',fullPage:true});
  for(const [width,locale] of [[390,'zh-CN'],[320,'en']]){
    await page.setViewport({width,height:844});await page.evaluate(locale=>localStorage.setItem('funtrack.locale',locale),locale);
    // Force a new document; a hash-only navigation would keep the old in-memory
    // locale even after changing its persisted preference.
    await page.goto(base+`/site.html?review=${width}#/publish`);await page.waitForSelector('#publish-form');
    assert.equal(await page.$eval('#locale-toggle',el=>el.textContent),locale==='en'?'中':'EN');
    await page.click('[name="source"][value="url"]');await page.type('#publish-url',`https://example.test/review-${width}`);
    const next=()=>page.evaluate(()=>[...document.querySelectorAll('.form-footer button')].find(b=>['下一步','Next'].includes(b.textContent))?.click());
    await next();await page.waitForSelector('#publish-name',{visible:true});await page.type('#publish-name','Operations review '+width);await page.type('#publish-desc','Local acceptance fixture');await page.select('#publish-category','website');await next();
    await page.waitForFunction(message=>document.querySelector('#publish-cover-draft')?.textContent.includes(message),{},locale==='en'?'Preview attempts are used up':'自动预览次数已用完');
    assert(await page.$eval('#publish-form [type="submit"]',el=>el.disabled));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
    await page.screenshot({path:out+`/media-quota-${width}.png`,fullPage:true});
    await page.click('[data-media-action="cover:skip"]');await page.click('[data-media-action="video:skip"]');
    await page.waitForFunction(()=>!document.querySelector('#publish-form [type="submit"]').disabled);await page.click('#publish-form [type="submit"]');
    await page.waitForSelector('.published-card-prompt');
    records.push({scenario:'quota reason, explicit skip, successful local publication',width,locale,noHorizontalOverflow:true});
  }
  assert.deepEqual(errors,[]);
  const evidence={browser:await browser.version(),scope:'Local frontend/router/SQLite; synthetic auth/storage and injected capture 429; no real devices or cloud services',records,uncaughtErrors:errors};
  await writeFile(out+'/result.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
}catch(error){
  if(page){await page.screenshot({path:out+'/failure.png',fullPage:true});console.error(JSON.stringify({url:page.url(),text:await page.$eval('body',el=>el.innerText),errors}));}throw error;
}finally{
  await browser?.close();if(fixture.exitCode===null){const closed=once(fixture,'exit');fixture.kill('SIGTERM');await closed;}
}
