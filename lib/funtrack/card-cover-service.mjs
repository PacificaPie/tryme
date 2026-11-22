import {cardAccessible,workAccessible,contentUnavailable} from './moderation-service.mjs';
import {fail,eventId} from './rules.mjs';
import {cardIdentity} from './card-identity.mjs';
import {archiveConstraint} from './archive-service.mjs';

// Cover refresh creates a new edition. Old card URLs and their snapshots never
// change. A separate immutable metadata reference changes only the image, not
// the selected game's version, title or description.
export function createCardCoverService({db,bodyJSON,json,hash}) {
  const sql=(query,...values)=>db().prepare(query).bind(...values);
  const first=(query,...values)=>sql(query,...values).first();
  const conflict=()=>fail(409,'CARD_CHANGED','当前名片已变化，请返回我的名片后重试。');
  async function source(id,user) {
    const row=await first('SELECT * FROM ft_cards WHERE id=? AND author_id=? AND deleted_at IS NULL',id,user.id);
    if(!row)fail(404,'CARD_NOT_FOUND','名片不存在');
    const latest=await first('SELECT id FROM ft_cards WHERE author_id=? ORDER BY rowid DESC LIMIT 1',user.id);
    if(latest?.id!==id)conflict();
    const card=JSON.parse(row.snapshot_json);
    if(!Array.isArray(card.works)||!card.works.length||card.works.length>30)fail(422,'INVALID_CARD','请重新制作这张名片。');
    return {...card,id:row.id,authorId:row.author_id};
  }
  async function ownWork(id,user) {
    const work=await first('SELECT * FROM ft_works WHERE id=? AND author_id=?',id,user.id);
    if(!work)fail(404,'WORK_NOT_FOUND','作品不存在');
    if(!await first(`SELECT w.id FROM ft_works w WHERE w.id=? AND ${workAccessible()}`,id))throw contentUnavailable();
    if(work.archived_at)fail(409,'WORK_ARCHIVED','名片包含已归档作品，请先恢复作品再更新封面。');
    return work;
  }
  async function oldCoverKey(work) {
    if(!work.coverUrl)return null;
    const metadataId=work.coverMetadataId||work.metadataId;
    const metadata=metadataId&&work.coverUrl==='/media/'+metadataId;
    const version=work.coverUrl==='/media/'+work.versionId;
    if(!metadata&&!version)return null;
    const row=await first(metadata?'SELECT cover_key FROM ft_work_metadata WHERE id=? AND work_id=?':'SELECT cover_key FROM ft_work_versions WHERE id=? AND work_id=?',metadata?metadataId:work.versionId,work.id);
    return row?.cover_key||null;
  }
  const usable=row=>row?.cover_key&&['image/png','image/jpeg','image/webp'].includes(row.cover_mime);
  async function handle(request,user) {
    const match=/^\/api\/cards\/([a-f0-9-]{36})\/cover-updates$/.exec(new URL(request.url).pathname);
    if(!match)return null;
    const id=match[1];
    if(request.method==='GET') {
      const card=await source(id,user),updates=[];
      for(const selected of card.works) {
        const work=await ownWork(selected.id,user);
        const cover=work.current_metadata_id&&await first('SELECT * FROM ft_work_metadata WHERE id=? AND work_id=?',work.current_metadata_id,work.id);
        if(usable(cover)&&cover.cover_key!==await oldCoverKey(selected))updates.push({workId:work.id,metadataId:cover.id,name:selected.name,previousCoverUrl:selected.coverUrl||'',coverUrl:'/media/'+cover.id});
      }
      return json({card:await cardIdentity(db(),card,user.id),updates});
    }
    if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED','不支持该请求方法');
    const input=await bodyJSON(request),updates=input.updates;
    if(Object.keys(input).some(key=>key!=='updates')||!Array.isArray(updates)||!updates.length||updates.length>30||updates.some(u=>!u||typeof u.workId!=='string'||typeof u.metadataId!=='string'||Object.keys(u).some(key=>!['workId','metadataId'].includes(key)))||new Set(updates.map(u=>u.workId)).size!==updates.length)fail(422,'INVALID_COVER_UPDATES','请选择需要更新的封面。');
    const key=eventId(request.headers.get('Idempotency-Key'));
    const requestHash=await hash(JSON.stringify({operation:'card-cover-updates',sourceId:id,updates}));
    async function replay() {
      const row=await first('SELECT * FROM ft_cards WHERE author_id=? AND idempotency_key=?',user.id,key);
      if(!row)return null;
      if(row.request_hash!==requestHash)fail(409,'IDEMPOTENCY_CONFLICT','封面选择已变化，请重新预览后保存。');
      if(row.deleted_at)fail(409,'CARD_DELETED','更新后的名片已删除，请重新选择。');
      if(!await first(`SELECT c.id FROM ft_cards c WHERE c.id=? AND ${cardAccessible()}`,row.id))throw contentUnavailable();
      return json({card:await cardIdentity(db(),{...JSON.parse(row.snapshot_json),id:row.id},user.id)});
    }
    const previous=await replay();if(previous)return previous;
    const card=await source(id,user),selected=new Map(card.works.map(w=>[w.id,w]));
    // Validate every selected work, including those whose cover is unchanged.
    for(const work of card.works)await ownWork(work.id,user);
    for(const update of updates) {
      const work=selected.get(update.workId);
      if(!work)fail(422,'INVALID_COVER_UPDATES','封面不属于这张名片。');
      const cover=await first('SELECT * FROM ft_work_metadata WHERE id=? AND work_id=?',update.metadataId,work.id);
      if(!usable(cover))fail(422,'INVALID_COVER_UPDATES','所选封面不可用，请重新预览。');
      if(cover.cover_key===await oldCoverKey(work))fail(422,'NO_COVER_UPDATES','所选封面没有变化。');
      work.coverMetadataId=cover.id;work.coverUrl='/media/'+cover.id;
    }
    const next={...card,id:crypto.randomUUID(),createdAt:new Date().toISOString()};
    try {
      // D1 serializes this condition and insertion. A newer template save or
      // deletion cannot be replaced by a delayed cover refresh.
      const result=await sql(`INSERT INTO ft_cards(id,author_id,snapshot_json,created_at,idempotency_key,request_hash)
        SELECT ?,?,?,?,?,? FROM ft_cards WHERE id=? AND author_id=? AND deleted_at IS NULL
        AND id=(SELECT id FROM ft_cards WHERE author_id=? ORDER BY rowid DESC LIMIT 1)`,next.id,user.id,JSON.stringify(next),next.createdAt,key,requestHash,id,user.id,user.id).run();
      if(!result.meta?.changes){const duplicate=await replay();if(duplicate)return duplicate;conflict();}
    } catch(error) {
      const duplicate=await replay();if(duplicate)return duplicate;
      if(archiveConstraint(error))fail(409,'WORK_ARCHIVED','名片包含已归档作品，请先恢复作品再更新封面。');
      throw error;
    }
    return json({card:await cardIdentity(db(),next,user.id)},201);
  }
  return {handle};
}
