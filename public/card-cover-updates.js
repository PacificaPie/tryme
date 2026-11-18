import {t,registerMessages} from './i18n.js';

registerMessages({
  '更新名片封面':'Update card covers','预览封面更新':'Preview cover updates',
  '只更新选中的封面，作品版本、名称和介绍保持不变。保存后生成新版名片，原名片链接仍可访问。':'Only selected covers change. Work versions, titles and descriptions stay the same. Saving creates a new card; the original link still works.',
  '当前名片封面':'Saved cover','作品的新封面':'New work cover','暂无封面':'No cover',
  '封面已是最新':'Covers are up to date','作品有新封面后，可以在这里预览并更新名片。':'When your works have new covers, preview and update them here.',
  '保存为新版名片':'Save as a new card','正在保存…':'Saving…','返回我的名片':'Back to my card',
  '请选择需要更新的封面。':'Choose at least one cover to update.',
  '保存结果尚未确认，请重试。':'The save is not confirmed. Please retry.',
  '当前名片已变化，请返回我的名片后重试。':'Your current card has changed. Return to your card and try again.',
  '名片包含已归档作品，请先恢复作品再更新封面。':'Restore the archived works in this card before updating covers.',
  '更新后的名片已删除，请重新选择。':'The updated card was deleted. Please start again.',
  '所选封面不可用，请重新预览。':'The selected cover is unavailable. Please preview again.',
  '所选封面没有变化。':'The selected cover has not changed.',
  '封面选择已变化，请重新预览后保存。':'Your cover selection changed. Preview it again before saving.',
});

export async function renderCardCoverUpdates(id,h) {
  const path='/api/cards/'+encodeURIComponent(id)+'/cover-updates';
  const back=`<a class="button quiet" href="#/cards">${t('返回我的名片')}</a>`;
  let data;
  try {data=await h.api(path,{signal:AbortSignal.timeout(20000)});}
  catch(error){
    if(!h.isCurrent())return;
    if(![404,409].includes(error.status))throw error;
    h.render(`<div class="page narrow card-cover-updates"><h1>${t('更新名片封面')}</h1><p class="error" role="alert">${h.esc(t(error.message))}</p>${back}</div>`);return;
  }
  if(!h.isCurrent())return;
  const {card,updates}=data;
  if(card?.id!==id||card.authorId!==h.owner||!Array.isArray(updates))throw Error(t('保存结果尚未确认，请重试。'));
  const image=(url,label)=>h.safeCover(url)?`<img src="${h.esc(h.safeCover(url))}" alt="${h.esc(t(label))}">`:`<span>${t('暂无封面')}</span>`;
  if(!h.render(`<div class="page narrow card-cover-updates"><h1>${t('预览封面更新')}</h1><p class="card-cover-explanation">${t('只更新选中的封面，作品版本、名称和介绍保持不变。保存后生成新版名片，原名片链接仍可访问。')}</p>${updates.length?`<form id="card-cover-form"><div class="card-cover-list">${updates.map((u,i)=>`<label class="card-cover-choice"><span class="card-cover-choice-title"><input type="checkbox" name="cover" value="${i}" checked> ${h.esc(u.name)}</span><span class="card-cover-comparison"><span><span class="card-cover-image">${image(u.previousCoverUrl,'当前名片封面')}</span><small>${t('当前名片封面')}</small></span><span><span class="card-cover-image">${image(u.coverUrl,'作品的新封面')}</span><small>${t('作品的新封面')}</small></span></span></label>`).join('')}</div><p id="card-cover-error" role="alert" class="error"></p><div class="form-footer">${back}<button class="button primary" type="submit">${t('保存为新版名片')}</button></div></form>`:`<h2>${t('封面已是最新')}</h2><p>${t('作品有新封面后，可以在这里预览并更新名片。')}</p>${back}`}</div>`))return;
  if(!updates.length)return;
  const form=h.root.querySelector('#card-cover-form'),button=form.querySelector('button[type=submit]'),error=form.querySelector('#card-cover-error');
  const inputs=[...form.querySelectorAll('input[name=cover]')];let pending=false,key=crypto.randomUUID();
  const selected=()=>inputs.filter(input=>input.checked).map(input=>{const u=updates[Number(input.value)];return {workId:u.workId,metadataId:u.metadataId};});
  form.addEventListener('change',()=>{if(!h.isCurrent()||pending)return;key=crypto.randomUUID();error.textContent='';button.disabled=!selected().length;});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(pending||!h.isCurrent())return;
    const chosen=selected();if(!chosen.length){error.textContent=t('请选择需要更新的封面。');return;}
    pending=true;button.disabled=true;button.textContent=t('正在保存…');inputs.forEach(input=>input.disabled=true);error.textContent='';
    try {
      const result=await h.api(path,{method:'POST',headers:{'Idempotency-Key':key},body:{updates:chosen},signal:AbortSignal.timeout(30000)});
      if(!h.isCurrent())return;
      if(!result.card?.id||result.card.id===id||result.card.authorId!==h.owner)throw Error(t('保存结果尚未确认，请重试。'));
      h.onSaved(result.card);
    }catch(e){if(h.isCurrent())error.textContent=t(e.message||'保存结果尚未确认，请重试。');}
    finally {pending=false;if(h.isCurrent()){button.disabled=!selected().length;button.textContent=t('保存为新版名片');inputs.forEach(input=>input.disabled=false);}}
  });
}
