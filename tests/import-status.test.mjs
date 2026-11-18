import test from 'node:test';
import assert from 'node:assert/strict';
import {HTML_MAX_BYTES,HTML_RECOMMENDED_BYTES,htmlFileError,htmlImportSizeNotice,repositoryImportBlocked,buildAvailabilityMarkup,importErrorText,createBuildAvailability} from '../public/import-status.js';
import {t,setLocale,getLocale} from '../public/i18n.js';

test('local HTML accepts exactly 16 MiB and rejects one byte more without confusing the file type',()=>{
  assert.equal(HTML_MAX_BYTES,16777216);
  assert.equal(htmlFileError({name:'rain.html',size:HTML_MAX_BYTES}),'');
  assert.match(htmlFileError({name:'rain.html',size:HTML_MAX_BYTES+1}),/16 MiB/);
  assert.match(htmlFileError({name:'rain.zip',size:100}),/请选择 HTML/);
  assert.match(htmlFileError({name:'rain.htm',size:0}),/为空/);
});
test('large-file guidance is nonblocking and follows only the selected ready import',()=>{
  const file={name:'rain.html',size:HTML_RECOMMENDED_BYTES+1};
  assert.equal(HTML_RECOMMENDED_BYTES,8388608);assert.equal(htmlFileError(file),'');
  assert.match(htmlImportSizeNotice({source:'html',file}),/仍可发布/);
  assert.equal(htmlImportSizeNotice({source:'html',file:{...file,size:HTML_RECOMMENDED_BYTES}}),'');
  assert.equal(htmlImportSizeNotice({source:'html',file:{...file,size:HTML_MAX_BYTES+1}}),'');
  assert.match(htmlImportSizeNotice({source:'github',file,ready:true}),/仍可发布/);
  assert.match(htmlImportSizeNotice({source:'github',file:{size:100},build:{status:'ready',artifactBytes:12*1048576},ready:true}),/12 MiB/);
  for(const args of [{source:'url',file},{source:'github',file,ready:false},{source:'github',file,ready:true,pending:true}])assert.equal(htmlImportSizeNotice(args),'');
});
test('repository size failures retain safe actual sizes and paths with bilingual layer-specific text',()=>{
  const previous=getLocale();
  const examples=[
    ['ARCHIVE_TOO_LARGE','仓库压缩包大小为 65 MiB，超过 64 MiB 上限。',/repository archive is 65 MiB/],
    ['ARCHIVE_TOO_LARGE','仓库压缩包大小至少为 64.01 MiB，超过 64 MiB 上限。',/at least 64.01 MiB/],
    ['ARCHIVE_UNPACKED_TOO_LARGE','仓库解压后大小超过 256 MiB 上限（已停止解压）。',/extracted repository exceeds the 256 MiB/],
    ['ARCHIVE_FILE_TOO_LARGE','仓库文件「assets/font.ttf」大小为 33.2 MiB，超过 32 MiB 上限。',/assets\/font.ttf.*33.2 MiB.*32 MiB/],
    ['ARCHIVE_TOO_MANY_FILES','仓库文件数量至少为 5001 项，超过 5000 项上限。',/5001 entries.*5000/],
    ['OUTPUT_TOO_LARGE','最终 HTML 大小为 16.01 MiB，超过 16 MiB 上限。',/final HTML is 16.01 MiB/],
    ['OUTPUT_TOO_LARGE','最终 HTML 大小至少为 16.01 MiB，超过 16 MiB 上限。',/final HTML is at least 16.01 MiB/],
  ];
  try{
    setLocale('zh-CN');for(const [code,message]of examples)assert.equal(importErrorText({code,message}),message);
    setLocale('en');for(const [errorCode,error,pattern]of examples){const text=t(importErrorText({errorCode,error}));assert.match(text,pattern);assert(!/[\u3400-\u9fff]/.test(text));}
    for(const code of ['ARCHIVE_TOO_LARGE','ARCHIVE_UNPACKED_TOO_LARGE','ARCHIVE_FILE_TOO_LARGE','ARCHIVE_TOO_MANY_FILES','INVALID_ARCHIVE','OUTPUT_TOO_LARGE']){
      const detail='Error: secret traceback\n at /root/credentials';const text=importErrorText({code,message:detail});assert(!text.includes('secret'));assert(!/[\u3400-\u9fff]/.test(t(text)));
    }
    const stored=importErrorText({code:examples[3][0],message:examples[3][1]});setLocale('zh-CN');assert.equal(t(stored),examples[3][1]);setLocale('en');assert.match(t(stored),examples[3][2]);
    const invalidPath='仓库文件「bad\npath」大小为 33 MiB，超过 32 MiB 上限。';assert(!importErrorText({code:'ARCHIVE_FILE_TOO_LARGE',message:invalidPath}).includes('bad'));
    const supported=buildAvailabilityMarkup({status:'online'},{selected:true});assert(supported.includes('dist/index.html'));assert(supported.includes('LICENSE'));
    assert(!/[\u3400-\u9fff]/.test(htmlImportSizeNotice({source:'html',file:{size:10*1048576}})));
  }finally{setLocale(previous);}
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
test('status refresh keeps imported HTML independent of the builder and hides it for other sources',async()=>{
  let selected=true,directFile=true,ready=true,online=false;const rendered=[];
  const availability=createBuildAvailability(async()=>({online,status:online?'online':'offline'}),state=>{
    rendered.push(buildAvailabilityMarkup(state,{selected,directFile,ready}));
  });
  try{
    await availability.refresh();online=true;await availability.refresh();online=false;await availability.refresh();
    assert(rendered.length>=6);for(const markup of rendered){assert.match(markup,/独立 HTML/);assert(!markup.includes('仓库构建'));assert(!markup.includes('data-import-local'));}
    selected=false;
    for(const staleDirectFile of [true,false])for(const staleReady of [true,false])for(const status of ['checking','online','offline','unknown']){
      assert.equal(buildAvailabilityMarkup({status},{selected,directFile:staleDirectFile,ready:staleReady}),'');
    }
    rendered.length=0;await availability.refresh();assert(rendered.every(markup=>markup===''));
    selected=true;directFile=false;ready=false;rendered.length=0;await availability.refresh();
    assert.match(rendered.at(-1),/GitHub 仓库构建离线/);assert.match(rendered.at(-1),/data-import-local/);
    online=true;await availability.refresh();assert.match(rendered.at(-1),/GitHub 仓库构建可用/);assert(!rendered.at(-1).includes('data-import-local'));
  }finally{availability.dispose();}
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
