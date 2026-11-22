import {workAccessible} from './moderation-service.mjs';
import {fail} from './rules.mjs';
import {safeAvatarURL} from './avatar-rules.mjs';

const LIKES=['work_like','comment_like'];
const FILTERS={all:[],comment:['comment','reply'],like:LIKES,follow:['follow']};
const DAY="CASE WHEN kind IN ('work_like','comment_like') THEN substr(created_at,1,10) ELSE CAST(seq AS TEXT) END";
const ACTOR=`COALESCE(NULLIF(p.name,''),
  (SELECT author_name FROM ft_comments WHERE author_id=n.actor_id ORDER BY seq DESC LIMIT 1),
  (SELECT author_name FROM ft_works WHERE author_id=n.actor_id ORDER BY created_at DESC LIMIT 1)) actor_name,
  p.avatar_url actor_avatar,
  (p.id IS NOT NULL OR EXISTS(SELECT 1 FROM ft_comments WHERE author_id=n.actor_id)
    OR EXISTS(SELECT 1 FROM ft_works WHERE author_id=n.actor_id)
    OR EXISTS(SELECT 1 FROM ft_cards WHERE author_id=n.actor_id AND deleted_at IS NULL)) actor_available`;
const actor=row=>({id:row.actor_id,name:row.actor_name||null,avatarUrl:safeAvatarURL(row.actor_avatar),available:Boolean(row.actor_available)});
function integer(value,name,{zero=false}={}){
  if(!/^(0|[1-9][0-9]*)$/.test(String(value))||!Number.isSafeInteger(Number(value))||Number(value)<(zero?0:1))fail(422,'INVALID_NOTIFICATION_INPUT',name+' 无效');
  return Number(value);
}
function filterValue(value){const filter=value||'all';if(!Object.hasOwn(FILTERS,filter))fail(422,'INVALID_NOTIFICATION_FILTER','互动筛选无效');return filter;}
function encode(value){return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function decode(value,owner,filter,work){
  if(!value)return null;
  try{
    if(value.length>2048||!/^[A-Za-z0-9_-]+$/.test(value))throw Error();
    const cursor=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0))));
    if(cursor.v!==1||cursor.owner!==owner||cursor.filter!==filter||cursor.work!==work)throw Error();
    integer(cursor.snapshot,'snapshot',{zero:true});integer(cursor.before,'before');
    if(cursor.before>cursor.snapshot)throw Error();return cursor;
  }catch{fail(422,'INVALID_NOTIFICATION_CURSOR','互动列表已变化，请重新加载');}
}

export function createNotificationService({db,bodyJSON,json}){
  const sql=(query,...values)=>db().prepare(query).bind(...values);
  const first=(query,...values)=>sql(query,...values).first();
  const summaryQuery=owner=>sql(`SELECT COALESCE(MAX(seq),0) snapshot,
    COALESCE(MAX(CASE WHEN active=1 AND read_at IS NULL THEN 1 ELSE 0 END),0) has_unread
    FROM ft_notifications WHERE recipient_id=?`,owner);
  const summaryJSON=(owner,row)=>({recipientId:owner,snapshot:Number(row.snapshot),hasUnread:Boolean(row.has_unread)});
  function identity(expected,user){if(typeof expected!=='string'||expected!==user.id)fail(409,'AUTH_SESSION_CHANGED','登录账号已变化，请刷新页面后重试。');}
  async function anchor(id,owner){
    const row=await first('SELECT * FROM ft_notifications WHERE seq=? AND recipient_id=?',integer(id,'id'),owner);
    if(!row)fail(404,'NOTIFICATION_NOT_FOUND','这条互动不存在');return row;
  }
  function group(row){return LIKES.includes(row.kind)?{where:'recipient_id=? AND kind=? AND target_id=? AND substr(created_at,1,10)=? AND seq<=?',values:[row.recipient_id,row.kind,row.target_id,row.created_at.slice(0,10),row.seq]}:{where:'recipient_id=? AND seq=?',values:[row.recipient_id,row.seq]};}
  async function list(url,user){
    const filter=filterValue(url.searchParams.get('filter')),work=url.searchParams.get('work')||'';
    if(work.length>128)fail(422,'INVALID_NOTIFICATION_INPUT','作品标识无效');
    const cursor=decode(url.searchParams.get('cursor'),user.id,filter,work);
    const limit=Math.min(integer(url.searchParams.get('limit')||20,'limit'),40);
    const summary=await summaryQuery(user.id).first(),snapshot=cursor?.snapshot??Number(summary.snapshot);
    const kinds=FILTERS[filter];
    const entries=await sql(`WITH grouped AS (
      SELECT MAX(seq) sort_seq,MAX(CASE WHEN active=1 THEN seq END) latest_seq,SUM(active) actor_count,MAX(CASE WHEN active=1 AND read_at IS NULL THEN 1 ELSE 0 END) unread
      FROM ft_notifications WHERE recipient_id=? AND seq<=?
        ${kinds.length?'AND kind IN ('+kinds.map(()=>'?').join(',')+')':''}${work?' AND work_id=?':''}
      GROUP BY kind,target_id,${DAY} HAVING SUM(active)>0 ${cursor?'AND MAX(seq)<?':''}
      ORDER BY sort_seq DESC LIMIT ?
    ) SELECT n.*,g.sort_seq,g.actor_count,g.unread,${ACTOR},w.id existing_work,w.name work_name,w.author_id work_author,w.archived_at,
      c.id existing_comment,c.body,c.parent_id,c.version_id,v.version
      FROM grouped g JOIN ft_notifications n ON n.seq=g.latest_seq
      LEFT JOIN ft_profiles p ON p.id=n.actor_id
      LEFT JOIN ft_works w ON w.id=n.work_id AND ${workAccessible()}
      LEFT JOIN ft_comments c ON c.id=n.target_id AND n.kind IN ('comment','reply','comment_like') AND c.work_id=n.work_id
      LEFT JOIN ft_work_versions v ON v.id=c.version_id AND v.work_id=n.work_id
      ORDER BY g.sort_seq DESC`,user.id,snapshot,...kinds,...work?[work]:[],...cursor?[cursor.before]:[],limit+1).all();
    const page=entries.results.slice(0,limit);
    const items=page.map(row=>{
      const available=row.kind==='follow'?Boolean(row.actor_available):Boolean(row.existing_work&&(!row.archived_at||row.work_author===user.id)&&(row.kind==='work_like'||row.existing_comment));
      return {id:Number(row.seq),kind:row.kind,actor:actor(row),actorCount:Number(row.actor_count),createdAt:row.created_at,
        unread:Boolean(row.unread),available,workId:available?row.work_id:null,workName:available?row.work_name:null,
        commentId:available?row.existing_comment||null:null,body:available?row.body||null:null,isReply:available&&Boolean(row.parent_id),
        versionId:available?row.version_id||null:null,version:available?row.version||null:null,archived:available&&Boolean(row.archived_at)};
    });
    return json({...summaryJSON(user.id,summary),snapshot,items,nextCursor:entries.results.length>limit?encode({v:1,owner:user.id,filter,work,snapshot,before:page.at(-1).sort_seq}):null});
  }
  async function members(url,user,id){
    const row=await anchor(id,user.id);if(!LIKES.includes(row.kind))fail(422,'INVALID_NOTIFICATION_INPUT','这条互动没有点赞列表');
    const grouped=group(row),before=url.searchParams.has('cursor')?integer(url.searchParams.get('cursor'),'cursor'):row.seq+1;
    const result=await sql(`SELECT n.seq,n.actor_id,${ACTOR} FROM ft_notifications n LEFT JOIN ft_profiles p ON p.id=n.actor_id
      WHERE ${grouped.where} AND active=1 AND seq<? ORDER BY seq DESC LIMIT 21`,...grouped.values,before).all();
    return json({recipientId:user.id,id:Number(row.seq),actors:result.results.slice(0,20).map(actor),nextCursor:result.results.length>20?String(result.results[19].seq):null});
  }
  async function read(request,user,id){
    const input=await bodyJSON(request);identity(input.expectedRecipientId,user);
    const now=new Date().toISOString();let update;
    if(id==='read-all')update=sql('UPDATE ft_notifications SET read_at=COALESCE(read_at,?) WHERE recipient_id=? AND active=1 AND seq<=?',now,user.id,integer(input.through,'through',{zero:true}));
    else{const grouped=group(await anchor(id,user.id));update=sql('UPDATE ft_notifications SET read_at=COALESCE(read_at,?) WHERE '+grouped.where+' AND active=1',now,...grouped.values);}
    const results=await db().batch([update,summaryQuery(user.id)]);
    return json(summaryJSON(user.id,results[1].results[0]));
  }
  return async function handle(request,user){
    const url=new URL(request.url),parts=url.pathname.split('/').filter(Boolean);
    if(parts[0]!=='api'||parts[1]!=='notifications')return null;
    if(request.method==='GET'){
      identity(url.searchParams.get('expectedRecipientId'),user);
      if(parts.length===2)return list(url,user);
      if(parts.length===3&&parts[2]==='summary')return json(summaryJSON(user.id,await summaryQuery(user.id).first()));
      if(parts.length===4&&parts[3]==='actors')return members(url,user,parts[2]);
    }
    if(request.method==='POST'&&((parts.length===3&&parts[2]==='read-all')||(parts.length===4&&parts[3]==='read')))return read(request,user,parts[2]);
    fail(405,'METHOD_NOT_ALLOWED','不支持该请求方法');
  };
}
