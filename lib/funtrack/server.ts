import { env } from 'cloudflare:workers';
import { ApiError, fail, authenticate, verifyWrite, requiredText, eventId, safeURL, coverType, htmlSource, sessionEvents, GAME_CSP, gameDocument, likedState, cardDetails, cardSnapshot, cardTemplate, commentInput, validateCommentParent, commentPageLimit, encodeCommentCursor, decodeCommentCursor } from './rules.mjs';

type Row = Record<string, any>;
type User = { id: string; name: string; email: string };
const iso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const bindings = () => env as unknown as { DB?: D1Database; BUCKET?: R2Bucket };
function db(): D1Database { const d=bindings().DB; if(!d)throw new ApiError(503,'STORAGE_UNAVAILABLE','数据库暂不可用'); return d; }
function bucket(): R2Bucket { const b=bindings().BUCKET; if(!b)throw new ApiError(503,'STORAGE_UNAVAILABLE','文件存储暂不可用'); return b; }
const sql=(query:string,...values:any[])=>db().prepare(query).bind(...values);
const first=(query:string,...values:any[])=>sql(query,...values).first<Row>();
async function rows(query:string,...values:any[]):Promise<Row[]> { return (await sql(query,...values).all<Row>()).results; }
export function json(value:unknown,status=200) { return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}}); }
function errorResponse(error:unknown) { if(error instanceof ApiError)return json({error:{code:error.code,message:error.message}},error.status); return json({error:{code:'INTERNAL_ERROR',message:'服务暂不可用，请保留内容后重试'}},500); }
async function hash(value:string|Uint8Array) {const bytes=typeof value==='string'?new TextEncoder().encode(value):value;const result=await crypto.subtle.digest('SHA-256',bytes as BufferSource);return Array.from(new Uint8Array(result),n=>n.toString(16).padStart(2,'0')).join('');}
async function limitedBody(request:Request,max:number) {
  const declared=Number(request.headers.get('content-length')||0);if(declared>max)fail(413,'BODY_TOO_LARGE','请求内容过大');
  const reader=request.body?.getReader();if(!reader)return new Uint8Array();const chunks:Uint8Array[]=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>max){await reader.cancel();fail(413,'BODY_TOO_LARGE','请求内容过大');}chunks.push(value);}
  const out=new Uint8Array(length);let at=0;for(const chunk of chunks){out.set(chunk,at);at+=chunk.byteLength;}return out;
}
async function bodyJSON(request:Request):Promise<Row> {
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new ApiError(415,'JSON_REQUIRED','请使用 JSON 请求');
  try {const body=JSON.parse(new TextDecoder().decode(await limitedBody(request,65536)));if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();return body;}catch(e){if(e instanceof ApiError)throw e;throw new ApiError(400,'INVALID_JSON','JSON 格式无效');}
}
const WORK_QUERY=`SELECT w.*,v.version,v.game_key,v.cover_key,v.cover_mime FROM ft_works w JOIN ft_work_versions v ON v.id=w.current_version_id`;
function workJSON(w:Row) { return {id:w.id,authorId:w.author_id,authorName:w.author_name,name:w.name,desc:w.description,source:w.source,versionId:w.current_version_id,version:w.version,coverUrl:w.cover_key?`/media/${w.current_version_id}`:'',...(w.url?{url:w.url}:{}),createdAt:w.created_at}; }
async function getWork(id:unknown) { if(typeof id!=='string'||id.length>128)throw new ApiError(404,'WORK_NOT_FOUND','作品不存在');const w=await first(WORK_QUERY+' WHERE w.id=?',id);if(!w)throw new ApiError(404,'WORK_NOT_FOUND','作品不存在');return w; }
async function ownWork(id:unknown,user:User) {const w=await getWork(id);if(w.author_id!==user.id)throw new ApiError(403,'NOT_OWNER','只能访问自己的作品数据');return w;}
async function userProfile(user:User) {const p=await first('SELECT name,bio,signature,headline,website,back_style FROM ft_profiles WHERE id=?',user.id);return {id:user.id,name:p?.name||user.name,bio:p?.bio||'',signature:p?.signature||'',headline:p?.headline||'',website:p?.website||'',backStyle:p?.back_style||'ink'};}
async function withWorkStats(works:Row[],user:User) {
  if(!works.length)return [];
  // Keep each statement below D1's bound-parameter limit, including a full
  // 200-work discovery response. Counts are live data, not card snapshot data.
  const batches:Row[][]=[];for(let at=0;at<works.length;at+=80)batches.push(works.slice(at,at+80));
  const [counts,commentCounts]=await Promise.all([
    Promise.all(batches.map(batch=>rows(`SELECT work_id,COUNT(*) n,MAX(CASE WHEN actor_id=? THEN 1 ELSE 0 END) liked FROM ft_work_likes WHERE work_id IN (${batch.map(()=>'?').join(',')}) GROUP BY work_id`,user.id,...batch.map(w=>w.id)))).then(groups=>groups.flat()),
    Promise.all(batches.map(batch=>rows(`SELECT work_id,COUNT(*) n FROM ft_comments WHERE work_id IN (${batch.map(()=>'?').join(',')}) GROUP BY work_id`,...batch.map(w=>w.id)))).then(groups=>groups.flat()),
  ]);
  const byId=new Map(counts.map(row=>[row.work_id,row]));
  const commentsById=new Map(commentCounts.map(row=>[row.work_id,row.n]));
  return works.map(work=>({...work,likesCount:Number(byId.get(work.id)?.n||0),likedByMe:Boolean(byId.get(work.id)?.liked),commentsCount:Number(commentsById.get(work.id)||0)}));
}
function likeJSON(workId:string,row:Row) {return {workId,liked:Boolean(row.liked),likesCount:Number(row.n||0)};}
async function workLike(request:Request,user:User,workId:string) {
  await getWork(workId);
  const countQuery=sql('SELECT COUNT(*) n,MAX(CASE WHEN actor_id=? THEN 1 ELSE 0 END) liked FROM ft_work_likes WHERE work_id=?',user.id,workId);
  if(request.method==='GET'){const count=await countQuery.first<Row>();return json(likeJSON(workId,count!));}
  const liked=likedState((await bodyJSON(request)).liked);
  const mutation=liked?sql('INSERT OR IGNORE INTO ft_work_likes (work_id,actor_id,created_at) VALUES (?,?,?)',workId,user.id,iso()):sql('DELETE FROM ft_work_likes WHERE work_id=? AND actor_id=?',workId,user.id);
  const results=await db().batch<Row>([mutation,countQuery]);
  return json(likeJSON(workId,results[1].results[0]));
}
async function rateLimit(user:User,table:'ft_events'|'ft_play_sessions'|'ft_feedback'|'ft_comments',column:'received_at'|'created_at',limit:number) {
  const actor=table==='ft_feedback'||table==='ft_comments'?'author_id':'actor_id';const result=await first(`SELECT COUNT(*) AS n FROM ${table} WHERE ${actor}=? AND ${column}>=?`,user.id,new Date(Date.now()-60000).toISOString());
  if(Number(result?.n)>=limit)throw new ApiError(429,'RATE_LIMITED','提交太频繁，请稍后重试');
}
function receipt(row:Row) { return {id:row.id,clientEventId:row.client_event_id,type:row.event_type,...(row.work_id?{workId:row.work_id}:{}),...(row.card_id?{cardId:row.card_id}:{}),receivedAt:row.received_at}; }

async function publish(request:Request,user:User) {
  const key=eventId(request.headers.get('idempotency-key'));
  const ct=request.headers.get('content-type')||'';if(!ct.startsWith('multipart/form-data;'))throw new ApiError(415,'FORM_REQUIRED','请使用文件上传表单');
  let form:FormData;try{form=await new Response(await limitedBody(request,4194304),{headers:{'Content-Type':ct}}).formData();}catch(e){if(e instanceof ApiError)throw e;throw new ApiError(400,'INVALID_FORM','上传表单无效');}
  const name=requiredText(form.get('name'),'作品名',80),description=requiredText(form.get('desc'),'作品简介',500);
  const source=form.get('source');if(source!=='html'&&source!=='url')throw new ApiError(422,'INVALID_SOURCE','选择 HTML 上传或外部链接');
  const url=source==='url'?safeURL(form.get('url')):null;
  let gameBytes:Uint8Array|null=null,coverBytes:Uint8Array|null=null,coverMime:string|null=null;
  if(source==='html') {const file=form.get('file');if(!file||typeof file==='string')throw new ApiError(422,'FILE_REQUIRED','请选择 HTML 文件');gameBytes=new Uint8Array(await file.arrayBuffer());htmlSource(gameBytes,file.type,file.name);}
  const cover=form.get('cover');if(cover&&typeof cover!=='string'&&cover.size){if(cover.size>2097152)throw new ApiError(413,'COVER_TOO_LARGE','封面须在 2 MiB 以内');coverBytes=new Uint8Array(await cover.arrayBuffer());coverMime=coverType(coverBytes,cover.type);}
  if(typeof cover==='string'&&cover)throw new ApiError(422,'INVALID_COVER','封面须为图片文件');
  const requestHash=await hash(JSON.stringify({name,description,source,url,game:gameBytes?await hash(gameBytes):null,cover:coverBytes?await hash(coverBytes):null,coverMime}));
  async function replay(){const found=await first(WORK_QUERY+' WHERE w.author_id=? AND w.idempotency_key=?',user.id,key);if(!found)return null;if(found.request_hash!==requestHash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','同一次提交的内容已变化，请创建新的提交标识');return json({work:workJSON(found)});}
  const prior=await replay();if(prior)return prior;
  const id=uuid(),versionId=uuid(),createdAt=iso();const gameKey=gameBytes?`games/${versionId}.html`:null,coverKey=coverBytes?`covers/${versionId}`:null;const written:string[]=[];
  try {
    if(gameKey&&gameBytes){await bucket().put(gameKey,gameBytes,{httpMetadata:{contentType:'text/html'}});written.push(gameKey);}
    if(coverKey&&coverBytes){await bucket().put(coverKey,coverBytes,{httpMetadata:{contentType:coverMime!}});written.push(coverKey);}
    await db().batch([
      sql('INSERT INTO ft_works (id,author_id,author_name,name,description,source,current_version_id,url,created_at,idempotency_key,request_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)',id,user.id,(await userProfile(user)).name,name,description,source,versionId,url,createdAt,key,requestHash),
      sql('INSERT INTO ft_work_versions (id,work_id,version,game_key,cover_key,cover_mime,created_at) VALUES (?,?,?,?,?,?,?)',versionId,id,'v1',gameKey,coverKey,coverMime,createdAt),
    ]);
  } catch(e) {
    // A database commit can succeed even if its response is lost. Confirm the
    // published row before deleting this attempt's objects; a failed read leaves
    // harmless orphans rather than risking deletion of a published game.
    const committed=await first(WORK_QUERY+' WHERE w.author_id=? AND w.idempotency_key=?',user.id,key);
    if(committed?.id===id)return json({work:workJSON(committed)});
    if(written.length)try{await bucket().delete(written);}catch{/* unreachable objects can be cleaned later; never delete another attempt */}
    if(committed){if(committed.request_hash!==requestHash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','同一次提交的内容已变化，请创建新的提交标识');return json({work:workJSON(committed)});}throw e;
  }
  return json({work:workJSON(await getWork(id))},201);
}

async function createSession(request:Request,user:User) {
  const input=await bodyJSON(request),w=await getWork(input.workId);
  const version=await first('SELECT * FROM ft_work_versions WHERE id=? AND work_id=?',String(input.versionId||''),w.id);
  if(!version||!version.game_key||w.source!=='html')throw new ApiError(422,'NOT_HOSTED_GAME','该版本没有平台托管的游戏');
  await rateLimit(user,'ft_play_sessions','created_at',30);
  const id=uuid(),token=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join(''),createdAt=iso(),expiresAt=new Date(Date.now()+3600000).toISOString();
  await sql('INSERT INTO ft_play_sessions (id,actor_id,work_id,version_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?,?)',id,user.id,w.id,version.id,await hash(token),createdAt,expiresAt).run();
  return json({id,token,gameUrl:`/game/${version.id}`,expiresAt},201);
}

async function ingestSession(request:Request,user:User,id:string) {
  const input=await bodyJSON(request),session=await first('SELECT * FROM ft_play_sessions WHERE id=? AND actor_id=?',id,user.id);
  if(!session)throw new ApiError(404,'SESSION_NOT_FOUND','会话不存在');
  if(typeof input.token!=='string'||input.token.length!==64||await hash(input.token)!==session.token_hash)throw new ApiError(403,'INVALID_SESSION_TOKEN','会话凭据无效');
  if(session.expires_at<=iso())throw new ApiError(410,'SESSION_EXPIRED','会话已过期');
  const events=sessionEvents(input.events),existing=await rows('SELECT * FROM ft_events WHERE session_id=? ORDER BY seq',id);
  const pending:Row[]=[],duplicates:string[]=[];let maxSeq=Math.max(0,...existing.map(e=>e.seq));let started=existing.some(e=>e.event_type==='play_start'),ended=existing.some(e=>e.event_type==='session_end');
  const types=new Set(existing.map(e=>e.event_type));
  for(const event of events){
    const previous=await first('SELECT * FROM ft_events WHERE actor_id=? AND client_event_id=?',user.id,event.id);
    if(previous){if(previous.session_id!==id||previous.event_type!==event.type||previous.seq!==event.seq||previous.elapsed_ms!==event.elapsedMs||previous.result_json!==(event.result?JSON.stringify(event.result):null))throw new ApiError(409,'EVENT_CONFLICT','事件标识已用于不同内容');duplicates.push(event.id);continue;}
    if(types.has(event.type)){duplicates.push(event.id);continue;}
    if(ended||event.seq<=maxSeq||(event.type==='game_complete'&&!started))throw new ApiError(409,'EVENT_ORDER','事件顺序无效或会话已经结束');
    maxSeq=event.seq;types.add(event.type);if(event.type==='play_start')started=true;if(event.type==='session_end')ended=true;
    pending.push({...event,recordId:uuid(),receivedAt:iso()});
  }
  if(pending.length){
    await rateLimit(user,'ft_events','received_at',240);
    await db().batch(pending.map(event=>sql(`INSERT OR IGNORE INTO ft_events (id,client_event_id,actor_id,work_id,version_id,session_id,event_type,seq,elapsed_ms,result_json,received_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM ft_play_sessions WHERE id=? AND actor_id=? AND expires_at>?)
      AND NOT EXISTS (SELECT 1 FROM ft_events WHERE session_id=? AND (event_type='session_end' OR seq>=?))
      AND (?<>'game_complete' OR EXISTS (SELECT 1 FROM ft_events WHERE session_id=? AND event_type='play_start'))`,
      event.recordId,event.id,user.id,session.work_id,session.version_id,id,event.type,event.seq,event.elapsedMs,event.result?JSON.stringify(event.result):null,event.receivedAt,
      id,user.id,event.receivedAt,id,event.seq,event.type,id)));
  }
  const accepted:Row[]=[];
  for(const event of pending){const row=await first('SELECT * FROM ft_events WHERE id=?',event.recordId);if(row)accepted.push(receipt(row));else{const duplicate=await first('SELECT * FROM ft_events WHERE session_id=? AND event_type=?',id,event.type);if(duplicate)duplicates.push(event.id);else throw new ApiError(409,'EVENT_ORDER','会话状态已变化，请检查事件顺序');}}
  return json({accepted,duplicates});
}

async function ingestEvent(request:Request,user:User) {
  const input=await bodyJSON(request),clientId=eventId(input.eventId),type=input.type;let workId:null|string=null,cardId:null|string=null,versionId:null|string=null;
  if(type==='work_view'||type==='outbound_click'){const w=await getWork(input.workId);if(type==='outbound_click'&&w.source!=='url')throw new ApiError(422,'INVALID_EVENT','该作品没有外链');workId=w.id;versionId=await targetVersion(input.versionId,w);}
  else if(type==='card_view'){const card=await first('SELECT id FROM ft_cards WHERE id=?',String(input.cardId||''));if(!card)throw new ApiError(404,'CARD_NOT_FOUND','名片不存在');cardId=card.id;}
  else throw new ApiError(422,'INVALID_EVENT','事件类型无效');
  const prior=await first('SELECT * FROM ft_events WHERE actor_id=? AND client_event_id=?',user.id,clientId);
  function response(row:Row,duplicate:boolean){if(row.event_type!==type||row.work_id!==workId||row.card_id!==cardId||row.version_id!==versionId)throw new ApiError(409,'EVENT_CONFLICT','事件标识已用于不同内容');return json({receipt:receipt(row),duplicate});}
  if(prior)return response(prior,true);await rateLimit(user,'ft_events','received_at',240);
  const id=uuid();await sql('INSERT OR IGNORE INTO ft_events (id,client_event_id,actor_id,work_id,version_id,card_id,event_type,received_at) VALUES (?,?,?,?,?,?,?,?)',id,clientId,user.id,workId,versionId,cardId,type,iso()).run();
  const row=await first('SELECT * FROM ft_events WHERE actor_id=? AND client_event_id=?',user.id,clientId);if(!row)throw new Error('Event insertion failed');return response(row,row.id!==id);
}

function feedbackJSON(f:Row) {return {id:f.id,workId:f.work_id,workName:f.work_name,versionId:f.version_id,text:f.text,type:f.type,authorId:f.author_id,authorName:f.author_name,createdAt:f.created_at};}
async function targetVersion(input:unknown,work:Row):Promise<string> {
  if(input===undefined)return work.current_version_id;
  if(typeof input!=='string'||!await first('SELECT id FROM ft_work_versions WHERE id=? AND work_id=?',input,work.id))throw new ApiError(422,'INVALID_VERSION','版本不属于该作品');
  return input;
}
async function addFeedback(request:Request,user:User) {
  const input=await bodyJSON(request),w=await getWork(input.workId),text=requiredText(input.text,'反馈',1000);
  const versionId=await targetVersion(input.versionId,w);
  if(!['喜欢','建议','问题'].includes(input.type))throw new ApiError(422,'INVALID_FEEDBACK_TYPE','请选择反馈类型');
  const clientId=input.eventId===undefined?uuid():eventId(input.eventId);
  function response(f:Row,status:number){if(f.work_id!==w.id||f.version_id!==versionId||f.text!==text||f.type!==input.type)throw new ApiError(409,'EVENT_CONFLICT','反馈标识已用于不同内容');return json({feedback:feedbackJSON({...f,work_name:w.name}),receipt:{id:f.id,clientEventId:f.client_event_id,type:'feedback',workId:f.work_id,receivedAt:f.created_at}},status);}
  const prior=await first('SELECT * FROM ft_feedback WHERE author_id=? AND client_event_id=?',user.id,clientId);if(prior)return response(prior,200);
  await rateLimit(user,'ft_feedback','created_at',30);
  const id=uuid();await sql('INSERT OR IGNORE INTO ft_feedback (id,client_event_id,work_id,version_id,author_id,author_name,text,type,created_at) VALUES (?,?,?,?,?,?,?,?,?)',id,clientId,w.id,versionId,user.id,(await userProfile(user)).name,text,input.type,iso()).run();
  const f=await first('SELECT * FROM ft_feedback WHERE author_id=? AND client_event_id=?',user.id,clientId);if(!f)throw new Error('Feedback insertion failed');return response(f,f.id===id?201:200);
}

// These queries deliberately never read ft_feedback. Legacy private messages
// retain their owner-only inbox and are not part of the work's public discussion.
const COMMENT_COLUMNS=`c.*,w.name AS work_name,w.author_id AS creator_id,
  (SELECT COUNT(*) FROM ft_comment_likes l WHERE l.comment_id=c.id) AS likes_count,
  EXISTS(SELECT 1 FROM ft_comment_likes l WHERE l.comment_id=c.id AND l.actor_id=?) AS liked_by_me,
  (SELECT COUNT(*) FROM ft_comments r WHERE r.parent_id=c.id) AS reply_count`;
const COMMENT_QUERY=`SELECT ${COMMENT_COLUMNS} FROM ft_comments c JOIN ft_works w ON w.id=c.work_id`;
function commentJSON(c:Row) {return {id:c.id,workId:c.work_id,workName:c.work_name,authorId:c.author_id,authorName:c.author_name,isCreator:c.author_id===c.creator_id,body:c.body,parentId:c.parent_id,createdAt:c.created_at,likesCount:Number(c.likes_count||0),likedByMe:Boolean(c.liked_by_me),replyCount:Number(c.reply_count||0)};}
async function getComment(id:unknown,user:User) {
  if(typeof id!=='string'||id.length>128)throw new ApiError(404,'COMMENT_NOT_FOUND','评论不存在');
  const comment=await first(COMMENT_QUERY+' WHERE c.id=?',user.id,id);
  if(!comment)throw new ApiError(404,'COMMENT_NOT_FOUND','评论不存在');return comment;
}
async function workComments(url:URL,user:User,workId:string) {
  await getWork(workId);
  const scope=`work:${workId}:roots`,limit=commentPageLimit(url.searchParams.get('limit')),cursor=decodeCommentCursor(url.searchParams.get('cursor'),scope);
  const query=sql(COMMENT_QUERY+` WHERE c.work_id=? AND c.parent_id IS NULL${cursor?' AND c.seq<?':''} ORDER BY c.seq DESC LIMIT ?`,user.id,workId,...cursor?[cursor,limit+1]:[limit+1]);
  const result=await db().batch<Row>([query,sql('SELECT COUNT(*) n FROM ft_comments WHERE work_id=?',workId)]);
  const rootRows=result[0].results.slice(0,limit);
  const comments=rootRows.map(c=>({...commentJSON(c),replies:[] as Row[],repliesNextCursor:null as string|null}));
  if(rootRows.length){
    // One bounded query for the first three replies per root, plus one sentinel.
    // Window ranks preserve old-to-new replies without fetching whole threads.
    const replies=await rows(`SELECT ${COMMENT_COLUMNS},c.thread_count FROM (
      SELECT r.*,ROW_NUMBER() OVER (PARTITION BY r.parent_id ORDER BY r.seq ASC) AS thread_rank,
        COUNT(*) OVER (PARTITION BY r.parent_id) AS thread_count
      FROM ft_comments r WHERE r.parent_id IN (${rootRows.map(()=>'?').join(',')})
    ) c JOIN ft_works w ON w.id=c.work_id WHERE c.thread_rank<=4 ORDER BY c.parent_id,c.seq ASC`,user.id,...rootRows.map(c=>c.id));
    const grouped=new Map<string,Row[]>();for(const reply of replies){const list=grouped.get(reply.parent_id)||[];list.push(reply);grouped.set(reply.parent_id,list);}
    for(const root of comments){const list=grouped.get(root.id)||[];root.replies=list.slice(0,3).map(commentJSON);root.replyCount=Number(list[0]?.thread_count||0);root.repliesNextCursor=list.length>3?encodeCommentCursor(list[2].seq,`comment:${root.id}:replies`):null;}
  }
  return json({comments,commentsCount:Number(result[1].results[0]?.n||0),nextCursor:result[0].results.length>limit?encodeCommentCursor(rootRows[rootRows.length-1].seq,scope):null});
}
async function commentReplies(url:URL,user:User,id:string) {
  const parent=await getComment(id,user);if(parent.parent_id!==null)throw new ApiError(422,'INVALID_COMMENT_PARENT','只有根评论有回复列表');
  const scope=`comment:${id}:replies`,limit=commentPageLimit(url.searchParams.get('limit')),cursor=decodeCommentCursor(url.searchParams.get('cursor'),scope);
  const result=await db().batch<Row>([
    sql(COMMENT_QUERY+` WHERE c.parent_id=?${cursor?' AND c.seq>?':''} ORDER BY c.seq ASC LIMIT ?`,user.id,id,...cursor?[cursor,limit+1]:[limit+1]),
    sql('SELECT COUNT(*) n FROM ft_comments WHERE parent_id=?',id),
  ]);
  const page=result[0].results.slice(0,limit);
  return json({replies:page.map(commentJSON),replyCount:Number(result[1].results[0]?.n||0),nextCursor:result[0].results.length>limit?encodeCommentCursor(page[page.length-1].seq,scope):null});
}
async function commentInbox(url:URL,user:User) {
  if(url.searchParams.get('mine')!=='1')throw new ApiError(422,'MINE_REQUIRED','请指定 mine=1 查看自己的作品评论');
  const workId=url.searchParams.get('work');if(workId)await ownWork(workId,user);
  const scope=`mine:${user.id}:comments${workId?`:work:${workId}`:''}`,limit=commentPageLimit(url.searchParams.get('limit'),50,100),cursor=decodeCommentCursor(url.searchParams.get('cursor'),scope);
  const filter=workId?' AND w.id=?':'',filterArgs=workId?[workId]:[];
  const result=await db().batch<Row>([
    sql(COMMENT_QUERY+` WHERE w.author_id=?${filter}${cursor?' AND c.seq<?':''} ORDER BY c.seq DESC LIMIT ?`,user.id,user.id,...filterArgs,...cursor?[cursor,limit+1]:[limit+1]),
    sql('SELECT COUNT(*) n FROM ft_comments c JOIN ft_works w ON w.id=c.work_id WHERE w.author_id=?'+filter,user.id,...filterArgs),
  ]);
  const page=result[0].results.slice(0,limit);
  return json({comments:page.map(commentJSON),commentsCount:Number(result[1].results[0]?.n||0),nextCursor:result[0].results.length>limit?encodeCommentCursor(page[page.length-1].seq,scope):null});
}
async function addComment(request:Request,user:User,workId:string) {
  const w=await getWork(workId),input=commentInput(await bodyJSON(request)),key=eventId(request.headers.get('idempotency-key'));
  const requestHash=await hash(JSON.stringify({workId,body:input.body,parentId:input.parentId}));
  async function response(comment:Row,duplicate:boolean){
    if(comment.request_hash!==requestHash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','评论提交内容已变化，请使用新的提交标识');
    const count=await first('SELECT COUNT(*) n FROM ft_comments WHERE work_id=?',workId);
    return json({comment:commentJSON(comment),commentsCount:Number(count?.n||0),duplicate},duplicate?200:201);
  }
  const prior=await first(COMMENT_QUERY+' WHERE c.author_id=? AND c.idempotency_key=?',user.id,user.id,key);if(prior)return response(prior,true);
  if(input.parentId){const parent=await first('SELECT id,work_id,parent_id FROM ft_comments WHERE id=?',input.parentId);validateCommentParent(parent,workId);}
  await rateLimit(user,'ft_comments','created_at',30);
  const id=uuid();
  await sql(`INSERT INTO ft_comments (id,work_id,author_id,author_name,body,parent_id,created_at,idempotency_key,request_hash)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(author_id,idempotency_key) DO NOTHING`,id,w.id,user.id,(await userProfile(user)).name,input.body,input.parentId,iso(),key,requestHash).run();
  const comment=await first(COMMENT_QUERY+' WHERE c.author_id=? AND c.idempotency_key=?',user.id,user.id,key);if(!comment)throw new Error('Comment insertion failed');
  return response(comment,comment.id!==id);
}
async function commentLike(request:Request,user:User,id:string) {
  await getComment(id,user);
  const query=sql('SELECT COUNT(*) n,MAX(CASE WHEN actor_id=? THEN 1 ELSE 0 END) liked FROM ft_comment_likes WHERE comment_id=?',user.id,id);
  function response(row:Row){return json({commentId:id,liked:Boolean(row.liked),likesCount:Number(row.n||0)});}
  if(request.method==='GET')return response((await query.first<Row>())!);
  const liked=likedState((await bodyJSON(request)).liked);
  const mutation=liked?sql('INSERT OR IGNORE INTO ft_comment_likes (comment_id,actor_id,created_at) VALUES (?,?,?)',id,user.id,iso()):sql('DELETE FROM ft_comment_likes WHERE comment_id=? AND actor_id=?',id,user.id);
  const result=await db().batch<Row>([mutation,query]);return response(result[1].results[0]);
}

async function createCard(request:Request,user:User) {
  const input=await bodyJSON(request),name=requiredText(input.name,'名片名称',80),bio=requiredText(input.bio??'','简介',500,0);
  const details=cardDetails(input);
  cardTemplate(input.template);
  if(!Array.isArray(input.workIds)||input.workIds.length<1||input.workIds.length>30||input.workIds.some((id:unknown)=>typeof id!=='string')||new Set(input.workIds).size!==input.workIds.length)throw new ApiError(422,'INVALID_WORK_SELECTION','请选择 1–30 个不同的作品');
  const keyHeader=request.headers.get('idempotency-key'),key=keyHeader?eventId(keyHeader):null;
  const requestHash=await hash(JSON.stringify({name,bio,template:input.template,workIds:input.workIds,...details}));
  // A pre-upgrade request without the new details can still replay its original
  // immutable snapshot. New detail values must never reuse that old request key.
  const legacyHash=!details.signature&&!details.headline&&!details.website&&details.backStyle==='ink'?await hash(JSON.stringify({name,bio,template:input.template,workIds:input.workIds})):null;
  async function replay(){if(!key)return null;const row=await first('SELECT * FROM ft_cards WHERE author_id=? AND idempotency_key=?',user.id,key);if(!row)return null;if(row.request_hash!==requestHash&&row.request_hash!==legacyHash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','名片提交内容已变化，请使用新的提交标识');return json({card:cardSnapshot(JSON.parse(row.snapshot_json))});}
  const prior=await replay();if(prior)return prior;
  const works=[];for(const workId of input.workIds)works.push({...workJSON(await ownWork(workId,user)),authorName:name});
  const card={id:uuid(),authorId:user.id,name,bio,...details,template:input.template,workIds:input.workIds,works,createdAt:iso()};
  try{await db().batch([
    sql('INSERT INTO ft_cards (id,author_id,snapshot_json,created_at,idempotency_key,request_hash) VALUES (?,?,?,?,?,?)',card.id,user.id,JSON.stringify(card),card.createdAt,key,requestHash),
    sql('INSERT INTO ft_profiles (id,name,bio,signature,headline,website,back_style) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,bio=excluded.bio,signature=excluded.signature,headline=excluded.headline,website=excluded.website,back_style=excluded.back_style',user.id,name,bio,details.signature,details.headline,details.website,details.backStyle),
    sql('UPDATE ft_works SET author_name=? WHERE author_id=?',name,user.id),
  ]);}catch(e){const found=await replay();if(found)return found;throw e;}
  return json({card},201);
}

async function analytics(url:URL,user:User) {
  const days=Number(url.searchParams.get('days')||7);if(!Number.isInteger(days)||days<1||days>30)throw new ApiError(422,'INVALID_DAYS','统计天数须为 1–30');
  const workId=url.searchParams.get('work');if(workId)await ownWork(workId,user);
  const works=await rows(WORK_QUERY+' WHERE w.author_id=?'+(workId?' AND w.id=?':'')+' ORDER BY w.created_at DESC',...workId?[user.id,workId]:[user.id]);
  const start=new Date();start.setUTCHours(0,0,0,0);start.setUTCDate(start.getUTCDate()-days+1);const from=start.toISOString(),to=iso();
  const condition='w.author_id=? AND e.received_at>=? AND e.received_at<=?'+(workId?' AND w.id=?':'');const args=workId?[user.id,from,to,workId]:[user.id,from,to];
  const grouped=await rows(`SELECT e.work_id,e.event_type,COUNT(*) n FROM ft_events e JOIN ft_works w ON w.id=e.work_id WHERE ${condition} GROUP BY e.work_id,e.event_type`,...args);
  const feedbacks=await rows(`SELECT f.work_id,COUNT(*) n FROM ft_feedback f JOIN ft_works w ON w.id=f.work_id WHERE w.author_id=? AND f.created_at>=? AND f.created_at<=?${workId?' AND w.id=?':''} GROUP BY f.work_id`,...args);
  const comments=await rows(`SELECT c.work_id,COUNT(*) n FROM ft_comments c JOIN ft_works w ON w.id=c.work_id WHERE w.author_id=? AND c.created_at>=? AND c.created_at<=?${workId?' AND w.id=?':''} GROUP BY c.work_id`,...args);
  const count=(id:string,type:string)=>Number(grouped.find(r=>r.work_id===id&&r.event_type===type)?.n||0);
  const byWork=works.map(w=>({workId:w.id,name:w.name,versionId:w.current_version_id,source:w.source,views:count(w.id,'work_view'),starts:w.source==='html'?count(w.id,'play_start'):null,ends:w.source==='html'?count(w.id,'session_end'):null,feedback:Number(feedbacks.find(f=>f.work_id===w.id)?.n||0),comments:Number(comments.find(c=>c.work_id===w.id)?.n||0),outboundClicks:count(w.id,'outbound_click')}));
  const daily=await rows(`SELECT substr(e.received_at,1,10) date,e.event_type,COUNT(*) n FROM ft_events e JOIN ft_works w ON w.id=e.work_id WHERE ${condition} AND e.event_type IN ('work_view','play_start') GROUP BY date,e.event_type`,...args);
  const byDay=Array.from({length:days},(_,i)=>{const date=new Date(start.getTime()+i*86400000).toISOString().slice(0,10);return {date,views:Number(daily.find(r=>r.date===date&&r.event_type==='work_view')?.n||0),starts:Number(daily.find(r=>r.date===date&&r.event_type==='play_start')?.n||0)};});
  const cardViews=workId?0:Number((await first(`SELECT COUNT(*) n FROM ft_events e JOIN ft_cards c ON c.id=e.card_id WHERE c.author_id=? AND e.event_type='card_view' AND e.received_at>=? AND e.received_at<=?`,user.id,from,to))?.n||0);
  const summary={views:0,starts:0,ends:0,feedback:0,comments:0,cardViews,outboundClicks:0};for(const w of byWork){summary.views+=w.views;summary.starts+=w.starts||0;summary.ends+=w.ends||0;summary.feedback+=w.feedback;summary.comments+=w.comments;summary.outboundClicks+=w.outboundClicks;}
  const eventReceipts=(await rows(`SELECT e.* FROM ft_events e JOIN ft_works w ON w.id=e.work_id WHERE ${condition} ORDER BY e.received_at DESC LIMIT 30`,...args)).map(receipt);
  const feedbackReceipts=(await rows(`SELECT f.id,f.work_id,f.created_at FROM ft_feedback f JOIN ft_works w ON w.id=f.work_id WHERE w.author_id=? AND f.created_at>=? AND f.created_at<=?${workId?' AND w.id=?':''} ORDER BY f.created_at DESC LIMIT 30`,...args)).map(f=>({id:f.id,type:'feedback',workId:f.work_id,receivedAt:f.created_at}));
  const cardReceipts=workId?[]:(await rows(`SELECT e.* FROM ft_events e JOIN ft_cards c ON c.id=e.card_id WHERE c.author_id=? AND e.received_at>=? AND e.received_at<=? ORDER BY e.received_at DESC LIMIT 30`,user.id,from,to)).map(receipt);
  const receipts=[...eventReceipts,...feedbackReceipts,...cardReceipts].sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)).slice(0,30);
  return json({summary,byWork,byDay,receipts});
}

export async function handleAPI(request:Request) {
  try {
    const user=authenticate(request.headers),url=new URL(request.url),parts=url.pathname.replace(/^\/api\/?/,'').split('/').filter(Boolean);
    if(request.method==='POST')verifyWrite(request);
    if(request.method==='GET') {
      if(parts[0]==='me'&&parts.length===1)return json({user:await userProfile(user)});
      if(parts[0]==='works'&&parts.length===1)return json({works:await withWorkStats((await rows(WORK_QUERY+(url.searchParams.get('mine')==='1'?' WHERE w.author_id=?':'')+' ORDER BY w.created_at DESC LIMIT 200',...url.searchParams.get('mine')==='1'?[user.id]:[])).map(workJSON),user)});
      if(parts[0]==='works'&&parts.length===2)return json({work:(await withWorkStats([workJSON(await getWork(parts[1]))],user))[0]});
      if(parts[0]==='works'&&parts.length===3&&parts[2]==='like')return await workLike(request,user,parts[1]);
      if(parts[0]==='works'&&parts.length===3&&parts[2]==='comments')return await workComments(url,user,parts[1]);
      if(parts[0]==='comments'&&parts.length===1)return await commentInbox(url,user);
      if(parts[0]==='comments'&&parts.length===3&&parts[2]==='replies')return await commentReplies(url,user,parts[1]);
      if(parts[0]==='comments'&&parts.length===3&&parts[2]==='like')return await commentLike(request,user,parts[1]);
      if(parts[0]==='analytics'&&parts.length===1)return await analytics(url,user);
      if(parts[0]==='feedback'&&parts.length===1){const workId=url.searchParams.get('work');if(workId)await ownWork(workId,user);return json({feedback:(await rows(`SELECT f.*,w.name work_name FROM ft_feedback f JOIN ft_works w ON w.id=f.work_id WHERE w.author_id=?${workId?' AND w.id=?':''} ORDER BY f.created_at DESC LIMIT 200`,...workId?[user.id,workId]:[user.id])).map(feedbackJSON)});}
      if(parts[0]==='cards'&&parts.length===1)return json({cards:(await rows('SELECT c.snapshot_json FROM ft_cards c WHERE c.id=(SELECT d.id FROM ft_cards d WHERE d.author_id=c.author_id ORDER BY d.rowid DESC LIMIT 1) ORDER BY c.created_at DESC LIMIT 200')).map(c=>cardSnapshot(JSON.parse(c.snapshot_json)))});
      if(parts[0]==='cards'&&parts.length===2){const c=parts[1]==='me'?await first('SELECT snapshot_json FROM ft_cards WHERE author_id=? ORDER BY rowid DESC LIMIT 1',user.id):await first('SELECT snapshot_json FROM ft_cards WHERE id=?',parts[1]);if(!c)throw new ApiError(404,'CARD_NOT_FOUND','还没有已保存的名片');return json({card:cardSnapshot(JSON.parse(c.snapshot_json))});}
      if(parts[0]==='media'&&parts.length===2)return mediaResponse(request,parts[1]);
    }
    if(request.method==='POST') {
      if(parts[0]==='works'&&parts.length===1)return await publish(request,user);
      if(parts[0]==='works'&&parts.length===3&&parts[2]==='like')return await workLike(request,user,parts[1]);
      if(parts[0]==='works'&&parts.length===3&&parts[2]==='comments')return await addComment(request,user,parts[1]);
      if(parts[0]==='comments'&&parts.length===3&&parts[2]==='like')return await commentLike(request,user,parts[1]);
      if(parts[0]==='sessions'&&parts.length===1)return await createSession(request,user);
      if(parts[0]==='sessions'&&parts.length===3&&parts[2]==='events')return await ingestSession(request,user,parts[1]);
      if(parts[0]==='events'&&parts.length===1)return await ingestEvent(request,user);
      if(parts[0]==='feedback'&&parts.length===1)return await addFeedback(request,user);
      if(parts[0]==='cards'&&parts.length===1)return await createCard(request,user);
    }
    return json({error:{code:'NOT_FOUND',message:'接口不存在'}},404);
  }catch(e){return errorResponse(e);}
}

export async function mediaResponse(request:Request,id:string) {
  try{authenticate(request.headers);const v=await first('SELECT cover_key,cover_mime FROM ft_work_versions WHERE id=?',id);if(!v?.cover_key)throw new ApiError(404,'MEDIA_NOT_FOUND','封面不存在');const object=await bucket().get(v.cover_key);if(!object)throw new ApiError(404,'MEDIA_NOT_FOUND','封面文件不存在');return new Response(object.body as unknown as BodyInit,{headers:{'Content-Type':v.cover_mime,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}catch(e){return errorResponse(e);}
}
export async function gameResponse(request:Request,id:string) {
  try{authenticate(request.headers);const v=await first('SELECT game_key FROM ft_work_versions WHERE id=?',id);if(!v?.game_key)throw new ApiError(404,'GAME_NOT_FOUND','游戏不存在');const object=await bucket().get(v.game_key);if(!object)throw new ApiError(404,'GAME_NOT_FOUND','游戏文件不存在');return new Response(gameDocument(await object.text(),new URL(request.url).origin),{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':GAME_CSP,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}catch(e){return errorResponse(e);}
}
