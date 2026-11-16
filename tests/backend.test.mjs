import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { ApiError, authenticate, verifyWrite, safeURL, coverType, htmlSource, cleanResult, sessionEvents, gameDocument, GAME_CSP, likedState, cardDetails, cardSnapshot } from '../lib/funtrack/rules.mjs';

const rejects=(fn,status)=>assert.throws(fn,error=>error instanceof ApiError&&error.status===status);
test('identity comes only from supplied platform headers, with a safe public display name',()=>{
  rejects(()=>authenticate(new Headers()),401);
  const headers=new Headers({'oai-authenticated-user-id':'owner-id','oai-authenticated-user-email':'owner@example.test','oai-authenticated-user-full-name':'%E5%88%9B%E4%BD%9C%E8%80%85','oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8'});
  assert.equal(authenticate(headers).name,'创作者');
  headers.delete('oai-authenticated-user-full-name');assert.equal(authenticate(headers).name,'owner');
});
test('writes require exact site origin and custom CSRF header',()=>{
  const req=(origin,csrf='1')=>new Request('https://funtrack.example/api/events',{method:'POST',headers:{Origin:origin,'X-Funtrack-CSRF':csrf}});
  verifyWrite(req('https://funtrack.example'));
  for(const origin of ['null','https://evil.example','https://funtrack.example.evil.example','http://funtrack.example'])rejects(()=>verifyWrite(req(origin)),403);
  rejects(()=>verifyWrite(req('https://funtrack.example','')),403);
});
test('external URLs reject script/data protocols and embedded credentials',()=>{
  assert.equal(safeURL('https://example.com/play'),'https://example.com/play');
  for(const value of ['javascript:alert(1)','data:text/html,hi','https://secret@example.com/','file:///tmp/game'])rejects(()=>safeURL(value),422);
});
test('like intent is an explicit boolean and never coerced into a toggle',()=>{
  assert.equal(likedState(true),true);assert.equal(likedState(false),false);
  for(const value of [undefined,null,0,1,'true','false',{},[]])rejects(()=>likedState(value),422);
});
test('author card details validate lengths, external URL and the three supplied styles',()=>{
  assert.deepEqual(cardDetails({}),{signature:'',headline:'',website:'',backStyle:'ink'});
  assert.deepEqual(cardDetails({signature:'  Seedy ',headline:'Small games',website:'https://example.com',backStyle:'cobalt'}),{signature:'Seedy',headline:'Small games',website:'https://example.com/',backStyle:'cobalt'});
  for(const backStyle of ['ink','ivory','cobalt'])assert.equal(cardDetails({backStyle}).backStyle,backStyle);
  for(const input of [{signature:'x'.repeat(81)},{headline:'x'.repeat(121)},{website:'javascript:alert(1)'},{website:'https://password@example.com'},{backStyle:'custom'},{signature:null}])rejects(()=>cardDetails(input),422);
});
test('legacy card defaults are read-only and never adopt newer profile details',()=>{
  const old=Object.freeze({id:'old-card',name:'Old creator',bio:'Original',works:Object.freeze([])});
  const displayed=cardSnapshot(old);
  assert.equal(displayed.signature,'');assert.equal(displayed.headline,'');assert.equal(displayed.website,'');assert.equal(displayed.backStyle,'ink');
  assert.equal(old.backStyle,undefined);assert.equal(old.signature,undefined);assert.equal(displayed.name,'Old creator');
  const supplied={...old,signature:'Original signature',headline:'Original headline',website:'https://example.com/',backStyle:'ivory'};
  assert.deepEqual(cardSnapshot(supplied),supplied);
});
test('cover magic and HTML type, encoding and size are checked',()=>{
  assert.equal(coverType(new Uint8Array([137,80,78,71,13,10,26,10]),'image/png'),'image/png');
  rejects(()=>coverType(new Uint8Array([137,80,78,71,13,10,26,10]),'image/jpeg'),415);
  rejects(()=>coverType(new TextEncoder().encode('<svg/>'),'image/png'),415);
  assert.equal(htmlSource(new TextEncoder().encode('<!doctype html><html></html>'),'text/html','game.html'),'<!doctype html><html></html>');
  rejects(()=>htmlSource(new Uint8Array([255]),'text/html','game.html'),422);
  rejects(()=>htmlSource(new Uint8Array(1048577),'text/html','game.html'),413);
  rejects(()=>htmlSource(new TextEncoder().encode('<html/>'),'text/plain','game.html'),415);
});
test('event payload is bounded, normalized and whitelist only',()=>{
  assert.deepEqual(sessionEvents([{id:'end-event',type:'session_end',seq:2},{id:'start-event',type:'play_start',seq:1}]).map(e=>e.type),['play_start','session_end']);
  rejects(()=>sessionEvents([{id:'start-event',type:'play_start',seq:1},{id:'end-event',type:'session_end',seq:1}]),422);
  rejects(()=>sessionEvents([{id:'key-event',type:'keydown',seq:1}]),422);
  rejects(()=>sessionEvents([{id:'end-event',type:'session_end',seq:2,elapsedMs:3600001}]),422);
  rejects(()=>cleanResult({score:Infinity}),422);
  rejects(()=>cleanResult({label:'x'.repeat(121)}),422);
  assert.deepEqual(cleanResult({score:10,label:'完成',rawKeys:'not stored'}),{score:10,label:'完成'});
});
test('sandbox bridge reports first trusted input and bounded completion without telemetry secrets',()=>{
  const messages=[],listeners=new Map();
  const doc=gameDocument('<html><body>game</body></html>','https://funtrack.example');
  const sdk=doc.match(/<script>([\s\S]*?)<\/script>/)[1];
  const context={location:{hash:'#bridge=random-bridge'},URLSearchParams,parent:{postMessage:(...args)=>messages.push(args)},window:{},document:{readyState:'complete',addEventListener:(type,handler)=>listeners.set(type,handler)}};
  vm.runInNewContext(sdk,context);
  assert.equal(messages[0][0].type,'ready');assert.equal(messages[0][1],'https://funtrack.example');
  listeners.get('keydown')({isTrusted:false,key:'secret'});assert.equal(messages.length,1);
  listeners.get('pointerdown')({isTrusted:true,x:4});listeners.get('keydown')({isTrusted:true,key:'secret'});
  assert.equal(messages.length,2);assert.equal(messages[1][0].type,'input');assert.deepEqual(Object.keys(messages[1][0]).sort(),['bridge','channel','type','version']);
  context.window.funtrack.complete({score:3,label:'ok'});context.window.funtrack.complete({score:7});assert.equal(messages.length,3);assert.equal(messages[2][0].result.score,3);
  assert.match(GAME_CSP,/sandbox allow-scripts;/);assert(!GAME_CSP.includes('allow-same-origin'));assert.match(GAME_CSP,/connect-src 'none'/);
  assert(!doc.includes('oai-authenticated'));assert(!doc.includes('token'));
});
