// Loopback-only UI acceptance: real application/router/SQLite and in-memory R2.
// Identities and publication data are synthetic; no Clerk, cloud or deployment.
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fixture,OWNER,handleAPI} from '../tests/helpers/router-fixture.mjs';
import {createPublicSharingService} from '../lib/funtrack/public-sharing.mjs';
const f=fixture({after(){}}),root=path.resolve('public');let origin;
const names=['纸上漫游','像素果园','Orbit Playground','记忆潮汐','Prism Breaker','Mini Sudoku','Pulse Lanes','Tiles','Arc Hoops','静静的花园','纸与光','小小宇宙','雨天的房间'];
const covers=['pixel-orchard.png','memory-tide.png','orbit.png','tiles.png','prism-breaker.png','mini-sudoku.png','pulse-lanes.png','tiles.png','arc-hoops.png'];
const authors=['林间','Mia','小舟','River','Sora'];
for(let i=0;i<names.length;i++){
  const owner=i===0?OWNER:'preview-creator-'+i;
  await f.api('/api/me/profile',{method:'POST',owner,body:{name:authors[i%authors.length],bio:'把日常的小小灵感，做成可以亲手探索的世界。',headline:i%2?'独立开发者 · 交互实验':'设计师 · 网页游戏',avatarPreset:['sun','moon','sprout','wave'][i%4]}});
  const form=new FormData();form.set('name',names[i]);form.set('desc','一个轻巧的互动作品，点开来探索片刻。');form.set('source','html');form.set('category',i%3?'game':'interactive');form.set('file',new File(['<!doctype html><body><button>'+names[i]+'</button></body>'],'game.html',{type:'text/html'}));form.set('cover',new File([await readFile(path.join(root,'examples',covers[i%covers.length]))],'cover.png',{type:'image/png'}));
  // The category catalog is validated by the actual publication service.
  form.set('category',i%3?'game':'other');
  const result=await f.api('/api/works',{method:'POST',owner,body:form});if(result.status!==201)throw Error(JSON.stringify(result));
  const saved=await f.api('/api/cards',{method:'POST',owner,body:{name:authors[i%authors.length],template:'editorial',signature:'Make something small.',workIds:[result.work.id]}});if(saved.status!==201)throw Error(JSON.stringify(saved));
  if(i<6)await f.api('/api/cards/'+saved.card.id+'/discovery',{method:'PATCH',owner,body:{listed:true,expectedRevision:0}});
}
const sharing=createPublicSharingService({db:()=>f.db,bucket:()=>f.bucket,origin:()=>origin});
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'};
const server=http.createServer(async(req,res)=>{
  try{
    if(req.headers.host!==new URL(origin).host){res.writeHead(403);return res.end();}
    const url=new URL(req.url,origin);
    if(url.pathname==='/__qa/owner'||url.pathname==='/__qa/guest'){
      res.writeHead(302,{'Set-Cookie':'qa-owner='+(url.pathname.endsWith('owner')?'1':'0')+'; Path=/; SameSite=Strict',Location:url.pathname.endsWith('owner')?'/site.html#/cards':'/site.html#/feed'});return res.end();
    }
    if(url.pathname==='/__qa'){
      res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(`<!doctype html><meta charset="utf-8"><style>body{font:14px system-ui;background:#e8ecef}iframe{border:1px solid #aaa;border-radius:8px;background:#fff}</style><p>LOCAL FIXTURE · real UI/router, synthetic users and data · <a href="/__qa/guest">Guest Feed</a> · <a href="/__qa/owner">Owner card controls</a></p><iframe title="390 pixel mobile viewport (browser simulation)" width="390" height="844" src="/site.html#/feed"></iframe>`);
    }
    let response;
    if(url.pathname.startsWith('/c/'))response=await sharing.page(new Request(url,{method:req.method}),url.pathname.split('/')[2]);
    else if(url.pathname.startsWith('/api/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const headers=new Headers(req.headers);headers.set('Origin','https://site.test');
      if(!url.pathname.startsWith('/api/public/')&&(req.headers.cookie||'').includes('qa-owner=1')){headers.set('oai-authenticated-user-id',OWNER);headers.set('oai-authenticated-user-full-name','Local fixture');headers.set('oai-authenticated-user-email','fixture@example.test');}
      response=await handleAPI(new Request('https://site.test'+url.pathname+url.search,{method:req.method,headers,...['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)}}));
    }else{
      let file=path.resolve(root,'.'+(url.pathname==='/'?'/site.html':url.pathname));if(!file.startsWith(root+'/'))throw Error('Invalid path');if((await stat(file)).isDirectory())file=path.join(file,'index.html');
      let data=await readFile(file);if(file.endsWith('/site.html'))data=Buffer.from(data.toString().replace('<script src="/opening-init.js"></script>','<script>localStorage.setItem("tryme.opening.seen.v1","1")</script><script src="/opening-init.js"></script>'));
      response=new Response(data,{headers:{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'}});
    }
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){res.writeHead(404);res.end('Fixture resource unavailable');console.error(error.message);}
});
server.listen(Number(process.env.MIXED_FEED_PREVIEW_PORT)||0,'127.0.0.1',()=>{origin='http://127.0.0.1:'+server.address().port;console.log(`Guest: ${origin}/__qa/guest\nOwner: ${origin}/__qa/owner\nMobile: ${origin}/__qa`);});
