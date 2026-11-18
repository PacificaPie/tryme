import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationState} from '../public/notification-state.js';
import {notificationHref,notificationTitle} from '../public/notifications.js';
import {setLocale} from '../public/i18n.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const row=(id=1)=>({id,kind:'work_like',actor:{id:'reader',name:'林夏',available:true},actorCount:3,unread:true,available:true,workId:'work-1'});
const data=(items=[row()],extra={})=>({recipientId:'owner',snapshot:items.at(-1)?.id||0,hasUnread:items.some(item=>item.unread),items,nextCursor:null,...extra});

test('opening and filtering are reads; marking persists only after confirmed success',async()=>{
  const calls=[],response=deferred();let writes=0;
  const model=createNotificationState({owner:'owner',api:(path,options)=>{calls.push({path,options});if(options.method==='POST'){writes++;return response.promise;}return Promise.resolve(data());}});
  await model.load();assert.equal(writes,0);assert.equal(model.state.items[0].unread,true);
  const marking=model.mark();assert.equal(model.state.hasUnread,true);assert.equal(model.state.items[0].unread,true);
  response.resolve(data([],{snapshot:1,hasUnread:false}));assert.equal(await marking,true);
  assert.equal(model.state.hasUnread,false);assert.equal(model.state.items[0].unread,false);
  assert.deepEqual(calls.at(-1).options.body,{expectedRecipientId:'owner',through:1});model.dispose();
});

test('failed read writes retain unread state and can retry idempotently',async()=>{
  let fail=true;
  const model=createNotificationState({owner:'owner',api:async(path,options)=>{if(options.method==='POST'){if(fail)throw Error('offline');return data([],{snapshot:1,hasUnread:false});}return data();}});
  await model.load();assert.equal(await model.mark(1),false);assert(model.state.hasUnread);assert(model.state.items[0].unread);assert.equal(model.state.error,'offline');
  fail=false;assert.equal(await model.mark(1),true);assert.equal(model.state.error,'');model.dispose();
});

test('a late list from the previous filter cannot overwrite the selected filter',async()=>{
  const slow=deferred();let calls=0;
  const model=createNotificationState({owner:'owner',api:()=>++calls===1?slow.promise:Promise.resolve(data([{...row(2),kind:'follow'}]))});
  const old=model.load({filter:'like'});await model.load({filter:'follow'});
  slow.resolve(data());await old;
  assert.equal(model.state.filter,'follow');assert.equal(model.state.items[0].kind,'follow');model.dispose();
});

test('late summary/list responses cannot undo a successful mark-read or consume a new-arrival red dot',async()=>{
  const slowList=deferred(),slowSummary=deferred();let lists=0;
  const model=createNotificationState({owner:'owner',api:async(path,options)=>{
    if(options.method==='POST')return data([],{snapshot:2,hasUnread:true});
    if(path.includes('/summary'))return slowSummary.promise;
    return ++lists===1?data():slowList.promise;
  }});
  await model.load();const oldList=model.load(),oldSummary=model.refreshSummary(true);
  await model.mark();assert(model.state.hasUnread);assert.equal(model.state.items[0].unread,false);
  slowList.resolve(data());slowSummary.resolve(data([],{snapshot:0,hasUnread:false}));await Promise.all([oldList,oldSummary]);
  assert(model.state.hasUnread);assert.equal(model.state.items[0].unread,false);model.dispose();
});

test('account switch or disposal isolates late responses and aborts pending transport',async()=>{
  const slow=deferred();let changes=0,signal;
  const model=createNotificationState({owner:'owner',api:(path,options)=>{signal=options.signal;return slow.promise;},onChange:()=>changes++});
  const loading=model.load();const count=changes;model.dispose();assert(signal.aborted);
  slow.resolve(data());await loading;assert.equal(changes,count);assert.deepEqual(model.state.items,[]);
  let invalidated=0;
  const stale=createNotificationState({owner:'owner',api:async()=>({...data(),recipientId:'other'}),onSessionChanged:()=>invalidated++});
  await stale.load();assert.equal(invalidated,1);assert.deepEqual(stale.state.items,[]);assert.equal(stale.state.hasUnread,false);
});

test('timeout is bounded, distinguishable from empty state and recoverable',async()=>{
  let recover=false;
  const model=createNotificationState({owner:'owner',timeoutMs:10,api:()=>recover?Promise.resolve(data([])):new Promise(()=>{})});
  await model.load();assert.match(model.state.error,/超时/);assert.equal(model.state.loaded,false);assert.equal(model.state.loading,false);
  recover=true;await model.load();assert.equal(model.state.loaded,true);assert.equal(model.state.error,'');assert.deepEqual(model.state.items,[]);model.dispose();
});

test('failed summary refresh keeps an existing unread badge and never invents an empty inbox',async()=>{
  let fail=false;
  const model=createNotificationState({owner:'owner',api:async()=>{if(fail)throw Error('offline');return data();}});
  await model.load();fail=true;await model.refreshSummary(true);
  assert.equal(model.state.summaryError,true);assert.equal(model.state.hasUnread,true);assert.equal(model.state.items.length,1);model.dispose();
});

test('older summary cannot erase a newer list badge or report a stale refresh failure',async()=>{
  for(const fail of [false,true]){
    const slow=deferred();
    const model=createNotificationState({owner:'owner',api:async path=>path.includes('/summary')?slow.promise:data([row(2)])});
    const old=model.refreshSummary(true);await model.load();
    if(fail)slow.reject(Error('offline'));else slow.resolve(data([],{snapshot:1,hasUnread:false}));
    await old;assert.equal(model.state.hasUnread,true);assert.equal(model.state.summaryError,false);assert.equal(model.state.items[0].unread,true);model.dispose();
  }
});

test('older list cannot replace a newer summary, including read changes without a new event sequence',async()=>{
  for(const hasUnread of [false,true]){
    const slow=deferred();
    const model=createNotificationState({owner:'owner',api:async path=>path.includes('/summary')?data([],{snapshot:2,hasUnread}):slow.promise});
    const old=model.load();await model.refreshSummary(true);
    slow.resolve(data([{...row(2),unread:!hasUnread}],{snapshot:2,hasUnread:!hasUnread}));await old;
    assert.equal(model.state.hasUnread,hasUnread);assert.equal(model.state.loaded,true);model.dispose();
  }
});

test('group member pagination is bounded by the API, deduplicated, and reset on refresh',async()=>{
  let members=0;
  const model=createNotificationState({owner:'owner',api:async path=>path.includes('/actors')?{recipientId:'owner',id:1,actors:++members===1?[{id:'a'},{id:'b'}]:[{id:'b'},{id:'c'}],nextCursor:members===1?'2':null}:data()});
  await model.load();await model.loadMembers(1);await model.loadMembers(1,true);
  assert.deepEqual(model.state.members.get(1).actors.map(a=>a.id),['a','b','c']);
  assert(model.state.items[0].unread,'Inspecting group actors does not implicitly mark the row read');
  await model.load();assert.equal(model.state.members.size,0);model.dispose();
});

test('deep links target the actual work/comment or person, never a card; unavailable targets have no link',()=>{
  const item={...row(),commentId:'comment / 1',kind:'reply'};
  const href=notificationHref(item,'/notifications?filter=comment');
  const params=new URLSearchParams(href.split('?')[1]);assert.equal(params.get('comment'),'comment / 1');assert.equal(params.get('from'),'/notifications?filter=comment');
  assert.equal(notificationHref({...item,available:false}),'');
  assert.equal(notificationHref({...row(),kind:'follow'}),'#/author/reader');
  setLocale('zh-CN');assert.equal(notificationTitle(row()),'林夏等 3 人赞了你的作品');
  setLocale('en');assert.equal(notificationTitle(row()),'林夏 and 2 others liked your work');setLocale('zh-CN');
});
