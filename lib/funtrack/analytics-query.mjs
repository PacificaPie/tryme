import {ApiError,fail} from './rules.mjs';

const DAY=86400000;
const day=value=>new Date(value).toISOString().slice(0,10);
const midnight=value=>value+'T00:00:00.000Z';
const addDays=(value,count)=>day(Date.parse(midnight(value))+count*DAY);
function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='1970-01-01'&&Number.isFinite(Date.parse(midnight(value)))&&day(Date.parse(midnight(value)))===value;}
export function analyticsQuery(params,now=new Date()){
  const today=day(now),hasRange=params.has('from')||params.has('to');let from,to;
  if(hasRange){
    from=params.get('from');to=params.get('to');
    if(params.has('days')||!validDate(from)||!validDate(to)||from>to||to>today)fail(422,'INVALID_DATE_RANGE','请选择有效的 UTC 日期范围，结束日期不能晚于今天');
  }else{
    const days=Number(params.get('days')||7);if(!Number.isInteger(days)||days<1||days>90)fail(422,'INVALID_DAYS','统计天数须为 1–90 天');
    to=today;from=addDays(to,1-days);
  }
  const length=Math.round((Date.parse(midnight(to))-Date.parse(midnight(from)))/DAY)+1;
  if(length<1||length>90)fail(422,'INVALID_DATE_RANGE','日期范围最多 90 天');
  const granularity=params.get('granularity')||'day';if(!['day','week'].includes(granularity))fail(422,'INVALID_GRANULARITY','请选择按日或按周查看');
  const self=params.get('excludeSelf')||'0';if(!['0','1'].includes(self))fail(422,'INVALID_SELF_FILTER','排除本人参数无效');
  const work=params.get('work')||null,version=params.get('version')||null;
  if(version&&!work)fail(422,'WORK_REQUIRED','请先选择作品，再筛选版本');
  if((work&&work.length>128)||(version&&version.length>128))fail(422,'INVALID_FILTER','作品或版本标识无效');
  return {from,to,previousFrom:addDays(from,-length),previousTo:addDays(from,-1),granularity,excludeSelf:self==='1',work,version,partialToday:to===today};
}

// All actor-distinct and duration aggregation happens inside SQLite/D1. At most
// 180 calendar days of facts enter these CTEs; no raw event collection is read
// into application memory. Each aggregation statement uses nine bound values.
const SCOPE=`WITH params AS (SELECT ? owner,? work_id,? version_id,? exclude_self,? current_from,? current_to,? previous_from,? previous_to,? granularity),
scope_works AS MATERIALIZED (SELECT w.* FROM ft_works w,params p WHERE w.author_id=p.owner AND (p.work_id IS NULL OR w.id=p.work_id)),
scope_sessions AS MATERIALIZED (SELECT s.* FROM ft_play_sessions s JOIN scope_works w ON w.id=s.work_id CROSS JOIN params p
  WHERE s.created_at>=p.previous_from AND s.created_at<p.current_to AND (p.version_id IS NULL OR s.version_id=p.version_id) AND (p.exclude_self=0 OR s.actor_id<>p.owner)),
session_events AS MATERIALIZED (SELECT e.session_id,
  MIN(CASE WHEN e.event_type='play_start' THEN e.received_at END) started_at,
  MAX(CASE WHEN e.event_type='game_complete' THEN 1 ELSE 0 END) completed,
  MAX(CASE WHEN e.event_type='session_end' THEN 1 ELSE 0 END) ended,
  MAX(CASE WHEN e.event_type='session_end' AND json_valid(e.result_json) THEN CASE
    WHEN json_type(e.result_json,'$.timingVersion')='integer' AND json_extract(e.result_json,'$.timingVersion')=1
    AND json_type(e.result_json,'$.activeMs')='integer' AND json_extract(e.result_json,'$.activeMs') BETWEEN 0 AND 3600000
    AND typeof(e.elapsed_ms)='integer' AND json_extract(e.result_json,'$.activeMs')<=e.elapsed_ms
    THEN json_extract(e.result_json,'$.activeMs') END END) active_ms
  FROM ft_events e JOIN scope_sessions s ON s.id=e.session_id
  WHERE e.actor_id=s.actor_id AND e.work_id=s.work_id AND e.version_id=s.version_id
  AND e.event_type IN ('play_start','game_complete','session_end') GROUP BY e.session_id)`;

// D1's compound SELECT limit is five terms. Keep each fact group below that
// limit, with materialization fences preventing optimizer expansion on reuse.
const FACTS=`,activity_facts AS MATERIALIZED (
  SELECT CASE e.event_type WHEN 'work_view' THEN 'view' ELSE 'outbound' END kind,e.work_id,e.actor_id,e.received_at at,
    0 started,0 completed,0 ended,NULL active_ms,NULL started_at
  FROM ft_events e JOIN scope_works w ON w.id=e.work_id CROSS JOIN params p
  WHERE e.event_type IN ('work_view','outbound_click') AND e.received_at>=p.previous_from AND e.received_at<p.current_to
    AND (p.version_id IS NULL OR e.version_id=p.version_id) AND (p.exclude_self=0 OR e.actor_id<>p.owner)
  UNION ALL
  SELECT 'session',s.work_id,s.actor_id,s.created_at,CASE WHEN e.started_at IS NOT NULL THEN 1 ELSE 0 END,
    COALESCE(e.completed,0),COALESCE(e.ended,0),CASE WHEN e.started_at IS NOT NULL AND e.ended=1 THEN e.active_ms END,e.started_at
  FROM scope_sessions s LEFT JOIN session_events e ON e.session_id=s.id
  UNION ALL
  SELECT 'feed',i.work_id,i.actor_id,i.received_at,0,0,0,NULL,NULL
  FROM ft_feed_impressions i JOIN scope_works w ON w.id=i.work_id CROSS JOIN params p
  WHERE p.version_id IS NULL AND i.received_at>=p.previous_from AND i.received_at<p.current_to
    AND (p.exclude_self=0 OR i.actor_id<>p.owner)
),social_facts AS MATERIALIZED (
  SELECT 'comment' kind,c.work_id,c.author_id actor_id,c.created_at at,0 started,0 completed,0 ended,NULL active_ms,NULL started_at FROM ft_comments c JOIN scope_works w ON w.id=c.work_id CROSS JOIN params p
  WHERE p.version_id IS NULL AND c.created_at>=p.previous_from AND c.created_at<p.current_to AND (p.exclude_self=0 OR c.author_id<>p.owner)
  UNION ALL
  SELECT 'like',l.work_id,l.actor_id,l.created_at,0,0,0,NULL,NULL FROM ft_work_likes l JOIN scope_works w ON w.id=l.work_id CROSS JOIN params p
  WHERE p.version_id IS NULL AND l.created_at>=p.previous_from AND l.created_at<p.current_to AND (p.exclude_self=0 OR l.actor_id<>p.owner)
  UNION ALL
  SELECT 'feedback',f.work_id,f.author_id,f.created_at,0,0,0,NULL,NULL FROM ft_feedback f JOIN scope_works w ON w.id=f.work_id CROSS JOIN params p
  WHERE f.created_at>=p.previous_from AND f.created_at<p.current_to AND (p.version_id IS NULL OR f.version_id=p.version_id) AND (p.exclude_self=0 OR f.author_id<>p.owner)
  UNION ALL
  SELECT 'card',NULL,e.actor_id,e.received_at,0,0,0,NULL,NULL FROM ft_events e JOIN ft_cards c ON c.id=e.card_id CROSS JOIN params p
  WHERE p.work_id IS NULL AND c.author_id=p.owner AND e.event_type='card_view' AND e.received_at>=p.previous_from AND e.received_at<p.current_to AND (p.exclude_self=0 OR e.actor_id<>p.owner)
),facts AS MATERIALIZED (SELECT * FROM activity_facts UNION ALL SELECT * FROM social_facts),timed AS MATERIALIZED (SELECT f.*,CASE WHEN f.at>=p.current_from THEN 'current' ELSE 'previous' END period,
  CASE WHEN p.granularity='week' THEN date(f.at,'-'||((CAST(strftime('%w',f.at) AS INTEGER)+6)%7)||' days') ELSE substr(f.at,1,10) END bucket
  FROM facts f CROSS JOIN params p),expanded AS MATERIALIZED (
  SELECT 'period' dimension,t.period group_key,CASE t.period WHEN 'current' THEN p.current_from ELSE p.previous_from END from_bound,
    CASE t.period WHEN 'current' THEN p.current_to ELSE p.previous_to END to_bound,t.* FROM timed t CROSS JOIN params p
  UNION ALL
  SELECT 'series',t.bucket,MAX(t.bucket||'T00:00:00.000Z',p.current_from),
    MIN(date(t.bucket,CASE p.granularity WHEN 'week' THEN '+7 days' ELSE '+1 day' END)||'T00:00:00.000Z',p.current_to),t.*
  FROM timed t CROSS JOIN params p WHERE t.period='current'
  UNION ALL
  SELECT 'work',t.work_id,p.current_from,p.current_to,t.* FROM timed t CROSS JOIN params p WHERE t.period='current' AND t.work_id IS NOT NULL
)`;

const AGGREGATE=`,aggregated AS (SELECT dimension,group_key,
  SUM(kind='feed') feedImpressions,COUNT(DISTINCT CASE WHEN kind='feed' THEN actor_id END) feedViewers,
  SUM(kind='view') pv,COUNT(DISTINCT CASE WHEN kind='view' THEN actor_id END) uv,
  SUM(kind='session') opens,COUNT(DISTINCT CASE WHEN kind='session' AND started=1 THEN actor_id END) players,
  SUM(kind='session' AND started=1) starts,SUM(kind='session' AND started=1 AND completed=1) completions,
  SUM(CASE WHEN kind='session' THEN active_ms END) totalActiveMs,AVG(CASE WHEN kind='session' THEN active_ms END) avgActiveMs,
  COUNT(CASE WHEN kind='session' THEN active_ms END) durationSamples,SUM(kind='session' AND started=1 AND ended=1) endedStarts,
  SUM(kind='comment') comments,SUM(kind='like') likes,SUM(kind='outbound') outboundClicks,
  SUM(kind='feedback') feedback,SUM(kind='card') cardViews,SUM(kind='session' AND ended=1) ends
  FROM expanded GROUP BY dimension,group_key),returning_players AS (
  SELECT dimension,group_key,COUNT(*) returningPlayers FROM (
    SELECT dimension,group_key,actor_id FROM expanded WHERE kind='session' AND started=1 AND started_at>=from_bound AND started_at<to_bound
    GROUP BY dimension,group_key,actor_id HAVING COUNT(DISTINCT substr(started_at,1,10))>=2
  ) GROUP BY dimension,group_key)
SELECT a.*,COALESCE(r.returningPlayers,0) returningPlayers FROM aggregated a LEFT JOIN returning_players r ON r.dimension=a.dimension AND r.group_key=a.group_key`;

export const ANALYTICS_SQL=SCOPE+FACTS+AGGREGATE;
export const FUNNEL_SQL=SCOPE+`,visitors AS (
  SELECT DISTINCT e.work_id,e.actor_id FROM ft_events e JOIN scope_works w ON w.id=e.work_id CROSS JOIN params p
  WHERE w.source='html' AND e.event_type='work_view' AND e.received_at>=p.current_from AND e.received_at<p.current_to
    AND (p.version_id IS NULL OR e.version_id=p.version_id) AND (p.exclude_self=0 OR e.actor_id<>p.owner)
)
SELECT COUNT(DISTINCT v.actor_id) visitors,COUNT(DISTINCT CASE WHEN s.id IS NOT NULL THEN v.actor_id END) opened,
  COUNT(DISTINCT CASE WHEN e.started_at IS NOT NULL THEN v.actor_id END) started
FROM visitors v CROSS JOIN params p LEFT JOIN scope_sessions s ON s.work_id=v.work_id AND s.actor_id=v.actor_id AND s.created_at>=p.current_from
LEFT JOIN session_events e ON e.session_id=s.id`;

const RECEIPTS_SQL=SCOPE+`,receipts AS (
  SELECT e.id,e.client_event_id clientEventId,e.event_type type,e.work_id workId,e.version_id versionId,e.card_id cardId,e.received_at receivedAt
  FROM ft_events e JOIN scope_works w ON w.id=e.work_id CROSS JOIN params p
  WHERE e.received_at>=p.current_from AND e.received_at<p.current_to AND (p.version_id IS NULL OR e.version_id=p.version_id) AND (p.exclude_self=0 OR e.actor_id<>p.owner)
  UNION ALL
  SELECT f.id,f.client_event_id,'feedback',f.work_id,f.version_id,NULL,f.created_at FROM ft_feedback f JOIN scope_works w ON w.id=f.work_id CROSS JOIN params p
  WHERE f.created_at>=p.current_from AND f.created_at<p.current_to AND (p.version_id IS NULL OR f.version_id=p.version_id) AND (p.exclude_self=0 OR f.author_id<>p.owner)
  UNION ALL
  SELECT e.id,e.client_event_id,e.event_type,NULL,NULL,e.card_id,e.received_at FROM ft_events e JOIN ft_cards c ON c.id=e.card_id CROSS JOIN params p
  WHERE p.work_id IS NULL AND c.author_id=p.owner AND e.event_type='card_view' AND e.received_at>=p.current_from AND e.received_at<p.current_to AND (p.exclude_self=0 OR e.actor_id<>p.owner)
) SELECT * FROM receipts ORDER BY receivedAt DESC,id DESC LIMIT 30`;

const keys=['feedImpressions','feedViewers','pv','uv','opens','players','starts','completions','totalActiveMs','avgActiveMs','durationSamples','endedStarts','comments','likes','outboundClicks','returningPlayers','feedback','cardViews','ends'];
const gameplay=['opens','players','starts','completions','totalActiveMs','avgActiveMs','durationSamples','endedStarts','returningPlayers','ends'];
function metrics(row,external,version){
  const result={};for(const key of keys)result[key]=row?.[key]??(['totalActiveMs','avgActiveMs'].includes(key)?null:0);
  if(external)for(const key of gameplay)result[key]=null;
  if(version){result.comments=null;result.likes=null;result.feedImpressions=null;result.feedViewers=null;}
  return {...result,views:result.pv};
}
function bucketDate(value,granularity){if(granularity==='day')return value;const date=new Date(midnight(value));return addDays(value,-((date.getUTCDay()+6)%7));}
export const analyticsBindings=(q,owner)=>[owner,q.work,q.version,q.excludeSelf?1:0,midnight(q.from),midnight(addDays(q.to,1)),midnight(q.previousFrom),midnight(addDays(q.previousTo,1)),q.granularity];

export async function readAnalytics(url,user,db,{now=new Date()}={}){
  const q=analyticsQuery(url.searchParams,now);
  const sql=(query,...values)=>db.prepare(query).bind(...values);
  if(q.work){
    const work=await sql('SELECT id,author_id FROM ft_works WHERE id=?',q.work).first();
    if(!work)throw new ApiError(404,'WORK_NOT_FOUND','作品不存在');
    if(work.author_id!==user.id)throw new ApiError(403,'NOT_OWNER','只能访问自己的作品数据');
    if(q.version&&!await sql('SELECT id FROM ft_work_versions WHERE id=? AND work_id=?',q.version,q.work).first())fail(422,'INVALID_VERSION','版本不属于该作品');
  }
  const bindings=analyticsBindings(q,user.id);
  const result=await db.batch([
    sql(ANALYTICS_SQL,...bindings),sql(FUNNEL_SQL,...bindings),sql(RECEIPTS_SQL,...bindings),
    sql('SELECT id,name,source,current_version_id FROM ft_works WHERE author_id=?'+(q.work?' AND id=?':'')+' ORDER BY created_at DESC,id DESC',user.id,...q.work?[q.work]:[]),
    sql('SELECT v.id,v.version label,(v.id=w.current_version_id) isCurrent FROM ft_work_versions v JOIN ft_works w ON w.id=v.work_id WHERE w.author_id=? AND w.id=? ORDER BY v.ordinal DESC',user.id,q.work),
  ]);
  const aggregate=result[0].results,works=result[3].results,external=works.length>0&&works.every(w=>w.source==='url');
  const summary=metrics(aggregate.find(r=>r.dimension==='period'&&r.group_key==='current'),external,q.version);
  const previous=metrics(aggregate.find(r=>r.dimension==='period'&&r.group_key==='previous'),external,q.version);
  const bucketRows=new Map(aggregate.filter(r=>r.dimension==='series').map(r=>[r.group_key,r]));
  const series=[];for(let date=bucketDate(q.from,q.granularity);date<=q.to;date=addDays(date,q.granularity==='week'?7:1))series.push({date,...metrics(bucketRows.get(date),external,q.version)});
  const byWork=works.map(w=>({workId:w.id,name:w.name,source:w.source,currentVersionId:w.current_version_id,...metrics(aggregate.find(r=>r.dimension==='work'&&r.group_key===w.id),w.source==='url',q.version)}));
  const funnel={...result[1].results[0],supported:works.some(w=>w.source==='html')};
  const coverage={endedStarts:summary.endedStarts,durationSamples:summary.durationSamples,unknownDurationEnds:external?null:summary.endedStarts-summary.durationSamples,
    unendedStarts:external?null:summary.starts-summary.endedStarts,durationCoverage:summary.endedStarts?summary.durationSamples/summary.endedStarts:null,versionSocialMetricsAvailable:!q.version,funnelHostedOnly:true};
  const meta={from:q.from,to:q.to,previousFrom:q.previousFrom,previousTo:q.previousTo,granularity:q.granularity,timezone:'UTC',excludeSelf:q.excludeSelf,scope:q.version?'version':q.work?'work':'all_works',partialToday:q.partialToday};
  const receipts=result[2].results.map(row=>Object.fromEntries(Object.entries(row).filter(([,value])=>value!==null)));
  // Old clients consume daily views/starts. A weekly request belongs to the new
  // UI, so its compatibility byDay follows the requested buckets as well.
  const byDay=series.map(row=>({date:row.date,views:row.pv,starts:row.starts}));
  return {meta,summary,previous,series,byWork,versions:result[4].results.map(v=>({...v,isCurrent:Boolean(v.isCurrent)})),funnel,coverage,
    scope:'work_period',from:midnight(q.from),to:now.toISOString()<midnight(addDays(q.to,1))?now.toISOString():midnight(addDays(q.to,1)),byDay,receipts};
}
