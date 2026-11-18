import test from 'node:test';
import assert from 'node:assert/strict';
import { safePreviewURL, previewMarkup, previewButton, automaticPreviewAllowed, previewStatusView, mountAutoPreview } from '../public/video-preview.js';
import { createAutoCoverController } from '../public/auto-cover.js';

test('Feed preview markup is inert until interaction and allows only same-origin preview endpoints',()=>{
  const url='/api/public/works/abcdefgh/preview/ijklmnop';
  assert.equal(safePreviewURL(url),url);
  for(const bad of ['https://example.com/clip.mp4','//example.com/clip.mp4','javascript:alert(1)','/game/version','/api/public/works/abcdefgh/preview/ijklmnop?token=secret',url+'\" onerror=evil']){
    assert.equal(safePreviewURL(bad),'');assert.equal(previewMarkup({url:bad}),'');assert.equal(previewButton({url:bad}),'');
  }
  const markup=previewMarkup({url});assert.match(markup,/muted playsinline preload="none"/);assert.doesNotMatch(markup,/\ssrc=|autoplay|loop/);assert.match(markup,/data-preview-src=/);
});
test('automatic playback honors touch, reduced motion and data-saving preferences',()=>{
  assert.equal(automaticPreviewAllowed({hover:true}),true);
  for(const options of [{},{hover:false},{hover:true,reducedMotion:true},{hover:true,saveData:true}])assert.equal(automaticPreviewAllowed(options),false);
});
test('generation status exposes bounded retry, budget and unavailable states without claiming success',()=>{
  assert.equal(previewStatusView({status:'none'}).action,'generate');
  assert.equal(previewStatusView({status:'failed',retryable:true}).action,'retry');
  assert.equal(previewStatusView({status:'failed',retryable:false}).action,'refresh');
  assert.equal(previewStatusView({status:'queued',reason:'MONTHLY_BUDGET'}).action,'refresh');
  assert.equal(previewStatusView({status:'ready'}).action,undefined);
  assert.match(previewStatusView({status:'unavailable'}).message,/暂不可用/);
});
test('preview polling uses its own version-pinned endpoint and rejects a late different-version result',async()=>{
  const work={id:'work-test',versionId:'version-one'},calls=[],ready=[];
  const controller=createAutoCoverController({work,resource:'auto-preview',onReady:state=>ready.push(state),api:async(path,options)=>{calls.push({path,options});return {workId:work.id,versionId:'version-two',status:'ready',preview:{url:'never-used'}};}});
  await controller.refresh();assert.equal(controller.state.status,'unknown');assert.equal(ready.length,0);assert.equal(calls[0].path,'/api/works/work-test/auto-preview');controller.dispose();
});
test('external, archived or other-owner views never fetch preview generation controls',()=>{
  for(const work of [{source:'url',authorId:'owner'},{source:'html',authorId:'other'},{source:'html',authorId:'owner',archivedAt:'2026-01-01'}]){
    assert.doesNotThrow(()=>mountAutoPreview({}, {work,owner:'owner',api:()=>assert.fail('unexpected request')}));
  }
});
