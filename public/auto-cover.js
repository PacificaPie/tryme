import {t,registerMessages} from './i18n.js';

registerMessages({
  '封面可不上传，发布后自动截取游戏开屏。PNG、JPG 或 WebP，最大 2 MiB。':'A cover is optional. We capture the opening screen after publishing. PNG, JPG or WebP, up to 2 MiB.',
  '正在检查自动封面…':'Checking automatic cover…','生成开屏封面':'Capture opening screen',
  '封面正在排队，不影响试玩。':'Cover capture is queued. Your game is ready to play.',
  '正在截取游戏开屏，不影响试玩。':'Capturing the opening screen. Your game is ready to play.',
  '自动封面已生成':'Automatic cover is ready',
  '开屏截图失败，也可以手动上传封面。':'The opening screen could not be captured. You can upload a cover instead.',
  '自动截图暂不可用，可以手动上传封面。':'Automatic capture is unavailable. You can upload a cover instead.',
  '本次未生成封面，可以手动上传。':'No cover was generated. You can upload one instead.',
  '尚未确认封面状态，请刷新查看。':'The cover status could not be confirmed. Refresh to check.',
  '重新截图':'Retry capture','刷新封面状态':'Refresh cover status',
  '仍在处理，可稍后刷新查看。':'Still processing. Refresh again in a moment.',
  '自动截图已达到使用上限，可稍后刷新或手动上传封面。':'Automatic capture has reached its usage limit. Check again later or upload a cover.',
});

const statuses=new Set(['none','queued','running','ready','failed','skipped','unavailable']);
const waitingForBudget=state=>state.status==='queued'&&['DAILY_BUDGET','MONTHLY_BUDGET'].includes(state.reason);
export function adoptAutoCoverDraft(draft, previousWork, latest, status, key) {
  if(draft.attempted||latest.name!==draft.base.name||latest.desc!==draft.base.desc||latest.versionId!==previousWork.versionId||latest.revision!==status.revision)return null;
  return {...draft,key,expectedRevision:latest.revision,base:{...draft.base,coverUrl:latest.coverUrl||''}};
}
export function autoCoverView(state={}) {
  if(waitingForBudget(state))return {message:'自动截图已达到使用上限，可稍后刷新或手动上传封面。',action:'refresh',label:'刷新封面状态'};
  if(state.status==='none')return {message:'',action:'generate',label:'生成开屏封面'};
  if(state.status==='queued'||state.status==='running')return {message:state.paused?'仍在处理，可稍后刷新查看。':state.status==='queued'?'封面正在排队，不影响试玩。':'正在截取游戏开屏，不影响试玩。',...(state.paused?{action:'refresh',label:'刷新封面状态'}:{})};
  if(state.status==='ready')return {message:'自动封面已生成'};
  if(state.status==='failed'||state.status==='unavailable')return {message:state.status==='failed'?'开屏截图失败，也可以手动上传封面。':'自动截图暂不可用，可以手动上传封面。',...(state.retryable?{action:'retry',label:'重新截图'}:{})};
  if(state.status==='skipped')return {message:'本次未生成封面，可以手动上传。',...(state.retryable?{action:'retry',label:'重新截图'}:{})};
  if(state.status==='checking')return {message:'正在检查自动封面…'};
  return {message:'尚未确认封面状态，请刷新查看。',action:'refresh',label:'刷新封面状态'};
}

export function createAutoCoverController({api,work,onChange=()=>{},onReady=()=>{},canGenerate=()=>true,timers=globalThis,pollDelay=4000,maxPolls=45,requestTimeout=15000}) {
  let state={status:'checking',pending:false},disposed=false,pending=null,abort=null,timer,deadlineTimer,polls=0,readyKey='',requestNumber=0;
  const path='/api/works/'+encodeURIComponent(work.id)+'/auto-cover';
  const update=next=>{state={...state,...next};if(!disposed)onChange(state);};
  const schedule=()=>{
    timers.clearTimeout(timer);
    if(!disposed&&!waitingForBudget(state)&&['queued','running'].includes(state.status)){
      if(polls++<maxPolls)timer=timers.setTimeout(()=>request(),pollDelay);
      else update({paused:true});
    }
  };
  async function request(action) {
    if(disposed||pending)return pending;
    if(action&&!canGenerate())return false;
    timers.clearTimeout(timer);abort=new AbortController();update({pending:true,paused:false});
    const controller=abort,number=++requestNumber,current=()=>!disposed&&number===requestNumber&&!controller.signal.aborted;
    let rejectAbort;
    const cancelled=new Promise((_,reject)=>{rejectAbort=()=>reject(new Error('Cover request cancelled'));controller.signal.addEventListener('abort',rejectAbort,{once:true});});
    const deadline=timers.setTimeout(()=>controller.abort(),requestTimeout);deadlineTimer=deadline;
    const operation=(async()=>{
      try{
        await Promise.race([cancelled,(async()=>{
          await Promise.resolve();if(!current())return;
          const result=await api(path,{signal:controller.signal,...(action?{method:'POST',body:{action,versionId:work.versionId}}:{})});
          if(!current())return;
          if(!statuses.has(result?.status)||result.workId!==work.id)throw new Error('Invalid cover state');
          update({...result,reason:result.reason||null,pending:false,paused:false});
          if(result.status==='ready'){
            const key=String(result.metadataId||result.coverUrl||'')+':'+result.revision;
            if(key!==readyKey){await onReady(result,{signal:controller.signal});if(current())readyKey=key;}
          }
        })()]);
      }catch{
        if(!disposed&&number===requestNumber)update({status:'unknown',pending:false,retryable:false});
      }finally{
        timers.clearTimeout(deadline);controller.signal.removeEventListener('abort',rejectAbort);
        if(number===requestNumber){pending=null;deadlineTimer=null;if(!disposed)schedule();}
      }
    })();
    pending=operation;return operation;
  }
  return {
    get state(){return state;},
    refresh(){polls=0;return request();},
    generate(action='generate'){
      if(!['generate','retry'].includes(action)||state.pending)return Promise.resolve(false);
      const allowed=action==='generate'?state.status==='none':['failed','unavailable','skipped'].includes(state.status)&&state.retryable;
      if(!allowed)return Promise.resolve(false);polls=0;return request(action);
    },
    dispose(){disposed=true;requestNumber++;timers.clearTimeout(timer);timers.clearTimeout(deadlineTimer);abort?.abort();pending=null;},
  };
}

export function mountAutoCover(root,{work,owner,api,onReady,blocked=()=>false}) {
  if(!root||work.authorId!==owner||work.source!=='html'||work.coverUrl)return {dispose(){},render(){}};
  let controller;
  const render=()=>{
    const state=controller?.state||{status:'checking'},view=autoCoverView(state);
    root.className='auto-cover';root.dataset.state=state.status;
    root.innerHTML=`${view.message?`<span role="status" aria-live="polite">${t(view.message)}</span>`:''}${view.action?`<button type="button" class="button quiet small" data-auto-cover="${view.action}" ${state.pending||blocked()?'disabled':''}>${t(view.label)}</button>`:''}`;
  };
  controller=createAutoCoverController({api,work,onReady,canGenerate:()=>!blocked(),onChange:render});
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-auto-cover]');if(!button||button.disabled)return;
    if(button.dataset.autoCover==='refresh')controller.refresh();else controller.generate(button.dataset.autoCover);
  });
  render();controller.refresh();return {dispose:()=>controller.dispose(),render};
}
