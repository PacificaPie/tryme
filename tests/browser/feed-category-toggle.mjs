// Run against tests/fixtures/frontend-hierarchy-browser-server.mjs only.
// Uses an isolated headless browser; optional tooling stays outside the lockfile.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(new URL('../../.preview/browser-runtime/package.json',import.meta.url));
const {chromium}=require('playwright');
const base=process.env.QA_ORIGIN||'http://127.0.0.1:4966';
assert.equal(new URL(base).hostname,'127.0.0.1','Only the loopback fixture is permitted');
const out='.preview/feed-category-toggle';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true}),records=[];
try{
  for(const width of [1440,390,320])for(const locale of ['zh-CN','en']){
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    await context.addInitScript(locale=>localStorage.setItem('funtrack.locale',locale),locale);
    const page=await context.newPage(),errors=[],requests=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(new URL(request.url()).pathname==='/api/discover')requests.push(new URL(request.url()).searchParams);});
    const filters=page.locator('[data-filter]'),category=id=>page.locator(`[data-filter="${id}"]`);
    const ready=()=>page.waitForFunction(()=>document.querySelector('#discovery-results')?.getAttribute('aria-busy')==='false');
    const selection=async expected=>{
      assert.deepEqual(await page.locator('[data-filter][aria-pressed="true"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.filter)),expected);
      assert.deepEqual(await page.locator('[data-filter].active').evaluateAll(nodes=>nodes.map(node=>node.dataset.filter)),expected);
    };
    const params=()=>new URLSearchParams(new URL(page.url()).hash.split('?')[1]);
    const clickCategory=async id=>{await category(id).click();await ready();};
    await page.goto(base+'/site.html#/feed?type=works');await ready();
    assert.deepEqual(await filters.allTextContents(),locale==='en'?['Personal sites','Games','Other']:['个人网站','游戏','其他']);
    await selection([]);assert.equal(requests.at(-1).get('category'),'all');
    assert.equal(await page.locator('.feed-grid [data-work-id]').count(),3);
    await clickCategory('game');await selection(['game']);assert.equal(params().get('category'),'game');
    assert.equal(requests.at(-1).get('category'),'game');
    await page.screenshot({path:`${out}/${locale}-${width}-selected.png`,fullPage:true});
    await clickCategory('website');await selection(['website']);assert.equal(params().get('category'),'website');
    assert.equal(requests.at(-1).get('category'),'website');assert.equal(await page.locator('.feed-grid [data-work-id]').count(),0);
    await category('website').focus();await page.keyboard.press('Space');await ready();await selection([]);assert.equal(params().has('category'),false);
    assert.equal(params().get('type'),'works');assert.equal(requests.at(-1).get('category'),'all');
    assert.equal(await page.locator('.feed-grid [data-work-id]').count(),3);
    await page.locator('.feed-refresh').click();await ready();await selection([]);assert.equal(requests.at(-1).get('category'),'all');
    await page.reload();await ready();await selection([]);assert.equal(requests.at(-1).get('category'),'all');
    // Leave the unselected Feed, then exercise the application's actual history restoration.
    const unfilteredURL=page.url();
    await page.locator('.feed-grid .tile-title a').first().click();await page.locator('.work-page').waitFor();
    await page.goBack();await ready();assert.equal(page.url(),unfilteredURL);await selection([]);
    assert.equal(await page.locator('.feed-grid [data-work-id]').count(),3);
    await clickCategory('game');const selectedURL=page.url();
    await page.locator('.feed-grid .tile-title a').first().click();await page.locator('.work-page').waitFor();
    await page.goBack();await ready();assert.equal(page.url(),selectedURL);await selection(['game']);
    await page.goForward();await page.locator('.work-page').waitFor();
    await page.goBack();await ready();await selection(['game']);
    await page.reload();await ready();await selection(['game']);assert.equal(requests.at(-1).get('category'),'game');
    // Search, order and following remain active when the category is toggled off.
    await page.goto(base+'/site.html#/feed?type=works&category=game&q=Orbit&sort=newest&following=1');await ready();
    await clickCategory('game');await selection([]);
    assert.deepEqual(Object.fromEntries(params()),{type:'works',q:'Orbit',sort:'newest',following:'1'});
    for(const [key,value]of Object.entries({type:'works',category:'all',q:'Orbit',sort:'newest',following:'1'}))assert.equal(requests.at(-1).get(key),value);
    await clickCategory('other');await page.locator('[data-clear]').click();await ready();await selection([]);
    assert.deepEqual(Object.fromEntries(params()),{type:'works',sort:'newest',following:'1'});
    assert.equal(requests.at(-1).get('category'),'all');assert.equal(await page.locator('#work-search').inputValue(),'');
    // The separate content-type controls and mixed creator cards still work.
    await page.locator('[data-feed-scope]').click();await ready();
    await page.locator('[data-feed-type="all"]').click();await ready();
    assert.equal(await page.locator('.filters').isVisible(),false);
    assert.equal(await page.locator('.feed-grid [data-card-id]').count(),1);
    await page.locator('[data-feed-type="cards"]').click();await ready();
    assert.equal(await page.locator('.feed-grid [data-work-id]').count(),0);
    await page.locator('[data-feed-type="works"]').click();await ready();await selection([]);
    const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('[data-filter]')].map(el=>{const r=el.getBoundingClientRect();return{text:el.textContent,x:r.x,right:r.right,height:r.height,font:getComputedStyle(el).fontSize};})}));
    assert(layout.scroll<=width,JSON.stringify(layout));
    for(const button of layout.buttons){assert(button.x>=0&&button.right<=width,JSON.stringify(button));assert(button.height>=44,JSON.stringify(button));}
    await page.screenshot({path:`${out}/${locale}-${width}-unselected.png`,fullPage:true});
    assert.deepEqual(errors,[]);
    records.push({width,locale,layout,requests:requests.length,result:'passed'});
    await context.close();
  }
}finally{await browser.close();}
await writeFile(out+'/results.json',JSON.stringify({base,browser:'isolated headless Chromium',scope:'Local fixture only; synthetic accounts/data, no production or physical-device acceptance',records},null,2)+'\n');
console.log('Feed category toggle browser matrix passed (6 viewport/locale combinations)');
