import test from 'node:test';
import assert from 'node:assert/strict';
import {withCardIdentity,cardPreviewFingerprint} from '../public/card-identity.js';

const card={id:'saved-card',authorId:'owner',name:'Old name',bio:'Old bio',headline:'Old role',website:'https://old.example/',avatarUrl:'/avatars/sun.svg',signature:'Card signature',backStyle:'cobalt',template:'fold',saveKey:'old-save',workIds:['work-one'],works:[{id:'work-one',authorId:'owner',authorName:'Old name',authorAvatarUrl:'/avatars/sun.svg',versionId:'pinned-version',metadataId:'pinned-metadata',name:'Saved work title',desc:'Saved description',coverUrl:'/media/pinned-cover'},{id:'foreign-work',authorId:'someone-else',authorName:'Another author'}]};
const profile={id:'owner',name:'Current name',bio:'Current bio',headline:'Current role',website:'https://current.example/',avatarUrl:'/avatars/moon.svg',signature:'Profile signature',backStyle:'ivory'};

test('live identity projection changes only the matching owner’s identity, preserving design and selected work snapshots',()=>{
  const before=structuredClone(card),next=withCardIdentity(card,profile);
  assert.notEqual(next,card);for(const field of ['name','bio','headline','website','avatarUrl'])assert.equal(next[field],profile[field]);
  for(const field of ['id','authorId','signature','backStyle','template','saveKey'])assert.equal(next[field],card[field]);
  assert.equal(next.works[0].authorName,profile.name);assert.equal(next.works[0].authorAvatarUrl,profile.avatarUrl);
  for(const field of ['id','authorId','versionId','metadataId','name','desc','coverUrl'])assert.equal(next.works[0][field],card.works[0][field]);
  assert.equal(next.works[1],card.works[1]);assert.deepEqual(next.workIds,card.workIds);assert.deepEqual(card,before);
});

test('cleared and missing optional identity fields remove stale saved values',()=>{
  for(const user of [{id:'owner',name:'Current name',bio:'',headline:'',website:'',avatarUrl:''},{id:'owner',name:'Current name'}]){
    const next=withCardIdentity(card,user);
    for(const field of ['bio','headline','website','avatarUrl'])assert.equal(next[field],'');
    assert.equal(next.works[0].authorAvatarUrl,'');assert.equal(next.signature,card.signature);
  }
});

test('a foreign or missing account never projects onto the viewed card',()=>{
  for(const user of [null,undefined,{id:'other',name:'Wrong user'},{name:'Missing id'},{id:'',name:'Empty id'}])assert.equal(withCardIdentity(card,user),card);
  const legacy={name:'Unknown author'};assert.equal(withCardIdentity(legacy,{name:'Missing id'}),legacy);
  const emptyOwner={authorId:'',name:'Unknown author'};assert.equal(withCardIdentity(emptyOwner,{id:'',name:'Empty id'}),emptyOwner);
  assert.equal(withCardIdentity(null,profile),null);
});

test('preview fingerprint follows identity and card contents, not save bookkeeping',()=>{
  const before=cardPreviewFingerprint(card),reordered=Object.fromEntries(Object.entries(card).reverse());
  assert.equal(cardPreviewFingerprint(reordered),before);
  assert.equal(cardPreviewFingerprint({...card,id:'new-id',saveKey:'new-save',createdAt:'later',fingerprint:'ignored'}),before);
  for(const [field,value]of Object.entries({name:'New name',bio:'',headline:'',website:'',avatarUrl:'',signature:'Another signature',backStyle:'ivory',template:'wall'}))assert.notEqual(cardPreviewFingerprint({...card,[field]:value}),before,field);
  assert.notEqual(cardPreviewFingerprint({...card,works:[{...card.works[0],versionId:'new-version'}]}),before);
});
