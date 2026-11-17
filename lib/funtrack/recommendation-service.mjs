import {ApiError,eventId,fail} from './rules.mjs';

// An intentionally small, inspectable first experiment. This is a priority
// score, not a promise of a number of impressions or a human-quality rating.
export const RECOMMENDATION_VERSION='reciprocity-v1';
export const RECOMMENDATION_LIMITS=Object.freeze({freshDays:30,freshMax:400,coldStartDays:7,coldStartViewers:20,coldStartMax:200,
  engagementDays:30,playerWeight:10,engagementMax:200,contributionDays:7,contributionWeight:10,contributionsPerDay:3,contributionMax:40,impressionsPerMinute:240});
const C=RECOMMENDATION_LIMITS;

export function recommendationRank(asOf,snapshot){
  const before=days=>new Date(Date.parse(asOf)-days*86400000).toISOString();
  return {sql:`(
    CAST(MAX(0,MIN(${C.freshMax},${C.freshMax}*(1-(julianday(?)-julianday(w.created_at))/${C.freshDays}))) AS INTEGER)
    + CASE WHEN w.created_at>=? THEN MAX(0,${C.coldStartMax}-${C.coldStartMax/C.coldStartViewers}*(
      SELECT COUNT(DISTINCT i.actor_id) FROM ft_feed_impressions i
      WHERE i.work_id=w.id AND i.actor_id<>w.author_id AND i.received_at<=? AND i.rowid<=?
    )) ELSE 0 END
    + MIN(${C.engagementMax},${C.playerWeight}*(SELECT COUNT(DISTINCT e.actor_id) FROM ft_events e
      WHERE e.work_id=w.id AND e.actor_id<>w.author_id AND e.event_type='play_start' AND e.received_at>=? AND e.received_at<=? AND e.rowid<=?))
    + CAST(MIN(${C.contributionMax},COALESCE((SELECT SUM(MAX(0,${C.contributionWeight}*(1-(julianday(?)-julianday(c.created_at))/${C.contributionDays})))
      FROM ft_contribution_credits c WHERE c.actor_id=w.author_id AND c.created_at>=? AND c.created_at<=? AND c.rowid<=?),0)) AS INTEGER)
  )`,values:[asOf,before(C.coldStartDays),asOf,snapshot.impressions,before(C.engagementDays),asOf,snapshot.events,asOf,before(C.contributionDays),asOf,snapshot.credits]};
}

export function createRecommendationService({db,bodyJSON}){
  const sql=(query,...values)=>db().prepare(query).bind(...values);

  // Run in the same D1 transaction as the interaction. The original stored
  // interaction timestamp prevents a pre-play interaction being rewarded by a
  // later retry. Credit time is the server award time (never backdated into a
  // cursor); only interactions from the last 24 hours remain eligible.
  // Unique keys and this INSERT SELECT enforce the daily limits
  // atomically across simultaneous likes, comments, feedback and versions.
  function creditStatement(actorId,workId,kind,sourceId=workId){
    const awardedAt=new Date().toISOString(),earnedDay=awardedAt.slice(0,10),recent=new Date(Date.parse(awardedAt)-86400000).toISOString();
    let interaction,sourceValues;
    if(kind==='like'){
      interaction='SELECT created_at FROM ft_work_likes WHERE actor_id=? AND work_id=?';sourceValues=[actorId,workId];
    }else if(kind==='comment'){
      interaction='SELECT created_at FROM ft_comments WHERE author_id=? AND work_id=? AND id=? AND parent_id IS NULL';sourceValues=[actorId,workId,sourceId];
    }else if(kind==='feedback'){
      interaction='SELECT created_at FROM ft_feedback WHERE author_id=? AND work_id=? AND id=?';sourceValues=[actorId,workId,sourceId];
    }else throw new Error('Invalid contribution source');
    return sql(`WITH interaction AS (${interaction})
      INSERT OR IGNORE INTO ft_contribution_credits(actor_id,target_work_id,target_author_id,source_kind,source_id,earned_day,created_at)
      SELECT ?,w.id,w.author_id,?,?,?,?
      FROM ft_works w JOIN ft_work_discovery d ON d.work_id=w.id CROSS JOIN interaction i
      WHERE w.id=? AND w.author_id<>? AND d.visibility='listed' AND i.created_at>=? AND i.created_at<=?
        AND EXISTS (SELECT 1 FROM ft_events e WHERE e.actor_id=? AND e.work_id=w.id AND e.event_type='play_start'
          AND e.received_at<=i.created_at AND e.received_at>=strftime('%Y-%m-%dT%H:%M:%fZ',julianday(i.created_at)-1))
        AND (SELECT COUNT(*) FROM ft_contribution_credits c WHERE c.actor_id=? AND c.earned_day=?)<${C.contributionsPerDay}`,
      ...sourceValues,actorId,kind,sourceId,earnedDay,awardedAt,workId,actorId,recent,awardedAt,actorId,actorId,earnedDay);
  }

  async function impressions(request,user){
    const input=await bodyJSON(request);
    // This is an optional stale-tab guard, never an alternate identity source.
    if(input.expectedActorId!==undefined&&input.expectedActorId!==user.id)fail(409,'ACTOR_CHANGED','登录账号已变化，请刷新页面后重试');
    if(!Array.isArray(input.impressions)||input.impressions.length<1||input.impressions.length>24)fail(422,'INVALID_IMPRESSIONS','每批须有 1–24 条曝光记录');
    const ids=new Map();
    input.impressions.forEach(value=>{
      if(!value||typeof value!=='object')fail(422,'INVALID_IMPRESSION','曝光记录无效');
      const id=eventId(value.eventId),workId=eventId(value.workId),sort=value.sort;
      if(!['recommended','newest','likes','comments'].includes(sort))fail(422,'INVALID_SORT','作品排序无效');
      const prior=ids.get(id);
      if(prior&&(prior.workId!==workId||prior.sort!==sort))fail(409,'EVENT_CONFLICT','曝光标识已用于不同内容');
      const event={eventId:id,workId,sort};ids.set(id,event);
    });
    const unique=[...ids.values()],now=new Date().toISOString(),day=now.slice(0,10),minute=new Date(Date.parse(now)-60000).toISOString();
    // Check event-ID reuse before any writes. Date deduplication is separate:
    // revisiting the same work or changing the sort cannot inflate exposure.
    for(const event of unique){
      const prior=await sql('SELECT work_id,sort FROM ft_feed_impressions WHERE actor_id=? AND client_event_id=?',user.id,event.eventId).first();
      if(prior&&(prior.work_id!==event.workId||prior.sort!==event.sort))fail(409,'EVENT_CONFLICT','曝光标识已用于不同内容');
    }
    const writes=unique.map(event=>{
      const id=crypto.randomUUID();
      return {event,id,statement:sql(`INSERT OR IGNORE INTO ft_feed_impressions(id,client_event_id,actor_id,work_id,sort,exposure_day,received_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ft_works w JOIN ft_work_discovery d ON d.work_id=w.id WHERE w.id=? AND d.visibility='listed')
        AND (SELECT COUNT(*) FROM ft_feed_impressions WHERE actor_id=? AND received_at>=?)<${C.impressionsPerMinute}`,
        id,event.eventId,user.id,event.workId,event.sort,day,now,event.workId,user.id,minute)};
    });
    await db().batch(writes.map(item=>item.statement));
    const accepted=[],duplicates=[],ignored=[];
    for(const {event,id} of writes){
      const exact=await sql('SELECT * FROM ft_feed_impressions WHERE actor_id=? AND client_event_id=?',user.id,event.eventId).first();
      if(exact){
        if(exact.work_id!==event.workId||exact.sort!==event.sort)fail(409,'EVENT_CONFLICT','曝光标识已用于不同内容');
        if(exact.id===id)accepted.push({eventId:event.eventId,workId:event.workId,receivedAt:exact.received_at});else duplicates.push(event.eventId);
        continue;
      }
      const prior=await sql('SELECT id FROM ft_feed_impressions WHERE actor_id=? AND work_id=? AND exposure_day=?',user.id,event.workId,day).first();
      if(prior){duplicates.push(event.eventId);continue;}
      const listed=await sql("SELECT w.id FROM ft_works w JOIN ft_work_discovery d ON d.work_id=w.id WHERE w.id=? AND d.visibility='listed'",event.workId).first();
      if(!listed){ignored.push(event.eventId);continue;}
      // A simultaneous batch may have filled the minute quota. Existing rows
      // are already durable; retrying these IDs never creates duplicates.
      throw new ApiError(429,'RATE_LIMITED','曝光记录提交过于频繁，请稍后重试');
    }
    return Response.json({accepted,duplicates,ignored},{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  return {creditStatement,impressions};
}
