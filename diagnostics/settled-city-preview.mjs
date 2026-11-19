// Local-only review of the real card UI/router, with clearly labelled test data.
// In-memory database and media; no credentials, external calls or production writes.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fixture, OWNER, handleAPI, gameResponse } from '../tests/helpers/router-fixture.mjs';
import { createPublicSharingService } from '../lib/funtrack/public-sharing.mjs';
const port = Number(process.env.CITY_PREVIEW_PORT || 8792), origin = `http://127.0.0.1:${port}`;
const f = fixture({ after() {} });
await f.api('/api/me/profile', { method: 'POST', body: { name: '林间 · 本地测试', headline: '把小小的想法，做成可以体验的世界', bio: '这里使用本地测试资料检查名片。线上展示时，姓名、简介和作品来自名片所属作者。', signature: '让作品先说话。', avatarPreset: 'sun' } });
const samples = [ ['orbit.png','轨道游乐场'], ['pixel-orchard.png','像素果园'], ['prism-breaker.png','棱镜弹球'], ['memory-tide.png','潮汐记忆'], ['mini-sudoku.png','迷你数独'], ['tiles.png','拼块之间'], ['arc-hoops.png','弧线投篮'], ['pulse-lanes.png','脉冲小径'], ['salt-run.jpg','盐原漫步'] ];
const works = [];
for (let i = 0; i < 30; i++) {
  const [file, title] = samples[i % samples.length], name = title + (i >= 9 ? ` · 测试 ${i + 1}` : '');
  const cover = new File([await readFile('public/examples/' + file)], file, {type: file.endsWith('.jpg') ? 'image/jpeg' : 'image/png'});
  const result = await f.publish({ name, extra: {cover}, bytes: `<!doctype html><html><body><h1>${name}</h1><button onclick="this.textContent='已体验'">本地测试作品</button></body></html>` });
  if (result.status !== 201) throw Error(JSON.stringify(result));
  works.push(result.work);
}
const cards = {};
for (const count of [1, 3, 6, 9, 10, 30]) {
  const result = await f.api('/api/cards', {method: 'POST', body: {name: '林间 · 本地测试', signature: '让作品先说话。', template: 'city', workIds: works.slice(0, count).map(w => w.id)}});
  if (result.status !== 201) throw Error(JSON.stringify(result));
  cards[count] = result.card.id;
}
const sharing = createPublicSharingService({ db: () => f.db, bucket: () => f.bucket, origin: () => origin });
const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.woff2':'font/woff2' };
const review = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>灯城名片 · 本地验收</title><script src="/theme-init.js"></script><style>
*{box-sizing:border-box}body{margin:0;background:#f3f4f6;color:#25303d;font:14px system-ui}header{padding:24px 32px;background:#fcfcfd;border-bottom:1px solid #d8dde3}h1{font-size:23px;margin:4px 0 10px}p{margin:8px 0;line-height:1.6;color:#66717e}.controls{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:18px}button,select,a{font:inherit;color:inherit}button,select{border:1px solid #c2cad4;border-radius:8px;background:transparent;padding:8px 12px;cursor:pointer}a{margin-left:8px;text-underline-offset:4px}.wrap{padding:24px 12px;display:flex;justify-content:center}iframe{width:100%;max-width:1000px;height:1000px;border:1px solid #d8dde3;border-radius:16px;background:#fcfcfd}iframe.mobile{width:390px;max-width:100%;height:844px}:root[data-theme=dark] body{background:#101418;color:#e5e8ed}:root[data-theme=dark] header{background:#15191e;border-color:#343b46}:root[data-theme=dark] p{color:#b1b8c4}@media(max-width:600px){header{padding:18px}.wrap{padding:12px 0}iframe{border-radius:0;border:0}.controls{gap:8px}}
</style></head><body><header><p>TRYME / LOCAL REVIEW</p><h1>灯城，收成你的名片。</h1><p>独立本地预览 · 测试作者与示例素材 · 数据不写入线上。</p><div class="controls"><label>作品 <select id="count">${[1,3,6,9,10,30].map(n => `<option ${n===9?'selected':''}>${n}</option>`).join('')}</select></label><button id="light">日间</button><button id="dark">夜间</button><button id="mobile">手机 390px</button><button id="desktop">桌面</button><a id="open" target="_blank">单独打开名片 ↗</a><a href="/site.html#/cards" target="_blank">进入名片区 ↗</a></div></header><main class="wrap"><iframe title="名片预览" id="preview" src="/c/${cards[9]}"></iframe></main><script type="module">
import {createThemeController} from '/theme.js';const theme=createThemeController(),cards=${JSON.stringify(cards)},frame=document.querySelector('#preview'),open=document.querySelector('#open');
function select(){open.href=frame.src='/c/'+cards[document.querySelector('#count').value];}document.querySelector('#count').onchange=select;
for(const mode of ['light','dark'])document.querySelector('#'+mode).onclick=()=>theme.setPreference(mode);
document.querySelector('#mobile').onclick=()=>frame.classList.add('mobile');document.querySelector('#desktop').onclick=()=>frame.classList.remove('mobile');select();
</script></body></html>`;
http.createServer(async (req,res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${port}`) {res.writeHead(403);return res.end();}
    const url = new URL(req.url,origin);let response;
    if (url.pathname==='/' || url.pathname==='/__city') response=new Response(review,{headers:{'Content-Type':'text/html; charset=utf-8'}});
    else if(url.pathname==='/__city/state') response=Response.json({cards,workIds:works.map(w=>w.id)});
    else if(url.pathname==='/__city/edge') response=new Response(await readFile('diagnostics/settled-city-edge.html'),{headers:{'Content-Type':'text/html; charset=utf-8'}});
    else if(url.pathname.startsWith('/c/')) response=await sharing.page(new Request(url,{method:req.method}),url.pathname.split('/')[2]);
    else if(url.pathname.startsWith('/game/')) response=await gameResponse(new Request(url,{headers:{'oai-authenticated-user-id':OWNER,'oai-authenticated-user-email':'fixture@example.test'}}),url.pathname.split('/')[2]);
    else if(url.pathname.startsWith('/api/')) {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const headers=new Headers(req.headers);headers.set('Origin','https://site.test');
      if(!url.pathname.startsWith('/api/public/')) {headers.set('oai-authenticated-user-id',OWNER);headers.set('oai-authenticated-user-full-name','Local fixture');headers.set('oai-authenticated-user-email','fixture@example.test');}
      response=await handleAPI(new Request('https://site.test'+url.pathname+url.search,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}));
    } else {
      const root=path.resolve('public');let file=path.resolve(root,'.'+url.pathname);
      if(!file.startsWith(root+'/'))throw Error('Invalid path');
      if((await stat(file)).isDirectory())file=path.join(file,'index.html');
      let bytes=await readFile(file);
      // Failure/motion injection exists only in this local review server.
      if(url.pathname==='/lit-city/'&&['webgl','reduce'].includes(url.searchParams.get('qa'))){
        const script=url.searchParams.get('qa')==='webgl'
          ? "const getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:getContext.call(this,type,...args)};"
          : "const media=window.matchMedia.bind(window);window.matchMedia=query=>query==='(prefers-reduced-motion: reduce)'?{matches:true,addEventListener(){},removeEventListener(){}}:media(query);";
        bytes=Buffer.from(bytes.toString().replace('<head>','<head><script>'+script+'</script>'));
      }
      response=new Response(bytes,{headers:{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'}});
    }
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  } catch(error) {res.writeHead(404);res.end('Local resource unavailable');console.error(error.message);}
}).listen(port,'127.0.0.1',()=>console.log(`City review: ${origin}/__city\nSaved nine-work card: ${origin}/c/${cards[9]}`));
