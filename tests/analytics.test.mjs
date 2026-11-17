import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {analyticsQuery,readAnalytics} from '../lib/funtrack/analytics-query.mjs';

const NOW=new Date('2026-11-16T12:00:00.000Z'),owner='creator',stamp=(date,time='12:00:00.000')=>date+'T'+time+'Z';
function fixture(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync('drizzle/'+file,'utf8'));
  function insert(table,record){const keys=Object.keys(record);sqlite.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>record[k]));}
  function work(id,source='html',author=owner){insert('ft_works',{id,author_id:author,author_name:author,name:id,description:id,source,current_version_id:id+'-v1',created_at:stamp('2026-10-01'),idempotency_key:randomUUID(),request_hash:'fixture'});version(id,1,source);}
  function version(id,n,source='html'){insert('ft_work_versions',{id:id+'-v'+n,work_id:id,version:'v'+n,ordinal:n,game_key:source==='html'?'game/'+id+n:null,created_at:stamp('2026-10-01')});}
  function event(work,actor,type,date,extra={}){insert('ft_events',{id:randomUUID(),client_event_id:randomUUID(),actor_id:actor,work_id:work,version_id:work?work+'-v1':null,event_type:type,received_at:stamp(date),...extra});}
  function session(work,actor,date,{v=1,start=true,end=false,complete=false,active,elapsedMs=10000,startDate=date,endDate=date,rawResult}={}){
    const id=randomUUID();insert('ft_play_sessions',{id,actor_id:actor,work_id:work,version_id:work+'-v'+v,token_hash:'test-only',created_at:stamp(date,'09:00:00.000'),expires_at:stamp(date,'10:00:00.000')});
    if(start)event(work,actor,'play_start',startDate,{version_id:work+'-v'+v,session_id:id,seq:1,elapsed_ms:0});
    if(complete)event(work,actor,'game_complete',endDate,{version_id:work+'-v'+v,session_id:id,seq:2,elapsed_ms:elapsedMs});
    if(end)event(work,actor,'session_end',endDate,{version_id:work+'-v'+v,session_id:id,seq:3,elapsed_ms:elapsedMs,result_json:rawResult??(active===undefined?null:JSON.stringify({timingVersion:1,activeMs:active}))});return id;
  }
  work('work-a');version('work-a',2);sqlite.prepare('UPDATE ft_works SET current_version_id=? WHERE id=?').run('work-a-v2','work-a');work('work-b');work('work-empty');work('work-link','url');work('work-foreign','html','other-creator');
  insert('ft_cards',{id:'card-one',author_id:owner,snapshot_json:'{}',created_at:stamp('2026-10-01')});
  for(const [w,a,d,v] of [['work-a','alice','2026-11-09',1],['work-a','alice','2026-11-09',1],['work-a','alice','2026-11-10',2],['work-a','bob','2026-11-09',1],['work-a',owner,'2026-11-09',1],['work-a','carol','2026-11-10',2],['work-b','alice','2026-11-09',1],['work-b','dave','2026-11-11',1],['work-link','eve','2026-11-09',1],['work-link','alice','2026-11-10',1]])event(w,a,'work_view',d,{version_id:w+'-v'+v});
  session('work-a','alice','2026-11-09',{end:true,complete:true,active:6000});
  session('work-a','alice','2026-11-10',{v:2,end:true,complete:true,active:2000});
  session('work-a','bob','2026-11-09',{end:true});
  session('work-a',owner,'2026-11-09',{end:true,complete:true,active:1000});
  session('work-a','frank','2026-11-12',{v:2,start:false});
  session('work-a','grace','2026-11-15',{v:2,end:true,complete:true,active:0,endDate:'2026-11-16'});
  session('work-b','alice','2026-11-09',{end:true});session('work-b','carol','2026-11-10');session('work-b','dave','2026-11-11',{start:false,end:true});
  for(const actor of ['alice',owner]){insert('ft_comments',{id:randomUUID(),work_id:'work-a',author_id:actor,author_name:actor,body:'comment',created_at:stamp('2026-11-09'),idempotency_key:randomUUID(),request_hash:'fixture'});insert('ft_work_likes',{work_id:'work-a',actor_id:actor,created_at:stamp('2026-11-09')});event(null,actor,'card_view','2026-11-09',{card_id:'card-one'});event('work-link',actor,'outbound_click','2026-11-09');}
  insert('ft_comments',{id:randomUUID(),work_id:'work-b',author_id:'alice',author_name:'Alice',body:'reply',created_at:stamp('2026-11-10'),idempotency_key:randomUUID(),request_hash:'fixture'});insert('ft_work_likes',{work_id:'work-b',actor_id:'alice',created_at:stamp('2026-11-10')});
  for(const [actor,v] of [['bob',1],[owner,2]])insert('ft_feedback',{id:randomUUID(),client_event_id:randomUUID(),work_id:'work-a',version_id:'work-a-v'+v,author_id:actor,author_name:actor,text:'feedback',type:'建议',created_at:stamp('2026-11-10')});
  event('work-a','alice','work_view','2026-11-02');session('work-a','alice','2026-11-02',{end:true,complete:true,active:4000});
  event('work-b','bob','work_view','2026-11-08');session('work-b','bob','2026-11-08',{end:true,active:3000,endDate:'2026-11-09'});
  event('work-foreign','intruder','work_view','2026-11-09');session('work-foreign','intruder','2026-11-09',{end:true,active:50000,elapsedMs:50000});
  const db={prepare(query){return {query,args:[],bind(...args){this.args=args;return this;},async first(){return sqlite.prepare(query).get(...this.args)||null;}};},async batch(statements){return statements.map(s=>({results:sqlite.prepare(s.query).all(...s.args)}));}};
  const query=async(extra={})=>readAnalytics(new URL('https://site.test/api/analytics?'+new URLSearchParams({from:'2026-11-09',to:'2026-11-15',...extra})),{id:owner},db,{now:NOW});
  return {sqlite,query,session,event};
}

test('UTC ranges are exact, previous period equal-length, compatible days and invalid filters bounded',()=>{
  const q=analyticsQuery(new URLSearchParams({from:'2026-11-09',to:'2026-11-15'}),NOW);assert.equal(q.previousFrom,'2026-11-02');assert.equal(q.previousTo,'2026-11-08');assert.equal(q.partialToday,false);
  assert.equal(analyticsQuery(new URLSearchParams({days:'1'}),NOW).from,'2026-11-16');assert.equal(analyticsQuery(new URLSearchParams(),NOW).partialToday,true);
  for(const params of [{from:'2026-02-30',to:'2026-03-01'},{from:'2026-11-09',to:'2026-11-17'},{from:'2026-01-01',to:'2026-11-01'},{from:'0000-01-01',to:'0000-01-02'},{from:'2026-11-09'},{from:'2026-11-09',to:'2026-11-15',days:'7'},{days:'91'},{days:'1.5'},{version:'work-a-v1'},{granularity:'hour'},{excludeSelf:'yes'}])assert.throws(()=>analyticsQuery(new URLSearchParams(params),NOW));
});
test('SQL deduplicates UV across works and aggregates session-created cohorts with genuine zero duration',async()=>{
  const f=fixture(),r=await f.query();assert.equal(r.summary.pv,10);assert.equal(r.summary.uv,6);assert.equal(r.summary.opens,9);assert.equal(r.summary.players,5);assert.equal(r.summary.starts,7);assert.equal(r.summary.completions,4);assert.equal(r.summary.totalActiveMs,9000);assert.equal(r.summary.durationSamples,4);assert.equal(r.summary.avgActiveMs,2250);assert.equal(r.summary.endedStarts,6);assert.equal(r.summary.ends,7);assert.equal(r.summary.returningPlayers,1);
  assert.deepEqual(r.coverage,{endedStarts:6,durationSamples:4,unknownDurationEnds:2,unendedStarts:1,durationCoverage:4/6,versionSocialMetricsAvailable:true,funnelHostedOnly:true});
  assert.equal(r.byWork.length,4);assert(!r.byWork.some(w=>w.workId==='work-foreign'));assert.equal(r.byWork.find(w=>w.workId==='work-empty').pv,0);f.sqlite.close();
});
test('funnel matches visitor/session actors on the same hosted work and never counts external-only visitors',async()=>{
  const f=fixture(),r=await f.query();assert.deepEqual(r.funnel,{visitors:5,opened:4,started:3,supported:true});assert(r.funnel.started<=r.funnel.opened&&r.funnel.opened<=r.funnel.visitors);
  const external=await f.query({work:'work-link'});assert.deepEqual(external.funnel,{visitors:0,opened:0,started:0,supported:false});assert.equal(external.summary.uv,2);assert.equal(external.summary.opens,null);assert.equal(external.summary.totalActiveMs,null);f.sqlite.close();
});
test('excludeSelf reaches views, sessions, duration, social, private feedback, cards and funnel',async()=>{
  const f=fixture(),r=await f.query({excludeSelf:'1'});assert.equal(r.summary.pv,9);assert.equal(r.summary.uv,5);assert.equal(r.summary.opens,8);assert.equal(r.summary.players,4);assert.equal(r.summary.starts,6);assert.equal(r.summary.completions,3);assert.equal(r.summary.durationSamples,3);assert.equal(r.summary.totalActiveMs,8000);assert.equal(r.summary.comments,2);assert.equal(r.summary.likes,2);assert.equal(r.summary.feedback,1);assert.equal(r.summary.cardViews,1);assert.equal(r.summary.outboundClicks,1);assert.deepEqual(r.funnel,{visitors:4,opened:3,started:2,supported:true});f.sqlite.close();
});
test('previous period and weekly aggregates use distinct users instead of summed daily UV',async()=>{
  const f=fixture(),daily=await f.query(),weekly=await f.query({granularity:'week'});assert.equal(daily.series.length,7);assert.equal(daily.series.reduce((n,d)=>n+d.uv,0),7);assert.equal(weekly.series.length,1);assert.equal(weekly.series[0].date,'2026-11-09');assert.equal(weekly.series[0].uv,6);assert.equal(weekly.series[0].returningPlayers,1);assert.equal(daily.series[6].durationSamples,1);assert.equal(daily.series[6].totalActiveMs,0);
  assert.equal(daily.previous.pv,2);assert.equal(daily.previous.uv,2);assert.equal(daily.previous.durationSamples,2);assert.equal(daily.previous.totalActiveMs,7000);assert.equal(daily.previous.avgActiveMs,3500);assert.equal(daily.previous.completions,1);f.sqlite.close();
});
test('version filter retains actual provenance and makes unassignable social counts unknown',async()=>{
  const f=fixture(),r=await f.query({work:'work-a',version:'work-a-v2'});assert.equal(r.summary.pv,2);assert.equal(r.summary.starts,2);assert.equal(r.summary.opens,3);assert.equal(r.summary.durationSamples,2);assert.equal(r.summary.totalActiveMs,2000);assert.equal(r.summary.avgActiveMs,1000);assert.equal(r.summary.comments,null);assert.equal(r.summary.likes,null);assert.equal(r.summary.feedback,1);assert.equal(r.byWork.length,1);assert.deepEqual(r.versions,[{id:'work-a-v2',label:'v2',isCurrent:true},{id:'work-a-v1',label:'v1',isCurrent:false}]);assert(r.receipts.every(e=>e.versionId==='work-a-v2'));f.sqlite.close();
});
test('legacy elapsed time and incomplete sessions are never converted to foreground duration',async()=>{
  const f=fixture(),r=await f.query({work:'work-b'});assert.equal(r.summary.starts,2);assert.equal(r.summary.endedStarts,1);assert.equal(r.summary.durationSamples,0);assert.equal(r.summary.totalActiveMs,null);assert.equal(r.summary.avgActiveMs,null);assert.equal(r.coverage.unknownDurationEnds,1);assert.equal(r.coverage.unendedStarts,1);
  const empty=await f.query({work:'work-empty'});assert.equal(empty.summary.pv,0);assert.equal(empty.summary.starts,0);assert.equal(empty.summary.totalActiveMs,null);assert.equal(empty.coverage.durationCoverage,null);assert(empty.series.every(d=>d.avgActiveMs===null&&d.pv===0));f.sqlite.close();
});
test('malformed or implausible duration payloads do not become samples',async()=>{
  const f=fixture();for(const [i,raw] of ['not-json','{"activeMs":50}','{"timingVersion":1,"activeMs":-1}','{"timingVersion":1,"activeMs":1.5}','{"timingVersion":1,"activeMs":10001}','{"timingVersion":1,"activeMs":0}'].entries())f.session('work-empty','actor-'+i,'2026-11-10',{end:true,rawResult:raw});
  const r=await f.query({work:'work-empty'});assert.equal(r.summary.endedStarts,6);assert.equal(r.summary.durationSamples,1);assert.equal(r.summary.totalActiveMs,0);assert.equal(r.summary.avgActiveMs,0);f.sqlite.close();
});
test('foreign work and cross-work version cannot access analytics; an empty owner receives bounded zeros',async()=>{
  const f=fixture();await assert.rejects(()=>f.query({work:'work-foreign'}),e=>e.status===403);await assert.rejects(()=>f.query({work:'missing-work'}),e=>e.status===404);await assert.rejects(()=>f.query({work:'work-a',version:'work-b-v1'}),e=>e.status===422);
  const db={prepare(query){return {query,args:[],bind(...args){this.args=args;return this;},async first(){return f.sqlite.prepare(query).get(...this.args)||null;}};},async batch(statements){return statements.map(s=>({results:f.sqlite.prepare(s.query).all(...s.args)}));}};
  const empty=await readAnalytics(new URL('https://site.test/api/analytics?days=7'),{id:'new-owner'},db,{now:NOW});assert.equal(empty.summary.pv,0);assert.equal(empty.summary.avgActiveMs,null);assert.equal(empty.byWork.length,0);assert.equal(empty.series.length,7);assert.equal(empty.receipts.length,0);f.sqlite.close();
});

test('Feed exposure analytics use daily dedup facts and period-distinct viewers with owner and version boundaries',async()=>{
  const f=fixture();
  try{
    const insert=f.sqlite.prepare('INSERT INTO ft_feed_impressions(id,client_event_id,actor_id,work_id,sort,exposure_day,received_at) VALUES(?,?,?,?,?,?,?)');
    for(const [work,actor,date] of [
      ['work-a','alice','2026-11-09'],['work-a','alice','2026-11-10'],['work-b','alice','2026-11-09'],
      ['work-a','bob','2026-11-11'],['work-a',owner,'2026-11-11'],['work-link','eve','2026-11-12'],
      ['work-a','alice','2026-11-02'],['work-foreign','intruder','2026-11-09'],
    ])insert.run(randomUUID(),randomUUID(),actor,work,'recommended',date,stamp(date));
    const all=await f.query();
    assert.equal(all.summary.feedImpressions,6);assert.equal(all.summary.feedViewers,4);
    assert.equal(all.previous.feedImpressions,1);assert.equal(all.previous.feedViewers,1);
    assert.equal(all.series.find(row=>row.date==='2026-11-09').feedImpressions,2);
    assert.equal(all.series.find(row=>row.date==='2026-11-09').feedViewers,1);
    assert.equal(all.byWork.find(row=>row.workId==='work-a').feedViewers,3);
    assert.equal(all.byWork.find(row=>row.workId==='work-empty').feedImpressions,0);
    const outside=await f.query({excludeSelf:'1',granularity:'week'});
    assert.equal(outside.summary.feedImpressions,5);assert.equal(outside.summary.feedViewers,3);
    assert.equal(outside.series[0].feedViewers,3);
    const external=await f.query({work:'work-link'});assert.equal(external.summary.feedViewers,1);assert.equal(external.summary.players,null);
    const version=await f.query({work:'work-a',version:'work-a-v1'});
    assert.equal(version.summary.feedImpressions,null);assert.equal(version.summary.feedViewers,null);
    assert(version.series.every(row=>row.feedViewers===null));
    await assert.rejects(f.query({work:'work-foreign'}),error=>error.code==='NOT_OWNER');
  }finally{f.sqlite.close();}
});
