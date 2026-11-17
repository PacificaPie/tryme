import test from 'node:test';
import assert from 'node:assert/strict';
import {HTML_MAX_BYTES,htmlFileError,repositoryImportBlocked,buildAvailabilityMarkup,importErrorText,createBuildAvailability} from '../public/import-status.js';
import {t,setLocale,getLocale} from '../public/i18n.js';

test('local HTML accepts exactly 8 MiB and rejects one byte more without confusing the file type',()=>{
  assert.equal(HTML_MAX_BYTES,8388608);
  assert.equal(htmlFileError({name:'rain.html',size:HTML_MAX_BYTES}),'');
  assert.match(htmlFileError({name:'rain.html',size:HTML_MAX_BYTES+1}),/8 MiB/);
  assert.match(htmlFileError({name:'rain.zip',size:100}),/请选择 HTML/);
  assert.match(htmlFileError({name:'rain.htm',size:0}),/为空/);
});
test('builder availability gates repositories but never standalone GitHub HTML',()=>{
  const repo='https://github.com/owner/game';
  const urls=['https://github.com/owner/game/blob/main/index.html','https://raw.githubusercontent.com/owner/game/main/index.htm'];
  for(const status of ['checking','offline','unconfigured']){
    assert.equal(repositoryImportBlocked({status},repo),true);
    for(const url of urls)assert.equal(repositoryImportBlocked({status},url),false);
  }
  assert.equal(repositoryImportBlocked({status:'online'},repo),false);
  assert.equal(repositoryImportBlocked({status:'unknown'},repo),false);
  const ready=buildAvailabilityMarkup({status:'offline'},{selected:true,ready:true});
  assert(!ready.includes('data-import-local'),'an already imported artifact should remain the selected source');
  const direct=buildAvailabilityMarkup({status:'offline'},{selected:true,directFile:true});
  assert(!direct.includes('data-import-local'));assert.match(direct,/独立 HTML/);
});
test('offline, inaccessible, unsupported and oversize failures have distinct actionable bilingual messages',()=>{
  const previous=getLocale();
  try{
    const messages=['BUILD_RUNNER_OFFLINE','GITHUB_NOT_FOUND','GITHUB_PRIVATE_REPOSITORY','GITHUB_INACCESSIBLE','UNSUPPORTED_PROJECT','HTML_TOO_LARGE','INVALID_HTML','GITHUB_AMBIGUOUS_REF'].map(code=>importErrorText({code}));
    assert.equal(new Set(messages).size,messages.length);
    assert(!messages[1].includes('私有'),'a 404 is not proof of a private repository');
    assert.match(importErrorText({errorCode:'UNSUPPORTED_PROJECT',error:'opaque worker detail'}),/Vite/);
    setLocale('en');for(const message of messages)assert(!/[\u3400-\u9fff]/.test(t(message)));
    setLocale('zh-CN');for(const message of messages)assert.equal(t(message),message);
    assert.equal(importErrorText({message:'custom detail'}),'custom detail');
  }finally{setLocale(previous);}
});
test('availability reads deduplicate and a stale online reply cannot overwrite a newer offline rejection',async()=>{
  let resolve,calls=0,lastSignal;
  const availability=createBuildAvailability((_path,{signal})=>{calls++;lastSignal=signal;return new Promise(r=>resolve=r);});
  const first=availability.refresh();assert.equal(availability.refresh(),first);assert.equal(calls,1);
  availability.markUnavailable('BUILD_RUNNER_OFFLINE');assert.equal(lastSignal.aborted,true);
  resolve({online:true,status:'online'});await first;assert.equal(availability.state.status,'offline');
  const fresh=availability.refresh();resolve({online:true,status:'online'});await fresh;
  assert.equal(availability.state.status,'online');assert.equal(calls,2);availability.dispose();
});
test('failed status reads are unknown rather than offline, and disposed forms ignore later replies',async()=>{
  const failed=createBuildAvailability(async()=>{throw new Error('network');});
  await failed.refresh();assert.equal(failed.state.status,'unknown');failed.dispose();
  let resolve,signal,changes=0;
  const pending=createBuildAvailability((_path,options)=>{signal=options.signal;return new Promise(r=>resolve=r);},()=>changes++);
  const request=pending.refresh();pending.dispose();const count=changes;
  assert(signal.aborted);resolve({online:true});await request;assert.equal(changes,count);
});
