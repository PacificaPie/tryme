import test from 'node:test';
import assert from 'node:assert/strict';
import {newVersionDraft,editVersionDraft,rebaseVersionDraft,versionWork,previewReferences,isPinnedPreview,prepareCardPreview,frozenAction,localPreviewHTML} from '../public/versioning-state.js';

test('editing and retrying a draft keep its original concurrency baseline until explicit rebase',()=>{
  const work={revision:2,version:'v2'};
  const initial=newVersionDraft(work,'first');
  const edited=editVersionDraft(initial,{releaseNotes:'a new ending'},'second');
  work.revision=4;work.version='v1';
  assert.equal(edited.expectedRevision,2);
  assert.equal(edited.baseVersion,'v2');
  edited.attempted=true;
  const retry=JSON.parse(JSON.stringify(edited));
  assert.equal(retry.key,'second');assert.equal(retry.expectedRevision,2);
  const rebased=rebaseVersionDraft(retry,work,'third');
  assert.equal(rebased.expectedRevision,4);assert.equal(rebased.baseVersion,'v1');
  assert.equal(rebased.releaseNotes,'a new ending');assert.equal(rebased.attempted,false);
});
test('a historical local version cannot inherit the current GitHub origin or cover',()=>{
  const current={id:'work',versionId:'v2-id',version:'v2',coverUrl:'/media/v2-id',build:{commitSha:'new'}};
  const old=versionWork(current,{id:'v1-id',version:'v1',coverUrl:'/media/v1-id'});
  assert.equal(old.versionId,'v1-id');assert.equal(old.coverUrl,'/media/v1-id');assert.equal(old.build,undefined);
  assert.equal(current.versionId,'v2-id');assert.equal(current.build.commitSha,'new');
});
test('card saving references previewed versions and event retries retain their original version',()=>{
  const work={id:'work',versionId:'v1-id'};
  const preview={works:structuredClone([work])};
  const fields={workId:work.id,versionId:work.versionId};
  const action=frozenAction('event-key','work_view',fields);
  work.versionId='v2-id';fields.versionId='v2-id';
  assert.deepEqual(previewReferences(preview),[{workId:'work',versionId:'v1-id'}]);
  assert.equal(action.versionId,'v1-id');assert(Object.isFrozen(action));
});
test('unpublished file preview starts with restrictive CSP and introduces no telemetry bridge',()=>{
  const html=localPreviewHTML('<html><script>window.test=1</script></html>');
  assert(html.indexOf('Content-Security-Policy')<html.indexOf('window.test'));
  assert(html.includes("connect-src 'none'"));assert(html.includes("default-src 'none'"));
  assert(!html.includes('funtrack-game'));assert(!html.includes('allow-same-origin'));
});
test('legacy card previews retain their original save key until explicit regeneration',()=>{
  const legacy={fingerprint:'same-content',saveKey:'old-workids-key',works:[{id:'work',versionId:'v1'}]};
  const restored=JSON.parse(JSON.stringify(legacy));
  assert.equal(isPinnedPreview(restored),false);
  assert.equal(restored.saveKey,'old-workids-key');
  const generated=prepareCardPreview(restored,{fingerprint:'same-content',works:restored.works},'new-pinned-key');
  assert.equal(generated.saveKey,'new-pinned-key');assert.equal(isPinnedPreview(generated),true);
  assert.equal(restored.saveKey,'old-workids-key');assert.equal(restored.payloadSchema,undefined);
  assert.strictEqual(prepareCardPreview(generated,{fingerprint:'same-content'},'unused-key'),generated);
});
