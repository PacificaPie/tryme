import {ApiError,fail} from './rules.mjs';
import {expectedRevision} from './version-rules.mjs';

export const DISCOVERY_COLUMNS=`d.visibility discovery_visibility,d.review_status discovery_review_status,d.kind discovery_kind,
  d.play_description discovery_play_description,d.submitted_version_id discovery_submitted_version_id,
  d.approved_version_id discovery_approved_version_id,d.review_note discovery_review_note,
  d.revision discovery_revision,d.updated_at discovery_updated_at`;
export const DISCOVERY_JOIN=' LEFT JOIN ft_work_discovery d ON d.work_id=w.id';
// Publishing creates a listed row. Missing rows remain fail-closed; review
// fields are retained only as historical data and never gate Feed visibility.
export const DISCOVERY_ELIGIBLE="d.visibility='listed'";
export function discoveryJSON(w) {
  return {visibility:w.discovery_visibility||'unlisted',reviewStatus:w.discovery_review_status||'unsubmitted',kind:w.discovery_kind||'unspecified',
    playDescription:w.discovery_play_description||'',submittedVersionId:w.discovery_submitted_version_id||null,
    approvedVersionId:w.discovery_approved_version_id||null,reviewNote:w.discovery_review_note||'',revision:w.discovery_revision||1,
    reviewRequired:false,eligible:w.discovery_visibility==='listed',
    updatedAt:w.discovery_updated_at||w.updated_at||w.created_at};
}
export function initialDiscovery(sql,workId,at){return sql("INSERT OR IGNORE INTO ft_work_discovery(work_id,visibility,updated_at) VALUES (?,'listed',?)",workId,at);}
// The discovery revision now concerns author-controlled visibility only.
// Publishing a version, rolling back or editing metadata leaves it unchanged.
const reviewDisabled=()=>fail(410,'REVIEW_DISABLED','收录确认已停用，作品发布后直接进入 Feed。请刷新页面。');

export function createDiscoveryService({db,ownWork,getWork,workJSON,bodyJSON}) {
  const sql=(query,...values)=>db().prepare(query).bind(...values);
  const json=value=>Response.json(value,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  async function conflict(id){const error=new ApiError(409,'DISCOVERY_CONFLICT','展示状态已变化，请刷新后重试。');error.current={discovery:discoveryJSON(await getWork(id))};throw error;}
  async function fresh(id){return {work:workJSON(await getWork(id))};}
  async function owner(request,user,id) {
    const w=await ownWork(id,user),input=await bodyJSON(request),action=input.action;
    if(action==='submit')return reviewDisabled();
    const expected=expectedRevision(input.expectedRevision);
    const state=discoveryJSON(w),now=new Date().toISOString();
    if(state.revision!==expected)return conflict(id);
    if(!['hide','restore'].includes(action))fail(422,'INVALID_DISCOVERY_ACTION','展示操作无效。');
    const statement=sql('UPDATE ft_work_discovery SET visibility=?,revision=revision+1,updated_at=? WHERE work_id=? AND revision=?',action==='hide'?'unlisted':'listed',now,id,expected);
    const result=await statement.run();if(!result.meta.changes)return conflict(id);return json(await fresh(id));
  }
  return async function handle(request,user){
    const url=new URL(request.url),parts=url.pathname.split('/').filter(Boolean);
    if(parts[0]!=='api')return null;
    if(parts[1]==='works'&&parts.length===4&&parts[3]==='discovery'){
      if(request.method==='GET')return json(await fresh((await ownWork(parts[2],user)).id));
      if(!['POST','PATCH'].includes(request.method))fail(405,'METHOD_NOT_ALLOWED','不支持该请求方法');
      return owner(request,user,parts[2]);
    }
    if(parts[1]==='review')return reviewDisabled();
    return null;
  };
}
