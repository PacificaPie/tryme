// Loopback-only fault injection: real site modules/router/SQLite, fake local
// identity and storage. Never run this as a deployed Worker or with cloud data.
import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {fixture,OWNER,OTHER,handleAPI} from '../helpers/router-fixture.mjs';
const cleanups=[],f=fixture({after:fn=>cleanups.push(fn)}),port=Number(process.env.FUNTRACK_RELIABILITY_PORT||4896);
const base=`http://127.0.0.1:${port}`,root=path.resolve(fileURLToPath(new URL('../../public/',import.meta.url)));
const {work}=await f.publish({name:'F09 reliability fixture'});
await f.api(`/api/works/${work.id}/comments`,{method:'POST',body:{body:'Baseline comment',versionId:work.versionId},owner:OTHER});
let account=OWNER,holdNext=false,held=[],aborted=0;const writes=[];
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,base),send=(value,type='application/json',status=200)=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
  try{
    if(url.pathname==='/__fixture/control'){
      if(url.searchParams.has('account'))account=url.searchParams.get('account')==='b'?OTHER:OWNER;
      if(url.searchParams.has('hold'))holdNext=true;
      if(url.searchParams.has('release')){for(const finish of held)finish();held=[];}
      send({account,holdNext,held:held.length,aborted});return;
    }
    if(url.pathname==='/__fixture/state'){send({account,workId:work.id,aborted,held:held.length,writes,profiles:f.database.prepare('SELECT * FROM ft_profiles').all(),comments:f.database.prepare('SELECT body,author_id FROM ft_comments').all()});return;}
    if(url.pathname==='/'){
      send(`<!doctype html><meta charset="utf-8"><h1>F09 local reliability fixture</h1><a href="/site.html#/work/${work.id}?discussion=1">Discussion</a> · <a href="/site.html#/studio/works">Creator workspace</a> · <a href="/mobile">390px discussion</a>`, 'text/html');return;
    }
    if(url.pathname==='/mobile'){
      send(`<!doctype html><meta charset="utf-8"><style>body{margin:12px;background:#eee}iframe{width:390px;height:844px;border:0;background:white}</style><iframe title="390px real site" src="/site.html#/work/${work.id}?discussion=1"></iframe>`,'text/html');return;
    }
    if(url.pathname==='/api/auth/config'){send({provider:'sites',configured:true});return;}
    if(url.pathname.startsWith('/api/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const headers=new Headers(req.headers);headers.set('oai-authenticated-user-id',account);headers.set('oai-authenticated-user-email',account+'@example.test');headers.set('oai-authenticated-user-full-name',account===OWNER?'Account A':'Account B');
      const request=new Request(url,{method:req.method,headers,...!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{}});
      const response=await handleAPI(request),bytes=Buffer.from(await response.arrayBuffer());
      const finish=()=>{if(res.destroyed)return;res.writeHead(response.status,Object.fromEntries(response.headers));res.end(bytes);};
      if(req.method!=='GET')writes.push({path:url.pathname,account,expected:headers.get('X-Funtrack-Expected-User'),status:response.status});
      if(holdNext&&req.method==='GET'&&url.pathname===`/api/works/${work.id}/comments`){holdNext=false;held.push(finish);res.on('close',()=>{if(!res.writableEnded)aborted++;});return;}
      finish();return;
    }
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(root+path.sep)){send('Not found','text/plain',404);return;}
    const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
    send(await readFile(file),types[path.extname(file)]||'application/octet-stream');
  }catch(error){send({error:{message:error.message}},'application/json',500);}
});
server.listen(port,'127.0.0.1',()=>process.stdout.write(`F09 local fixture: ${base}/ (work ${work.id})\n`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.closeAllConnections();server.close(()=>{cleanups.forEach(fn=>fn());process.exit(0);});});
