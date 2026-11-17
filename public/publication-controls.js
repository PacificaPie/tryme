import {t} from './i18n.js';
import './publication.messages.js';

const q=(selector,root=document)=>root.querySelector(selector);
const kinds=[['game','网页游戏'],['interactive_story','互动叙事'],['prototype','可玩原型']];
let pending=0;
export const hasPendingPublicationControl=()=>pending>0;
export const discoveryPath=id=>'/studio/works/'+encodeURIComponent(id)+'/discovery';
export function discoveryState(work){
  const d=work.discovery||{},approved=d.reviewStatus==='approved'&&d.approvedVersionId===work.versionId;
  const listed=d.visibility==='listed';
  return {approved,listed,canHide:listed,canRestore:!listed&&approved,
    label:d.reviewStatus==='pending'?(listed?'待收录':'待收录 · 已隐藏'):d.reviewStatus==='rejected'?'暂未收录':approved?(listed?'已进入 Feed':'已从 Feed 隐藏'):'未进入 Feed'};
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
function ruleDetails(){return `<details class="discovery-rules"><summary>${t('收录规则')}</summary><ul><li>${t('收录网页游戏、互动叙事和可玩原型；允许未完成，也不要求分数或输赢。')}</li><li>${t('作品能正常打开，玩家可以操作，并得到游戏或叙事反馈。')}</li><li>${t('普通工具、静态作品集、广告页和重复发布不进入 Feed。')}</li><li>${t('请注明使用的原作与素材来源，并确保你有权发布。')}</li></ul><p>${t('提交后人工确认；上传成功不代表已收录或已认证原创。')}</p></details>`;}
function controls(work){
  const state=discoveryState(work);
  if(state.canHide)return `<button class="button quiet" type="button" data-visibility="hide">${t('从 Feed 隐藏')}</button>`;
  if(state.canRestore)return `<button class="button primary" type="button" data-visibility="restore">${t('恢复到 Feed')}</button>`;
  return '';
}
export function disposePublicationControls(){q('#visibility-dialog')?.remove();}
export function changeVisibility(work,action,h){
  disposePublicationControls();const dialog=document.createElement('dialog');dialog.id='visibility-dialog';dialog.className='share-dialog';
  const label=action==='hide'?'从 Feed 隐藏':'恢复到 Feed';
  dialog.innerHTML=`<h2>${h.esc(t(label))}</h2><p class="share-item-title">${h.esc(work.name)}</p><p>${t(action==='hide'?'作品将退出 Feed、搜索和作者作品列表。原链接、名片与历史数据保留；持有链接的人仍可访问。':'已收录的当前版本将重新出现在 Feed、搜索和作者作品列表。')}</p><p class="error" role="alert"></p><div class="form-footer"><button class="button primary" data-confirm>${t(label)}</button><button class="button quiet" data-back>${t('返回')}</button></div>`;
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
  if(work.authorId!==h.owner)throw Object.assign(Error('只能管理自己的作品收录'),{status:403});
  const d=work.discovery||{},state=discoveryState(work),e=h.esc;
  const hasForm=!state.approved;
  h.render(`<div class="page narrow discovery-settings"><a class="back" href="#/studio/works">${t('← 我的作品')}</a><div class="page-head"><div><h1>${e(work.name)}</h1>${statusText(work,e)}</div><a class="button quiet small" href="#/work/${encodeURIComponent(id)}?from=${encodeURIComponent(discoveryPath(id))}">${t('试玩作品')}</a></div><p class="discovery-scope">${t('链接和名片始终可访问；收录决定作品是否进入 Feed。')}</p>${d.reviewNote?`<p class="discovery-review-note">${e(d.reviewNote)}</p>`:''}${hasForm?`<form id="discovery-form" class="form"><div class="field"><label for="discovery-kind">${t('作品类型')}</label><select id="discovery-kind" name="kind" required><option value="">${t('选择类型')}</option>${kinds.map(([value,label])=>`<option value="${value}" ${d.kind===value?'selected':''}>${t(label)}</option>`).join('')}</select></div><div class="field"><label for="discovery-play">${t('玩家做什么，会发生什么？')}</label><textarea id="discovery-play" name="playDescription" maxlength="500" required>${e(d.playDescription||'')}</textarea></div>${ruleDetails()}<label class="discovery-confirm"><input type="checkbox" name="rulesAccepted" required><span>${t('我已试玩，作品符合收录规则，且我有权发布。')}</span></label><p id="discovery-error" class="error" role="alert"></p><div class="form-footer"><button class="button primary" type="submit">${t(d.reviewStatus==='pending'?'更新收录申请':'申请进入 Feed')}</button>${controls(work)}</div></form>`:`${ruleDetails()}<div class="form-footer">${controls(work)}</div>`}</div>`);
  q('[data-visibility]')?.addEventListener('click',event=>changeVisibility(work,event.currentTarget.dataset.visibility,h));
  const form=q('#discovery-form');if(!form)return;
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!form.reportValidity())return;
    const button=q('[type=submit]',form);if(button.disabled)return;const data=new FormData(form);
    form.querySelectorAll('input,select,textarea,button').forEach(node=>node.disabled=true);button.textContent=t('正在提交…');q('#discovery-error').textContent='';pending++;
    try{await h.api('/api/works/'+encodeURIComponent(id)+'/discovery',{method:'PATCH',body:{action:'submit',expectedRevision:d.revision,kind:data.get('kind'),playDescription:String(data.get('playDescription')||'').trim(),rulesAccepted:data.get('rulesAccepted')==='on'}});h.onChanged();h.notify(t('已提交，等待收录'));if(h.isCurrent())h.go('/studio/works');}
    catch(error){if(h.isCurrent()){q('#discovery-error').textContent=t(error.message);if(error.code==='DISCOVERY_CONFLICT'){const refresh=document.createElement('button');refresh.type='button';refresh.className='button quiet small';refresh.textContent=t('刷新状态');refresh.onclick=h.reload;q('#discovery-error').after(refresh);}}}
    finally{pending--;if(form.isConnected){form.querySelectorAll('input,select,textarea,button').forEach(node=>node.disabled=false);button.textContent=t(d.reviewStatus==='pending'?'更新收录申请':'申请进入 Feed');}}
  });
}
export async function renderReviewQueue(_route,h){
  if(!h.canReview)throw Object.assign(Error('仅收录管理员可访问'),{status:403});
  const {works}=await h.api('/api/review/works?status=pending');if(!h.isCurrent())return;
  const e=h.esc;
  h.render(h.studio(`<div class="page-head"><div><h1>${t('收录管理')}</h1><p>${t('{count} 件待确认',{count:works.length})}</p></div></div>${ruleDetails()}<div id="review-queue">${works.length?works.map(work=>{const d=work.discovery;return `<article class="review-row" data-review-id="${e(work.id)}"><header><div><h2>${e(work.name)}</h2><p>${e(work.authorName)} · ${e(work.version)} · ${t(kinds.find(([value])=>value===d.kind)?.[1]||'未填写作品类型')}</p></div><a class="button small" data-review-preview href="#/work/${encodeURIComponent(work.id)}?play=1&from=${encodeURIComponent('/studio/review')}" target="_blank" rel="noopener">${t('打开试玩 ↗')}</a></header><p class="review-play-description">${e(d.playDescription||t('作者尚未补充玩法说明'))}</p>${d.visibility==='unlisted'?`<p class="tiny muted">${t('作者已隐藏；通过收录后仍保持隐藏。')}</p>`:''}<label class="discovery-confirm"><input type="checkbox" data-review-checked><span>${t('已试玩当前版本，符合收录规则')}</span></label><p class="error" role="alert"></p><div class="review-actions"><button class="button primary small" data-review-decision="approve" disabled>${t('收录到 Feed')}</button><details><summary>${t('暂不收录')}</summary><label class="review-note-label" for="review-note-${e(work.id)}">${t('修改建议')}</label><textarea id="review-note-${e(work.id)}" data-review-note maxlength="500" placeholder="${t('告诉作者需要修改什么')}" rows="2"></textarea><button class="button quiet small" data-review-decision="reject">${t('发送修改建议')}</button></details></div></article>`;}).join(''):`<div class="review-empty"><p>${t('没有待收录作品')}</p><a class="text-link" href="#/studio/works">${t('我的作品')}</a></div>`}</div>`,'review'));
  for(const row of q('#review-queue').querySelectorAll('[data-review-id]')){
    const work=works.find(item=>item.id===row.dataset.reviewId),readyForReview=kinds.some(([value])=>value===work.discovery.kind)&&Boolean(work.discovery.playDescription?.trim());let opened=false,busy=false;
    const checkbox=q('[data-review-checked]',row),approve=q('[data-review-decision=approve]',row);
    q('[data-review-preview]',row).onclick=()=>{opened=true;approve.disabled=busy||!checkbox.checked||!readyForReview;};
    checkbox.onchange=()=>{approve.disabled=busy||!checkbox.checked||!opened||!readyForReview;if(!readyForReview)q('.error',row).textContent=t('请让作者补充作品类型和玩法说明后再收录。');else if(checkbox.checked&&!opened)q('.error',row).textContent=t('请先打开试玩，再确认收录。');else q('.error',row).textContent='';};
    row.addEventListener('click',async event=>{
      const button=event.target.closest('[data-review-decision]');if(!button||button.disabled||busy)return;
      const decision=button.dataset.reviewDecision,note=q('[data-review-note]',row).value.trim();
      if(decision==='reject'&&!note){q('.error',row).textContent=t('请填写修改建议。');q('[data-review-note]',row).focus();return;}
      if(decision==='approve'&&(!opened||!checkbox.checked||!readyForReview))return;
      busy=true;pending++;row.setAttribute('aria-busy','true');row.querySelectorAll('button,input,textarea').forEach(node=>node.disabled=true);q('.error',row).textContent='';
      try{await h.api('/api/review/works/'+encodeURIComponent(work.id),{method:'POST',body:{decision,expectedRevision:work.discovery.revision,versionId:work.versionId,note}});h.onChanged();h.notify(t(decision==='approve'?'作品已收录':'修改建议已发送'));if(h.isCurrent())h.reload();}
      catch(error){if(row.isConnected){q('.error',row).textContent=t(error.message);if(error.code==='DISCOVERY_CONFLICT'||error.code==='REVIEW_CONFLICT'){const refresh=document.createElement('button');refresh.type='button';refresh.className='button quiet small';refresh.textContent=t('刷新状态');refresh.onclick=h.reload;q('.error',row).after(refresh);}}}
      finally{pending--;busy=false;if(row.isConnected){row.removeAttribute('aria-busy');row.querySelectorAll('button,input,textarea').forEach(node=>node.disabled=false);approve.disabled=!opened||!checkbox.checked||!readyForReview;}}
    });
  }
}
