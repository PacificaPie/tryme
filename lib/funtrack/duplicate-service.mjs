import {ApiError} from './rules.mjs';

// This registry prevents concurrent duplicate publications without changing or
// merging any existing work, version, card, analytics row or stored object.
export function createDuplicateService({db}) {
  const sql=(query,...values)=>db().prepare(query).bind(...values);
  async function find(owner,kind,fingerprint) {
    const claimed=await sql(`SELECT w.id,w.name,w.source,v.id version_id,v.version FROM ft_work_fingerprints f
      JOIN ft_works w ON w.id=f.work_id AND w.author_id=f.owner_id
      JOIN ft_work_versions v ON v.id=f.version_id AND v.work_id=w.id
      WHERE f.owner_id=? AND f.kind=? AND f.fingerprint=?`,owner,kind,fingerprint).first();
    if(claimed)return claimed;
    // Also cover records written by the previous deployment while the additive
    // migration was live. Old records are not rewritten just to claim identity.
    return sql(`SELECT w.id,w.name,w.source,v.id version_id,v.version FROM ft_works w
      JOIN ft_work_versions v ON v.work_id=w.id WHERE w.author_id=? AND ${kind==='html'?"w.source='html' AND v.content_hash=?":"w.source='url' AND w.url=?"}
      ORDER BY w.created_at,w.id,v.ordinal LIMIT 1`,owner,fingerprint).first();
  }
  function duplicate(row) {
    const error=new ApiError(409,'DUPLICATE_WORK','你已上传过相同内容，请打开已有作品或更新其版本。');
    error.existingWork={id:row.id,name:row.name,source:row.source,versionId:row.version_id,version:row.version};
    throw error;
  }
  async function assertNew(owner,kind,fingerprint) {const row=await find(owner,kind,fingerprint);if(row)duplicate(row);}
  async function assertVersion(owner,workId,versionId,fingerprint) {
    // Prefer this work's current/history match, including grandfathered works
    // that share bytes with another old work and cannot own the unique claim.
    const existing=await sql(`SELECT id,version FROM ft_work_versions WHERE work_id=? AND content_hash=?
      ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,ordinal DESC LIMIT 1`,workId,fingerprint,versionId).first();
    if(existing){
      const same=existing.id===versionId;
      const error=new ApiError(409,same?'VERSION_UNCHANGED':'VERSION_ALREADY_EXISTS',same?'游戏文件没有变化；修改名称、介绍或封面请使用编辑作品信息。':'相同文件已在版本历史中，请打开历史版本或切换到该版本。');
      error.existingVersion={id:existing.id,version:existing.version,workId};throw error;
    }
    const row=await find(owner,'html',fingerprint);if(row&&row.id!==workId)duplicate(row);
  }
  function claim(owner,kind,fingerprint,workId,versionId,at) {
    // Called in the same D1 transaction as the referenced new version. A unique
    // conflict rolls back the entire publication; a rejected CAS inserts none.
    return sql(`INSERT INTO ft_work_fingerprints(owner_id,kind,fingerprint,work_id,version_id,created_at)
      SELECT ?,?,?,?,v.id,? FROM ft_work_versions v WHERE v.id=? AND v.work_id=?`,owner,kind,fingerprint,workId,at,versionId,workId);
  }
  return {find,duplicate,assertNew,assertVersion,claim};
}
