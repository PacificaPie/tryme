// Loopback-only browser fixture: real site modules, HTTP router, SQLite and
// in-memory object storage. No production branch, cloud API, or real user data.
// Run from the repository root: node tests/fixtures/comment-context-browser-server.mjs
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fixture, OWNER, OTHER, handleAPI, gameResponse } from '../helpers/router-fixture.mjs';

const cleanups=[],f=fixture({after:callback=>cleanups.push(callback)}),port=Number(process.env.FUNTRACK_COMMENT_FIXTURE_PORT||4875);
const base=`http://127.0.0.1:${port}`,publicRoot=path.resolve(fileURLToPath(new URL('../../public/',import.meta.url)));
function checked(result,status=200){if(result.status!==status)throw Error(JSON.stringify(result));return result;}
const published=checked(await f.publish({name:'Comment version fixture'}),201).work;
const old=checked(await f.api('/api/cards',{method:'POST',body:{name:'Fixture creator',bio:'Fixed v1 snapshot',template:'fold',workIds:[published.id]},key:randomUUID()}),201).card;
const post=async(body,versionId,parentId=null,owner=OTHER)=>checked(await f.api(`/api/works/${published.id}/comments`,{method:'POST',body:{body,parentId,...(versionId===undefined?{}:{versionId})},owner,key:randomUUID()}),201).comment;
const oldRoot=await post('旧版根评论：这条在普通列表第二页。',published.versionId);
const replies=[];
for(let i=0;i<6;i++)replies.push(await post(`旧版回复 ${i+1}${i===5?'：定位目标，超过默认三条回复。':''}`,published.versionId,oldRoot.id));
const unknown=await post('历史评论：没有可靠版本记录，保持未知。',undefined);
checked(await f.version(published.id),201);
const current=checked(await f.get(published.id)).work;
const newReply=await post('v2 回复 v1 的根评论：版本属于回复自己的上下文。',current.versionId,oldRoot.id);
for(let i=0;i<23;i++)await post(`当前版本评论 ${i+1}`,current.versionId,null,i%2?OWNER:'fixture-second-reader');
const missing=randomUUID(),deepReply=replies.at(-1);
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const routes={
  '互动列表（作者）':'#/studio/feedback',
  '当前 v2 讨论':`#/work/${current.id}?discussion=1`,
  '旧名片固定 v1（可提交新评论）':`#/work/${published.id}?card=${old.id}&discussion=1`,
  '定位第二页根评论（v1）':`#/work/${current.id}?comment=${oldRoot.id}`,
  '定位第六条回复（v1）':`#/work/${current.id}?comment=${deepReply.id}`,
  '定位新版本回复（v2）':`#/work/${current.id}?comment=${newReply.id}`,
  '定位未知版本旧评论':`#/work/${current.id}?comment=${unknown.id}`,
  '不存在的评论':`#/work/${current.id}?comment=${missing}`,
};
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
function send(response,body,type='text/html',status=200,extra={}){response.writeHead(status,{...headers,'Content-Type':`${type}; charset=utf-8`,...extra});response.end(body);}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,base);
  try{
    if(url.pathname==='/'){
      send(res,`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Comment context fixture</title><h1>评论版本 · 本地 SQLite 验收</h1><p>真实前端与 API，仅本地测试身份和存储。发布作品当前为 v2，旧名片固定 v1。</p>${Object.entries(routes).map(([label,route])=>`<p><a href="/fixture?route=${encodeURIComponent(route)}">${esc(label)}</a> · <a href="/fixture?route=${encodeURIComponent(route)}&lang=en&theme=dark">EN / dark</a></p>`).join('')}<p><a href="/fixture-state">查看 SQLite 评论快照</a></p>`);return;
    }
    if(url.pathname==='/fixture'){
      const route=Object.values(routes).includes(url.searchParams.get('route'))?url.searchParams.get('route'):routes['互动列表（作者）'];
      send(res,`<script>localStorage.setItem('funtrack.locale',${JSON.stringify(url.searchParams.get('lang')==='en'?'en':'zh-CN')});localStorage.setItem('funtrack.theme',${JSON.stringify(url.searchParams.get('theme')==='dark'?'dark':'light')});location.replace(${JSON.stringify('/site.html'+route)});</script>`);return;
    }
    if(url.pathname==='/fixture-state'){
      send(res,JSON.stringify({currentVersionId:current.versionId,oldVersionId:published.versionId,workId:current.id,cardId:old.id,rootId:oldRoot.id,deepReplyId:deepReply.id,comments:f.database.prepare('SELECT id,body,parent_id,version_id FROM ft_comments ORDER BY seq DESC').all()},null,2),'application/json');return;
    }
    if(url.pathname==='/api/auth/config'){send(res,JSON.stringify({provider:'sites',configured:true}),'application/json');return;}
    if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/game/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const requestHeaders=new Headers(req.headers);
      requestHeaders.set('oai-authenticated-user-id',OWNER);requestHeaders.set('oai-authenticated-user-email',OWNER+'@example.test');requestHeaders.set('oai-authenticated-user-full-name','Fixture creator');
      const request=new Request(url,{method:req.method,headers:requestHeaders,...!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{}});
      const response=url.pathname.startsWith('/game/')?await gameResponse(request,url.pathname.split('/')[2]):await handleAPI(request);
      res.writeHead(response.status,{...headers,...Object.fromEntries(response.headers)});res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const file=path.resolve(publicRoot,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(publicRoot+path.sep)){send(res,'Not found','text/plain',404);return;}
    const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'};
    send(res,await readFile(file),types[path.extname(file)]||'application/octet-stream');
  }catch(error){send(res,JSON.stringify({error:{message:error.message}}),'application/json',500);}
});
server.listen(port,'127.0.0.1',()=>process.stdout.write(`Comment context fixtures: ${base}/\n`));
function stop(){server.close(()=>{cleanups.forEach(callback=>callback());process.exit(0);});}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
