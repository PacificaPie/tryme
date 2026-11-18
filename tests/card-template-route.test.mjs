import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {CARD_TEMPLATES} from '../public/card-templates.js';
import {t} from '../public/i18n.js';

const source=ts.createSourceFile('site.js',readFileSync(new URL('../public/site.js',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const node=source.statements.find(item=>ts.isFunctionDeclaration(item)&&item.name?.text==='renderTemplateExperience');
assert(node,'Production template route bridge exists');
const plain=value=>JSON.parse(JSON.stringify(value));
class ApiError extends Error {constructor(message,status,code){super(message);this.status=status;this.code=code;}}

function fixture({ids=['own-work-a','own-work-b']}={}){
  const renders=[],mounts=[],writes=[],navigation=[],notices=[],requests=[],root={isConnected:true};let saves=0;
  const draft={ids:[...ids],name:'My current name',bio:'My bio',headline:'Maker',signature:'My signature',website:'https://example.test/',backStyle:'cobalt',template:'wall'};
  const preview={id:'preview',saveKey:'approved-preview',works:[{id:'own-work-a'}]};
  const context=vm.createContext({
    CARD_TEMPLATES,t,ApiError,decodeURIComponent,URLSearchParams,
    me:{id:'current-owner',name:'Live person'},draftOwner:'current-owner',routeNumber:1,templateExperiencePanel:null,
    cardDraft:draft,preview,cardError:'Old error',cardKey:'old-key',storage:{preview:'scoped-preview'},
    $:selector=>selector==='.card-template-experience-page'?root:null,
    applyHTML:(html,number)=>{renders.push({html,number});return number===context.routeNumber;},
    mountTemplateExperience:(element,options)=>{const panel={dispose(){}};mounts.push({element,options,panel});return panel;},
    api:(...args)=>{requests.push(args);throw new Error('Opening a template must not fetch or save data');},
    write:(key,value)=>writes.push({key,value}),saveCardDraft:()=>saves++,uid:()=> 'new-card-key',
    notify:message=>notices.push(message),go:path=>navigation.push(path),
  });
  vm.runInContext(node.getText(source),context);
  const route=id=>({path:'/cards/templates/'+id,raw:'/cards/templates/'+id,params:new URLSearchParams()});
  return {context,root,draft,preview,renders,mounts,writes,navigation,notices,requests,route,get saves(){return saves;}};
}

test('opening a template experience is read-only and mounts the chosen design with the current user',async()=>{
  const f=fixture(),before=plain(f.context.cardDraft);
  await f.context.renderTemplateExperience(f.route('fold'),1);
  assert.equal(f.mounts.length,1);assert.equal(f.mounts[0].element,f.root);
  assert.equal(f.mounts[0].options.template.id,'fold');assert.equal(f.mounts[0].options.user,f.context.me);
  assert.equal(f.context.templateExperiencePanel,f.mounts[0].panel);
  assert.match(f.renders[0].html,/class="page card-template-experience-page"/);
  assert.equal(f.context.cardDraft,f.draft);assert.deepEqual(plain(f.context.cardDraft),before);assert.equal(f.context.preview,f.preview);
  assert.equal(f.context.cardKey,'old-key');assert.equal(f.context.cardError,'Old error');
  assert.equal(f.saves,0);assert.deepEqual(f.writes,[]);assert.deepEqual(f.navigation,[]);assert.deepEqual(f.requests,[]);
});

test('using a template changes only the chosen design, keeps current personal fields and selected works, and invalidates the old preview',async()=>{
  for(const ids of [['own-work-a','own-work-b'],[]]){
    const f=fixture({ids}),before=plain(f.context.cardDraft);
    await f.context.renderTemplateExperience(f.route('fold'),1);f.mounts[0].options.onUse();
    assert.deepEqual(plain(f.context.cardDraft),{...before,template:'fold'});
    assert.equal(f.context.preview,null);assert.equal(f.context.cardError,'');assert.equal(f.context.cardKey,'new-card-key');
    assert.deepEqual(f.writes,[{key:'scoped-preview',value:null}]);assert.equal(f.saves,1);
    assert.deepEqual(f.navigation,[ids.length?'/cards/me/template':'/cards/me']);assert.equal(f.notices.length,1);assert.deepEqual(f.requests,[]);
  }
});

test('a template use callback from an old route or account cannot modify the active draft',async()=>{
  for(const change of ['route','account','draft-owner','signed-out']){
    const f=fixture(),before=plain(f.context.cardDraft);await f.context.renderTemplateExperience(f.route('fold'),1);
    if(change==='route')f.context.routeNumber=2;else if(change==='account')f.context.me={id:'new-owner'};else if(change==='draft-owner')f.context.draftOwner='new-owner';else f.context.me=null;
    f.mounts[0].options.onUse();
    assert.deepEqual(plain(f.context.cardDraft),before,change);assert.equal(f.context.preview,f.preview,change);
    assert.equal(f.saves,0);assert.deepEqual(f.writes,[]);assert.deepEqual(f.navigation,[]);assert.deepEqual(f.notices,[]);
  }
});

test('unknown or malformed template routes fail without changing drafts or mounting an experience',async()=>{
  for(const id of ['missing-template','','fold/extra','%E0%A4%A']){
    const f=fixture();await assert.rejects(async()=>f.context.renderTemplateExperience(f.route(id),1),error=>error.status===404);
    assert.equal(f.mounts.length,0);assert.equal(f.context.preview,f.preview);assert.equal(f.saves,0);assert.deepEqual(f.requests,[]);
  }
  const stale=fixture();stale.context.routeNumber=2;await stale.context.renderTemplateExperience(stale.route('fold'),1);
  assert.equal(stale.mounts.length,0);assert.equal(stale.saves,0);
});
