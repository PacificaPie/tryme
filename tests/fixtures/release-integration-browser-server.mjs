// Combined #20/#21/#25 loopback QA: real UI/router/SQL; synthetic identities,
// in-memory storage, production prepublish gate ON, no real cloud capture.
// Exposes local-only fault controls for the reviewer; never deploy this fixture.
import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fixture,OWNER,OTHER,handleAPI} from '../helpers/router-fixture.mjs';
import {createPublicSharingService} from '../../lib/funtrack/public-sharing.mjs';
import {creatorCardPreview} from '../../public/creator-home.js';
import {CARD_TEMPLATES} from '../../public/card-templates.js';
const cleanup=[],f=fixture({after:fn=>cleanup.push(fn)},{prepublish:true}),port=4897,base=`http://127.0.0.1:${port}`,root=path.resolve('public');
const checked=(r,status=200)=>{if(r.status!==status)throw Error(JSON.stringify(r));return r;};
let account=OWNER,holdNext=false,held=[],aborted=0;const writes=[];
const works=[];
async function publish(args){
  const body=new FormData();body.set('id',crypto.randomUUID());body.set('source','html');body.set('file',new File([args.bytes],'seed.html',{type:'text/html'}));
  const draft=checked(await f.api('/api/publish-drafts',{method:'POST',body}));
  return f.publish({...args,extra:{...args.extra,draftId:draft.id,coverChoice:args.extra?.cover?'manual':'skip',videoChoice:'skip'}});
}
for(const [index,name] of ['Orbit','Prism','Website'].entries()){
  const extra=index<2?{cover:new File([await readFile(`public/examples/${index?'prism-breaker':'orbit'}.png`)],'cover.png',{type:'image/png'})}:{};
  works.push(checked(await publish({name,bytes:`<html><body>${name}</body></html>`,extra}),201).work);
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
    if(url.pathname==='/')return send(res,`<!doctype html><meta charset="utf-8"><h1>Release integration QA</h1><p><a href="/site.html#/cards">My card</a></p><p><a href="/site.html#/author/${encodeURIComponent(OWNER)}">Profile</a></p><p><a href="/site.html#/cards/covers/${original.id}">Cover updates</a></p><p><a href="/miniatures">All template previews</a></p><p><a href="/c/${original.id}">Original public card</a></p>`);
    if(url.pathname==='/miniatures')return send(res,`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/site.css"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/profile-editor.css"><link rel="stylesheet" href="/creator-home.css"><link rel="stylesheet" href="/card-workspace.css"><link rel="stylesheet" href="/card-miniature.css"><main style="max-width:1100px;margin:32px auto;padding:20px"><h1>Saved template previews</h1><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:20px">${cards.map(c=>`<section><h2>${c.template}</h2><a class="creator-card-stage" href="/c/${c.id}">${creatorCardPreview(c,{safeCover:v=>v?.replace('/media/','/api/media/')})}</a></section>`).join('')}</div></main>`);
    if(url.pathname==='/fixture-control'){
      if(url.searchParams.has('account'))account=url.searchParams.get('account')==='b'?OTHER:OWNER;
      if(url.searchParams.has('hold'))holdNext=true;
      if(url.searchParams.has('release')){held.forEach(fn=>fn());held=[];}
      return send(res,JSON.stringify({account,holdNext,aborted}),'application/json');
    }
    if(url.pathname==='/fixture-state')return send(res,JSON.stringify({originalId:original.id,account,aborted,writes,works:f.database.prepare('SELECT id,current_version_id FROM ft_works').all(),cards:f.database.prepare('SELECT id,snapshot_json FROM ft_cards ORDER BY rowid').all(),comments:f.database.prepare('SELECT id,author_id,body FROM ft_comments').all(),privateDrafts:f.count('ft_publish_drafts')}),'application/json');
    if(url.pathname==='/api/auth/config')return send(res,JSON.stringify({provider:'sites',configured:true}),'application/json');
    if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/media/')||url.pathname.startsWith('/c/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const headers=new Headers(req.headers);headers.set('oai-authenticated-user-id',account);headers.set('oai-authenticated-user-email',account+'@example.test');headers.set('oai-authenticated-user-full-name',account===OWNER?'Local card review':'Account B');
      if(url.pathname.startsWith('/media/'))url.pathname='/api'+url.pathname;
      const request=new Request(url,{method:req.method,headers,...!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{}});
      const response=url.pathname.startsWith('/c/')?await publicSharing.page(request,url.pathname.split('/')[2]):await handleAPI(request);
      const bytes=Buffer.from(await response.arrayBuffer()),finish=()=>{if(res.destroyed)return;res.writeHead(response.status,Object.fromEntries(response.headers));res.end(bytes);};
      if(req.method!=='GET')writes.push({path:url.pathname,account,expected:headers.get('X-Funtrack-Expected-User'),status:response.status});
      if(holdNext&&req.method==='GET'&&/^\/api\/works\/[^/]+\/comments$/.test(url.pathname)){holdNext=false;held.push(finish);res.on('close',()=>{if(!res.writableEnded)aborted++;});return;}
      finish();return;
    }
    let pathname=url.pathname==='/site'?'/site.html':url.pathname;if(pathname.endsWith('/'))pathname+='index.html';
    const file=path.resolve(root,'.'+decodeURIComponent(pathname));if(!file.startsWith(root+path.sep))return send(res,'Not found','text/plain',404);
    const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
    send(res,await readFile(file),types[path.extname(file)]||'application/octet-stream');
  }catch(e){send(res,JSON.stringify({error:e.message}),'application/json',500);}
});
server.listen(port,'127.0.0.1',()=>console.log('Release integration QA: '+base+'/'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.closeAllConnections();server.close(()=>{cleanup.forEach(fn=>fn());process.exit(0);});});
