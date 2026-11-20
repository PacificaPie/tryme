// Local acceptance only: production frontend + HTTP router + SQLite; synthetic
// accounts and memory object storage. No Clerk, cloud capture or deployments.
import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {readAnalytics} from '../../lib/funtrack/analytics-query.mjs';
import {fixture,OWNER,handleAPI} from '../helpers/router-fixture.mjs';

const cleanup=[],f=fixture({after:fn=>cleanup.push(fn)},{prepublish:true});
const root=fileURLToPath(new URL('../../public/',import.meta.url));
const port=Number(process.env.CREATOR_WORKSPACE_PORT||4937),base=`http://127.0.0.1:${port}`;
const users={existing:OWNER,empty:'workspace-empty',archived:'workspace-archived'};
const checked=(r,status=200)=>{if(r.status!==status)throw Error(JSON.stringify(r));return r;};
for(const [account,name] of [['existing','小小世界工作室'],['empty','新创作者'],['archived','往日作品集']]){
  checked(await f.api('/api/me/onboarding',{method:'POST',owner:users[account],body:{intent:'create',name}}));
}
const works=[];
for(const [i,name] of ['Orbit · 轨道之间','Prism · 棱镜漫游','Memory Tide · 潮汐记忆'].entries()){
  const bytes=`<!doctype html><html><body><button>${name}</button></body></html>`;
  const form=new FormData();form.set('id',crypto.randomUUID());form.set('source','html');form.set('file',new File([bytes],'game.html',{type:'text/html'}));
  const draft=checked(await f.api('/api/publish-drafts',{method:'POST',body:form}));
  works.push(checked(await f.publish({name,bytes,category:'game',extra:{draftId:draft.id,coverChoice:'manual',videoChoice:'skip',cover:new File([await readFile(path.join(root,'examples',['orbit','prism-breaker','memory-tide'][i]+'.png'))],'cover.png',{type:'image/png'})}}),201).work);
}
const card=checked(await f.api('/api/cards',{method:'POST',body:{name:'小小世界工作室',template:'wall',workIds:works.slice(0,2).map(w=>w.id)}}),201).card;
const old=f.seed({owner:users.archived});
checked(await f.api('/api/works/'+old.id+'/archive',{method:'POST',owner:users.archived,body:{action:'archive',expectedRevision:1}}));
// Keep seeded snapshots visible to the acceptance runner for immutability checks.
const writes=[];
const send=(res,body,type='application/json',status=200)=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));};
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,base);
  try{
    if(url.pathname==='/__workspace'){
      const account=url.searchParams.get('account');
      if(account&&Object.hasOwn(users,account))res.setHeader('Set-Cookie',`workspace-account=${account}; Path=/; SameSite=Lax`);
      return send(res,{works:works.map(w=>w.id),card:card.id,writes,cards:f.database.prepare('SELECT id,snapshot_json FROM ft_cards ORDER BY rowid').all(),versions:f.database.prepare('SELECT * FROM ft_work_versions ORDER BY rowid').all()});
    }
    if(url.pathname==='/api/auth/config')return send(res,{provider:'sites',configured:true});
    if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/media/')){
      const account=/workspace-account=(\w+)/.exec(req.headers.cookie||'')?.[1]||'existing',owner=users[account]||OWNER;
      if(url.pathname==='/api/analytics')return send(res,await readAnalytics(url,{id:owner},f.db));
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const headers=new Headers(req.headers);headers.set('oai-authenticated-user-id',owner);headers.set('oai-authenticated-user-email',owner+'@example.test');headers.set('oai-authenticated-user-full-name',owner);
      if(url.pathname.startsWith('/media/'))url.pathname='/api'+url.pathname;
      const response=await handleAPI(new Request(url,{method:req.method,headers,...!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{}}));
      if(req.method!=='GET')writes.push({path:url.pathname,method:req.method,status:response.status,owner});
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const pathname=['/','/site'].includes(url.pathname)?'/site.html':url.pathname;
    const file=path.resolve(root,'.'+decodeURIComponent(pathname));if(!file.startsWith(root))return send(res,'Not found','text/plain',404);
    const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml'};
    send(res,await readFile(file),types[path.extname(file)]||'application/octet-stream');
  }catch(error){send(res,{error:{message:error.message}},'application/json',500);}
});
server.listen(port,'127.0.0.1',()=>console.log(`Workspace fixture: ${base}/site.html#/studio/works`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.closeAllConnections();server.close(()=>{cleanup.forEach(fn=>fn());process.exit(0);});});
