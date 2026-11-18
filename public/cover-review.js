import {t,registerMessages} from './i18n.js';
registerMessages({
 '候选封面':'Suggested cover','封面可不上传，发布后会自动截图，确认满意后再使用。':'A cover is optional. Review an automatic screenshot after publishing.',
 '正在检查截图…':'Checking screenshot…','正在等待开屏完成并截图…':'Waiting for the page introduction and capturing…',
 '截图正在排队，可以稍后回到编辑页确认。':'Screenshot queued. You can return to the editor to review it.',
 '这张封面怎么样？':'How does this cover look?','确认后才会替换作品封面。':'Your cover changes only after you confirm.',
 '使用这张':'Use this cover','再等几秒截图':'Wait longer and retake','重新截图':'Retake screenshot','上传其他封面':'Upload another cover',
 '自动生成封面':'Generate cover','封面已更新':'Cover updated','自动截图失败，可以重试或上传封面。':'Capture failed. Try again or upload a cover.',
 '作品信息已变化，请重新截图或上传封面。':'Your work changed. Retake the screenshot or upload a cover.',
 '自动截图暂不可用，可以上传封面。':'Automatic capture is unavailable. You can upload a cover.',
 '本版本截图次数已用完，可以上传封面。':'This version has used its captures. You can upload a cover.',
 '截图额度暂时用完，请稍后刷新或上传封面。':'Capture limit reached. Check later or upload a cover.',
 '刷新截图状态':'Refresh screenshot status','候选封面预览':'Suggested website cover',
 '仍在处理，可稍后刷新查看。':'Still processing. Check again later.',
 '先保存或撤销当前修改，再选择截图。':'Save or discard your edits before choosing a screenshot.',
});
const known=new Set(['none','queued','running','candidate','accepted','failed','stale','skipped','unavailable']);
export function createCoverReviewController({api,work,onChange=()=>{},onAccepted=()=>{},blocked=()=>false,timers=globalThis,pollDelay=4000,maxPolls=45}){
 let state={status:'checking'},disposed=false,busy=false,timer,abort,deadline,polls=0;
 const path='/api/works/'+encodeURIComponent(work.id)+'/cover-review';
 const update=next=>{state={...state,...next};if(!disposed)onChange(state);};
 async function request(action,waitMs){
  if(disposed||busy||action&&blocked())return false;busy=true;timers.clearTimeout(timer);abort=new AbortController();update({pending:true,error:'',paused:false});
  const signal=abort.signal;let rejectAbort;
  const cancelled=new Promise((_,reject)=>{rejectAbort=()=>reject(new Error('Cancelled'));signal.addEventListener('abort',rejectAbort,{once:true});});
  deadline=timers.setTimeout(()=>abort.abort(),15000);
  try{
   const result=await Promise.race([cancelled,api(path,{signal,...(action?{method:'POST',body:{action,versionId:work.versionId,expectedRevision:state.revision??work.revision,candidateId:state.candidateId||null,...(waitMs?{waitMs}:{})}}:{})})]);
   if(disposed)return;
   if(!known.has(result?.status)||result.workId!==work.id||result.versionId!==work.versionId)throw new Error('Invalid screenshot status');
   update({...result,candidateUrl:result.candidateUrl||'',pending:false});
   if(action==='accept'&&result.status==='accepted')await onAccepted(result);
  }catch(error){if(!disposed)update({pending:false,status:error.code==='COVER_CONFLICT'?'stale':'unknown',error:error.message||''});}
  finally{
   timers.clearTimeout(deadline);signal.removeEventListener('abort',rejectAbort);busy=false;
   if(!disposed&&['queued','running'].includes(state.status)&&!['DAILY_BUDGET','MONTHLY_BUDGET'].includes(state.reason)){
    if(polls++<maxPolls)timer=timers.setTimeout(()=>request(),pollDelay);else update({paused:true});
   }
  }
 }
 return {get state(){return state;},refresh(){polls=0;return request();},act(action,waitMs){if(!['generate','retake','accept'].includes(action))return false;polls=0;return request(action,waitMs);},dispose(){disposed=true;timers.clearTimeout(timer);timers.clearTimeout(deadline);abort?.abort();}};
}
const escape=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function mountCoverReview(root,{work,owner,api,onAccepted,blocked=()=>false,onUpload}){
 if(!root||!['url','html'].includes(work.source)||work.authorId!==owner||work.archivedAt)return {dispose(){},render(){}};
 let controller;
 const render=()=>{
  const state=controller?.state||{status:'checking'},locked=state.pending||blocked(),button=(action,label,primary=false,wait)=>`<button type="button" class="button ${primary?'primary':'quiet'} small" data-external-cover="${action}" ${wait?`data-wait="${wait}"`:''} ${locked?'disabled':''}>${t(label)}</button>`;
  let message='正在检查截图…',actions='',candidate='';
  if(state.status==='candidate'){
   const expected='/api/works/'+encodeURIComponent(work.id)+'/cover-review/image/';
   if(state.candidateUrl?.startsWith(expected)&&/^[\w-]+$/.test(state.candidateUrl.slice(expected.length)))candidate=`<img class="external-cover-image" src="${escape(state.candidateUrl)}" alt="${t('候选封面预览')}" width="1200" height="750">`;
   message='这张封面怎么样？';actions=button('accept','使用这张',true);
  }else if(state.status==='queued'||state.status==='running')message=state.paused?'仍在处理，可稍后刷新查看。':state.status==='queued'?'截图正在排队，可以稍后回到编辑页确认。':'正在等待开屏完成并截图…';
  else if(state.status==='accepted')message='封面已更新';
  else if(state.status==='none'){message='确认后才会替换作品封面。';actions=button('generate','自动生成封面');}
  else if(state.status==='stale')message='作品信息已变化，请重新截图或上传封面。';
  else if(state.status==='failed')message='自动截图失败，可以重试或上传封面。';
  else if(state.status!=='checking')message='自动截图暂不可用，可以上传封面。';
  if(['DAILY_BUDGET','MONTHLY_BUDGET'].includes(state.reason))message='截图额度暂时用完，请稍后刷新或上传封面。';
  if(['candidate','accepted','failed','stale'].includes(state.status)&&state.retryable)actions+=button('retake','重新截图')+button('retake','再等几秒截图',false,10000);
  if(['unknown','queued','running','unavailable'].includes(state.status))actions+=button('refresh','刷新截图状态');
  const manual=onUpload?button('upload','上传其他封面'):`<a class="text-link" href="#/studio/works/${encodeURIComponent(work.id)}/edit">${t('上传其他封面')}</a>`;
  root.className='external-cover';root.innerHTML=`<div class="external-cover-heading"><strong>${t('候选封面')}</strong><span role="status" aria-live="polite">${t(message)}</span></div>${candidate}${candidate?`<p class="muted">${t('确认后才会替换作品封面。')}</p>`:''}<div class="external-cover-actions">${actions}${manual}</div>${blocked()?`<small>${t('先保存或撤销当前修改，再选择截图。')}</small>`:state.retryable===false&&state.attempts>=3?`<small>${t('本版本截图次数已用完，可以上传封面。')}</small>`:''}`;
 };
 controller=createCoverReviewController({api,work,onChange:render,onAccepted,blocked});
 const click=event=>{const button=event.target.closest('[data-external-cover]');if(!button||button.disabled)return;const action=button.dataset.externalCover;if(action==='upload')onUpload?.();else if(action==='refresh')controller.refresh();else controller.act(action,Number(button.dataset.wait)||undefined);};
 root.addEventListener('click',click);render();controller.refresh();return {render,dispose(){controller.dispose();root.removeEventListener('click',click);}};
}
