// Local-only review harness; real router/SQLite/public assets, fake identity.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fixture,OWNER,handleAPI,gameResponse} from '../helpers/router-fixture.mjs';
import {createPublicSharingService} from '../../lib/funtrack/public-sharing.mjs';
const port=Number(process.env.TRYME_REVIEW_PORT||8881);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local review port');
const cleanups=[],f=fixture({after:fn=>cleanups.push(fn)}),base='http://127.0.0.1:'+port;
const brandRoot=path.resolve('design/morning-review/brand-round4');
const brandChoices=new Set(['stack-original','stack-edge','stack-seam','stack-hand']);
const requireStatus=(r,status)=>{if(r.status!==status)throw Error(JSON.stringify(r));return r;};
requireStatus(await f.api('/api/me/profile',{method:'POST',body:{name:'Pacifica · 本地验收',bio:'可以亲自体验的小作品',headline:'Creator',website:'',avatarUrl:'/avatars/moon.svg'}}),200);
const works=[];
for(const [slug,name] of [['salt-run','盐路疾行'],['orbit','Orbit · 星轨'],['tiles','点亮九宫格']]){
 const bytes=await readFile('public/examples/'+slug+'.html','utf8'),match=/data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)/.exec(bytes);
 const form=new FormData();form.set('name',name);form.set('desc','仅限本地验收的真实示例作品');form.set('source','html');form.set('file',new File([bytes],'game.html',{type:'text/html'}));
 if(match)form.set('cover',new File([Buffer.from(match[2],'base64')],'cover.'+match[1],{type:'image/'+match[1]}));
 works.push(requireStatus(await f.api('/api/works',{method:'POST',body:form}),201).work);
}
works.push(requireStatus(await f.publish({name:'小花园 · 外链样例',source:'url',url:'https://example.com/'}),201).work);
const saved=requireStatus(await f.api('/api/cards',{method:'POST',body:{name:'Pacifica · 本地验收',bio:'可以亲自体验的小作品',template:'fold',workIds:works.slice(0,2).map(w=>w.id)}}),201).card;
const sharing=createPublicSharingService({db:()=>f.db,bucket:()=>f.bucket,origin:()=>base});
const record={works:works.map(w=>({id:w.id,name:w.name,versionId:w.versionId})),oldCardId:saved.id};await mkdir('.preview/review',{recursive:true});await writeFile(port===8881?'.preview/review/fixture.json':'.preview/review/fixture-'+port+'.json',JSON.stringify(record,null,2));
const publicRoot=path.resolve('public'),types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2'};
createServer(async(req,res)=>{try{const url=new URL(req.url,base);let response;
 if(url.pathname.startsWith('/__brand/')){const name=url.pathname.slice('/__brand/'.length);if(!/^(?:(?:stack-original|stack-edge|stack-seam|stack-hand)(?:-favicon)?\.svg|main-preview\.(?:js|css))$/.test(name))throw Error('Unknown brand review asset');response=new Response(await readFile(path.join(brandRoot,name)),{headers:{'Content-Type':types[path.extname(name)]}});}
 else if(url.pathname==='/api/auth/config')response=Response.json({provider:'sites',configured:true});
 else if(url.pathname==='/fixture-state')response=Response.json({...record,cards:f.database.prepare('SELECT id,created_at FROM ft_cards').all()});
 else if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/game/')||url.pathname.startsWith('/media/')||url.pathname.startsWith('/c/')){
  const parts=[];for await(const part of req)parts.push(part);const headers=new Headers(req.headers);headers.set('oai-authenticated-user-id',OWNER);headers.set('oai-authenticated-user-email',OWNER+'@example.test');headers.set('oai-authenticated-user-full-name','Pacifica local review');
  const request=new Request(url.pathname.startsWith('/media/')?new URL('/api'+url.pathname,base):url,{method:req.method,headers,...!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(parts)}:{}});
  response=url.pathname.startsWith('/c/')?await sharing.page(request,url.pathname.split('/')[2]):url.pathname.startsWith('/game/')?await gameResponse(request,url.pathname.split('/')[2]):await handleAPI(request);
 }else{const name=['/','/site'].includes(url.pathname)?'/site.html':url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname,file=path.resolve(publicRoot,'.'+decodeURIComponent(name));if(!file.startsWith(publicRoot+path.sep))throw Error('Path rejected');let bytes=await readFile(file);if(name==='/site.html'&&brandChoices.has(url.searchParams.get('logo')))bytes=Buffer.from(bytes.toString().replace('href="/assets/tryme-icon.svg"','href="/__brand/'+url.searchParams.get('logo')+'-favicon.svg"').replace('</head>','<link rel="stylesheet" href="/__brand/main-preview.css"><script src="/__brand/main-preview.js" defer></script></head>'));if(name==='/site.html')bytes=Buffer.from(bytes.toString().replace('</body>','<div style="position:fixed;bottom:8px;left:8px;z-index:999999;padding:6px 12px;border-radius:8px;background:#faf2c4;color:#533f14;font:12px system-ui;pointer-events:none">本地验收数据 · 不连接线上</div></body>'));response=new Response(bytes,{headers:{'Content-Type':types[path.extname(file)]||'application/octet-stream'}});}
 res.writeHead(response.status,{'Cache-Control':'no-store',...Object.fromEntries(response.headers)});res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:error.message}}));}}).listen(port,'127.0.0.1',()=>console.log('Local real-app review '+base+'/site#/studio; local fixture data only'));
