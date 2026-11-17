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
  const current={id:'work',versionId:'v2-id',version:'v2',coverUrl:'/media/v2-id',metadataId:'new-metadata',build:{commitSha:'new'}};
  const old=versionWork(current,{id:'v1-id',version:'v1',coverUrl:'/media/v1-id'});
  assert.equal(old.versionId,'v1-id');assert.equal(old.coverUrl,'/media/v1-id');assert.equal(old.build,undefined);assert.equal(old.metadataId,undefined);
  assert.equal(current.versionId,'v2-id');assert.equal(current.build.commitSha,'new');
});
test('new card previews pin metadata while schema2 retries retain their exact legacy references and key',()=>{
  const works=[{id:'work',versionId:'v1',metadataId:'metadata-original',revision:2},{id:'unseeded',versionId:'v1',metadataId:null,revision:4}];
  const legacy={payloadSchema:2,fingerprint:'same-content',saveKey:'already-saved',works:structuredClone(works)};
  assert.equal(isPinnedPreview(legacy),true);
  assert.deepEqual(previewReferences(legacy),[{workId:'work',versionId:'v1'},{workId:'unseeded',versionId:'v1'}]);
  assert.equal(legacy.saveKey,'already-saved');
  const next=prepareCardPreview(legacy,{fingerprint:'same-content',works:structuredClone(works)},'explicit-regeneration');
  assert.equal(next.payloadSchema,3);assert.equal(next.saveKey,'explicit-regeneration');
  works[0].metadataId='later-metadata';works[1].revision=5;
  assert.deepEqual(previewReferences(next),[{workId:'work',versionId:'v1',metadataId:'metadata-original'},{workId:'unseeded',versionId:'v1',expectedRevision:4}]);
  assert.equal(next.saveKey,'explicit-regeneration');
  assert.equal(legacy.payloadSchema,2);assert.equal(legacy.saveKey,'already-saved');
});
test('schema3 cannot silently submit an unpinned legacy work when its preview revision is missing',()=>{
  const works=[{id:'unseeded',versionId:'v1',metadataId:null}];
  assert.throws(()=>previewReferences({payloadSchema:3,works}),/重新生成预览/);
  assert.deepEqual(previewReferences({payloadSchema:2,works}),[{workId:'unseeded',versionId:'v1'}]);
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
