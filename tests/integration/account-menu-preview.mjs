// Local UI fixture: serves the real frontend, with synthetic account/API data.
// No external auth, backend, production data or writes are used.
// node tests/integration/account-menu-preview.mjs [port] [baseline-directory]
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../public/',import.meta.url));
const port=Number(process.argv[2]||8898),baseline=process.argv[3]&&resolve(process.argv[3]);
const origin=`http://127.0.0.1:${port}`,profiles=new Map();
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const longName='Alexandra非常长的中英文昵称ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const error=message=>({error:{code:'PREVIEW_ONLY',message}});

createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const url=new URL(req.url,origin),page=new URL(req.headers.referer||url,origin);
  const params=url.pathname==='/site.html'?url.searchParams:page.searchParams;
  const key=params.toString(),isNew=params.has('new');
  const user=profiles.get(key)||{id:'account-preview',name:params.has('long')?longName:'Alex Chen',avatarUrl:'/avatars/moon.svg',bio:'Local preview profile',headline:'',website:''};
  const onboarding={required:isNew,creatorReady:!isNew,needsCreatorProfile:isNew,hasWorks:!isNew,hasCard:false};
  const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(data));};
  try{
    if(url.pathname==='/'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Account menu preview</title><style>body{font:16px/1.7 system-ui;max-width:720px;margin:60px auto;padding:24px}li{margin:12px 0}</style><h1>Account menu preview</h1><p>Real frontend with a synthetic account and local API fixtures. No live login or backend. Profile saves only change this preview process.</p><ul><li><a href="/site.html?theme=light#/feed">Established account · 中文 · light</a></li><li><a href="/site.html?theme=dark&locale=en#/feed">Established account · English · dark</a></li><li><a href="/site.html?new=1&theme=light#/feed">New account · optional getting started</a></li><li><a href="/site.html?long=1&new=1&theme=dark&locale=en#/feed">Long name · English · dark</a></li><li><a href="/site.html?guest=1#/feed">Signed out</a></li></ul></html>`);return;
    }
    if(url.pathname==='/api/auth/config')return json({provider:'sites',configured:true,environment:'local'});
    if(url.pathname==='/api/me')return params.has('guest')?json(error('Signed out fixture'),401):json({user,onboarding});
    if(url.pathname==='/api/me/profile'&&req.method==='POST'){
      let body='';for await(const chunk of req)body+=chunk;
      const input=JSON.parse(body),saved={...user,...Object.fromEntries(['name','bio','headline','website'].map(k=>[k,String(input[k]??user[k])]))};
      profiles.set(key,saved);return json({user:saved});
    }
    if(url.pathname==='/api/notifications/summary')return json({recipientId:user.id,hasUnread:false,snapshot:0});
    if(url.pathname==='/api/cards/me')return json({error:{code:'CARD_NOT_FOUND',message:'No card in this fixture'}},404);
    if(url.pathname==='/api/creators/account-preview')return json({creator:{...user,counts:{works:0,followers:0,following:0}},card:null});
    if(url.pathname==='/api/creators')return json({creators:[],nextCursor:null,total:0});
    if(url.pathname==='/api/works')return json({works:[],nextCursor:null,total:0});
    if(['/api/discover','/api/public/discover'].includes(url.pathname))return json({works:[],nextCursor:null,total:0});
    if(url.pathname.startsWith('/api/'))return json(error('This endpoint is outside the menu preview'),404);
    if(url.pathname.startsWith('/signout-')){res.writeHead(302,{Location:'/site.html?guest=1#/feed'}).end();return;}
    const file=resolve(root,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(root))return json(error('Not found'),404);
    const override=baseline&&['/site.js','/surface.css','/creator-social.css'].includes(url.pathname)?resolve(baseline,url.pathname.slice(1)):file;
    let data=await readFile(override);
    if(url.pathname==='/site.html'){
      const setup=`<script>localStorage.setItem('tryme.opening.seen.v1','1');localStorage.setItem('funtrack.locale',${JSON.stringify(params.get('locale')==='en'?'en':'zh-CN')});localStorage.setItem('funtrack.theme',${JSON.stringify(params.get('theme')==='dark'?'dark':'light')});</script>`;
      data=data.toString().replace('<head>','<head>'+setup).replace('</body>','<p style="position:fixed;bottom:0;left:0;margin:0;padding:4px 8px;background:#26333e;color:#fff;font:11px system-ui;z-index:10">LOCAL FIXTURE · Account menu preview</p></body>');
    }
    res.writeHead(200,{'Content-Type':(types[extname(file)]||'application/octet-stream')+'; charset=utf-8'}).end(data);
  }catch(e){json(error(e.code==='ENOENT'?'Not found':'Preview error'),e.code==='ENOENT'?404:500);}
}).listen(port,'127.0.0.1',()=>console.log(`Account menu fixture: ${origin}${baseline?' (baseline)':''}`));
