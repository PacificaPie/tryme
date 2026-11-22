import {ApiError,fail,eventId,requiredText} from './rules.mjs';

// Only trusted SQL identifiers from application code are accepted here.
const identifier=value=>{if(!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(value))throw Error('Invalid SQL identifier');return value;};
export const workAccessible=(id='w.id')=>`NOT EXISTS(SELECT 1 FROM ft_content_restrictions moderation WHERE moderation.target_type='work' AND moderation.target_id=${identifier(id)})`;
export const cardAccessible=(alias='c')=>`NOT EXISTS(SELECT 1 FROM ft_content_restrictions moderation WHERE moderation.target_type='card' AND moderation.target_id=${identifier(alias)}.id)
 AND NOT EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(${alias}.snapshot_json) THEN ${alias}.snapshot_json ELSE '{}' END,'$.works') selected
 JOIN ft_content_restrictions restricted ON restricted.target_type='work' AND restricted.target_id=json_extract(selected.value,'$.id'))`;
export function contentUnavailable(){return new ApiError(404,'CONTENT_UNAVAILABLE','内容暂时不可访问。');}
export function moderationConstraint(error){return String(error?.message||'').includes('CONTENT_UNAVAILABLE');}
export function createModerationService({db,bodyJSON,json,hash,moderators=()=>''}){
 const sql=(q,...values)=>db().prepare(q).bind(...values),first=(q,...v)=>sql(q,...v).first();
 const permitted=user=>new Set(String(moderators()||'').split(/[\s,]+/).filter(Boolean)).has(user.id);
 async function work(id){if(await first("SELECT 1 FROM ft_content_restrictions WHERE target_type='work' AND target_id=?",id))throw contentUnavailable();}
 async function card(id){const row=await first(`SELECT c.id FROM ft_cards c WHERE c.id=? AND ${cardAccessible()}`,id);if(!row)throw contentUnavailable();}
 async function latest(kind,id){return first('SELECT * FROM ft_moderation_actions WHERE target_type=? AND target_id=? ORDER BY revision DESC LIMIT 1',kind,id);}
 async function inspect(kind,id){
  const target=await first(kind==='work'?'SELECT id,name,author_id FROM ft_works WHERE id=?':'SELECT id,author_id FROM ft_cards WHERE id=?',id);
  if(!target)fail(404,'NOT_FOUND','目标内容不存在。');
  const current=await latest(kind,id),history=(await sql('SELECT revision,action,actor_id,reason,created_at FROM ft_moderation_actions WHERE target_type=? AND target_id=? ORDER BY revision DESC LIMIT 50',kind,id).all()).results;
  const affected=kind==='work'?Number((await first("SELECT COUNT(*) n FROM ft_cards c WHERE c.deleted_at IS NULL AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(c.snapshot_json) THEN c.snapshot_json ELSE '{}' END,'$.works') selected WHERE json_extract(selected.value,'$.id')=?)",id)).n):0;
  const inherited=kind==='card'?(await sql("SELECT DISTINCT restricted.target_id FROM ft_cards c,json_each(CASE WHEN json_valid(c.snapshot_json) THEN c.snapshot_json ELSE '{}' END,'$.works') selected JOIN ft_content_restrictions restricted ON restricted.target_type='work' AND restricted.target_id=json_extract(selected.value,'$.id') WHERE c.id=?",id).all()).results.map(r=>r.target_id):[];
  return {target:{type:kind,id:target.id,name:target.name||'',authorId:target.author_id},blocked:current?.action==='block',revision:current?.revision||0,affectedCards:affected,inheritedWorkBlocks:inherited,history};
 }
 async function handle(request,user){
  const parts=new URL(request.url).pathname.split('/').filter(Boolean);
  if(parts[0]!=='api'||parts[1]!=='moderation')return null;
  if(!permitted(user))fail(403,'MODERATION_FORBIDDEN','此账号没有内容管理权限。');
  if(parts.length===2&&request.method==='GET')return json({enabled:true});
  const [, ,kind,id]=parts;
  if(parts.length!==4||!['work','card'].includes(kind)||!/^[A-Za-z0-9_-]{8,128}$/.test(id||''))fail(404,'NOT_FOUND','接口不存在');
  if(request.method==='GET')return json(await inspect(kind,id));
  if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED','不支持该请求方法');
  const input=await bodyJSON(request);
  if(Object.keys(input).some(k=>!['action','reason','expectedRevision'].includes(k))||!['block','restore'].includes(input.action)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail(422,'INVALID_MODERATION','请刷新内容状态并明确填写处置原因。');
  const reason=requiredText(input.reason,'处置原因',1000),key=eventId(request.headers.get('Idempotency-Key'));
  const requestHash=await hash(JSON.stringify({kind,id,action:input.action,reason,expectedRevision:input.expectedRevision}));
  async function replay(){
   const row=await first('SELECT * FROM ft_moderation_actions WHERE actor_id=? AND idempotency_key=?',user.id,key);if(!row)return null;
   if(row.request_hash!==requestHash)fail(409,'IDEMPOTENCY_CONFLICT','处置内容已变化，请刷新后重试。');
   return json({...await inspect(kind,id),receipt:{revision:row.revision,action:row.action},duplicate:true});
  }
  const prior=await replay();if(prior)return prior;
  await inspect(kind,id);
  const revision=input.expectedRevision+1;
  try{await sql(`INSERT OR IGNORE INTO ft_moderation_actions(target_type,target_id,revision,action,actor_id,reason,idempotency_key,request_hash,created_at)
   SELECT ?,?,?,?,?,?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM ft_moderation_actions WHERE target_type=? AND target_id=?),0)=?`,
   kind,id,revision,input.action,user.id,reason,key,requestHash,new Date().toISOString(),kind,id,input.expectedRevision).run();}
  catch(error){const committed=await replay();if(committed)return committed;throw error;}
  const committed=await replay();if(committed)return committed;
  const error=new ApiError(409,'MODERATION_CONFLICT','内容状态已变化，请刷新后再处理。');error.current=await inspect(kind,id);throw error;
 }
 return {work,card,handle,permitted};
}
