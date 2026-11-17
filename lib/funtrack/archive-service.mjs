import {ApiError,fail} from './rules.mjs';
import {expectedRevision} from './version-rules.mjs';

export function requireActiveWork(work){if(work.archived_at)fail(409,'WORK_ARCHIVED','这件作品已归档，请先恢复到我的作品后再操作。');}
export function archiveConstraint(error){return String(error?.message||'').includes('WORK_ARCHIVED');}
export function mineWorkState(value){
  const state=value===null||value===undefined?'active':value;
  if(!['active','archived','all'].includes(state))fail(422,'INVALID_WORK_STATE','作品列表范围无效。');
  return state;
}

export function createArchiveService({db,ownWork,workJSON,bodyJSON}){
  const sql=(query,...values)=>db().prepare(query).bind(...values);
  const json=work=>Response.json({work:workJSON(work)},{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  const desired=(work,action)=>Boolean(work.archived_at)===(action==='archive');
  async function conflict(id,user){
    const work=workJSON(await ownWork(id,user));
    const error=new ApiError(409,'ARCHIVE_CONFLICT','作品状态已变化，请刷新后重试。');
    error.current={revision:work.revision,archivedAt:work.archivedAt,discovery:work.discovery};throw error;
  }
  return async function handle(request,user){
    const parts=new URL(request.url).pathname.split('/').filter(Boolean);
    if(parts.length!==4||parts[0]!=='api'||parts[1]!=='works'||parts[3]!=='archive')return null;
    if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED','不支持该请求方法');
    const work=await ownWork(parts[2],user),input=await bodyJSON(request),action=input.action;
    if(!['archive','restore'].includes(action))fail(422,'INVALID_ARCHIVE_ACTION','归档操作无效。');
    const expected=expectedRevision(input.expectedRevision);
    // Repeating an already achieved state is safe after a lost response and
    // cannot undo a later version or republish a restored work.
    if(desired(work,action))return json(work);
    if(work.revision!==expected)return conflict(work.id,user);
    const now=new Date().toISOString();
    let result;
    try{
      result=await db().batch([sql(`UPDATE ft_works SET archived_at=?,revision=revision+1,updated_at=?
        WHERE id=? AND author_id=? AND revision=? AND archived_at IS ?`,action==='archive'?now:null,now,work.id,user.id,expected,work.archived_at||null)]);
    }catch(error){
      const current=await ownWork(work.id,user);if(desired(current,action))return json(current);throw error;
    }
    const current=await ownWork(work.id,user);
    if(result[0].meta.changes||desired(current,action))return json(current);
    return conflict(work.id,user);
  };
}
