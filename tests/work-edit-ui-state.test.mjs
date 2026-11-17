import test from 'node:test';
import assert from 'node:assert/strict';
import {newWorkEditDraft,editWorkDraft,rebaseWorkEditDraft,workEditChanged,coverFileError,workEditReturnPath} from '../public/work-edit-state.js';

const work={id:'work',revision:2,name:'雨',desc:'窗边的游戏',coverUrl:'/media/original'};
test('unchanged text cannot enable save or rotate an already attempted request key',()=>{
  const draft=newWorkEditDraft(work,'same-key');draft.attempted=true;
  assert.equal(workEditChanged(draft),false);
  assert.strictEqual(editWorkDraft(draft,{name:'雨'},'unused'),draft);
  assert.equal(editWorkDraft(draft,{name:'雨'},'unused').key,'same-key');
  assert.equal(workEditChanged({...draft,name:' 雨 ',desc:'窗边的游戏\n'}),false);
});
test('draft retry persists original revision until explicit refresh; edited and untouched fields merge separately',()=>{
  let draft=editWorkDraft(newWorkEditDraft(work,'first'),{name:'隔窗有雨',replaceCover:true},'edited');draft.attempted=true;
  draft=JSON.parse(JSON.stringify(draft));assert.equal(draft.key,'edited');assert.equal(draft.expectedRevision,2);
  const later={...work,revision:5,name:'另一处改名',desc:'其他设备的新介绍',coverUrl:'/media/later'};
  const refreshed=rebaseWorkEditDraft(draft,later,'explicit-refresh');
  assert.equal(refreshed.name,'隔窗有雨');assert.equal(refreshed.desc,later.desc);
  assert.equal(refreshed.replaceCover,true);assert.equal(refreshed.base.coverUrl,later.coverUrl);
  assert.equal(refreshed.expectedRevision,5);assert.equal(refreshed.key,'explicit-refresh');assert.equal(refreshed.attempted,false);
  assert.equal(draft.expectedRevision,2);assert.equal(draft.base.coverUrl,'/media/original');
});
test('cover replacement and reverting to the original cover have explicit no-op behavior',()=>{
  const initial=newWorkEditDraft(work,'one');
  const replacement=editWorkDraft(initial,{replaceCover:true},'two');assert.equal(workEditChanged(replacement),true);
  assert.equal(workEditChanged(editWorkDraft(replacement,{replaceCover:false},'three')),false);
});
test('cover validation accepts 2 MiB exactly and rejects excessive, empty or unsupported files',()=>{
  assert.equal(coverFileError({type:'image/jpeg',size:2097152}),'');
  assert.match(coverFileError({type:'image/png',size:2097153}),/2 MiB/);
  assert.match(coverFileError({type:'image/svg+xml',size:100}),/PNG/);
  assert.match(coverFileError({type:'image/webp',size:0}),/为空/);
});
test('return navigation only accepts the same canonical work or the creator list',()=>{
  assert.equal(workEditReturnPath('/work/work','work'),'/work/work');
  for(const path of ['https://example.com','//example.com','/work/other','/card/old','/work/work?card=old'])assert.equal(workEditReturnPath(path,'work'),'/studio/works');
});

test('editing from a filtered work detail preserves return context without autoplay',()=>{
  const path='/work/work?from=%2Ffeed%3Fq%3Drain&discussion=1';
  assert.equal(workEditReturnPath(path,'work'),path);
  assert.equal(workEditReturnPath(path+'&play=1','work'),path);
});
