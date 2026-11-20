// Run against tests/fixtures/mobile-share-browser-server.mjs, never a live site.
// Optional browser tooling lives under .preview, outside the application lockfile.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import jsQR from 'jsqr';
const require=createRequire(new URL('../../.preview/browser-runtime/package.json',import.meta.url));
const {chromium,webkit}=require('playwright'),{PNG}=require('pngjs');
const base=process.env.QA_ORIGIN||'http://127.0.0.1:4898';
assert.equal(new URL(base).hostname,'127.0.0.1','Only the loopback fixture is permitted');
const out='.preview/mobile-share';await mkdir(out,{recursive:true});
const state=await (await fetch(base+'/fixture-state')).json();
const publicURL=base+'/c/'+state.cards[0].id,results=[];
const dimensions=el=>({client:el.clientWidth,scroll:el.scrollWidth});
const fits=async locator=>{const size=await locator.evaluate(dimensions);assert(size.scroll<=size.client+1,JSON.stringify(size));return size;};
const decode=buffer=>{const png=PNG.sync.read(buffer);return {width:png.width,height:png.height,url:jsQR(new Uint8ClampedArray(png.data),png.width,png.height)?.data};};

for(const [engineName,engine] of [['chrome',chromium],['webkit',webkit]]){
  const browser=await engine.launch(engineName==='chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{
    for(const [width,height] of [[320,640],[390,844],[1280,900]])for(const theme of ['light','dark']){
      const context=await browser.newContext({viewport:{width,height},colorScheme:theme,reducedMotion:'reduce',acceptDownloads:true});
      const page=await context.newPage(),errors=[],requests=[];
      page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push({method:request.method(),url:request.url()}));
      const record={engine:engineName,version:browser.version(),width,height,theme};
      for(const card of state.cards.slice(0,3)){
        await page.goto(base+'/c/'+card.id);await page.locator('[data-public-card-share]').waitFor();
        await page.locator('[data-public-card-share]').scrollIntoViewIfNeeded();
        await fits(page.locator('html'));await fits(page.locator('.card-preview'));await fits(page.locator('.card-preview h2').first());
        // Lazy images in filmstrip are loaded by its thumbnail index/scroll.
        if(card.template==='filmstrip')await page.locator('[data-reel-go="2"]').click();
        await page.waitForFunction(()=>document.querySelector('.public-cover-placeholder'));
        assert.match(await page.locator('.public-cover-placeholder').first().textContent(),/Missing cover/);
      }
      await page.goto(publicURL);await page.locator('[data-public-card-share]').waitFor();
      await page.locator('[data-card-work]').nth(2).click();
      await page.locator('.public-work-art .public-cover-placeholder').waitFor();
      assert.match(await page.locator('.public-work-copy h2').textContent(),/Missing cover/);
      await page.locator('.public-work-close').click();
      await page.locator('[data-public-card-share]').click();await page.locator('.share-qr-row button').waitFor();
      record.dialog=await fits(page.locator('#share-link-dialog'));
      assert.equal(await page.locator('.share-item-title').textContent(),state.longName);
      const dataURL=await page.locator('.share-qr-row canvas').evaluate(el=>el.toDataURL());
      assert.equal(decode(Buffer.from(dataURL.split(',')[1],'base64')).url,publicURL);
      // Actual browser clipboard write. Chrome also grants read permission so the
      // result can be independently read back; WebKit uses its real write API.
      if(engineName==='chrome')await context.grantPermissions(['clipboard-read','clipboard-write']);
      await page.locator('.share-link-only').click();
      await page.waitForFunction(()=>document.querySelector('.share-status').textContent.includes('链接已复制'));
      if(engineName==='chrome')assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),publicURL);
      record.clipboard='native write passed';
      if(width===390&&theme==='dark'){
        await page.screenshot({path:out+'/'+engineName+'-after-dialog.png'});
        await page.locator('.share-qr-row button').click();await page.locator('.share-poster-preview').waitFor({state:'visible'});
        await page.waitForFunction(()=>document.querySelector('.share-poster-preview img').naturalWidth===1200);
        const downloadEvent=page.waitForEvent('download');await page.locator('[data-download]').click();
        const download=await downloadEvent;assert.equal(download.suggestedFilename(),'TryMe-card.png');
        const posterPath=out+'/'+engineName+'-poster.png';await download.saveAs(posterPath);
        record.poster=decode(await readFile(posterPath));assert.deepEqual(record.poster,{width:1200,height:1440,url:publicURL});
        const popupEvent=page.waitForEvent('popup');await page.locator('[data-open-image]').click();
        const popup=await popupEvent;await popup.waitForLoadState();
        await popup.waitForFunction(()=>document.querySelector('img')?.naturalWidth===1200);await popup.close();
        record.fullImage='blob image opened at 1200×1440';
        await page.screenshot({path:out+'/'+engineName+'-after-poster-dialog.png'});
      }
      await page.keyboard.press('Escape');await page.locator('#share-link-dialog').waitFor({state:'detached'});
      assert.equal(await page.locator('[data-public-card-share]').evaluate(el=>el===document.activeElement),true);
      if(width===320&&theme==='dark')await page.screenshot({path:out+'/'+engineName+'-after-card.png',fullPage:true});
      assert(!requests.some(r=>r.method!=='GET'||new URL(r.url).pathname==='/api/me'),'Public viewing/sharing must not authenticate or write');
      assert.deepEqual(errors,[]);results.push(record);console.log(JSON.stringify(record));await context.close();
    }
    // API availability/error branches are injected, not OS share-sheet acceptance.
    const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),page=await context.newPage();
    await page.goto(publicURL);await page.locator('[data-public-card-share]').waitFor();
    const nativeSupport=await page.evaluate(()=>({share:typeof navigator.share,canShare:typeof navigator.canShare}));
    await page.evaluate(()=>{
      window.shareCalls=[];window.shareMode='ok';
      Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{
        window.shareCalls.push({url:data.url,files:data.files?.map(f=>({name:f.name,type:f.type,size:f.size})),active:navigator.userActivation.isActive});
        if(window.shareMode!=='ok')throw new DOMException('Injected share result',window.shareMode);
      }});
      Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
    });
    await page.locator('[data-public-card-share]').click();await page.locator('.share-native').click();
    assert.equal(await page.evaluate(()=>shareCalls[0].url),publicURL);
    await page.evaluate(()=>window.shareMode='AbortError');await page.locator('.share-native').click();
    assert.equal(await page.locator('.share-status').textContent(),'');
    await page.evaluate(()=>window.shareMode='NotAllowedError');await page.locator('.share-native').click();
    assert.match(await page.locator('.share-status').textContent(),/未能打开系统分享/);
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new DOMException('Denied','NotAllowedError');}}}));
    await page.locator('.share-link-only').click();
    assert.match(await page.locator('.share-status').textContent(),/手动复制/);
    assert.deepEqual(await page.locator('textarea').evaluate(el=>({value:el.value,start:el.selectionStart,end:el.selectionEnd})),{value:publicURL,start:0,end:publicURL.length});
    // Exercise the explicit older-Safari Image decoder path as well.
    await page.evaluate(()=>window.createImageBitmap=undefined);
    await page.locator('.share-qr-row button').click();await page.locator('.share-poster-preview').waitFor({state:'visible'});
    await page.evaluate(()=>window.shareMode='ok');await page.locator('[data-share-image]').click();
    const fileCall=await page.evaluate(()=>shareCalls.at(-1));assert.equal(fileCall.files[0].type,'image/png');assert(fileCall.files[0].size>10000);assert(fileCall.active);
    await page.evaluate(()=>window.shareMode='AbortError');await page.locator('[data-share-image]').click();
    assert.equal(await page.locator('.share-status').textContent(),'');
    await page.evaluate(()=>window.shareMode='NotAllowedError');await page.locator('[data-share-image]').click();
    assert.match(await page.locator('.share-status').textContent(),/未能分享图片/);
    await page.evaluate(()=>Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false}));
    await page.locator('.share-qr-row button').click();await page.locator('.share-poster-preview').waitFor({state:'visible'});
    assert.equal(await page.locator('[data-share-image]').isVisible(),false);
    await page.keyboard.press('Escape');await page.locator('#share-link-dialog').waitFor({state:'detached'});
    await page.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:undefined}));
    await page.locator('[data-public-card-share]').click();assert.equal(await page.locator('.share-native').isVisible(),false);
    await page.keyboard.press('Escape');await page.locator('#share-link-dialog').waitFor({state:'detached'});
    // Navigation goes through the real auth page; only identity establishment is
    // a synthetic Sites-provider redirect, followed by real pinned-router reads.
    await page.locator('[data-card-work]').first().click();await page.locator('.public-work-copy a').click();
    await page.locator('a[href^="/signin-with-chatgpt?"]').waitFor();
    assert.equal(await page.locator('.auth-actions a').last().getAttribute('href'),'/c/'+state.cards[0].id);
    await page.locator('a[href^="/signin-with-chatgpt?"]').click();
    await page.locator('.work-pinned').waitFor();assert.match(await page.locator('.work-pinned').textContent(),/v1/);
    await page.frameLocator('.game-frame').locator('button').waitFor();
    assert.equal(await page.frameLocator('.game-frame').locator('button').textContent(),'Saved v1 0');
    assert((await page.locator('.game-frame').getAttribute('src')).includes(state.works[0].versionId));
    const sessions=(await (await fetch(base+'/fixture-state')).json()).sessions;
    assert(sessions.some(s=>s.actor_id==='publication-other'&&s.version_id===state.works[0].versionId));
    await page.screenshot({path:out+'/'+engineName+'-pinned-v1.png',fullPage:true});
    // Clearing only this isolated browser's QA cookie simulates expiry. The
    // public page stays readable; private card/game reads fail closed.
    await context.clearCookies();
    assert.equal((await context.request.get(base+'/api/cards/'+state.cards[0].id)).status(),401);
    assert.equal((await context.request.get(base+'/game/'+state.works[0].versionId)).status(),401);
    await page.goto(publicURL);await page.locator('[data-public-card-share]').waitFor();
    results.push({engine:engineName,nativeSupport,shareBranches:'injected success, cancel, denial, unsupported passed',decoder:'Image fallback passed',returnFlow:'synthetic account B → saved v1; cookie expiry → private 401/public 200'});
    await context.close();
  }finally{await browser.close();}
}
await writeFile(out+'/results.json',JSON.stringify({base,scope:'Local fixture only; no real Clerk/OS share sheet/device acceptance',results},null,2)+'\n');
console.log('Mobile sharing browser matrix passed');
