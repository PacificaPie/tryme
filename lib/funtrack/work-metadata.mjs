// Immutable snapshots keep public work edits separate from historical versions.
export const metadataId=()=>`metadata-${crypto.randomUUID()}`;
export function metadataStatements(sql,w,{id,initialId,expected,name=w.name,description=w.description,coverKey=w.cover_key,coverMime=w.cover_mime,at,actor}){
  return [
    // Legacy rows are left untouched by migration. The first normal write also
    // freezes their original publication text for subsequent idempotent replay.
    sql(`INSERT INTO ft_work_metadata(id,work_id,name,description,cover_key,cover_mime,created_at,created_by)
      SELECT ?,w.id,w.name,w.description,v.cover_key,v.cover_mime,w.created_at,? FROM ft_works w
      JOIN ft_work_versions v ON v.work_id=w.id AND v.ordinal=1
      WHERE w.id=? AND w.revision=? AND w.initial_metadata_id IS NULL`,initialId,actor,w.id,expected),
    sql(`INSERT INTO ft_work_metadata(id,work_id,name,description,cover_key,cover_mime,created_at,created_by)
      SELECT ?,id,?,?,?,?,?,? FROM ft_works WHERE id=? AND revision=?`,id,name,description,coverKey||null,coverMime||null,at,actor,w.id,expected),
  ];
}
