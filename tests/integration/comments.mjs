// Comment and template checks against a real local D1 Worker only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const base=new URL(process.env.FUNTRACK_TEST_URL||'http://127.0.0.1:8767');
assert(['localhost','127.0.0.1','[::1]'].includes(base.hostname),'Only loopback test identities are allowed.');
const run=randomUUID(),owner=`comment_owner_${run}`,reader=`comment_reader_${run}`,privateText=`PRIVATE-NOT-A-PUBLIC-COMMENT-${run}`;
const report={run,base:base.origin,checks:[],startedAt:new Date().toISOString()};
async function request(path,{method='GET',user=owner,json,form,headers={}}={}){
  const response=await fetch(new URL(path,base),{method,headers:{...(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':`${user}@sites.test`}:{}),...(method==='POST'?{Origin:base.origin,'X-Funtrack-CSRF':'1'}:{}),...(json!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:form||(json!==undefined?JSON.stringify(json):undefined)});
  const raw=await response.text();let body;try{body=JSON.parse(raw);}catch{body=raw;}return {status:response.status,body};
}
function ok(response,status=200){assert.equal(response.status,status,JSON.stringify(response.body).slice(0,500));return response.body;}
async function check(name,fn){await fn();report.checks.push(name);console.log(`PASS ${name}`);}
async function createWork(name,user=owner){const form=new FormData();form.set('name',name);form.set('desc','Local comment boundary verification.');form.set('source','url');form.set('url','https://example.com/game/'+randomUUID());return ok(await request('/api/works',{method:'POST',user,form,headers:{'Idempotency-Key':randomUUID()}}),201).work;}
const work=await createWork('Comment test'),secondWork=await createWork('Other work'),readerWork=await createWork('Reader owned work',reader);
const path=`/api/works/${work.id}/comments`;
const post=(body,{user=reader,parentId=null,key=randomUUID(),workId=work.id,extra={}}={})=>request(`/api/works/${workId}/comments`,{method:'POST',user,json:{body,parentId,...extra},headers:{'Idempotency-Key':key}});
let root,creatorRoot;const replies=[];
await check('comment auth, CSRF and legacy private feedback isolation',async()=>{
  assert.equal((await request(path,{user:null})).status,401);
  assert.equal((await request(path,{method:'POST',json:{body:'test'},headers:{Origin:'null','Idempotency-Key':randomUUID()}})).status,403);
  assert.equal((await request(path,{method:'POST',json:{body:'missing key'}})).status,422);
  assert.equal((await request('/api/comments')).status,422);
  ok(await request('/api/feedback',{method:'POST',user:reader,json:{workId:work.id,text:privateText,type:'建议',eventId:randomUUID()}}),201);
  const empty=ok(await request(path));assert.equal(empty.commentsCount,0);assert.deepEqual(empty.comments,[]);
  assert.equal(ok(await request('/api/works/'+work.id)).work.commentsCount,0);
  assert(ok(await request('/api/feedback')).feedback.some(f=>f.text===privateText));
});
await check('concurrent comment retries persist once and identity cannot be supplied in the body',async()=>{
  const key=randomUUID(),body='公开评论 <b>保留为文字</b>';
  const responses=await Promise.all(Array.from({length:5},()=>post(body,{key,extra:{authorId:owner,authorName:'Fake creator',isCreator:true}})));
  for(const response of responses)assert([200,201].includes(response.status),JSON.stringify(response.body));
  root=responses[0].body.comment;assert.equal(new Set(responses.map(r=>r.body.comment.id)).size,1);
  assert.equal(responses.filter(r=>r.status===201).length,1);assert.equal(root.authorId,reader);assert.equal(root.isCreator,false);assert.equal(root.body,body);assert(!root.authorName.includes('@'));
  assert.equal(ok(await request(path)).commentsCount,1);
  assert.equal((await post('changed',{key})).status,409);
  assert.equal((await post(body,{key,workId:secondWork.id})).status,409);
  creatorRoot=ok(await post('Creator root',{user:owner}),201).comment;assert.equal(creatorRoot.isCreator,true);
});
await check('single-level replies enforce the same work and bounded content',async()=>{
  for(let i=0;i<5;i++)replies.push(ok(await post(`Reply ${i}`,{parentId:root.id,user:i%2?reader:owner}),201).comment);
  assert.equal(replies[0].isCreator,true);assert.equal(replies[1].isCreator,false);
  assert.equal((await post('nested',{parentId:replies[0].id})).status,422);
  assert.equal((await post('cross-work',{parentId:root.id,workId:secondWork.id})).status,422);
  assert.equal((await post('missing root',{parentId:randomUUID()})).status,404);
  assert.equal((await post(' ')).status,422);assert.equal((await post('x'.repeat(1001))).status,422);
  assert.equal((await request(`/api/comments/${replies[0].id}/replies`)).status,422);
});
await check('newest-root pagination embeds only the first three oldest replies',async()=>{
  const page=ok(await request(path+'?limit=1'));assert.equal(page.commentsCount,7);assert.equal(page.comments[0].id,creatorRoot.id);assert(page.nextCursor);
  const next=ok(await request(path+'?limit=1&cursor='+encodeURIComponent(page.nextCursor)));assert.equal(next.nextCursor,null);
  const thread=next.comments[0];assert.equal(thread.id,root.id);assert.equal(thread.replyCount,5);
  assert.deepEqual(thread.replies.map(c=>c.id),replies.slice(0,3).map(c=>c.id));assert(thread.repliesNextCursor);
  assert(!JSON.stringify(next).includes(privateText));
  assert.equal((await request(`/api/works/${secondWork.id}/comments?cursor=`+encodeURIComponent(page.nextCursor))).status,400);
});
await check('reply cursors continue after embedded rows with no skips or duplicates',async()=>{
  const thread=ok(await request(path)).comments.find(c=>c.id===root.id);
  const continued=ok(await request(`/api/comments/${root.id}/replies?limit=1&cursor=`+encodeURIComponent(thread.repliesNextCursor)));
  assert.equal(continued.replyCount,5);assert.deepEqual(continued.replies.map(c=>c.id),[replies[3].id]);assert(continued.nextCursor);
  const last=ok(await request(`/api/comments/${root.id}/replies?limit=1&cursor=`+encodeURIComponent(continued.nextCursor)));
  assert.deepEqual(last.replies.map(c=>c.id),[replies[4].id]);assert.equal(last.nextCursor,null);
  const fromStart=ok(await request(`/api/comments/${root.id}/replies?limit=2`));assert.deepEqual(fromStart.replies.map(c=>c.id),replies.slice(0,2).map(c=>c.id));
  assert.equal((await request(`/api/comments/${creatorRoot.id}/replies?cursor=`+encodeURIComponent(thread.repliesNextCursor))).status,400);
  assert.equal((await request(path+'?limit=51')).status,422);
});
await check('creator inbox is scoped to owned works and never returns private feedback',async()=>{
  const elsewhere=ok(await post('On reader work',{workId:readerWork.id,user:owner}),201).comment;
  const mine=ok(await request('/api/comments?mine=1&limit=2'));assert.equal(mine.commentsCount,7);assert(mine.comments.every(c=>c.workId===work.id));assert(mine.nextCursor);
  assert(!JSON.stringify(mine).includes(privateText));
  const theirs=ok(await request('/api/comments?mine=1',{user:reader}));assert.equal(theirs.commentsCount,1);assert.equal(theirs.comments[0].id,elsewhere.id);
  assert.equal((await request('/api/comments?mine=1&cursor='+encodeURIComponent(mine.nextCursor),{user:reader})).status,400);
  const filtered=ok(await request(`/api/comments?mine=1&work=${work.id}&limit=2`));assert.equal(filtered.commentsCount,7);assert(filtered.comments.every(c=>c.workId===work.id));assert(filtered.nextCursor);
  const next=ok(await request(`/api/comments?mine=1&work=${work.id}&limit=2&cursor=`+encodeURIComponent(filtered.nextCursor)));assert.equal(next.commentsCount,7);assert(next.comments.every(c=>c.workId===work.id));
  assert.equal(ok(await request(`/api/comments?mine=1&work=${secondWork.id}`)).commentsCount,0);
  assert.equal((await request(`/api/comments?mine=1&work=${readerWork.id}`)).status,403);
  assert.equal((await request('/api/comments?mine=1&cursor='+encodeURIComponent(filtered.nextCursor))).status,400);
});
await check('comment and reply likes are real, idempotent and isolated by account',async()=>{
  const likePath=`/api/comments/${root.id}/like`,set=(liked,user=owner,extra={})=>request(likePath,{method:'POST',user,json:{liked,...extra}});
  const repeated=await Promise.all(Array.from({length:5},()=>set(true)));repeated.forEach(r=>assert.deepEqual(ok(r),{commentId:root.id,liked:true,likesCount:1}));
  assert.equal(ok(await set(true,reader)).likesCount,2);
  assert.deepEqual(ok(await set(false,owner,{actorId:reader})),{commentId:root.id,liked:false,likesCount:1});
  assert.equal(ok(await set(false)).likesCount,1);assert.equal(ok(await request(likePath,{user:reader})).liked,true);
  assert.equal((await set('true')).status,422);
  const thread=ok(await request(path,{user:reader})).comments.find(c=>c.id===root.id);assert.equal(thread.likesCount,1);assert.equal(thread.likedByMe,true);
  assert.equal(ok(await request(`/api/comments/${replies[0].id}/like`,{method:'POST',json:{liked:true}})).likesCount,1);
});
await check('work counts include only new roots and replies; old feedback remains owner-only',async()=>{
  assert.equal(ok(await request('/api/works/'+work.id)).work.commentsCount,7);
  assert.equal(ok(await request('/api/works?mine=1')).works.find(w=>w.id===work.id).commentsCount,7);
  assert.equal(ok(await request('/api/feedback')).feedback.filter(f=>f.text===privateText).length,1);
  assert.equal(ok(await request('/api/feedback',{user:reader})).feedback.some(f=>f.text===privateText),false);
  const analytics=ok(await request(`/api/analytics?work=${work.id}&days=1`));
  assert.equal(analytics.summary.feedback,1);assert.equal(analytics.summary.comments,7);
  assert.equal(analytics.byWork[0].feedback,1);assert.equal(analytics.byWork[0].comments,7);
});
await check('collection cards save while old fold snapshots remain unchanged',async()=>{
  const input={workIds:[work.id],name:'Comment creator',bio:'Testing templates',template:'fold'};
  const old=ok(await request('/api/cards',{method:'POST',json:input}),201).card;
  const next=ok(await request('/api/cards',{method:'POST',json:{...input,template:'collection'}}),201).card;
  assert.equal(next.template,'collection');assert.deepEqual(ok(await request('/api/cards/'+old.id)).card,old);
  assert.equal((await request('/api/cards',{method:'POST',json:{...input,template:'untrusted'}})).status,422);
});
await check('new roots do not cause duplicates when continuing an existing cursor',async()=>{
  const first=ok(await request(path+'?limit=1'));assert.equal(first.comments[0].id,creatorRoot.id);
  const fresh=ok(await post('Newest root',{user:owner}),201).comment;
  const older=ok(await request(path+'?limit=1&cursor='+encodeURIComponent(first.nextCursor)));assert.equal(older.comments[0].id,root.id);assert.equal(older.nextCursor,null);
  assert.equal(ok(await request(path+'?limit=1')).comments[0].id,fresh.id);
  const analytics=ok(await request(`/api/analytics?work=${work.id}`));assert.equal(analytics.summary.comments,8);assert.equal(analytics.summary.feedback,1);
});
Object.assign(report,{workId:work.id,rootId:root.id,replyIds:replies.map(c=>c.id),completedAt:new Date().toISOString()});
await mkdir('.preview',{recursive:true});await writeFile('.preview/local-comments-integration.json',JSON.stringify(report,null,2));
console.log(`Completed ${report.checks.length} checks. Evidence: .preview/local-comments-integration.json`);
