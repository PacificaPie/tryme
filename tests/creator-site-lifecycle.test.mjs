import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {CARD_TEMPLATES} from '../public/card-templates.js';
import {createRemixDraft,remixStyle} from '../public/card-remix.js';
import {isPinnedPreview,previewReferences} from '../public/versioning-state.js';
import {withCardIdentity,cardPreviewFingerprint} from '../public/card-identity.js';
import {t} from '../public/i18n.js';
import '../public/creator-social.messages.js';

// Run production functions with deferred requests. Only browser chrome and
// network transport are fixtures; the draft transitions and guards are real.
const source=ts.createSourceFile('site.js',readFileSync(new URL('../public/site.js',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const functions=['editProfile','renderBuilder','renderCardRemix','saveCard','saveCardDraft','cardProfile','syncCardPreview','activateDrafts'].map(name=>{
  const node=source.statements.find(item=>ts.isFunctionDeclaration(item)&&item.name?.text===name);assert(node,name);return node.getText(source);
}).join('\n');
const plain=value=>JSON.parse(JSON.stringify(value));
const cardId='71160f2c-1946-4d96-a85c-bfdaf5940fe8';
const originalPreview={id:'preview',authorId:'mine',name:'My profile',bio:'Profile bio',headline:'Profile role',signature:'Card signature',website:'https://profile.example/',backStyle:'ivory',avatarUrl:'/avatars/sun.svg',template:'wall',workIds:['my-work-one'],works:[{id:'my-work-one',authorId:'mine',authorName:'My profile',authorAvatarUrl:'/avatars/sun.svg',name:'Saved work title',desc:'Saved work description',coverUrl:'/media/saved-cover',versionId:'version-one',metadataId:'metadata-one',revision:1}],payloadSchema:3,saveKey:'original-save'};
originalPreview.fingerprint=cardPreviewFingerprint(originalPreview);
const sourceCard={id:cardId,authorId:'someone-else',name:'Another creator',bio:'Not my bio',headline:'Not my role',template:'filmstrip',backStyle:'cobalt',works:[{id:'foreign-work'}],saveKey:'foreign-key'};
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
class Button {disabled=false;textContent='';listeners=new Map();addEventListener(type,handler){this.listeners.set(type,handler);}click(){return this.listeners.get('click')?.();}}
function fixture(path='/cards/me/preview'){
  const calls=[],mine=[],writes=[],navigations=[],notices=[],renders=[],html=[],buttons=new Map(['#save-card','#card-error','#apply-card-remix'].map(key=>[key,new Button()]));let editor,uid=0;
  let activeRoute={path,raw:path,params:new URLSearchParams()};
  const context=vm.createContext({t,CARD_TEMPLATES,createRemixDraft,remixStyle,isPinnedPreview,previewReferences,withCardIdentity,cardPreviewFingerprint,URLSearchParams,JSON,structuredClone,
    me:{id:'mine',name:'My profile',bio:'Profile bio',headline:'Profile role',website:'https://profile.example/',avatarUrl:'/avatars/sun.svg'},draftOwner:'mine',routeNumber:1,
    cardDraft:{ids:['my-work-one'],template:'wall',name:'Draft name',bio:'Draft bio',headline:'Draft role',signature:'Draft signature',backStyle:'ivory'},preview:structuredClone(originalPreview),cardPending:false,cardError:'',onboardingState:{intent:'create',hasCard:false},
    storage:{card:'card:mine',preview:'preview:mine'},write:(key,value)=>writes.push({key,value:structuredClone(value)}),uid:()=>`new-key-${++uid}`,
    api:(url,options)=>{const pending=defer();calls.push({url,options,...pending});return pending.promise;},readMine:()=>{const pending=defer();mine.push(pending);return pending.promise;},
    route:()=>activeRoute,go:value=>navigations.push(value),notify:value=>notices.push(value),renderRoute:()=>renders.push(activeRoute.path),identity(){},clearDiscovery(){},
    openProfileEditor:options=>{editor=options;},$:selector=>buttons.get(selector)||null,
    applyHTML:(value,number)=>{if(number!==context.routeNumber)return false;html.push(value);return true;},head:value=>`<h1>${value}</h1>`,
    esc:value=>String(value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
    safeExternal:value=>{try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return ''; }},
    ApiError:class extends Error{constructor(message,status,code){super(message);this.status=status;this.code=code;}},
  });
  vm.runInContext(functions,context);
  return {context,calls,mine,writes,navigations,notices,renders,html,buttons,get editor(){return editor;},setRoute(value){activeRoute={path:value,raw:value,params:new URLSearchParams()};},remixRoute(){return {path:'/cards/me',raw:'/cards/me?templateFrom='+cardId,params:new URLSearchParams({templateFrom:cardId})};}};
}

test('an obsolete builder response cannot prune another page or account’s draft or redirect to selection',async()=>{
  for(const changed of ['route','account']){
    const f=fixture(),before=plain(f.context.cardDraft),pending=f.context.renderBuilder({path:'/cards/me/template',params:new URLSearchParams()},1);
    if(changed==='route'){f.context.routeNumber=2;f.setRoute('/author/someone');}
    else {f.context.me={id:'another-account'};f.context.draftOwner='another-account';}
    f.mine[0].resolve([{id:'different-work'}]);await pending;
    assert.deepEqual(plain(f.context.cardDraft),before,changed);assert.deepEqual(f.writes,[]);assert.deepEqual(f.navigations,[]);assert.deepEqual(f.html,[]);
  }
});

test('same-template confirmation preserves the draft until accepted, then keeps only design and card-specific signature',async()=>{
  const f=fixture(),draft=plain(f.context.cardDraft),preview=plain(f.context.preview),pending=f.context.renderCardRemix(f.remixRoute(),1);
  assert.deepEqual(f.writes,[]);f.calls[0].resolve({card:sourceCard});await pending;
  assert.deepEqual(plain(f.context.cardDraft),draft);assert.deepEqual(plain(f.context.preview),preview);assert.deepEqual(f.writes,[]);
  assert.match(f.html[0],/继续原草稿/);assert.match(f.html[0],/已保存的名片不受影响/);
  f.buttons.get('#apply-card-remix').click();
  assert.equal(f.context.cardDraft.template,'filmstrip');assert.equal(f.context.cardDraft.backStyle,'cobalt');assert(!Object.hasOwn(f.context.cardDraft,'name'));assert.deepEqual(plain(f.context.cardDraft.ids),[]);
  assert.equal(f.context.preview,null);assert.deepEqual(f.navigations,['/cards/me']);assert(!JSON.stringify(f.context.cardDraft).includes('foreign'));
});

test('late remix fetches and stale confirmation buttons cannot replace the current account’s draft',async()=>{
  for(const phase of ['fetch','click'])for(const changed of ['route','account']){
    const f=fixture(),before=plain(f.context.cardDraft),pending=f.context.renderCardRemix(f.remixRoute(),1);
    if(phase==='click'){f.calls[0].resolve({card:sourceCard});await pending;}
    if(changed==='route')f.context.routeNumber=2;else {f.context.me={id:'another-account'};f.context.draftOwner='another-account';}
    if(phase==='fetch'){f.calls[0].resolve({card:sourceCard});await pending;}else f.buttons.get('#apply-card-remix').click();
    assert.deepEqual(plain(f.context.cardDraft),before,phase+' '+changed);assert.deepEqual(f.writes,[]);assert.deepEqual(f.navigations,[]);
  }
});

test('every live profile field refreshes preview identity without changing selected work versions or card-specific choices',()=>{
  for(const [field,value]of Object.entries({name:'New name',bio:'New bio',headline:'New role',website:'https://new.example/',avatarUrl:'/avatars/moon.svg'})){
    const f=fixture(),draft=plain(f.context.cardDraft);f.context.editProfile();f.editor.onSaved({...plain(f.context.me),[field]:value});
    const next=plain(f.context.preview);assert.equal(next[field],value,field);assert.notEqual(next.saveKey,originalPreview.saveKey);assert.notEqual(next.fingerprint,originalPreview.fingerprint);
    assert.equal(next.signature,originalPreview.signature);assert.equal(next.backStyle,originalPreview.backStyle);assert.equal(next.template,originalPreview.template);assert.equal(next.payloadSchema,3);
    const work=next.works[0];for(const key of ['id','name','desc','coverUrl','versionId','metadataId','revision'])assert.equal(work[key],originalPreview.works[0][key]);
    assert.equal(work.authorName,f.context.me.name);assert.equal(work.authorAvatarUrl,f.context.me.avatarUrl);assert.equal(JSON.parse(next.fingerprint)[field],value);
    assert.deepEqual(plain(f.context.cardDraft),draft);assert.deepEqual(f.renders,['/cards/me/preview']);assert.equal(f.writes.length,1);assert.equal(f.writes[0].key,'preview:mine');
  }
});

test('cleared optional profile fields replace old values, and all card routes redraw after confirmed profile edits',()=>{
  for(const path of ['/cards','/cards/me','/cards/me/template','/cards/me/preview','/cards/templates/fold','/card/'+cardId]){
    const f=fixture(path);f.context.editProfile();f.editor.onSaved({...plain(f.context.me),name:'Current name',bio:'',headline:'',website:'',avatarUrl:''});
    for(const field of ['bio','headline','website','avatarUrl'])assert.equal(f.context.preview[field],'',path+' '+field);
    assert.equal(f.context.preview.name,'Current name');assert.equal(f.context.preview.works[0].authorAvatarUrl,'');assert.deepEqual(f.renders,[path]);
    assert.equal(f.context.preview.signature,originalPreview.signature);
  }
});

test('same-account draft activation refreshes old preview identity, and unchanged profile saves keep the retry key',async()=>{
  const f=fixture();await f.context.activateDrafts({...plain(f.context.me),name:'Loaded current name'});
  assert.equal(f.context.preview.name,'Loaded current name');assert.notEqual(f.context.preview.saveKey,originalPreview.saveKey);assert.equal(f.writes.length,1);
  f.context.me={...plain(f.context.me),name:'Loaded current name'};const key=f.context.preview.saveKey;f.context.editProfile();f.editor.onSaved(plain(f.context.me));
  assert.equal(f.context.preview.saveKey,key);assert.equal(f.writes.length,1,'An unchanged identity must not regenerate an idempotency key');
});

test('saving a draft strips legacy duplicated identity while retaining its design choices',()=>{
  const f=fixture();f.context.cardDraft.website='https://old.example/';f.context.cardDraft.avatarUrl='/avatars/moon.svg';f.context.saveCardDraft();
  assert.deepEqual(plain(f.context.cardDraft),{ids:['my-work-one'],template:'wall',signature:'Draft signature',backStyle:'ivory'});
  assert.equal(f.writes[0].key,'card:mine');assert.deepEqual(f.writes[0].value,plain(f.context.cardDraft));
});

test('an old profile editor cannot write or apply identity to a new account',()=>{
  const f=fixture();f.context.editProfile();
  f.context.me={id:'other',name:'Other'};f.context.draftOwner='other';
  assert.throws(()=>f.editor.api('/api/me/profile',{method:'POST'}),error=>error.code==='AUTH_SESSION_CHANGED');
  f.editor.onSaved({id:'mine',name:'Old response',avatarUrl:'/avatars/moon.svg'});
  assert.equal(f.context.me.name,'Other');assert.equal(f.context.preview.saveKey,originalPreview.saveKey);assert.deepEqual(f.calls,[]);
});

test('saving synchronizes the latest profile before forming its request and retains one operation for repeated clicks',async()=>{
  const f=fixture();f.context.me={...plain(f.context.me),name:'Latest name',bio:'Latest bio',headline:'Latest role',website:'https://latest.example/',avatarUrl:'/avatars/moon.svg'};
  const pending=f.context.saveCard();await f.context.saveCard();assert.equal(f.calls.length,1);
  for(const field of ['name','bio','headline','website','avatarUrl'])assert.equal(f.calls[0].options.body[field],f.context.me[field]);
  assert.notEqual(f.calls[0].options.headers['Idempotency-Key'],originalPreview.saveKey);assert.equal(f.calls[0].options.headers['Idempotency-Key'],f.context.preview.saveKey);
  assert.deepEqual(plain(f.calls[0].options.body.workRefs),[{workId:'my-work-one',versionId:'version-one',metadataId:'metadata-one'}]);assert.equal(f.calls[0].options.body.signature,originalPreview.signature);
  f.calls[0].resolve({card:{id:cardId}});await pending;
  assert.deepEqual(f.navigations,['/card/'+cardId+'?saved=1']);assert.equal(f.context.cardPending,false);assert.equal(f.context.onboardingState.hasCard,true);
});

test('a late old save success or deleted-card error cannot navigate away from or erase a newer preview',async()=>{
  for(const outcome of ['success','deleted']){
    const f=fixture(),pending=f.context.saveCard(),newPreview={...structuredClone(originalPreview),saveKey:'new-preview-key',name:'New preview'};
    f.context.preview=newPreview;
    if(outcome==='success')f.calls[0].resolve({card:{id:cardId}});else f.calls[0].reject(Object.assign(new Error('Old card deleted'),{code:'CARD_DELETED'}));
    await pending;
    assert.equal(f.context.preview,newPreview);assert.deepEqual(f.navigations,[]);assert.deepEqual(f.writes,[]);assert.deepEqual(f.notices,[]);
    assert.equal(f.context.cardPending,false);assert.equal(f.buttons.get('#save-card').disabled,false);assert.equal(f.buttons.get('#save-card').textContent,'保存为新名片');
  }
});

test('an old account’s save completion cannot clear another account’s in-flight save state',async()=>{
  const f=fixture(),oldSave=f.context.saveCard();
  f.context.me={...plain(f.context.me),id:'other'};f.context.draftOwner='other';f.context.cardPending=false;f.context.storage.preview='preview:other';
  const next={...structuredClone(originalPreview),authorId:'other',saveKey:'other-key'};f.context.preview=next;
  const newSave=f.context.saveCard(),operation=f.context.cardPending;
  f.calls[0].reject(Object.assign(new Error('Old card deleted'),{code:'CARD_DELETED'}));await oldSave;
  assert.equal(f.context.cardPending,operation);assert.equal(f.context.preview,next);assert.equal(f.buttons.get('#save-card').disabled,true);assert.deepEqual(f.writes,[]);assert.deepEqual(f.navigations,[]);
  f.calls[1].resolve({card:{id:'other-card'}});await newSave;
  assert.equal(f.context.cardPending,false);assert.deepEqual(f.navigations,['/card/other-card?saved=1']);
});
