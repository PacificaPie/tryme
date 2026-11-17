import {t,getLocale} from './i18n.js';
import {publicationFailureMessage,publicationFailureActions,discoveryState,discoveryPath} from './publication-controls.js';
import './creator-module.messages.js';
import { isArchived, archiveGuardMarkup, archivedWorkPath } from './archive-controls.js';
import {newVersionDraft,editVersionDraft,rebaseVersionDraft,versionWork,localPreviewHTML} from './versioning-state.js';
import {HTML_UPLOAD_HINT,htmlFileError,isGithubHTMLURL,importErrorText,repositoryImportBlocked,buildAvailabilityMarkup,createBuildAvailability} from './import-status.js';

const contexts=new Map(),flashes=new Map();
let active=null;
const phases=['queued','fetching','installing','building','packaging'];
const labels={queued:'等待构建',fetching:'导入源码',installing:'安装依赖',building:'构建项目',packaging:'整理运行包',ready:'构建完成',failed:'构建失败',cancelled:'已取消'};
const q=(selector,root=document)=>root.querySelector(selector);
const uuid=()=>crypto.randomUUID();
const storeKey=(owner,id)=>'funtrack.version-update:'+owner+':'+id;
const read=key=>{try{return JSON.parse(sessionStorage.getItem(key));}catch{return null;}};
const write=(key,value)=>{try{sessionStorage.setItem(key,JSON.stringify(value));}catch{}};
const remove=key=>{try{sessionStorage.removeItem(key);}catch{}};
const historyPath=id=>'/studio/works/'+encodeURIComponent(id)+'/versions';
const updatePath=id=>'/studio/works/'+encodeURIComponent(id)+'/update';
const running=build=>Boolean(build&&phases.includes(build.status));
const fileLink=isGithubHTMLURL;
const buildFor=ctx=>ctx.draft.build?.inputURL===ctx.draft.githubURL?.trim()?ctx.draft.build:null;
const ready=ctx=>ctx.draft.source==='html'?Boolean(ctx.file):buildFor(ctx)?.status==='ready'||Boolean(ctx.file&&ctx.draft.githubImport?.url===ctx.draft.githubURL?.trim());
const save=ctx=>write(ctx.storage,ctx.draft);
export function hasPendingVersionMutation(){return Boolean(active?.activating||[...contexts.values()].some(ctx=>ctx.pending||ctx.importPending||ctx.cancelPending)||(active?.ctx?.draft&&running(buildFor(active.ctx))));}
const fileKey=(ctx,kind)=>'version:'+ctx.owner+':'+ctx.id+':'+kind;
const fileOp=(ctx,action,kind,value)=>{
  const run=()=>ctx.h.fileStore(action,fileKey(ctx,kind),value,true);
  if(action==='get')return run();
  ctx.fileWrites=(ctx.fileWrites||Promise.resolve()).then(run,run);return ctx.fileWrites;
};
const invalidate=ctx=>{ctx.draft=editVersionDraft(ctx.draft,{},uuid());ctx.error='';save(ctx);};
function disposePreview(){const dialog=q('#version-preview-dialog');if(dialog){dialog.close?.();dialog.remove();}}
export function disposeVersioning(){if(active){active.disposed=true;active.availability?.dispose();clearTimeout(active.timer);active.pollRevision++;active=null;}disposePreview();q('#version-activate-dialog')?.remove();}
function visible(view){return active===view&&!view.disposed&&view.h.isCurrent();}
function drawError(view,message){if(visible(view)){const el=q('#version-error');if(el)el.textContent=t(message);}}
function successMessage(result){const later=result.current.versionId!==result.operation.toVersionId;if(result.operation.changed===false)return later?t('本次操作未切换版本；线上后来已有变化'):t('{version} 已是当前版本',{version:result.version.version});const message=t(result.operation.action==='publish'?'已发布 {version}':'已切换到 {version}',{version:result.version.version});return message+(later?t('；线上版本后来已有变化'):'');}
function complete(view,result){const message=successMessage(result);flashes.set(view.ctx.storage,message);view.h.onChanged();if(!view.h.isPlaying?.()&&(visible(view)||active?.ctx===view.ctx&&visible(active)))view.h.go(historyPath(view.ctx.id));else view.h.notify(message);}

async function context(h,id,work){
  const storage=storeKey(h.owner,id);let ctx=contexts.get(storage);
  if(!ctx){ctx={id,owner:h.owner,storage,h,work,draft:read(storage)||newVersionDraft(work,uuid()),file:null,cover:null,pending:false,importPending:false,importRevision:0,error:'',conflict:null};contexts.set(storage,ctx);ctx.loading=Promise.all([fileOp(ctx,'get','game'),fileOp(ctx,'get','cover')]).then(([file,cover])=>{ctx.file=file;ctx.cover=cover;});}
  await ctx.loading;
  ctx.h=h;ctx.work=work;ctx.archived=isArchived(work);
  if(ctx.draft.expectedRevision!==work.revision&&!ctx.draft.attempted)ctx.conflict={versionId:work.versionId,revision:work.revision};
  save(ctx);return ctx;
}
function updateState(view){
  if(!visible(view)&&active?.ctx===view.ctx)view=active;
  if(!visible(view))return;const ctx=view.ctx,d=ctx.draft,form=q('#version-update-form'),build=buildFor(ctx),busy=ctx.pending,availability=view.availability?.state||{status:'checking'},blocked=repositoryImportBlocked(availability,d.githubURL);
  if(!form)return;
  form.querySelectorAll('input,textarea').forEach(el=>el.disabled=busy);
  q('#version-html-field').hidden=d.source!=='html';q('#version-github-field').hidden=d.source!=='github';
  q('#version-github-url').disabled=busy||d.source!=='github'||running(build);
  q('#version-import').disabled=busy||ctx.archived||ctx.importPending||running(build)||!d.githubURL?.trim()||blocked;
  q('#version-import').textContent=t(ctx.importPending?'正在导入…':running(build)?'构建中…':fileLink(d.githubURL)?'读取文件':'导入并构建');
  q('#version-import').classList.toggle('primary',d.source==='github'&&!ready(ctx)&&!blocked);
  q('#version-import-availability').innerHTML=buildAvailabilityMarkup(availability,{selected:d.source==='github',directFile:fileLink(d.githubURL),ready:d.source==='github'&&ready(ctx),disabled:busy||ctx.importPending});
  q('#version-file-name').textContent=ctx.file?.name||'';
  q('#version-source-status').textContent=ctx.importPending?t('正在读取 GitHub…'):build?t(labels[build.status]||build.status):ready(ctx)&&d.source==='github'?ctx.file.name:'';
  q('#version-build-panel').hidden=!build;
  if(build){q('#version-build-source').textContent=build.repository+' · '+(build.commitSha||'').slice(0,7);q('#version-build-logs').textContent=build.logs||'';q('#version-build-cancel').hidden=!running(build);q('#version-build-cancel').disabled=ctx.cancelPending||busy;q('#version-build-progress').hidden=!running(build);q('#version-build-progress').value=phases.indexOf(build.status)+1;}
  q('#version-preview').disabled=!ready(ctx)||ctx.importPending;
  q('#version-cover-name').textContent=ctx.cover?.name||t('沿用 {version} 封面',{version:ctx.work.version});q('#version-cover-reset').hidden=!ctx.cover;q('#version-cover-reset').disabled=busy;
  const conflict=ctx.conflict||(!d.attempted&&d.expectedRevision!==ctx.work.revision?{revision:ctx.work.revision}:null);
  q('#version-conflict').hidden=!conflict;q('#version-rebase').disabled=busy;
  q('#version-baseline').textContent=t('基于 {version}',{version:d.baseVersion});
  const submit=q('#version-submit');submit.disabled=busy||ctx.archived||ctx.importPending||!ready(ctx)||Boolean(conflict);submit.textContent=t(busy?'正在发布…':d.attempted?'确认上次发布结果':'发布新版本');submit.classList.toggle('primary',d.source!=='github'||ready(ctx));
  q('#version-error').textContent=t(ctx.error||(d.source==='github'&&build?.status==='failed'?importErrorText(build):''));
  const recovery=q('#version-recovery');if(recovery){recovery.innerHTML=ctx.publicationFailure&&ctx.error===publicationFailureMessage(ctx.publicationFailure)?publicationFailureActions(ctx.publicationFailure,{esc:view.h.esc,workId:ctx.id}):'';recovery.hidden=!recovery.innerHTML;}
}
async function pollBuild(view){
  if(!visible(view)&&active?.ctx===view.ctx)view=active;
  clearTimeout(view.timer);const ctx=view.ctx,build=buildFor(ctx);if(!visible(view)||ctx.draft.source!=='github'||!running(build))return;
  const revision=++view.pollRevision,id=build.id,inputURL=build.inputURL;
  try{const result=await view.h.api('/api/builds/'+encodeURIComponent(id));if(!visible(view)||revision!==view.pollRevision||buildFor(ctx)?.id!==id)return;ctx.draft.build={...result.build,inputURL};ctx.pollError='';save(ctx);updateState(view);}
  catch(error){if(!visible(view)||revision!==view.pollRevision)return;ctx.pollError=error.message;drawError(view,error.message);}
  if(visible(view)&&revision===view.pollRevision&&running(buildFor(ctx)))view.timer=setTimeout(()=>pollBuild(view),ctx.pollError?5000:1500);
}
async function importBuild(view){
  const ctx=view.ctx,d=ctx.draft;if(ctx.pending||ctx.archived||ctx.importPending||d.source!=='github'||running(buildFor(ctx)))return;
  const url=d.githubURL?.trim();if(!url)return;if(repositoryImportBlocked(view.availability?.state,url)){updateState(view);return;}const revision=++ctx.importRevision,isFile=fileLink(url);ctx.importPending=true;ctx.error='';
  if(!isFile){if(d.githubRequest?.url!==url||['ready','failed','cancelled'].includes(buildFor(ctx)?.status))d.githubRequest={url,key:uuid()};d.githubImport=null;d.build=null;save(ctx);}
  const requestKey=d.githubRequest?.key;updateState(view);
  try{
    if(isFile){const result=await view.h.api('/api/imports/github',{method:'POST',body:{url}});if(revision!==ctx.importRevision||ctx.draft.source!=='github'||ctx.draft.githubURL?.trim()!==url)return;ctx.file=new File([result.html],result.filename,{type:'text/html'});ctx.draft.githubImport={url,commitSha:result.commitSha};ctx.draft.build=null;invalidate(ctx);await fileOp(ctx,'put','game',ctx.file);}
    else{const result=await view.h.api('/api/builds',{method:'POST',headers:{'Idempotency-Key':requestKey},body:{url}});if(ctx.draft.githubRequest?.key!==requestKey||ctx.draft.githubURL?.trim()!==url)return;ctx.draft.build={...result.build,inputURL:url};if(revision===ctx.importRevision&&ctx.draft.source==='github'&&!ctx.pending)invalidate(ctx);else save(ctx);pollBuild(view);}
  }catch(error){if(revision===ctx.importRevision){ctx.error=importErrorText(error);if(['BUILD_RUNNER_OFFLINE','BUILD_RUNNER_UNCONFIGURED'].includes(error.code))view.availability?.markUnavailable(error.code);}}
  finally{if(revision===ctx.importRevision){ctx.importPending=false;updateState(view);}}
}
async function cancelBuild(view){
  const ctx=view.ctx,build=buildFor(ctx);if(!running(build)||ctx.cancelPending)return;ctx.cancelPending=true;updateState(view);
  try{const result=await view.h.api('/api/builds/'+encodeURIComponent(build.id)+'/cancel',{method:'POST',body:{}});if(buildFor(ctx)?.id===build.id){const target=active?.ctx===ctx?active:view;target.pollRevision++;clearTimeout(target.timer);ctx.draft.build={...result.build,inputURL:build.inputURL};save(ctx);}}
  catch(error){if(buildFor(ctx)?.id===build.id)ctx.error=error.message;}
  finally{ctx.cancelPending=false;updateState(view);}
}
async function showPreview(view){
  const ctx=view.ctx;if(!ready(ctx))return;const file=ctx.file,build=ctx.draft.source==='github'?buildFor(ctx):null;
  let html;if(build?.status!=='ready'){try{html=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}catch{ctx.error='游戏文件须使用 UTF-8 编码。';updateState(view);return;}}
  if(!visible(view))return;disposePreview();const dialog=document.createElement('dialog');dialog.id='version-preview-dialog';dialog.className='version-preview-dialog';dialog.innerHTML=`<div class="game-tools"><span>${t('新版本预览')}</span><button type="button" class="button quiet small">${t('关闭预览')}</button></div><iframe title="${t('新版本预览')}" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>`;document.body.appendChild(dialog);
  q('button',dialog).addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>dialog.remove(),{once:true});const frame=q('iframe',dialog);if(build?.status==='ready')frame.src='/api/builds/'+encodeURIComponent(build.id)+'/preview';else frame.srcdoc=localPreviewHTML(html);dialog.showModal();q('button',dialog).focus();
}
async function publishVersion(view){
  const ctx=view.ctx,d=ctx.draft;if(ctx.pending||ctx.archived||ctx.importPending||!ready(ctx)||ctx.conflict)return;
  if(!(d.source==='github'&&buildFor(ctx)?.status==='ready')&&htmlFileError(ctx.file)){ctx.error=htmlFileError(ctx.file);updateState(view);return;}
  const form=new FormData();form.set('releaseNotes',d.releaseNotes.trim());form.set('expectedRevision',String(d.expectedRevision));
  const build=d.source==='github'?buildFor(ctx):null;if(build?.status==='ready')form.set('buildId',build.id);else form.set('file',new File([ctx.file],ctx.file.name,{type:'text/html'}));if(ctx.cover)form.set('cover',ctx.cover);
  const key=d.key;d.attempted=true;ctx.pending=true;ctx.error='';save(ctx);updateState(view);
  try{await ctx.fileWrites;const result=await view.h.api('/api/works/'+encodeURIComponent(ctx.id)+'/versions',{method:'POST',headers:{'Idempotency-Key':key},body:form});remove(ctx.storage);await Promise.all([fileOp(ctx,'delete','game'),fileOp(ctx,'delete','cover')]);contexts.delete(ctx.storage);ctx.pending=false;complete(view,result);}
  catch(error){ctx.pending=false;ctx.publicationFailure=error;const duplicate=['DUPLICATE_WORK','VERSION_UNCHANGED','VERSION_ALREADY_EXISTS'].includes(error.code);if(error.code==='WORK_ARCHIVED')ctx.archived=true;ctx.error=duplicate||error.code==='WORK_ARCHIVED'?publicationFailureMessage(error):importErrorText(error);if(duplicate){ctx.draft=editVersionDraft(ctx.draft,{},uuid());save(ctx);}if(error.code==='VERSION_CONFLICT'){ctx.conflict=error.current||{revision:null};d.attempted=false;save(ctx);}updateState(view);if(error.status===401&&visible(view))q('#version-error').innerHTML=view.h.esc(t(error.message))+' <a href="'+view.h.esc(view.h.signinURL())+'" target="_top">'+t('重新登录')+'</a>';}
}
async function rebase(view){
  const ctx=view.ctx;if(ctx.pending)return;
  try{const {work}=await view.h.api('/api/works/'+encodeURIComponent(ctx.id));if(!visible(view))return;if(isArchived(work)){ctx.archived=true;ctx.publicationFailure={code:'WORK_ARCHIVED'};ctx.error=publicationFailureMessage(ctx.publicationFailure);updateState(view);return;}ctx.archived=false;ctx.work=work;ctx.draft=rebaseVersionDraft(ctx.draft,work,uuid());ctx.conflict=null;ctx.error='';save(ctx);updateState(view);}
  catch(error){ctx.error=error.message;updateState(view);}
}
async function mountUpdate(view,work){
  const {h}=view,ctx=view.ctx=await context(h,work.id,work);if(!visible(view))return;const d=ctx.draft,e=h.esc;
  h.render(`<div class="page narrow version-page"><a class="back" href="#${historyPath(work.id)}">← ${t('版本历史')}</a><div class="page-head"><div><h1>${e(t('更新 {name}',{name:work.name}))}</h1><p id="version-baseline"></p></div></div><form id="version-update-form" class="form"><fieldset class="field source-picker"><legend>${t('新版本文件')}</legend><div class="segmented">${[['html','本地 HTML'],['github','GitHub']].map(([value,label])=>`<label><input type="radio" name="source" value="${value}" ${d.source===value?'checked':''}>${t(label)}</label>`).join('')}</div></fieldset><div id="version-import-availability" class="import-availability" aria-live="polite"></div><div class="field" id="version-html-field"><input id="version-file" aria-label="${t('新版本 HTML 文件')}" type="file" accept=".html,.htm,text/html"><small>${t(HTML_UPLOAD_HINT)}</small><p id="version-file-name" class="file-selected"></p></div><div class="field" id="version-github-field"><div class="github-input"><input id="version-github-url" name="githubURL" type="url" aria-label="${t('GitHub 链接')}" placeholder="https://github.com/owner/repository" value="${e(d.githubURL)}"><button class="button" id="version-import" type="button">${t('导入并构建')}</button></div><p id="version-source-status" role="status"></p><section id="version-build-panel" class="build-panel" hidden><progress id="version-build-progress" max="5" aria-label="${t('构建进度')}"></progress><button id="version-build-cancel" type="button" class="button quiet small">${t('取消构建')}</button><details class="build-details"><summary>${t('构建记录')}</summary><p id="version-build-source"></p><pre id="version-build-logs"></pre></details></section></div><div class="field"><label for="version-notes">${t('更新说明')}</label><textarea id="version-notes" name="releaseNotes" maxlength="1000" required>${e(d.releaseNotes)}</textarea></div><details class="version-options"><summary>${t('封面')}</summary><div class="cover-picker"><input id="version-cover" type="file" accept="image/png,image/jpeg,image/webp" aria-label="${t('替换封面')}"><span id="version-cover-name"></span><button type="button" class="button quiet small" id="version-cover-reset">${t('沿用当前封面')}</button></div></details><section class="version-conflict" id="version-conflict" hidden><p>${t('线上版本已变化，你选择的文件和说明已保留。')}</p><button type="button" class="button small" id="version-rebase">${t('按当前版本继续')}</button></section><p id="version-error" class="error" role="alert"></p><div id="version-recovery" class="publication-recovery" hidden></div><div class="form-footer"><button id="version-submit" class="button primary" type="submit">${t('发布新版本')}</button><details class="version-secondary"><summary>${t('更多')}</summary><button id="version-preview" class="button quiet" type="button">${t('预览试玩')}</button><a class="button quiet" href="#${historyPath(work.id)}">${t('保存草稿并返回')}</a></details></div></form></div>`);
  const form=q('#version-update-form');form.addEventListener('input',event=>{const field=event.target.name;if(!['source','githubURL','releaseNotes'].includes(field)||ctx.pending)return;if(field!=='releaseNotes'){ctx.importRevision++;ctx.importPending=false;view.pollRevision++;clearTimeout(view.timer);}ctx.draft=editVersionDraft(ctx.draft,{[field]:event.target.value},uuid());ctx.error='';save(ctx);updateState(view);if(field==='source'){pollBuild(view);if(event.target.value==='github')view.availability?.refresh();}});
  q('#version-file').addEventListener('change',async event=>{const file=event.target.files[0];if(!file||ctx.pending)return;const error=htmlFileError(file);if(error){ctx.error=error;event.target.value='';updateState(view);return;}ctx.file=file;ctx.draft.githubImport=null;invalidate(ctx);updateState(view);await fileOp(ctx,'put','game',file);});
  q('#version-cover').addEventListener('change',async event=>{const file=event.target.files[0];if(!file||ctx.pending)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2097152){ctx.error='请选择不超过 2 MB 的 PNG、JPG 或 WebP 图片。';event.target.value='';updateState(view);return;}ctx.cover=file;invalidate(ctx);updateState(view);await fileOp(ctx,'put','cover',file);});
  q('#version-cover-reset').addEventListener('click',async()=>{ctx.cover=null;invalidate(ctx);updateState(view);await fileOp(ctx,'delete','cover');});
  q('#version-import-availability').addEventListener('click',event=>{
    if(event.target.closest('[data-import-check]'))view.availability?.refresh();
    if(event.target.closest('[data-import-local]')&&!ctx.pending&&!ctx.importPending){const input=q('input[name="source"][value="html"]',form);input.checked=true;input.dispatchEvent(new Event('input',{bubbles:true}));q('#version-file').focus();}
  });
  q('#version-import').addEventListener('click',()=>importBuild(view));q('#version-build-cancel').addEventListener('click',()=>cancelBuild(view));q('#version-preview').addEventListener('click',()=>showPreview(view));q('#version-rebase').addEventListener('click',()=>rebase(view));form.addEventListener('submit',event=>{event.preventDefault();publishVersion(view);});updateState(view);pollBuild(view);
}

async function activateVersion(view,attempt){
  if(view.activating)return;view.activating=true;write(view.ctx.storage+':activate',attempt);const dialog=q('#version-activate-dialog'),button=q('#activate-confirm');if(button){button.disabled=true;button.textContent=t('正在切换…');}
  try{const result=await view.h.api('/api/works/'+encodeURIComponent(view.ctx.id)+'/activate',{method:'POST',headers:{'Idempotency-Key':attempt.key},body:{versionId:attempt.versionId,expectedRevision:attempt.expectedRevision}});remove(view.ctx.storage+':activate');if(dialog?.isConnected)dialog.close();complete(view,result);}
  catch(error){if(!visible(view))return;const message=q('#activate-error')||q('#version-error');if(message){message.textContent=t(error.message);if(error.status===401)message.innerHTML=view.h.esc(t(error.message))+' <a href="'+view.h.esc(view.h.signinURL())+'" target="_top">'+t('重新登录')+'</a>';}
    if(error.code==='WORK_ARCHIVED'){remove(view.ctx.storage+':activate');if(message)message.textContent=t('这件作品已归档，请先恢复再继续。');if(button){button.textContent=t('前往归档恢复');button.disabled=false;button.onclick=()=>{q('#version-activate-dialog')?.close();view.h.go(archivedWorkPath(view.ctx.id));};}}
    else if(error.code==='VERSION_CONFLICT'){remove(view.ctx.storage+':activate');if(button){button.textContent=t('查看当前版本');button.disabled=false;button.onclick=()=>{q('#version-activate-dialog')?.close();view.h.go(historyPath(view.ctx.id));};}}
    else if(button){button.disabled=false;button.textContent=t('重试切换');}
  }finally{view.activating=false;}
}
function confirmActivate(view,version){
  if(view.activating)return;
  if(isArchived(view.data?.work)){view.h.notify(t('这件作品已归档，请先恢复再继续。'));return;}
  const {h,ctx}=view,old=q('#version-activate-dialog');if(old)old.remove();const previous=read(ctx.storage+':activate'),attempt=previous?.versionId===version.id?previous:{key:uuid(),versionId:version.id,expectedRevision:view.data.revision,fromLabel:view.data.work.version,toLabel:version.version};
  const dialog=document.createElement('dialog');dialog.id='version-activate-dialog';dialog.className='share-dialog';dialog.innerHTML=`<h2>${h.esc(attempt.fromLabel)} → ${h.esc(attempt.toLabel)}</h2><p>${h.esc(t('将普通作品链接切换到 {version}。',{version:attempt.toLabel}))}</p><p id="activate-error" class="error" role="alert"></p><div class="form-footer"><button id="activate-confirm" class="button primary" type="button">${h.esc(t('切换到 {version}',{version:attempt.toLabel}))}</button><button id="activate-back" class="button quiet" type="button">${t('返回')}</button></div>`;document.body.appendChild(dialog);q('#activate-confirm').onclick=()=>activateVersion(view,attempt);q('#activate-back').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();q('#activate-back').focus();
}
async function mountHistory(view,data){
  const {h}=view,e=h.esc;view.data=data;view.ctx={id:data.work.id,owner:h.owner,storage:storeKey(h.owner,data.work.id)};let versions=data.versions,cursor=data.nextCursor,loading=false;const flash=flashes.get(view.ctx.storage);flashes.delete(view.ctx.storage);
  h.render(`<div class="page narrow version-page"><a class="back" href="#/studio/works">← ${t('我的作品')}</a><div class="page-head"><div><h1>${e(data.work.name)}</h1><p>${t('版本历史')}</p></div>${isArchived(data.work)?`<a class="button" href="#${archivedWorkPath(data.work.id)}">${t('前往归档恢复')}</a>`:`<a class="button primary" href="#${updatePath(data.work.id)}">${t('更新版本')}</a>`}</div>${flash?`<p class="version-notice" role="status">${e(flash)}</p>`:''}<p class="version-current">${t('当前线上')} <strong>${e(data.work.version)}</strong></p>${data.work.discovery?`<p class="version-feed-status"><a class="text-link" href="#${discoveryPath(data.work.id)}">${e(t(discoveryState(data.work).label))} · ${t('展示设置')}</a></p>`:''}<div id="version-list"></div><p id="version-error" class="error" role="alert"></p><button id="versions-more" class="comments-more" ${cursor?'':'hidden'}>${t('查看更多')}</button></div>`);
  const draw=()=>{if(!visible(view))return;q('#version-list').innerHTML=versions.map(v=>`<article class="version-row"><div class="version-row-main"><div class="version-row-heading"><a href="#${historyPath(data.work.id)}/${encodeURIComponent(v.id)}">${e(v.version)}</a>${v.id===data.currentVersionId?`<span class="version-current-label">${t('当前')}</span>`:''}<time>${e(new Date(v.createdAt).toLocaleString(getLocale(),{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}))}</time></div><p>${e(v.releaseNotes||t('首次发布'))}</p><span class="tiny muted">${v.build?'GitHub · '+e(v.build.commitSha?.slice(0,7)||''):'HTML'}</span></div><details class="version-row-more"><summary>${t('更多')}</summary><a href="#${historyPath(data.work.id)}/${encodeURIComponent(v.id)}">${e(t('试玩 {version}',{version:v.version}))}</a>${v.id!==data.currentVersionId&&!isArchived(data.work)?`<button type="button" data-activate="${e(v.id)}">${t('切换到此版本')}</button>`:''}</details></article>`).join('');q('#versions-more').hidden=!cursor;};draw();
  q('#version-list').addEventListener('click',event=>{const button=event.target.closest('[data-activate]');if(button){const version=versions.find(v=>v.id===button.dataset.activate);if(version)confirmActivate(view,version);}});
  q('#versions-more').addEventListener('click',async()=>{if(loading||!cursor)return;loading=true;q('#versions-more').disabled=true;try{const result=await h.api('/api/works/'+encodeURIComponent(data.work.id)+'/versions?cursor='+encodeURIComponent(cursor));if(!visible(view))return;const ids=new Set(versions.map(v=>v.id));versions.push(...result.versions.filter(v=>!ids.has(v.id)));cursor=result.nextCursor;draw();}catch(error){drawError(view,error.message);}finally{loading=false;if(visible(view))q('#versions-more').disabled=false;}});
  const uncertain=read(view.ctx.storage+':activate');if(uncertain&&!isArchived(data.work)){const error=q('#version-error');error.textContent=t('上次切换的结果尚未确认。');const button=document.createElement('button');button.className='button small';button.textContent=t('确认切换结果');button.onclick=()=>confirmActivate(view,{id:uncertain.versionId,version:uncertain.toLabel});error.after(button);}
}
async function mountHistorical(view,data){
  const {h}=view,work=versionWork(data.work,data.version),e=h.esc,path=historyPath(work.id);view.ctx={id:work.id,owner:h.owner,storage:storeKey(h.owner,work.id)};view.data={...data,revision:data.current.revision,work:data.work};
  h.render(`<div class="page narrow version-page"><a class="back" href="#${path}">← ${t('版本历史')}</a><div class="page-head"><div><h1>${e(work.name)} · ${e(work.version)}</h1><p>${t(work.versionId===data.current.versionId?'当前线上版本':'历史版本')}</p></div></div><div id="play-area" class="work-media" data-built-project="${Boolean(work.build)}"><div class="detail-cover">${h.workImage(work)}</div></div><p class="version-release-notes">${e(data.version.releaseNotes||t('首次发布'))}</p><div class="form-footer"><button class="button primary" data-action="start-game">${e(t('试玩 {version}',{version:work.version}))}</button>${work.versionId!==data.current.versionId&&!isArchived(data.work)?`<details class="version-secondary"><summary>${t('更多')}</summary><button class="button quiet" id="historical-activate">${t('切换到此版本')}</button></details>`:''}</div><p id="version-error" class="error" role="alert"></p></div>`);
  q('[data-action="start-game"]').addEventListener('click',()=>h.startGame(work));q('#historical-activate')?.addEventListener('click',()=>confirmActivate(view,data.version));
}
export async function renderVersioning(route,h){
  const match=/^\/studio\/works\/([^/]+)\/(update|versions)(?:\/([^/]+))?$/.exec(route.path);if(!match)return false;
  const view={h,disposed:false,timer:null,pollRevision:0};active=view;const id=decodeURIComponent(match[1]);
  if(match[2]==='update'){view.availability=createBuildAvailability(h.api,()=>{if(view.ctx)updateState(view);});view.availability.refresh();const {work}=await h.api('/api/works/'+encodeURIComponent(id));if(!visible(view))return true;if(work.authorId!==h.owner)throw new Error(t('只能更新自己的作品。'));if(isArchived(work)){view.availability?.dispose();h.render(archiveGuardMarkup(work,h));return true;}if(work.source!=='html')throw new Error(t('外链作品暂不支持版本更新。'));await mountUpdate(view,work);}
  else{const data=await h.api('/api/works/'+encodeURIComponent(id)+'/versions'+(match[3]?'/'+encodeURIComponent(decodeURIComponent(match[3])):''));if(!visible(view))return true;if(match[3])await mountHistorical(view,data);else await mountHistory(view,data);}
  return true;
}
