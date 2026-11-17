import {t} from './i18n.js';
import './publication.messages.js';

const q=(selector,root=document)=>root.querySelector(selector);
let pending=0;
export const hasPendingPublicationControl=()=>pending>0;
export const discoveryPath=id=>'/studio/works/'+encodeURIComponent(id)+'/discovery';
export function discoveryState(work){
  const listed=work.discovery?.visibility==='listed';
  return {listed,canHide:listed,canRestore:!listed,label:listed?'已进入 Feed':'已从 Feed 隐藏'};
}
export function publicationFailureMessage(error){
  if(error?.code==='DUPLICATE_WORK')return '你已上传过这份内容。可打开已有作品，或为它更新版本。';
  if(error?.code==='VERSION_UNCHANGED')return '游戏文件与当前版本相同。修改名称、介绍或封面，请使用编辑作品信息。';
  if(error?.code==='VERSION_ALREADY_EXISTS')return '这份文件已在版本历史中。可查看该版本并切换，无需重复上传。';
  return error?.message||'';
}
export function publicationFailureActions(error,{esc,workId}={}){
  const existing=error?.existingWork;
  if(error?.code==='DUPLICATE_WORK'&&existing?.id){
    const id=encodeURIComponent(existing.id);
    return `<a class="button small" href="#/work/${id}">${esc(t('打开已有作品'))}${existing.name?' · '+esc(existing.name):''}</a>${existing.source==='html'?`<a class="button quiet small" href="#/studio/works/${id}/update">${t('更新版本')}</a>`:''}`;
  }
  if(error?.code==='VERSION_UNCHANGED'&&workId)return `<a class="button small" href="#/studio/works/${encodeURIComponent(workId)}/edit">${t('编辑作品信息')}</a>`;
  if(error?.code==='VERSION_ALREADY_EXISTS'&&workId&&error.existingVersion?.id)return `<a class="button small" href="#/studio/works/${encodeURIComponent(workId)}/versions/${encodeURIComponent(error.existingVersion.id)}">${esc(t('查看历史版本'))}${error.existingVersion.version?' · '+esc(error.existingVersion.version):''}</a>`;
  return '';
}
function statusText(work,esc){return `<span class="discovery-status">${esc(t(discoveryState(work).label))}</span>`;}
function controls(work){
  const state=discoveryState(work);
  if(state.canHide)return `<button class="button primary" type="button" data-visibility="hide">${t('从 Feed 隐藏')}</button>`;
  if(state.canRestore)return `<button class="button primary" type="button" data-visibility="restore">${t('恢复到 Feed')}</button>`;
  return '';
}
export function disposePublicationControls(){q('#visibility-dialog')?.remove();}
export function changeVisibility(work,action,h){
  disposePublicationControls();const dialog=document.createElement('dialog');dialog.id='visibility-dialog';dialog.className='share-dialog';
  const label=action==='hide'?'从 Feed 隐藏':'恢复到 Feed';
  dialog.innerHTML=`<h2>${h.esc(t(label))}</h2><p class="share-item-title">${h.esc(work.name)}</p><p>${t(action==='hide'?'作品将退出 Feed、搜索和作者作品列表。原链接、名片与历史数据保留；持有链接的人仍可访问。':'作品将重新出现在 Feed、搜索和作者作品列表。')}</p><p class="error" role="alert"></p><div class="form-footer"><button class="button primary" data-confirm>${t(label)}</button><button class="button quiet" data-back>${t('返回')}</button></div>`;
  document.body.appendChild(dialog);q('[data-back]',dialog).onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  q('[data-confirm]',dialog).onclick=async()=>{
    const button=q('[data-confirm]',dialog);if(button.disabled)return;button.disabled=true;q('[data-back]',dialog).disabled=true;pending++;
    try{await h.api('/api/works/'+encodeURIComponent(work.id)+'/discovery',{method:'PATCH',body:{action,expectedRevision:work.discovery.revision}});h.onChanged();dialog.close();h.notify(t(action==='hide'?'已从 Feed 隐藏':'已恢复到 Feed'));if(h.isCurrent())h.reload();}
    catch(error){if(dialog.isConnected){q('.error',dialog).textContent=t(error.message);if(error.code==='DISCOVERY_CONFLICT'){button.textContent=t('刷新状态');button.onclick=()=>{dialog.close();if(h.isCurrent())h.reload();};}}}
    finally{pending--;if(dialog.isConnected){button.disabled=false;q('[data-back]',dialog).disabled=false;}}
  };
  dialog.showModal();q('[data-back]',dialog).focus();
}
export async function renderDiscoverySettings(route,h){
  const id=decodeURIComponent(route.path.split('/')[3]),{work}=await h.api('/api/works/'+encodeURIComponent(id));if(!h.isCurrent())return;
  if(work.authorId!==h.owner)throw Object.assign(Error('只能管理自己的作品展示'),{status:403});
  const e=h.esc;
  h.render(`<div class="page narrow discovery-settings"><a class="back" href="#/studio/works">${t('← 我的作品')}</a><div class="page-head"><div><h1>${e(work.name)}</h1>${statusText(work,e)}</div><a class="button quiet small" href="#/work/${encodeURIComponent(id)}?from=${encodeURIComponent(discoveryPath(id))}">${t('试玩作品')}</a></div><p class="discovery-scope">${t('隐藏仅影响 Feed、搜索和作者作品列表；原链接、名片与历史数据保留。')}</p><div class="form-footer">${controls(work)}</div></div>`);
  q('[data-visibility]')?.addEventListener('click',event=>changeVisibility(work,event.currentTarget.dataset.visibility,h));
}
