import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {t} from '../public/i18n.js';
import {htmlImportSizeNotice,importErrorText} from '../public/import-status.js';

function productionFunction(file,name){
  const source=ts.createSourceFile(file,readFileSync(new URL('../public/'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const node=source.statements.find(item=>ts.isFunctionDeclaration(item)&&item.name?.text===name);
  assert(node);return node.getText(source);
}
const publishState=productionFunction('site.js','refreshPublishState');
const versionState=productionFunction('versioning.js','updateState');
function nodes(){
  const all=new Map();
  const get=id=>{
    if(['#publish-related','#publish-recovery','#version-recovery'].includes(id))return null;
    if(!all.has(id))all.set(id,{textContent:'',hidden:false,disabled:false,classList:{toggle(){}},querySelectorAll:()=>[],getAttribute(){return null;},removeAttribute(){}});
    return all.get(id);
  };
  return {get,all};
}
function fixture(kind){
  const dom=nodes(),draft={source:'html',githubURL:'https://github.com/owner/repo',expectedRevision:1,baseVersion:'v1'},file={name:'game.html',size:10*1048576},state={build:null,ready:true};
  const shared={t,htmlImportSizeNotice,importErrorText,repositoryImportBlocked:()=>false,buildAvailabilityMarkup:()=>'',labels:{ready:'构建完成'},buildLabels:{ready:'构建完成'},buildSteps:[],phases:[]};
  let context,update;
  if(kind==='publish'){
    context=vm.createContext({...shared,$:dom.get,$$:()=>[],publishDraft:draft,publishFile:file,coverFile:null,coverPreview:'',publishCoverDraft:{canPublish:true,sync(){}},publishMediaSource:()=>({}),publishWizard:null,publishPending:false,githubPending:false,publishError:'',publishFailure:null,
      publishAvailability:{state:{status:'online'}},matchingBuild:()=>state.build,activeBuild:()=>false,githubReady:()=>draft.source==='github'&&state.ready,githubFileLink:()=>false,buildCancelPending:false,buildPollError:''});
    vm.runInContext(publishState,context);update=()=>context.refreshPublishState();
  }else{
    const ctx={draft,file,work:{version:'v1',revision:1},pending:false,importPending:false},view={ctx,availability:{state:{status:'online'}}};
    context=vm.createContext({...shared,q:dom.get,visible:()=>true,buildFor:()=>state.build,running:()=>false,ready:()=>state.ready,fileLink:()=>false});
    vm.runInContext(versionState,context);update=()=>context.updateState(view);context.ctx=ctx;
  }
  return {draft,state,context,update,get:dom.get,notice:()=>dom.get(kind==='publish'?'#publish-size-notice':'#version-size-notice'),submit:()=>dom.get(kind==='publish'?'[type="submit"]':'#version-submit')};
}

for(const kind of ['publish','version'])test(`${kind} form shows large-HTML guidance without blocking valid uploads or ready imports`,()=>{
  const f=fixture(kind);f.update();assert.match(f.notice().textContent,/10 MiB/);assert.equal(f.notice().hidden,false);assert.equal(f.submit().disabled,false);
  f.draft.source='github';f.draft.githubImport={commitSha:'abcdef',url:f.draft.githubURL};f.update();assert.match(f.notice().textContent,/10 MiB/);assert.equal(f.submit().disabled,false);
  f.state.build={status:'ready',id:'build-id',repository:'owner/repo',artifactBytes:14*1048576};f.update();assert.match(f.notice().textContent,/14 MiB/);assert.equal(f.submit().disabled,false);
  f.state.ready=false;f.state.build=null;f.update();assert.equal(f.notice().textContent,'');assert.equal(f.notice().hidden,true);assert.equal(f.submit().disabled,true);
  if(kind==='publish'){f.draft.source='url';f.update();assert.equal(f.notice().hidden,true);assert.equal(f.submit().disabled,false);}
  else {f.draft.source='html';f.context.ctx.file=null;f.update();assert.equal(f.notice().hidden,true);}
});
