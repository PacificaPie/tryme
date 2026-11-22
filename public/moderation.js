import {t,registerMessages} from './i18n.js';
registerMessages({
 '内容管理':'Content moderation','此入口仅供获授权的运营账号使用。':'This page is for authorized operators.',
 '作品或名片 ID':'Work or card ID','查询内容':'Look up content','作品':'Work','名片':'Card',
 '处置原因':'Reason','下架内容':'Block content','恢复访问':'Restore access','刷新状态':'Refresh status',
 '正常':'Available','已下架':'Blocked','下架作品会同时暂停包含它的旧名片、旧版本游戏和媒体的访问。恢复不会改写历史快照。':'Blocking a work also blocks cards containing it, historical game versions and media. Restoration preserves snapshots.',
 '请先查询并核对内容 ID，再提交处置。':'Look up and verify the content ID before submitting.',
 '关联名片':'Affected cards','处置记录':'Decision history','没有处置记录。':'No decisions yet.',
 '处置已保存。':'Decision saved.','关联作品仍被下架，名片暂不能恢复访问。':'A selected work is still blocked; this card remains unavailable.',
 '内容状态已变化，请刷新后再处理。':'The content state changed. Refresh before acting.',
 '此账号没有内容管理权限。':'This account has no moderation permission.',
 '内容暂时不可访问。':'This content is currently unavailable.',
});
export async function renderModeration({api,esc,render,current}){
 await api('/api/moderation');if(!current())return;
 render(`<div class="page narrow"><a class="back" href="#/feed">${t('返回发现')}</a><h1>${t('内容管理')}</h1><p>${t('此入口仅供获授权的运营账号使用。')}</p><p>${t('下架作品会同时暂停包含它的旧名片、旧版本游戏和媒体的访问。恢复不会改写历史快照。')}</p><form id="moderation-lookup"><div class="field"><label for="moderation-kind">${t('作品')} / ${t('名片')}</label><select id="moderation-kind"><option value="work">${t('作品')}</option><option value="card">${t('名片')}</option></select></div><div class="field"><label for="moderation-id">${t('作品或名片 ID')}</label><input id="moderation-id" required pattern="[A-Za-z0-9_-]{8,128}" maxlength="128" autocomplete="off"></div><button class="button primary">${t('查询内容')}</button></form><p id="moderation-error" class="error" role="alert"></p><section id="moderation-detail"></section></div>`);
 const lookup=document.querySelector('#moderation-lookup'),root=document.querySelector('#moderation-detail'),error=document.querySelector('#moderation-error');
 let state=null,pending=false,operation=null,serial=0;
 const message=(value,success=false)=>{if(current()){error.className=success?'muted':'error';error.setAttribute('role',success?'status':'alert');error.textContent=t(value||'');}};
 const lock=value=>{pending=value;if(!current())return;lookup.querySelectorAll('input,select,button').forEach(el=>el.disabled=value);root.querySelectorAll('input,textarea,button').forEach(el=>el.disabled=value);};
 const path=()=>`/api/moderation/${state.target.type}/${encodeURIComponent(state.target.id)}`;
 function show(){
  root.innerHTML=`<h2>${esc(state.target.name||state.target.id)}</h2><p><code>${esc(state.target.type)} / ${esc(state.target.id)}</code></p><p>${t(state.blocked?'已下架':'正常')} · ${t('关联名片')}: ${state.affectedCards}</p>${state.inheritedWorkBlocks.length?`<p>${t('关联作品仍被下架，名片暂不能恢复访问。')}</p>`:''}<form id="moderation-action"><div class="field"><label for="moderation-reason">${t('处置原因')}</label><textarea id="moderation-reason" required maxlength="1000"></textarea></div><button class="button primary" type="submit">${t(state.blocked?'恢复访问':'下架内容')}</button> <button class="button quiet" type="button" id="moderation-refresh">${t('刷新状态')}</button></form><h3>${t('处置记录')}</h3>${state.history.length?`<ol>${state.history.map(item=>`<li>${esc(item.created_at)} · ${t(item.action==='block'?'下架内容':'恢复访问')}<p>${esc(item.reason)}</p><small>${esc(item.actor_id)}</small></li>`).join('')}</ol>`:`<p>${t('没有处置记录。')}</p>`}`;
  root.querySelector('#moderation-refresh').addEventListener('click',()=>load(state.target.type,state.target.id));
  root.querySelector('#moderation-action').addEventListener('submit',async event=>{
   event.preventDefault();if(pending||!current())return;
   const reason=root.querySelector('#moderation-reason').value.trim();if(!reason)return;
   const body={action:state.blocked?'restore':'block',reason,expectedRevision:state.revision},url=path(),identity=JSON.stringify({url,body});
   if(operation?.identity!==identity)operation={identity,key:crypto.randomUUID()};
   lock(true);message('');
   try{const result=await api(url,{method:'POST',headers:{'Idempotency-Key':operation.key},body});if(!current())return;state=result;operation=null;show();message('处置已保存。',true);}
   catch(e){message(e.message);if(e.code==='MODERATION_CONFLICT'){operation=null;root.querySelector('[type="submit"]').hidden=true;}}
   finally{lock(false);}
  });
 }
 async function load(kind,id){
  if(pending||!current())return;const generation=++serial;state=null;operation=null;root.innerHTML='';lock(true);message('');
  try{const result=await api(`/api/moderation/${kind}/${encodeURIComponent(id)}`);if(!current()||generation!==serial)return;state=result;show();}
  catch(e){message(e.message);}
  finally{lock(false);}
 }
 lookup.addEventListener('submit',event=>{event.preventDefault();void load(lookup.querySelector('#moderation-kind').value,lookup.querySelector('#moderation-id').value.trim());});
}
