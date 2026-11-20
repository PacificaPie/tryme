import {ApiError,fail} from './rules.mjs';
import {cardRowIdentities} from './card-identity.mjs';

// All selected works must still be discoverable. Do not indirectly promote a
// hidden/archived work through a card, even though its old share link still works.
export const CARD_FEED_FROM=`FROM ft_card_feed_selections e JOIN ft_cards c ON c.id=e.card_id`;
export const CARD_FEED_ELIGIBLE=`c.deleted_at IS NULL AND c.author_id=e.author_id
  AND e.seq=(SELECT MAX(latest.seq) FROM ft_card_feed_selections latest WHERE latest.author_id=e.author_id)
  AND json_valid(c.snapshot_json) AND json_type(c.snapshot_json,'$.works')='array'
  AND json_array_length(c.snapshot_json,'$.works') BETWEEN 1 AND 30
  AND NOT EXISTS(SELECT 1 FROM json_each(c.snapshot_json,'$.works') saved
    WHERE NOT EXISTS(SELECT 1 FROM ft_works w JOIN ft_work_discovery d ON d.work_id=w.id
      WHERE w.id=json_extract(saved.value,'$.id') AND w.author_id=c.author_id
      AND w.archived_at IS NULL AND d.visibility='listed'))`;

export function createCardFeedService({db,bodyJSON,json,sharing}){
  const sql=(query,...values)=>db().prepare(query).bind(...values);
  async function state(user,id){
    const latest=await sql('SELECT * FROM ft_card_feed_selections WHERE author_id=? ORDER BY seq DESC LIMIT 1',user.id).first();
    const eligible=await sql(`SELECT e.seq ${CARD_FEED_FROM} WHERE e.card_id=? AND ${CARD_FEED_ELIGIBLE}`,id).first();
    return {listed:latest?.card_id===id,eligible:Boolean(eligible),revision:latest?.seq||0};
  }
  async function handle(request,user){
    const match=/^\/api\/cards\/([A-Za-z0-9_-]{8,128})\/discovery$/.exec(new URL(request.url).pathname);
    if(!match)return null;
    const id=match[1],card=await sql('SELECT id FROM ft_cards WHERE id=? AND author_id=? AND deleted_at IS NULL',id,user.id).first();
    if(!card)fail(404,'CARD_NOT_FOUND','名片不存在');
    if(request.method==='GET')return json({discovery:await state(user,id)});
    if(!['POST','PATCH'].includes(request.method))fail(405,'METHOD_NOT_ALLOWED','不支持该请求方法');
    const input=await bodyJSON(request);
    if(typeof input.listed!=='boolean'||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail(422,'INVALID_CARD_DISCOVERY','请明确选择名片展示状态并刷新后重试。');
    async function conflict(){const error=new ApiError(409,'CARD_DISCOVERY_CONFLICT','名片展示状态已变化，请刷新后重试。');error.current={discovery:await state(user,id)};throw error;}
    const current=await state(user,id);if(current.revision!==input.expectedRevision)return conflict();
    if(current.listed===input.listed)return json({discovery:current});
    const result=await sql(`INSERT INTO ft_card_feed_selections(author_id,card_id,created_at)
      SELECT ?,?,? WHERE COALESCE((SELECT MAX(seq) FROM ft_card_feed_selections WHERE author_id=?),0)=?
      AND EXISTS(SELECT 1 FROM ft_cards WHERE id=? AND author_id=? AND deleted_at IS NULL)`,
    user.id,input.listed?id:null,new Date().toISOString(),user.id,input.expectedRevision,id,user.id).run();
    if(!result.meta.changes)return conflict();
    return json({discovery:await state(user,id)});
  }
  async function page({query,asOf,snapshot,lastCard,user}){
    const conditions=[CARD_FEED_ELIGIBLE,'e.seq<=?','e.created_at<=?'],values=[snapshot.cards,asOf];
    if(query.following){conditions.push('EXISTS(SELECT 1 FROM ft_creator_follows f WHERE f.follower_id=? AND f.creator_id=e.author_id AND f.created_at<=?)');values.push(user.id,asOf);}
    if(query.q){conditions.push(`instr(lower(CASE WHEN p.id IS NULL THEN COALESCE(json_extract(c.snapshot_json,'$.name'),'')||char(10)||COALESCE(json_extract(c.snapshot_json,'$.bio'),'')||char(10)||COALESCE(json_extract(c.snapshot_json,'$.headline'),'') ELSE p.name||char(10)||p.bio||char(10)||p.headline END),lower(?))>0`);values.push(query.q);}
    const from=CARD_FEED_FROM+' LEFT JOIN ft_profiles p ON p.id=c.author_id WHERE '+conditions.join(' AND ');
    const results=await db().batch([
      sql('SELECT c.id,c.author_id,c.snapshot_json,e.seq '+from+(lastCard?' AND e.seq<?':'')+' ORDER BY e.seq DESC LIMIT ?',...values,...lastCard?[lastCard]:[],query.limit+1),
      sql('SELECT COUNT(*) n '+from,...values),
    ]);
    const rows=results[0].results,cards=await cardRowIdentities(db(),rows);
    return {cards:cards.map(card=>{
      const projected=sharing.project(card);
      return {type:'card',id:projected.id,name:projected.name,bio:projected.bio,headline:projected.headline,avatarUrl:projected.avatarUrl,template:projected.template,signature:projected.signature,
        works:projected.works.map(work=>({name:work.name,version:work.version,coverUrl:work.coverUrl?`/api/public/discover/cards/${card.id}/works/${work.id}/cover`:''}))};
    }),positions:rows.map(row=>row.seq),total:Number(results[1].results[0].n)};
  }
  async function cover(request,cardId,workId){
    const row=await sql(`SELECT c.id,c.author_id,c.snapshot_json ${CARD_FEED_FROM} WHERE e.card_id=? AND ${CARD_FEED_ELIGIBLE}`,cardId).first();
    if(!row)fail(404,'MEDIA_NOT_FOUND','封面不存在');
    const [card]=await cardRowIdentities(db(),[row]);return sharing.cover(request,card,workId);
  }
  return {handle,page,cover};
}
