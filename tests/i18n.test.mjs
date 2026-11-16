import test from 'node:test';
import assert from 'node:assert/strict';
import {createI18n,LOCALE_STORAGE_KEY,LOCALE_CHANGE_EVENT,setLocale} from '../public/i18n.js';
import {formatAnalyticsDuration,formatAnalyticsNumber,analyticsChange,analyticsErrorMessage,validateAnalyticsDates} from '../public/analytics.js';

function environment(saved) {
  const values = new Map(saved === undefined ? [] : [[LOCALE_STORAGE_KEY,saved]]), events = new EventTarget(), received = [];
  events.addEventListener(LOCALE_CHANGE_EVENT,event=>received.push(event.detail.locale));
  const storage = {getItem:key=>values.get(key) ?? null,setItem:(key,value)=>values.set(key,value)};
  return {i18n:createI18n({storage:()=>storage,events:()=>events}),values,received};
}

test('Chinese defaults; a supported saved locale is restored and invalid settings are ignored',()=>{
  assert.equal(environment().i18n.getLocale(),'zh-CN');
  assert.equal(environment('en').i18n.getLocale(),'en');
  assert.equal(environment('zh-CN').i18n.getLocale(),'zh-CN');
  assert.equal(environment('fr').i18n.getLocale(),'zh-CN');
});
test('language changes persist and notify exactly once while unsupported locales preserve the selection',()=>{
  const {i18n,values,received}=environment();
  assert.equal(i18n.setLocale('en'),'en');
  assert.equal(values.get(LOCALE_STORAGE_KEY),'en');
  i18n.setLocale('en'); i18n.setLocale('en-US');
  assert.deepEqual(received,['en']);
  assert.equal(i18n.getLocale(),'en');
  i18n.setLocale('zh-CN');
  assert.deepEqual(received,['en','zh-CN']);
  assert.equal(environment(values.get(LOCALE_STORAGE_KEY)).i18n.getLocale(),'zh-CN');
});
test('denied browser storage still permits changing language in memory',()=>{
  const storage={getItem(){throw new Error('denied');},setItem(){throw new Error('denied');}};
  const i18n=createI18n({storage:()=>storage,events:()=>undefined});
  assert.equal(i18n.getLocale(),'zh-CN');
  assert.doesNotThrow(()=>i18n.setLocale('en'));
  assert.equal(i18n.getLocale(),'en');
  const inaccessible=createI18n({storage(){throw new Error('unavailable');},events:()=>undefined});
  assert.equal(inaccessible.setLocale('en'),'en');
});
test('modules merge translations, unknown strings retain their original text, and switching back restores Chinese',()=>{
  const {i18n}=environment();
  i18n.registerMessages({'作品':'Works'});
  i18n.registerMessages({'数据':'Analytics'});
  assert.equal(i18n.t('作品'),'作品');
  i18n.setLocale('en');
  assert.equal(i18n.t('作品'),'Works');
  assert.equal(i18n.t('数据'),'Analytics');
  assert.equal(i18n.t('还没翻译的文案'),'还没翻译的文案');
  assert.equal(i18n.t('constructor'),'constructor');
  i18n.setLocale('zh-CN');
  assert.equal(i18n.t('数据'),'数据');
});
test('interpolation preserves user text literally, only uses own values, and never recursively translates content',()=>{
  const {i18n}=environment('en');
  i18n.registerMessages({'作品':'Works','查看 {name}，共 {count} 件':'View {name}, {count} works'});
  assert.equal(i18n.t('查看 {name}，共 {count} 件',{name:'作品 {count}',count:2}),'View 作品 {count}, 2 works');
  assert.equal(i18n.t('查看 {name}，共 {count} 件',Object.assign(Object.create({name:'inherited'}),{count:0})),'View {name}, 0 works');
  assert.equal(i18n.t('{name}',{name:'<img onerror=alert(1)>'}),'<img onerror=alert(1)>'); // Renderer owns escaping, never core translation.
});
test('locale formatting uses the selected language and keeps date-only analytics values on their UTC day',()=>{
  const {i18n}=environment('en');
  assert.equal(i18n.localeNumber(12345.6,{maximumFractionDigits:1}),'12,345.6');
  assert.equal(i18n.localeNumber(null),'—');
  assert.equal(i18n.localeNumber(NaN),'—');
  assert.equal(i18n.localeDate('2026-01-01',{month:'short',day:'numeric'}),'Jan 1');
  assert.equal(i18n.localeDate('2026-01-01T00:00:00Z',{month:'short',day:'numeric',timeZone:'America/Los_Angeles'}),'Dec 31');
  assert.equal(i18n.localeDate('not a date'),'—');
  assert.equal(i18n.localeDate(null),'—');
  i18n.setLocale('zh-CN');
  assert.equal(i18n.localeDate('2026-01-01',{month:'short',day:'numeric'}),'1月1日');
});
test('analytics switches duration, comparison and errors without changing unknown or zero data semantics',()=>{
  try {
    setLocale('en');
    assert.equal(formatAnalyticsDuration(null),'—');
    assert.equal(formatAnalyticsDuration(0),'0 s');
    assert.equal(formatAnalyticsDuration(250),'Under 1 s');
    assert.equal(formatAnalyticsDuration(65000),'1 min 5s');
    assert.equal(formatAnalyticsDuration(3600000),'1 h');
    assert.equal(formatAnalyticsNumber(12345),'12,345');
    assert.deepEqual(analyticsChange(5,0),{label:'New',direction:'new'});
    assert.deepEqual(analyticsChange(5,5),{label:'No change',direction:'flat'});
    assert.equal(analyticsErrorMessage({code:'NOT_OWNER'}),'You can only access your own works.');
    assert.equal(analyticsErrorMessage({status:401}),'Please sign in again.');
    assert.equal(analyticsErrorMessage({code:'INCOMPLETE_ANALYTICS'}),'The analytics response is incomplete. Please retry.');
    assert.equal(analyticsErrorMessage({message:'user content or an unknown server error'}),'Please try again shortly.');
    assert.equal(validateAnalyticsDates('2026-11-17','2026-11-17','2026-11-16'),'The end date cannot be later than today (UTC).');
  } finally { setLocale('zh-CN'); }
  assert.equal(formatAnalyticsDuration(65000),'1 分 5秒');
});
