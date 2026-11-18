import test from 'node:test';
import assert from 'node:assert/strict';
import {formatAnalyticsNumber,formatAnalyticsDuration,analyticsChange,validateAnalyticsDates,normalizeAnalyticsQuery,analyticsQuery,sortAnalyticsWorks,analyticsMetricSet} from '../public/analytics.js';

test('unknown duration stays unknown and known zero is not replaced by a missing value',()=>{
  assert.equal(formatAnalyticsDuration(null),'—');
  assert.equal(formatAnalyticsDuration(undefined),'—');
  assert.equal(formatAnalyticsDuration(0),'0 秒');
  assert.equal(formatAnalyticsDuration(250),'不足 1 秒');
  assert.equal(formatAnalyticsDuration(65000),'1 分 5秒');
  assert.equal(formatAnalyticsDuration(3600000),'1 小时');
  assert.equal(formatAnalyticsNumber(null),'—');
  assert.equal(formatAnalyticsNumber(0),'0');
});
test('period comparison does not divide by zero or treat missing samples as a decline',()=>{
  assert.deepEqual(analyticsChange(5,0),{label:'新增',direction:'new'});
  assert.deepEqual(analyticsChange(0,0),{label:'—',direction:'none'});
  assert.deepEqual(analyticsChange(null,5000),{label:'—',direction:'none'});
  assert.deepEqual(analyticsChange(0,5),{label:'↓ 100%',direction:'down'});
  assert.deepEqual(analyticsChange(12,10),{label:'↑ 20%',direction:'up'});
});
test('custom periods use inclusive UTC dates with leap-day and 90-day boundaries',()=>{
  assert.equal(validateAnalyticsDates('2024-01-01','2024-03-30','2024-04-01'),'');
  assert.match(validateAnalyticsDates('2024-01-01','2024-03-31','2024-04-01'),/90/);
  assert.equal(validateAnalyticsDates('2024-02-29','2024-02-29','2024-04-01'),'');
  assert.notEqual(validateAnalyticsDates('2023-02-29','2023-03-01','2024-04-01'),'');
  assert.notEqual(validateAnalyticsDates('2024-04-02','2024-04-02','2024-04-01'),'');
  assert.notEqual(validateAnalyticsDates('1969-12-31','1970-01-01','2024-04-01'),'');
});
test('work drilldown and return preserve date filters and omit orphan version filters',()=>{
  const state=normalizeAnalyticsQuery({from:'2026-11-01',to:'2026-11-07',work:'one',version:'v1',excludeSelf:'1',granularity:'week',metric:'avgActiveMs'});
  assert.deepEqual(analyticsQuery(state),{from:'2026-11-01',to:'2026-11-07',work:'one',version:'v1',excludeSelf:'1',granularity:'week'});
  const all={...state,work:'',version:''};
  assert.deepEqual(analyticsQuery(all),{from:'2026-11-01',to:'2026-11-07',excludeSelf:'1',granularity:'week'});
  assert.equal(normalizeAnalyticsQuery({version:'v1'}).version,'');
  assert.equal(normalizeAnalyticsQuery({metric:'returningPlayers'}).metric,'uv');
  assert.equal(normalizeAnalyticsQuery({days:'1'}).days,1);
});
test('missing duration sorts after known zero in both directions without changing API rows',()=>{
  const rows=[{workId:'missing',avgActiveMs:null},{workId:'long',avgActiveMs:6000},{workId:'zero',avgActiveMs:0}];
  assert.deepEqual(sortAnalyticsWorks(rows,'avgActiveMs').map(row=>row.workId),['long','zero','missing']);
  assert.deepEqual(sortAnalyticsWorks(rows,'avgActiveMs','asc').map(row=>row.workId),['zero','long','missing']);
  assert.equal(rows[0].workId,'missing');
});

test('overview prioritizes visits and separates hosted engagement from external clicks',()=>{
 assert.deepEqual(analyticsMetricSet(true).primary,['uv','pv','outboundClicks','comments']);
 assert.deepEqual(analyticsMetricSet(false,true).primary,['uv','pv','players','outboundClicks']);
 assert(analyticsMetricSet(false).primary.includes('avgActiveMs'));
 for(const key of ['players','avgActiveMs','totalActiveMs','opens','starts','completions'])assert(!analyticsMetricSet(true).trend.includes(key));
 assert.equal(analyticsMetricSet(false,true).sortable.length,5);
});
