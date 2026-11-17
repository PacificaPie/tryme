import {ApiError,fail,eventId,requiredText} from './rules.mjs';
import {expectedRevision} from './version-rules.mjs';

export const DISCOVERY_COLUMNS=`d.visibility discovery_visibility,d.review_status discovery_review_status,d.kind discovery_kind,
  d.play_description discovery_play_description,d.submitted_version_id discovery_submitted_version_id,
  d.approved_version_id discovery_approved_version_id,d.review_note discovery_review_note,
  d.revision discovery_revision,d.updated_at discovery_updated_at`;
export const DISCOVERY_JOIN=' LEFT JOIN ft_work_discovery d ON d.work_id=w.id';
// Missing rows are unlisted: no fallback that accidentally promotes new work.
export const DISCOVERY_ELIGIBLE="d.visibility='listed' AND d.review_status='approved' AND d.approved_version_id=w.current_version_id";
export function discoveryJSON(w) {
  return {visibility:w.discovery_visibility||'unlisted',reviewStatus:w.discovery_review_status||'unsubmitted',kind:w.discovery_kind||'unspecified',
    playDescription:w.discovery_play_description||'',submittedVersionId:w.discovery_submitted_version_id||null,
    approvedVersionId:w.discovery_approved_version_id||null,reviewNote:w.discovery_review_note||'',revision:w.discovery_revision||1,
    eligible:w.discovery_visibility==='listed'&&w.discovery_review_status==='approved'&&w.discovery_approved_version_id===w.current_version_id,
    updatedAt:w.discovery_updated_at||w.updated_at||w.created_at};
}
export const canReview=(user,configured)=>typeof configured==='string'&&configured.split(',').map(id=>id.trim()).filter(Boolean).includes(user.id);
export function initialDiscovery(sql,workId,at){return sql('INSERT OR IGNORE INTO ft_work_discovery(work_id,updated_at) VALUES (?,?)',workId,at);}
// Version/metadata changes invalidate approval in the database trigger from
// migration 0007, atomically with the original work CAS and also across deploys.

export function createDiscoveryService({db,ownWork,getWork,workJSON,bodyJSON,reviewerIds,workQuery}) {
  const sql=(query,...values)=>db().prepare(query).bind(...values);
  const json=value=>Response.json(value,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  async function conflict(id){const error=new ApiError(409,'DISCOVERY_CONFLICT','收录状态或作品版本已变化，请刷新后重试。');error.current={discovery:discoveryJSON(await getWork(id))};throw error;}
  async function fresh(id){return {work:workJSON(await getWork(id))};}
  async function owner(request,user,id) {
    const w=await ownWork(id,user),input=await bodyJSON(request),expected=expectedRevision(input.expectedRevision),action=input.action;
    const state=discoveryJSON(w),now=new Date().toISOString();
    if(state.revision!==expected)return conflict(id);
    let statement;
    if(action==='submit'){
      if(!['game','interactive_story','prototype'].includes(input.kind))fail(422,'INVALID_WORK_KIND','Feed 收录网页游戏、互动叙事和可玩原型。');
      const description=requiredText(input.playDescription,'玩家操作与反馈',500);
      if(input.rulesAccepted!==true)fail(422,'DISCOVERY_RULES_REQUIRED','请确认作品符合收录规则且你有权发布。');
      if(state.reviewStatus==='approved'&&state.approvedVersionId===w.current_version_id)fail(409,'ALREADY_REVIEWED','当前版本已收录，隐藏的作品可直接恢复展示。');
      statement=sql(`UPDATE ft_work_discovery SET visibility='listed',review_status='pending',kind=?,play_description=?,
        submitted_version_id=?,approved_version_id=NULL,review_note='',reviewed_by=NULL,revision=revision+1,updated_at=?
        WHERE work_id=? AND revision=? AND EXISTS(SELECT 1 FROM ft_works w WHERE w.id=ft_work_discovery.work_id AND w.current_version_id=?)`,input.kind,description,w.current_version_id,now,id,expected,w.current_version_id);
    }else if(action==='hide'){
      statement=sql("UPDATE ft_work_discovery SET visibility='unlisted',revision=revision+1,updated_at=? WHERE work_id=? AND revision=?",now,id,expected);
    }else if(action==='restore'){
      if(state.reviewStatus!=='approved'||state.approvedVersionId!==w.current_version_id)fail(409,'DISCOVERY_REVIEW_REQUIRED','当前版本尚未收录，请先申请进入 Feed。');
      statement=sql(`UPDATE ft_work_discovery SET visibility='listed',revision=revision+1,updated_at=? WHERE work_id=? AND revision=?
        AND review_status='approved' AND approved_version_id=(SELECT current_version_id FROM ft_works WHERE id=?)`,now,id,expected,id);
    }else fail(422,'INVALID_DISCOVERY_ACTION','收录操作无效。');
    const result=await statement.run();if(!result.meta.changes)return conflict(id);return json(await fresh(id));
  }
  async function review(request,user,id) {
    const w=await getWork(id),input=await bodyJSON(request),expected=expectedRevision(input.expectedRevision),versionId=eventId(input.versionId);
    if(!['approve','reject'].includes(input.decision))fail(422,'INVALID_REVIEW_DECISION','请选择收录或退回。');
    const note=input.decision==='reject'?requiredText(input.note,'退回原因',500):typeof input.note==='string'?input.note.trim().slice(0,500):'';
    const state=discoveryJSON(w);
    if(state.revision!==expected||state.reviewStatus!=='pending'||state.submittedVersionId!==versionId||w.current_version_id!==versionId)return conflict(id);
    if(input.decision==='approve'&&(!['game','interactive_story','prototype'].includes(state.kind)||!state.playDescription.trim()))
      fail(422,'DISCOVERY_DETAILS_REQUIRED','请作者先补充作品类型与玩法说明，再提交收录申请。');
    const result=await sql(`UPDATE ft_work_discovery SET review_status=?,approved_version_id=?,review_note=?,reviewed_by=?,revision=revision+1,updated_at=?
      WHERE work_id=? AND revision=? AND review_status='pending' AND submitted_version_id=?
      AND EXISTS(SELECT 1 FROM ft_works w WHERE w.id=ft_work_discovery.work_id AND w.current_version_id=?)`,input.decision==='approve'?'approved':'rejected',input.decision==='approve'?versionId:null,note,user.id,new Date().toISOString(),id,expected,versionId,versionId).run();
    if(!result.meta.changes)return conflict(id);return json(await fresh(id));
  }
  return async function handle(request,user){
    const url=new URL(request.url),parts=url.pathname.split('/').filter(Boolean);
    if(parts[0]!=='api')return null;
    if(parts[1]==='works'&&parts.length===4&&parts[3]==='discovery'){
      if(request.method==='GET')return json(await fresh((await ownWork(parts[2],user)).id));
      if(!['POST','PATCH'].includes(request.method))fail(405,'METHOD_NOT_ALLOWED','不支持该请求方法');
      return owner(request,user,parts[2]);
    }
    if(parts[1]!=='review'||parts[2]!=='works'||parts.length>4)return null;
    if(!canReview(user,reviewerIds()))fail(403,'REVIEW_FORBIDDEN','没有收录管理权限。');
    if(request.method==='GET'&&parts.length===3){
      const status=url.searchParams.get('status')||'pending';if(!['pending','approved','rejected'].includes(status))fail(422,'INVALID_REVIEW_STATUS','收录状态无效。');
      const result=await sql(workQuery+" WHERE d.review_status=? ORDER BY d.updated_at,d.work_id LIMIT 100",status).all();
      return json({works:result.results.map(workJSON)});
    }
    if(request.method==='POST'&&parts.length===4)return review(request,user,parts[3]);
    fail(405,'METHOD_NOT_ALLOWED','不支持该请求方法');
  };
}
