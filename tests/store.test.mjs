import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,initialState,publishDraft,validURL,escapeHTML,STORAGE_KEY} from '../dist/store.js';
const ready=()=>({...initialState(),signedIn:true,profile:{id:'local-creator',name:'测试者',bio:''},draft:{id:'draft-1',title:' 小游戏 ',url:'https://example.com/game',description:' 点击方块 ',cover:''}});
test('publish validates identity and rejects executable links',()=>{
 const s=ready();assert.throws(()=>publishDraft({...s,signedIn:false}));
 assert.throws(()=>publishDraft({...s,draft:{...s.draft,url:'javascript:alert(1)'}}));
 assert.equal(validURL('https://name:password@example.com'),null);
});
test('publish keeps the current draft until commit, then creates one work and a fresh draft',()=>{
 const before=ready();const {state,work}=publishDraft(before);
 assert.equal(before.works.length,0);assert.equal(before.draft.title,' 小游戏 ');
 assert.equal(state.works.length,1);assert.equal(work.title,'小游戏');assert.equal(state.draft.title,'');assert.notEqual(state.draft.id,before.draft.id);
 const replay=publishDraft({...state,draft:before.draft});assert.equal(replay.state.works.length,1);
});
test('failed storage commit does not report or retain a successful in-memory mutation',()=>{
 const s=createStore({getItem:()=>null,setItem:()=>{throw new Error('quota');}});
 assert.throws(()=>s.commit({signedIn:true}));assert.equal(s.get().signedIn,false);
});
test('draft and feedback survive reload without creating another work',()=>{
 const data=new Map();const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
 const a=createStore(storage);a.commit(ready());const b=createStore(storage);
 assert.equal(b.get().draft.id,'draft-1');assert.equal(b.get().works.length,0);
 const result=publishDraft(b.get());b.commit(result.state);const c=createStore(storage);
 assert.equal(c.get().works.length,1);assert.equal(c.get().lastPublished,'draft-1');assert.ok(data.has(STORAGE_KEY));
});
test('corrupt storage recovers and user content is escaped',()=>{
 const s=createStore({getItem:()=>'{invalid',setItem:()=>{}});assert.ok(s.readError);assert.equal(s.get().works.length,0);
 assert.equal(escapeHTML('<img src=x onerror="alert(1)">'),'&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});
