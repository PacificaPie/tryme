import {t,registerMessages} from './i18n.js';
registerMessages({
 '发布前选好封面':'Choose your cover before publishing','输入网址后自动截图，可继续填写作品信息。':'Capture starts after you enter a URL. Keep filling in your work details.',
 '正在加载网站并等待开屏完成…':'Loading the website and waiting for its introduction…','正在等待截图位置…':'Waiting for a capture slot…',
 '这张封面怎么样？':'How does this cover look?','使用这张封面':'Use this cover','已选用，发布时会一起保存。':'Selected. Your cover will be saved with your work.',
 '重新截图':'Retake screenshot','再等几秒截图':'Wait longer and retake','先不设置封面':'Continue without a cover','你已选择暂不设置封面。':'You chose to continue without a cover.',
 '截图未完成，可以重试或上传自己的封面。':'Capture did not complete. Retry or upload your own cover.',
 '正在保存封面…':'Saving cover…','请先选择封面，或选择先不设置封面。':'Choose a cover or continue without one.',
 '自动截图需要公开 HTTPS 网址，也可以自行上传封面。':'Automatic capture needs a public HTTPS URL. You can also upload a cover.',
 '发布前候选封面':'Cover preview before publishing','截图次数暂时用完，可以上传封面或稍后重试':'Capture limit reached. Upload a cover or try later.',
});
export function captureURL(value){try{const u=new URL(value.trim());return u.protocol==='https:'&&u.hostname.includes('.')&&!u.username&&!u.password?u.href:'';}catch{return '';}}
export function createCoverDraftController({api,onChange=()=>{},onPersist=()=>{},timers=globalThis,uuid=()=>crypto.randomUUID(),saved=null,debounceMs=1400}){
 let state={status:'empty',url:'',id:''},generation=0,timer,disposed=false,skipped=false,hadCover=false;
 const update=next=>{state={...state,...next};if(!disposed){onPersist({id:state.id,url:state.url,status:state.status});onChange(state);}};
 const schedule=(fn,ms)=>{timers.clearTimeout(timer);timer=timers.setTimeout(fn,ms);};
 async function run(token,waitMs=5000,read=false,tries=0){
  if(disposed||token!==generation)return;
  const {id,url}=state;update({status:'running',error:''});const abort=new AbortController(),deadline=timers.setTimeout(()=>abort.abort(),45000);
  try{
   const result=await api(read?'/api/cover-drafts/'+id:'/api/cover-drafts',{signal:abort.signal,...read?{}:{method:'POST',body:{id,url,waitMs}}});
   if(disposed||token!==generation)return;
   if(result.id!==id||result.url!==url||!['running','candidate','failed'].includes(result.status))throw new Error('Invalid cover draft');
   if(result.status==='candidate'&&result.imageUrl!=='/api/cover-drafts/'+id+'/image')throw new Error('Invalid cover image');
   update({...result,error:''});
   if(result.status==='running'){if(tries<25)schedule(()=>run(token,waitMs,true,tries+1),2000);else update({status:'failed'});}
  }catch(error){
   if(disposed||token!==generation)return;
   if(error.code==='CAPTURE_BUSY'&&tries<12){update({status:'waiting'});schedule(()=>run(token,waitMs,false,tries+1),2000);}
   else update({status:'failed',error:error.code==='CAPTURE_LIMIT'?error.message:''});
  }finally{timers.clearTimeout(deadline);}
 }
 return {
  get state(){return state;},get canPublish(){return skipped||['selected','empty'].includes(state.status);},
  setURL(value,{manual=false,selected=false}={}){
   const url=captureURL(value),hasCover=manual||selected,coverChanged=hasCover!==hadCover;hadCover=hasCover;
   if(state.url===url){if(hasCover&&coverChanged){skipped=true;if(state.status!=='selected'){generation++;timers.clearTimeout(timer);update({status:'selected'});}}return;}
   generation++;timers.clearTimeout(timer);skipped=manual||selected;state={status:url?'waiting':'empty',url,id:uuid(),imageUrl:'',error:''};
   if(!url){update({});return;}if(skipped){update({status:'selected'});return;}
   const token=generation;
   if(saved?.url===url&&saved.id){state.id=saved.id;if(saved.status==='skipped'){skipped=true;update({status:'skipped'});}else{update({status:'running'});schedule(()=>run(token,5000,true),0);}saved=null;return;}
   update({});schedule(()=>run(token),debounceMs);
  },
  retake(waitMs=5000){if(!state.url||disposed)return;generation++;skipped=false;update({id:uuid(),imageUrl:'',status:'running'});void run(generation,waitMs);},
  skip(){generation++;timers.clearTimeout(timer);skipped=true;update({status:'skipped'});},
  select(){generation++;timers.clearTimeout(timer);skipped=true;update({status:'selected'});},
  dispose(){disposed=true;generation++;timers.clearTimeout(timer);},
 };
}
export function mountCoverDraft(root,{api,saved,onPersist,onChange,fetchImage,onSelect}){
 let controller,selecting=false;
 const render=()=>{
  const s=controller?.state||{status:'empty'},button=(action,label,primary=false)=>`<button type="button" class="button ${primary?'primary':'quiet'} small" data-draft-action="${action}" ${selecting?'disabled':''}>${t(label)}</button>`;
  const labels={empty:'输入网址后自动截图，可继续填写作品信息。',waiting:'正在等待截图位置…',running:'正在加载网站并等待开屏完成…',candidate:'这张封面怎么样？',selected:'已选用，发布时会一起保存。',skipped:'你已选择暂不设置封面。',failed:'截图未完成，可以重试或上传自己的封面。'};
  root.dataset.state=s.status;
  root.innerHTML=`<div class="external-cover-heading"><strong>${t('发布前选好封面')}</strong><span role="status" aria-live="polite">${t(selecting?'正在保存封面…':s.error||labels[s.status])}</span></div>${s.status==='candidate'?`<img class="external-cover-image" src="${s.imageUrl}" alt="${t('发布前候选封面')}" width="1200" height="750">`:''}<div class="external-cover-actions">${s.status==='candidate'?button('select','使用这张封面',true):''}${['candidate','failed','skipped','selected'].includes(s.status)?button('retake','重新截图')+button('later','再等几秒截图'):''}${!['selected','skipped','empty'].includes(s.status)?button('skip','先不设置封面'):''}</div>`;
  onChange?.(s);
 };
 controller=createCoverDraftController({api,saved,onPersist,onChange:render});
 const click=async event=>{
  const b=event.target.closest('[data-draft-action]');if(!b||b.disabled)return;
  const action=b.dataset.draftAction;
  if(action==='skip')controller.skip();else if(action==='retake'||action==='later')controller.retake(action==='later'?10000:5000);
  else if(action==='select'){
   const original=controller.state;selecting=true;render();
   try{const blob=await fetchImage(original.imageUrl);if(controller.state!==original||!root.isConnected)return;await onSelect(new File([blob],'website-cover.jpg',{type:'image/jpeg'}),original.url);if(controller.state.url===original.url&&controller.state.id===original.id)controller.select();}
   catch{if(root.isConnected)root.querySelector('[role="status"]').textContent=t('截图未完成，可以重试或上传自己的封面。');}
   finally{selecting=false;if(root.isConnected)render();}
  }
 };
 root.addEventListener('click',click);render();return {get canPublish(){return !selecting&&controller.canPublish;},sync:controller.setURL,skip:controller.skip,dispose(){controller.dispose();root.removeEventListener('click',click);}};
}
