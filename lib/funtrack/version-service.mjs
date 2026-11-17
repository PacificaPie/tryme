import {ApiError,fail,eventId} from './rules.mjs';
import {metadataId,metadataStatements} from './work-metadata.mjs';
import {expectedRevision,releaseNotes,versionPage,versionCursor} from './version-rules.mjs';
import {createDuplicateService} from './duplicate-service.mjs';
import {requireActiveWork} from './archive-service.mjs';

// Runtime dependencies are injected so failure recovery can be tested without
// adding fault controls to the deployed API.
export function createVersionService({db,bucket,ownWork,workJSON,hash,readForm,readArtifact,bodyJSON,onPublished}){
  const duplicates=createDuplicateService({db});
  const sql=(query,...values)=>db().prepare(query).bind(...values);
  const first=(query,...values)=>sql(query,...values).first();
  const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  const current=w=>({versionId:w.current_version_id,revision:w.revision,metadataId:w.current_metadata_id||null});
  const versionJSON=v=>({id:v.id,workId:v.work_id,version:v.version,ordinal:v.ordinal,releaseNotes:v.release_notes,contentHash:v.content_hash,createdBy:v.created_by,createdAt:v.created_at,coverUrl:v.cover_key?`/media/${v.id}`:'',source:v.game_key?'html':'url',...(v.provenance_json?{build:JSON.parse(v.provenance_json)}:{})});
  const operationJSON=o=>({id:o.id,action:o.action,fromVersionId:o.from_version_id,toVersionId:o.to_version_id,previousRevision:o.previous_revision,revision:o.revision,changed:Boolean(o.changed),createdAt:o.created_at});
  const findOperation=(owner,key)=>first('SELECT * FROM ft_version_operations WHERE owner_id=? AND idempotency_key=?',owner,key);
  async function conflict(workId,user){const w=await ownWork(workId,user);requireActiveWork(w);const error=new ApiError(409,'VERSION_CONFLICT','作品版本已变化，请刷新后重新选择');error.current=current(w);throw error;}
  async function operationResponse(op,requestHash,status=200){
    if(op.request_hash!==requestHash)fail(409,'IDEMPOTENCY_CONFLICT','同一次操作的内容已变化，请使用新的提交标识');
    const version=await first('SELECT * FROM ft_work_versions WHERE id=? AND work_id=?',op.to_version_id,op.work_id);
    if(op.action==='publish'&&onPublished)try{await onPublished(op.work_id,op.to_version_id,op.owner_id);}catch{/* Optional cover generation never invalidates a published version. */}
    const w=await first('SELECT current_version_id,revision,current_metadata_id FROM ft_works WHERE id=?',op.work_id);
    // The operation and version are immutable. Only this separate current field
    // may change on replay; replay never executes a pointer update.
    return json({version:versionJSON(version),operation:operationJSON(op),current:current(w)},status);
  }
  function guard(operationId,metadata){
    // A zero-row CAS is NOT a SQL error. Turn an inconsistent publication into
    // a NOT NULL violation inside the same transaction, rolling back all rows.
    return sql(`UPDATE ft_version_operations SET work_id=CASE WHEN EXISTS (
      SELECT 1 FROM ft_works w WHERE w.id=ft_version_operations.work_id
      AND w.current_version_id=ft_version_operations.to_version_id AND w.revision=ft_version_operations.revision AND w.current_metadata_id IS ?
    ) THEN work_id ELSE NULL END WHERE id=?`,metadata,operationId);
  }
  async function clean(keys){if(keys.length)try{await bucket().delete(keys);}catch{/* only unreachable attempt objects; no version deletion */}}
  async function publish(request,user,w){
    const key=eventId(request.headers.get('idempotency-key')),form=await readForm(request);
    for(const field of ['name','desc','url','source'])if(form.has(field))fail(422,'INVALID_VERSION_FIELDS','更新版本仅接受游戏、封面和更新说明');
    const expected=expectedRevision(form.get('expectedRevision')),notes=releaseNotes(form.get('releaseNotes'));
    const artifact=await readArtifact(form,'html',user.id),contentHash=await hash(artifact.gameBytes);
    const requestHash=await hash(JSON.stringify({workId:w.id,action:'publish',expectedRevision:expected,game:contentHash,buildId:artifact.buildId,cover:artifact.coverBytes?await hash(artifact.coverBytes):'inherit',coverMime:artifact.coverMime,releaseNotes:notes}));
    const prior=await findOperation(user.id,key);if(prior)return operationResponse(prior,requestHash);
    requireActiveWork(w);
    if(w.revision!==expected)return conflict(w.id,user);
    await duplicates.assertVersion(user.id,w.id,w.current_version_id,contentHash);
    const versionId=crypto.randomUUID(),operationId=crypto.randomUUID(),nextMetadata=metadataId(),initialId=w.initial_metadata_id||metadataId(),at=new Date().toISOString();
    const gameKey=`games/${versionId}.html`,coverKey=artifact.coverBytes?`covers/${versionId}`:w.cover_key,coverMime=artifact.coverBytes?artifact.coverMime:w.cover_mime;
    const written=[];
    try{
      written.push(gameKey);await bucket().put(gameKey,artifact.gameBytes,{httpMetadata:{contentType:'text/html'}});
      if(artifact.coverBytes){written.push(coverKey);await bucket().put(coverKey,artifact.coverBytes,{httpMetadata:{contentType:coverMime}});}
      const result=await db().batch([
        sql(`INSERT INTO ft_work_versions (id,work_id,version,ordinal,game_key,cover_key,cover_mime,created_at,provenance_json,release_notes,content_hash,created_by)
          SELECT ?,w.id,'v'||n.next,n.next,?,?,?,?,?,?,?,? FROM ft_works w
          JOIN (SELECT COALESCE(MAX(ordinal),0)+1 AS next FROM ft_work_versions WHERE work_id=?) n
          WHERE w.id=? AND w.author_id=? AND w.source='html' AND w.revision=?`,versionId,gameKey,coverKey,coverMime,at,artifact.provenanceJSON,notes,contentHash,user.id,w.id,w.id,user.id,expected),
        ...metadataStatements(sql,w,{id:nextMetadata,initialId,expected,coverKey,coverMime,at,actor:user.id}),
        sql(`INSERT INTO ft_version_operations (id,owner_id,work_id,action,idempotency_key,request_hash,from_version_id,to_version_id,previous_revision,revision,changed,created_at)
          SELECT ?,?,w.id,'publish',?,?,w.current_version_id,v.id,w.revision,w.revision+1,1,? FROM ft_work_versions v JOIN ft_works w ON w.id=v.work_id WHERE v.id=?`,operationId,user.id,key,requestHash,at,versionId),
        sql(`UPDATE ft_works SET current_version_id=?,current_metadata_id=?,initial_metadata_id=COALESCE(initial_metadata_id,?),revision=revision+1,updated_at=? WHERE id=? AND author_id=? AND revision=?
          AND EXISTS(SELECT 1 FROM ft_version_operations WHERE id=? AND work_id=ft_works.id AND previous_revision=ft_works.revision)`,versionId,nextMetadata,initialId,at,w.id,user.id,expected,operationId),
        guard(operationId,nextMetadata),
        duplicates.claim(user.id,'html',contentHash,w.id,versionId,at),
      ]);
      // Both a rejected CAS and a successful commit are checked against the
      // operation row, rather than interpreting a JS exception as a rollback.
      const committed=await findOperation(user.id,key);
      if(result[0].meta.changes===0){await clean(written);if(committed)return operationResponse(committed,requestHash);return conflict(w.id,user);}
      if(!committed)throw Error('Version operation did not commit');
      return operationResponse(committed,requestHash,201);
    }catch(error){
      // If this read fails, keep possible orphans: a committed object must never
      // be deleted merely because the transaction response was lost.
      const committed=await findOperation(user.id,key);
      if(committed?.id===operationId)return operationResponse(committed,requestHash,201);
      await clean(written);
      if(committed)return operationResponse(committed,requestHash);
      await duplicates.assertVersion(user.id,w.id,w.current_version_id,contentHash);
      throw error;
    }
  }
  async function activate(request,user,w){
    const key=eventId(request.headers.get('idempotency-key')),input=await bodyJSON(request),expected=expectedRevision(input.expectedRevision),target=eventId(input.versionId);
    const requestHash=await hash(JSON.stringify({workId:w.id,action:'activate',expectedRevision:expected,versionId:target}));
    const prior=await findOperation(user.id,key);if(prior)return operationResponse(prior,requestHash);
    requireActiveWork(w);
    const version=await first('SELECT * FROM ft_work_versions WHERE id=? AND work_id=?',target,w.id);
    if(!version)fail(404,'VERSION_NOT_FOUND','版本不存在');if(!version.game_key)fail(422,'NOT_HOSTED_GAME','该版本没有平台托管的游戏');
    if(w.revision!==expected)return conflict(w.id,user);
    const id=crypto.randomUUID(),at=new Date().toISOString(),changed=w.current_version_id!==target,nextMetadata=changed?metadataId():w.current_metadata_id||null,initialId=w.initial_metadata_id||metadataId();
    try{
      await db().batch([
        ...(changed?metadataStatements(sql,w,{id:nextMetadata,initialId,expected,coverKey:version.cover_key,coverMime:version.cover_mime,at,actor:user.id}):[]),
        sql(`INSERT INTO ft_version_operations (id,owner_id,work_id,action,idempotency_key,request_hash,from_version_id,to_version_id,previous_revision,revision,changed,created_at)
          SELECT ?,?,id,'activate',?,?,current_version_id,?,revision,revision+CASE WHEN current_version_id<>? THEN 1 ELSE 0 END,
          CASE WHEN current_version_id<>? THEN 1 ELSE 0 END,? FROM ft_works WHERE id=? AND author_id=? AND source='html' AND revision=?`,id,user.id,key,requestHash,target,target,target,at,w.id,user.id,expected),
        sql(`UPDATE ft_works SET current_version_id=?,current_metadata_id=?,initial_metadata_id=CASE WHEN ?=1 THEN COALESCE(initial_metadata_id,?) ELSE initial_metadata_id END,revision=(SELECT revision FROM ft_version_operations WHERE id=?),
          updated_at=CASE WHEN current_version_id<>? THEN ? ELSE updated_at END WHERE id=? AND author_id=? AND revision=?
          AND EXISTS(SELECT 1 FROM ft_version_operations WHERE id=? AND work_id=ft_works.id AND previous_revision=ft_works.revision)`,target,nextMetadata,changed?1:0,initialId,id,target,at,w.id,user.id,expected,id),
        guard(id,nextMetadata),
      ]);
    }catch(error){const committed=await findOperation(user.id,key);if(committed)return operationResponse(committed,requestHash);throw error;}
    const committed=await findOperation(user.id,key);if(committed)return operationResponse(committed,requestHash);
    return conflict(w.id,user);
  }
  return async function handle(request,user){
    const url=new URL(request.url),parts=url.pathname.split('/').filter(Boolean);
    if(parts[0]!=='api'||parts[1]!=='works'||!['versions','activate'].includes(parts[3]))return null;
    if(parts.length<4||parts.length>5)return null;
    const w=await ownWork(parts[2],user);if(w.source!=='html')fail(422,'VERSION_SOURCE_UNSUPPORTED','目前仅支持站内游戏的版本更新');
    if(request.method==='GET'&&parts[3]==='versions'){
      if(parts.length===5){const v=await first('SELECT * FROM ft_work_versions WHERE id=? AND work_id=?',parts[4],w.id);if(!v)fail(404,'VERSION_NOT_FOUND','版本不存在');return json({work:workJSON(w),version:versionJSON(v),current:current(w)});}
      const {limit,before}=versionPage(url.searchParams,w.id);
      const result=await sql(`SELECT * FROM ft_work_versions WHERE work_id=?${before?' AND ordinal<?':''} ORDER BY ordinal DESC LIMIT ?`,w.id,...before?[before,limit+1]:[limit+1]).all();
      const page=result.results.slice(0,limit);
      return json({work:workJSON(w),currentVersionId:w.current_version_id,revision:w.revision,versions:page.map(v=>({...versionJSON(v),isCurrent:v.id===w.current_version_id})),nextCursor:result.results.length>limit?versionCursor(w.id,page.at(-1).ordinal):null});
    }
    if(request.method==='POST'&&parts.length===4)return parts[3]==='versions'?publish(request,user,w):activate(request,user,w);
    return json({error:{code:'METHOD_NOT_ALLOWED',message:'不支持该请求方法'}},405);
  };
}
