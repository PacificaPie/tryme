import {ApiError,fail,eventId,requiredText,coverType} from './rules.mjs';
import {expectedRevision} from './version-rules.mjs';
import {COVER_MAX_BYTES,MULTIPART_OVERHEAD_BYTES} from './limits.mjs';
import {metadataId,metadataStatements} from './work-metadata.mjs';

export function createWorkEditService({db,bucket,ownWork,workJSON,hash,readForm}){
  const sql=(query,...values)=>db().prepare(query).bind(...values);
  const first=(query,...values)=>sql(query,...values).first();
  const json=value=>Response.json(value,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  const current=w=>({versionId:w.current_version_id,revision:w.revision,metadataId:w.current_metadata_id||null});
  const find=(owner,key)=>first('SELECT * FROM ft_work_edit_operations WHERE owner_id=? AND idempotency_key=?',owner,key);
  async function response(op,requestHash){
    if(op.request_hash!==requestHash)fail(409,'IDEMPOTENCY_CONFLICT','同一次操作的内容已变化，请使用新的提交标识');
    const w=await first('SELECT current_version_id,revision,current_metadata_id FROM ft_works WHERE id=?',op.work_id);
    return json({work:JSON.parse(op.response_json),operation:{id:op.id,action:'edit',previousRevision:op.previous_revision,revision:op.revision,changed:Boolean(op.changed),metadataId:op.metadata_id,createdAt:op.created_at},current:current(w)});
  }
  async function conflict(id,user){const w=await ownWork(id,user),error=new ApiError(409,'WORK_CONFLICT','作品信息已变化，请刷新后继续编辑');error.current=current(w);throw error;}
  async function clean(keys){if(keys.length)try{await bucket().delete(keys);}catch{/* only this unpublished attempt's immutable objects */}}
  return async function handle(request,user){
    const parts=new URL(request.url).pathname.split('/').filter(Boolean);
    if(request.method!=='PATCH'||parts.length!==3||parts[0]!=='api'||parts[1]!=='works')return null;
    const w=await ownWork(parts[2],user),key=eventId(request.headers.get('idempotency-key'));
    const form=await readForm(request,COVER_MAX_BYTES+MULTIPART_OVERHEAD_BYTES),seen=new Set();
    for(const field of form.keys()){if(!['name','desc','expectedRevision','cover'].includes(field)||seen.has(field))fail(422,'INVALID_WORK_FIELDS','作品信息编辑仅接受名称、介绍和封面');seen.add(field);}
    const name=requiredText(form.get('name'),'作品名',80),description=requiredText(form.get('desc'),'作品简介',500),expected=expectedRevision(form.get('expectedRevision'));
    let coverBytes=null,coverMime=null;
    if(form.has('cover')){
      const cover=form.get('cover');if(!cover||typeof cover==='string'||!cover.size)fail(422,'INVALID_COVER','封面须为图片文件');
      if(cover.size>COVER_MAX_BYTES)fail(413,'COVER_TOO_LARGE','封面须在 2 MiB 以内');
      coverBytes=new Uint8Array(await cover.arrayBuffer());coverMime=coverType(coverBytes,cover.type);
    }
    const requestHash=await hash(JSON.stringify({workId:w.id,expectedRevision:expected,name,description,cover:coverBytes?await hash(coverBytes):'keep',coverMime}));
    const prior=await find(user.id,key);if(prior)return response(prior,requestHash);
    if(w.revision!==expected)return conflict(w.id,user);
    const changed=name!==w.name||description!==w.description||Boolean(coverBytes),id=crypto.randomUUID(),at=new Date().toISOString();
    const nextMetadata=changed?metadataId():w.current_metadata_id||null,initialId=w.initial_metadata_id||metadataId();
    const coverKey=coverBytes?`covers/${nextMetadata}`:w.cover_key,revision=expected+(changed?1:0),written=[];
    const snapshot=workJSON({...w,name,description,cover_key:coverKey,cover_mime:coverBytes?coverMime:w.cover_mime,current_metadata_id:nextMetadata,revision,updated_at:changed?at:w.updated_at});
    try{
      if(coverBytes){written.push(coverKey);await bucket().put(coverKey,coverBytes,{httpMetadata:{contentType:coverMime}});}
      await db().batch([
        ...(changed?metadataStatements(sql,w,{id:nextMetadata,initialId,expected,name,description,coverKey,coverMime:coverBytes?coverMime:w.cover_mime,at,actor:user.id}):[]),
        sql(`INSERT INTO ft_work_edit_operations(id,owner_id,work_id,idempotency_key,request_hash,metadata_id,previous_revision,revision,changed,response_json,created_at)
          SELECT ?,?,id,?,?,?,?,?,?,?,? FROM ft_works WHERE id=? AND author_id=? AND revision=?`,id,user.id,key,requestHash,nextMetadata,expected,revision,changed?1:0,JSON.stringify(snapshot),at,w.id,user.id,expected),
        sql(`UPDATE ft_works SET name=?,description=?,current_metadata_id=?,initial_metadata_id=CASE WHEN ?=1 THEN COALESCE(initial_metadata_id,?) ELSE initial_metadata_id END,
          revision=?,updated_at=CASE WHEN ?=1 THEN ? ELSE updated_at END WHERE id=? AND author_id=? AND revision=?
          AND EXISTS(SELECT 1 FROM ft_work_edit_operations WHERE id=? AND work_id=ft_works.id AND previous_revision=ft_works.revision)`,name,description,nextMetadata,changed?1:0,initialId,revision,changed?1:0,at,w.id,user.id,expected,id),
        sql(`UPDATE ft_work_edit_operations SET work_id=CASE WHEN EXISTS(SELECT 1 FROM ft_works w WHERE w.id=ft_work_edit_operations.work_id
          AND w.revision=ft_work_edit_operations.revision AND w.current_metadata_id IS ft_work_edit_operations.metadata_id) THEN work_id ELSE NULL END WHERE id=?`,id),
      ]);
      const committed=await find(user.id,key);
      if(committed){if(committed.id!==id)await clean(written);return response(committed,requestHash);}
      await clean(written);return conflict(w.id,user);
    }catch(error){
      // An uncertain DB response must not delete an asset that actually committed.
      const committed=await find(user.id,key);
      if(committed?.id===id)return response(committed,requestHash);
      await clean(written);if(committed)return response(committed,requestHash);throw error;
    }
  };
}
