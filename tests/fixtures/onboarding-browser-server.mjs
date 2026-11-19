// Loopback acceptance fixture: real UI/router/SQLite, fictional new accounts.
// No Clerk session, cloud writes, or production data. Never deploy this server.
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fixture, handleAPI, OWNER } from '../helpers/router-fixture.mjs';

const cleanup=[], f=fixture({after:fn=>cleanup.push(fn)});
const root=path.resolve(fileURLToPath(new URL('../../public/',import.meta.url))), port=4898, base=`http://127.0.0.1:${port}`;
const created=String(Date.now()), users={a:'clerk:onboarding-a',b:'clerk:onboarding-b',existing:OWNER};
let account='a', failure=false;
for(const [index,name] of ['Orbit','Prism Breaker','Memory Tide'].entries()) {
  const cover=['orbit','prism-breaker','memory-tide'][index];
  const result=await f.publish({name,bytes:`<!doctype html><html><body>${name}</body></html>`,extra:{cover:new File([await readFile(path.join(root,'examples',cover+'.png'))],'cover.png',{type:'image/png'})}});
  if(result.status!==201)throw Error(JSON.stringify(result));
}
const send=(res,body,type='text/html',status=200)=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,base);
  try {
    if(url.pathname==='/__onboarding') {
      if(Object.hasOwn(users,url.searchParams.get('account')))account=url.searchParams.get('account');
      if(url.searchParams.has('failure'))failure=url.searchParams.get('failure')==='1';
      return send(res,JSON.stringify({account,failure,saved:f.count('ft_onboarding')}),'application/json');
    }
    if(url.pathname==='/api/auth/config')return send(res,JSON.stringify({provider:'sites',configured:true}),'application/json');
    if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/media/')) {
      if(failure&&url.pathname==='/api/me/onboarding')return send(res,JSON.stringify({error:{message:'本地验收：保存暂时失败',code:'FIXTURE_FAILURE'}}),'application/json',503);
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const headers=new Headers(req.headers);
      headers.set('oai-authenticated-user-id',users[account]);
      headers.set('oai-authenticated-user-email',account+'@example.test');
      headers.set('oai-authenticated-user-full-name','');
      headers.set('oai-authenticated-user-created-at',created);
      if(url.pathname.startsWith('/media/'))url.pathname='/api'+url.pathname;
      const response=await handleAPI(new Request(url,{method:req.method,headers,...!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{}}));
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const pathname=url.pathname==='/'?'/site.html':url.pathname;
    const file=path.resolve(root,'.'+decodeURIComponent(pathname));
    if(!file.startsWith(root+path.sep))return send(res,'Not found','text/plain',404);
    const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
    send(res,await readFile(file),types[path.extname(file)]||'application/octet-stream');
  } catch(error) {send(res,JSON.stringify({error:error.message}),'application/json',500);}
});
server.listen(port,'127.0.0.1',()=>console.log(`Onboarding acceptance: ${base}/site.html#/feed`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.closeAllConnections();server.close(()=>{cleanup.forEach(fn=>fn());process.exit(0);});});
