// Loopback-only acceptance fixture. Real router, modules and SQLite; fictional
// identities/data. No cloud bindings, credentials, notification mocks or writes.
import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {fixture,OWNER,OTHER,REVIEWER,handleAPI,gameResponse} from '../helpers/router-fixture.mjs';

const cleanup=[],f=fixture({after:fn=>cleanup.push(fn)},{through:18});
const publicRoot=fileURLToPath(new URL('../../public/',import.meta.url));
let user=OWNER,base,fail=false;
const checked=(value,status=200)=>{if(value.status!==status)throw Error(JSON.stringify(value));return value;};
for(const [id,name,avatarPreset] of [[OWNER,'Pacifica','moon'],[OTHER,'阿禾','sprout'],[REVIEWER,'林夏','sun'],['inbox-third','小满','wave']])checked(await f.api('/api/me/profile',{method:'POST',owner:id,body:{name,avatarPreset}}));
const work=checked(await f.publish({name:'隔窗有雨 · 本地演示'}),201).work;
checked(await f.api('/api/works/'+work.id+'/comments',{method:'POST',owner:OTHER,body:{body:'迁移前的历史评论，不能变成未读提醒。'}}),201);
f.migrate();
for(const owner of [OTHER,REVIEWER,'inbox-third'])checked(await f.api('/api/works/'+work.id+'/like',{method:'POST',owner,body:{liked:true}}));
const root=checked(await f.api('/api/works/'+work.id+'/comments',{method:'POST',owner:OTHER,body:{body:'最后一扇窗的解法很巧，想知道你是怎么设计的。',versionId:work.versionId}}),201).comment;
const mine=checked(await f.api('/api/works/'+work.id+'/comments',{method:'POST',body:{body:'可以留意窗外的声音。',versionId:work.versionId}}),201).comment;
checked(await f.api('/api/works/'+work.id+'/comments',{method:'POST',owner:REVIEWER,body:{body:'我也试了一次，声音的提示确实很有用。',parentId:mine.id,versionId:work.versionId}}),201);
checked(await f.api('/api/comments/'+mine.id+'/like',{method:'POST',owner:OTHER,body:{liked:true}}));
checked(await f.api('/api/creators/'+OWNER+'/follow',{method:'POST',owner:'inbox-third',body:{following:true}}));
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
function send(res,body,type='text/html',status=200){res.writeHead(status,{...headers,'Content-Type':type+'; charset=utf-8'});res.end(body);}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,base);
  try{
    if(url.pathname==='/'){
      send(res,`<!doctype html><meta charset="utf-8"><title>TryMe local activity fixture</title><h1>站内互动 · 本地演示数据</h1><p><a href="/site.html#/feed">打开主站</a> · <a href="/site.html#/notifications">互动消息</a> · <a href="/site.html#/studio/works">创作中心</a> · <a href="/site.html#/studio/feedback">旧互动链接</a></p><p>当前身份：${user||'未登录'}</p><form method="post" action="/__fixture"><button name="action" value="owner">切为作者</button><button name="action" value="other">切为阿禾</button><button name="action" value="empty">切为空账号</button><button name="action" value="guest">退出登录</button><button name="action" value="fail">切换加载失败</button><button name="action" value="new">新增演示评论</button><button name="action" value="delete">删除演示评论</button></form>`);return;
    }
    if(url.pathname==='/__fixture'&&req.method==='POST'){
      let body='';for await(const chunk of req)body+=chunk;const action=new URLSearchParams(body).get('action');
      if(action==='owner')user=OWNER;if(action==='other')user=OTHER;if(action==='empty')user='empty-account';if(action==='guest')user=null;if(action==='fail')fail=!fail;
      if(action==='new')checked(await f.api('/api/works/'+work.id+'/comments',{method:'POST',owner:OTHER,body:{body:'刚刚到达的新评论 '+Date.now()}}),201);
      if(action==='delete')f.database.prepare('DELETE FROM ft_comments WHERE id=?').run(root.id);
      res.writeHead(303,{Location:'/'});res.end();return;
    }
    if(url.pathname==='/__fixture-state'){send(res,JSON.stringify({user,workId:work.id,rows:f.database.prepare('SELECT * FROM ft_notifications').all()}),'application/json');return;}
    if(url.pathname==='/api/auth/config'){send(res,JSON.stringify({provider:'sites',configured:true}),'application/json');return;}
    if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/game/')){
      if(fail&&url.pathname.startsWith('/api/notifications')){send(res,JSON.stringify({error:{code:'FIXTURE_UNAVAILABLE',message:'暂时无法加载互动'}}),'application/json',503);return;}
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const requestHeaders=new Headers(req.headers);
      for(const name of ['oai-authenticated-user-id','oai-authenticated-user-email','oai-authenticated-user-full-name'])requestHeaders.delete(name);
      if(user){requestHeaders.set('oai-authenticated-user-id',user);requestHeaders.set('oai-authenticated-user-email',user+'@example.test');requestHeaders.set('oai-authenticated-user-full-name',user);}
      const request=new Request(url,{method:req.method,headers:requestHeaders,...!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{}});
      const result=url.pathname.startsWith('/game/')?await gameResponse(request,url.pathname.split('/')[2]):await handleAPI(request);
      res.writeHead(result.status,{...headers,...Object.fromEntries(result.headers)});res.end(Buffer.from(await result.arrayBuffer()));return;
    }
    const file=path.resolve(publicRoot,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(publicRoot)){send(res,'Not found','text/plain',404);return;}
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
    let content=await readFile(file);
    if(url.pathname==='/site.html')content=content.toString().replace('<title>TryMe</title>','<title>TryMe · 本地演示数据</title>');
    send(res,content,types[path.extname(file)]||'application/octet-stream');
  }catch(error){send(res,JSON.stringify({error:{message:error.message}}),'application/json',500);}
});
server.listen(0,'127.0.0.1',()=>{base='http://127.0.0.1:'+server.address().port;process.stdout.write(base+'/\n');});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>{cleanup.forEach(fn=>fn());process.exit(0);}));
