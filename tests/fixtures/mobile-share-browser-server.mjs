// Loopback-only QA: actual UI, public projection, router and SQLite; synthetic
// accounts and in-memory media. The sign-in shim is NOT a Clerk/login test.
import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fixture,OTHER,handleAPI,gameResponse} from '../helpers/router-fixture.mjs';
import {createPublicSharingService} from '../../lib/funtrack/public-sharing.mjs';

const cleanup=[],f=fixture({after:fn=>cleanup.push(fn)}),root=path.resolve('public');
const port=Number(process.env.PORT||4898),base=`http://127.0.0.1:${port}`;
const checked=(result,status=200)=>{if(result.status!==status)throw Error(JSON.stringify(result));return result;};
const works=[];
for(const [index,name] of ['Orbit v1','Empty cover','Missing cover'].entries()){
  works.push(checked(await f.publish({name,bytes:`<!doctype html><button>Saved v1 ${index}</button>`,extra:index===1?{}:{cover:new File([await readFile('public/examples/orbit.png')],'cover.png',{type:'image/png'})}}),201).work);
}
const longName='LongCreatorName'.repeat(5)+'张';
checked(await f.api('/api/me/profile',{method:'POST',body:{name:longName,headline:'Independent maker · 独立创作者',bio:'Browser sharing review',avatarPreset:'moon'}}));
const cards=[];
for(const template of ['wall','editorial','filmstrip','fold','collection','city']){
  cards.push(checked(await f.api('/api/cards',{method:'POST',body:{name:longName,template,workIds:works.map(w=>w.id),signature:'Keep making',backStyle:'ink'}}),201).card);
}
// A saved v1 card must keep v1 even after the live work advances to v2.
checked(await f.version(works[0].id,{bytes:'<!doctype html><button>Live v2 must not appear</button>',revision:works[0].revision}),201);
const missing=f.database.prepare('SELECT cover_key FROM ft_work_metadata WHERE id=?').get(works[2].metadataId);
if(!missing?.cover_key)throw Error('Missing-cover fixture was not seeded');
f.objects.delete(missing.cover_key);
const sharing=createPublicSharingService({db:()=>f.db,bucket:()=>f.bucket,origin:()=>base});
const send=(res,body,type='text/html',status=200)=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,base);
  try{
    if(url.pathname==='/fixture-state')return send(res,JSON.stringify({cards:cards.map(c=>({id:c.id,template:c.template})),works,longName,events:f.count('ft_events'),sessions:f.database.prepare('SELECT work_id,version_id,actor_id FROM ft_play_sessions').all()}),'application/json');
    if(url.pathname==='/')return send(res,`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><h1>Local sharing QA — synthetic data</h1>${cards.map(c=>`<p><a href="/c/${c.id}">${c.template}</a></p>`).join('')}`);
    if(url.pathname==='/api/auth/config')return send(res,JSON.stringify({provider:'sites',configured:true}),'application/json');
    if(url.pathname==='/signin-with-chatgpt'){
      // Only reached after the real local auth page has preserved return_to.
      const target=url.searchParams.get('return_to');
      if(!target?.startsWith('/site.html#/work/'))return send(res,'Invalid test return','text/plain',400);
      res.writeHead(302,{'Location':target,'Set-Cookie':'qa-account=other; Path=/; SameSite=Lax; HttpOnly'});return res.end();
    }
    if(/^\/(api|media|c|game)\//.test(url.pathname)){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const headers=new Headers(req.headers);
      for(const key of [...headers.keys()])if(key.startsWith('oai-authenticated-'))headers.delete(key);
      const account=/(?:^|;\s*)qa-account=other(?:;|$)/.test(req.headers.cookie||'')?OTHER:null;
      if(account){headers.set('oai-authenticated-user-id',account);headers.set('oai-authenticated-user-email',account+'@example.test');}
      if(url.pathname.startsWith('/media/'))url.pathname='/api'+url.pathname;
      const request=new Request(url,{method:req.method,headers,...!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{}});
      const response=url.pathname.startsWith('/c/')?await sharing.page(request,url.pathname.split('/')[2]):url.pathname.startsWith('/game/')?await gameResponse(request,url.pathname.split('/')[2]):await handleAPI(request);
      res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));
    }
    let pathname=url.pathname==='/site'?'/site.html':url.pathname;if(pathname.endsWith('/'))pathname+='index.html';
    const file=path.resolve(root,'.'+decodeURIComponent(pathname));if(!file.startsWith(root+path.sep))return send(res,'Not found','text/plain',404);
    const types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
    send(res,await readFile(file),types[path.extname(file)]||'application/octet-stream');
  }catch(error){send(res,JSON.stringify({error:error.message}),'application/json',500);}
});
server.listen(port,'127.0.0.1',()=>console.log('Local sharing QA: '+base));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.closeAllConnections();server.close(()=>{cleanup.forEach(fn=>fn());process.exit(0);});});
