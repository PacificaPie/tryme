// Loopback QA only: production UI/router with test identity and in-memory DB/R2.
import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fixture,OWNER,handleAPI} from '../helpers/router-fixture.mjs';
import {createPublicSharingService} from '../../lib/funtrack/public-sharing.mjs';
import {creatorCardPreview} from '../../public/creator-home.js';
import {CARD_TEMPLATES} from '../../public/card-templates.js';
const cleanup=[],f=fixture({after:fn=>cleanup.push(fn)}),port=4879,base=`http://127.0.0.1:${port}`,root=path.resolve('public');
const checked=(r,status=200)=>{if(r.status!==status)throw Error(JSON.stringify(r));return r;};
const works=[];
for(const [index,name] of ['Orbit','Prism','Website'].entries()){
  const extra=index<2?{cover:new File([await readFile(`public/examples/${index?'prism-breaker':'orbit'}.png`)],'cover.png',{type:'image/png'})}:{};
  works.push(checked(await f.publish({name,bytes:`<html><body>${name}</body></html>`,extra}),201).work);
}
await f.api('/api/me/profile',{method:'POST',body:{name:'Local card review',headline:'Making small worlds',avatarPreset:'moon'}});
const cards=[];for(const template of [...CARD_TEMPLATES.filter(t=>t.id!=='city'),{id:'city'}])cards.push(checked(await f.api('/api/cards',{method:'POST',body:{name:'Local card review',template:template.id,workIds:works.map(w=>w.id),backStyle:'ink'}}),201).card);
const original=cards.at(-1),form=new FormData();form.set('name','Website');form.set('desc','Updated work description');form.set('expectedRevision',String(works[2].revision));form.set('cover',new File([await readFile('public/examples/memory-tide.png')],'new.png',{type:'image/png'}));
checked(await f.api('/api/works/'+works[2].id,{method:'PATCH',body:form}));
const publicSharing=createPublicSharingService({db:()=>f.db,bucket:()=>f.bucket,origin:()=>base});
const send=(res,body,type='text/html',status=200)=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,base);
  try{
    if(url.pathname==='/')return send(res,`<!doctype html><meta charset="utf-8"><h1>Local card QA</h1><p><a href="/site.html#/cards">My card</a></p><p><a href="/site.html#/author/${encodeURIComponent(OWNER)}">Profile</a></p><p><a href="/site.html#/cards/covers/${original.id}">Cover updates</a></p><p><a href="/miniatures">All template previews</a></p><p><a href="/c/${original.id}">Original public card</a></p>`);
    if(url.pathname==='/miniatures')return send(res,`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/site.css"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/profile-editor.css"><link rel="stylesheet" href="/creator-home.css"><link rel="stylesheet" href="/card-workspace.css"><link rel="stylesheet" href="/card-miniature.css"><main style="max-width:1100px;margin:32px auto;padding:20px"><h1>Saved template previews</h1><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:20px">${cards.map(c=>`<section><h2>${c.template}</h2><a class="creator-card-stage" href="/c/${c.id}">${creatorCardPreview(c,{safeCover:v=>v?.replace('/media/','/api/media/')})}</a></section>`).join('')}</div></main>`);
    if(url.pathname==='/fixture-state')return send(res,JSON.stringify({originalId:original.id,cards:f.database.prepare('SELECT id,snapshot_json FROM ft_cards ORDER BY rowid').all()}),'application/json');
    if(url.pathname==='/api/auth/config')return send(res,JSON.stringify({provider:'sites',configured:true}),'application/json');
    if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/media/')||url.pathname.startsWith('/c/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const headers=new Headers(req.headers);headers.set('oai-authenticated-user-id',OWNER);headers.set('oai-authenticated-user-email',OWNER+'@example.test');headers.set('oai-authenticated-user-full-name','Local card review');
      if(url.pathname.startsWith('/media/'))url.pathname='/api'+url.pathname;
      const request=new Request(url,{method:req.method,headers,...!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{}});
      const response=url.pathname.startsWith('/c/')?await publicSharing.page(request,url.pathname.split('/')[2]):await handleAPI(request);
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    let pathname=url.pathname==='/site'?'/site.html':url.pathname;if(pathname.endsWith('/'))pathname+='index.html';
    const file=path.resolve(root,'.'+decodeURIComponent(pathname));if(!file.startsWith(root+path.sep))return send(res,'Not found','text/plain',404);
    const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
    send(res,await readFile(file),types[path.extname(file)]||'application/octet-stream');
  }catch(e){send(res,JSON.stringify({error:e.message}),'application/json',500);}
});
server.listen(port,'127.0.0.1',()=>console.log('Local card QA: '+base+'/'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>{cleanup.forEach(fn=>fn());process.exit(0);}));
