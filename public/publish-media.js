import {t,registerMessages} from './i18n.js';
registerMessages({
 '发布前预览':'Preview before publishing','导入后自动准备截图和视频，只有你能看到。':'Screenshots and video are prepared privately after import.',
 '正在准备私有草稿…':'Preparing your private draft…','正在准备预览…':'Preparing preview…','预览未完成，可以重试或明确跳过。':'Preview did not finish. Retry or explicitly skip it.',
 '使用这张封面':'Use this cover','使用这段视频':'Use this video','不使用视频':'Continue without video','先不设置封面':'Continue without a cover',
 '已选择':'Selected','已跳过':'Skipped','已选择手动封面':'Manual cover selected','重试':'Retry','重新截图':'Retake screenshot','再等几秒截图':'Wait longer and retake',
 '重新录制':'Record again','封面':'Cover','视频预览':'Video preview','外链目前仅支持截图。':'External websites currently support screenshots only.',
 '请先确认封面和视频，或明确选择跳过。':'Choose your cover and video, or explicitly skip them.',
 '预览仅自己可见，确认并发布后才会进入 Feed。':'Only you can see this preview. It enters Feed after you confirm and publish.',
 '私有草稿已失效，请重新准备。':'Your private draft expired. Prepare it again.',
 '自动预览次数已用完，可以跳过预览继续发布，或稍后再试。':'Preview attempts are used up. Skip the preview to publish, or try again later.',
 '自动预览暂不可用，可以跳过预览继续发布。':'Automatic previews are unavailable. Skip the preview to publish.',
});

export function publishMediaFailure(reason){
 if(reason==='CAPTURE_LIMIT')return '自动预览次数已用完，可以跳过预览继续发布，或稍后再试。';
 if(reason==='BROWSER_UNAVAILABLE')return '自动预览暂不可用，可以跳过预览继续发布。';
 return '预览未完成，可以重试或明确跳过。';
}

const fingerprints=new WeakMap();
export async function publishSourceKey(input){
 if(input.source==='url'){try{const u=new URL(input.url);return ['https:','http:'].includes(u.protocol)?'url:'+u.href:'';}catch{return '';}}
 if(input.buildId)return 'build:'+input.buildId;
 if(!input.file)return '';
 if(!fingerprints.has(input.file))fingerprints.set(input.file,input.file.arrayBuffer().then(b=>crypto.subtle.digest('SHA-256',b)).then(b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('')));
 return input.source+':'+await fingerprints.get(input.file);
}
export function sourceForm(input){const form=new FormData();form.set('source',input.source==='url'?'url':'html');if(input.source==='url')form.set('url',input.url.trim());else if(input.buildId)form.set('buildId',input.buildId);else if(input.file)form.set('file',input.file.type==='text/html'?input.file:new File([input.file],input.file.name,{type:'text/html'}));return form;}

// The persisted request IDs survive refresh and lost responses. A new File is
// hashed before it can inherit any previous choices, even if its name/size match.
export function createPublishMediaController({api,saved,onChange=()=>{},onPersist=()=>{},timers=globalThis,uuid=()=>crypto.randomUUID(),debounceMs=900}){
 let state={status:'empty',key:'',id:'',coverChoice:'',videoChoice:''},input={},generation=0,disposed=false,identity='',fileRef,manual=false,expiryTimer;
 const waits=new Map(),requests=new Set();
 const current=g=>!disposed&&g===generation;
 function emit(){if(!disposed){onPersist({...state});onChange(state);}}
 function stop(){generation++;timers.clearTimeout(expiryTimer);for(const [id,resolve] of waits){timers.clearTimeout(id);resolve();}waits.clear();for(const c of requests)c.abort();requests.clear();}
 function delay(ms){return new Promise(resolve=>{const id=timers.setTimeout(()=>{waits.delete(id);resolve();},ms);waits.set(id,resolve);});}
 async function request(path,options={}){const c=new AbortController();requests.add(c);const id=timers.setTimeout(()=>c.abort(),40000);try{return await api(path,{...options,signal:c.signal});}finally{timers.clearTimeout(id);requests.delete(c);}}
 function accept(kind,result){if(result&&result.kind!==kind)throw Error('Invalid capture');if(result?.status==='ready'&&result.url!==`/api/publish-drafts/${state.id}/media/${result.id}`)throw Error('Invalid media URL');state[kind]=result;}
 async function capture(kind,g,{retake=false,waitMs=5000}={}){
  if(!current(g)||state[kind+'Choice']==='skip'||kind==='video'&&input.source==='url')return;
  if(state[kind]?.status==='ready'&&!retake)return;
  const started=Date.now();
  let attempt=retake?null:state[kind+'Attempt'];
  if(!attempt){attempt={id:uuid(),waitMs};state[kind+'Attempt']=attempt;}
  for(let n=0;n<24&&current(g)&&Date.now()-started<70000;n++){
   if(state[kind+'Choice']==='skip')return;
   state[kind]={...state[kind],status:'running'};emit();
   try{
    const result=await request(`/api/publish-drafts/${state.id}/capture`,{method:'POST',body:{id:attempt.id,kind,waitMs:attempt.waitMs}});
    if(!current(g))return;accept(kind,result);emit();if(result.status!=='running')return;
   }catch(error){if(!current(g))return;if(!['CAPTURE_BUSY'].includes(error.code)&&error.status){state[kind]={status:'failed',reason:['CAPTURE_LIMIT','BROWSER_UNAVAILABLE'].includes(error.code)?error.code:'CAPTURE_FAILED'};emit();return;}}
   await delay(2000);
  }
  if(current(g)){state[kind]={status:'failed'};emit();}
 }
 async function prepare(g,restore){
  await delay(debounceMs);if(!current(g))return;
  state.status='preparing';emit();
  try{
   const form=sourceForm(input);form.set('id',state.id);
   // Replay creation with the same ID: it is safe if the first response was lost.
   let result;for(let n=0;n<2;n++){try{result=await request('/api/publish-drafts',{method:'POST',body:form});break;}catch(e){if(!current(g))return;if(e.status||n)throw e;}}
   if(!current(g))return;if(result.id!==state.id)throw Error('Invalid draft');
   state.status='ready';state.expiresAt=result.expiresAt;
   timers.clearTimeout(expiryTimer);expiryTimer=timers.setTimeout(()=>{if(current(g)){state.status='expired';emit();}},Math.max(0,Date.parse(result.expiresAt)-Date.now()));
   for(const kind of ['cover','video']){accept(kind,result[kind]);if(state[kind+'Choice']==='candidate'&&state[kind]?.id!==state[kind+'CaptureId'])state[kind+'Choice']='';}
   if(manual)state.coverChoice='manual';emit();
   await capture('cover',g);await capture('video',g);
  }catch(error){if(current(g)){state.status=error.code==='DRAFT_EXPIRED'?'expired':'failed';emit();}}
 }
 return {
  get state(){return state;},
  get canPublish(){return state.status==='ready'&&Date.parse(state.expiresAt)>Date.now()&&['candidate','manual','skip'].includes(state.coverChoice)&&['candidate','skip'].includes(state.videoChoice);},
  get choices(){return {draftId:state.id,...Object.fromEntries(['coverChoice','coverCaptureId','videoChoice','videoCaptureId'].map(k=>[k,state[k]||'']))};},
  sync(next){
   const ident=JSON.stringify([next.source,next.url||'',next.buildId||'']);if(ident===identity&&next.file===fileRef)return;
   // Reselecting a file creates a new File object even when its bytes have not
   // changed. Keep the resumable draft until its content fingerprint is known.
   // A different fingerprint still revokes every prior candidate and choice.
   const previous=state.key?{...state}:null;
   identity=ident;fileRef=next.file;input=next;stop();const g=generation;
   state={status:'preparing',key:'',id:'',coverChoice:manual?'manual':'',videoChoice:''};emit();
   void publishSourceKey(next).then(key=>{if(!current(g))return;if(!key){state.status='empty';emit();return;}
    const restore=previous?.key===key?previous:saved?.key===key?saved:null;saved=null;state={...state,...restore,key,id:restore?.id||uuid(),status:'preparing'};emit();void prepare(g,restore);
   }).catch(()=>{if(current(g)){state.status='failed';emit();}});
  },
  manual(value){manual=value;state.coverChoice=value?'manual':'';emit();},
  choose(kind,choice){if(choice==='candidate'&&state[kind]?.status!=='ready')return;state[kind+'Choice']=choice;state[kind+'CaptureId']=choice==='candidate'?state[kind].id:'';emit();},
  retry(kind,waitMs=5000){if(state.status!=='ready'){stop();if(state.status==='expired')state.id=uuid();void prepare(generation);return;}state[kind+'Choice']='';void capture(kind,generation,{retake:true,waitMs});},
  dispose(){disposed=true;stop();},
 };
}

export function mountPublishMedia(root,{api,saved,onPersist,onChange,onChoice=()=>{}}){
 let controller;const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function render(){
  const s=controller?.state||{status:'empty'},button=(action,label,disabled=false)=>`<button type="button" class="button quiet small" data-media-action="${action}" ${disabled?'disabled':''}>${t(label)}</button>`;
  const panel=kind=>{const c=s[kind],choice=s[kind+'Choice'],busy=c?.status==='running';return `<section class="publish-media-panel"><h3>${t(kind==='cover'?'封面':'视频预览')}</h3><p role="status">${t(choice==='manual'?'已选择手动封面':choice==='skip'?'已跳过':choice==='candidate'?'已选择':busy?'正在准备预览…':c?.status==='ready'?'':c?.status==='failed'?publishMediaFailure(c.reason):'正在准备预览…')}</p>${c?.status==='ready'?(kind==='cover'?`<img class="external-cover-image" src="${esc(c.url)}" alt="${t('封面')}" width="1200" height="750">`:`<video class="external-cover-image" src="${esc(c.url)}" controls muted playsinline preload="metadata"></video>`):''}<div class="external-cover-actions">${c?.status==='ready'?button(kind+':candidate',kind==='cover'?'使用这张封面':'使用这段视频'):''}${button(kind+':skip',kind==='cover'?'先不设置封面':'不使用视频')}${button(kind+':retry',kind==='cover'?'重新截图':'重新录制',busy)}${kind==='cover'?button('cover:later','再等几秒截图',busy):''}</div></section>`;};
  root.innerHTML=`<div class="external-cover-heading"><strong>${t('发布前预览')}</strong><span>${t('预览仅自己可见，确认并发布后才会进入 Feed。')}</span></div>${s.status==='ready'?panel('cover')+(s.key.startsWith('url:')?`<p>${t('外链目前仅支持截图。')}</p><div class="external-cover-actions">${button('video:skip',s.videoChoice==='skip'?'已跳过':'不使用视频')}</div>`:panel('video')):`<p role="status">${t(s.status==='failed'?'预览未完成，可以重试或明确跳过。':s.status==='expired'?'私有草稿已失效，请重新准备。':s.status==='empty'?'导入后自动准备截图和视频，只有你能看到。':'正在准备私有草稿…')}</p>${['failed','expired'].includes(s.status)?button('cover:retry','重试'):''}`}`;
  onChange?.();
 }
 controller=createPublishMediaController({api,saved,onPersist,onChange:render});
 const click=e=>{const b=e.target.closest('[data-media-action]');if(!b||b.disabled)return;const [kind,action]=b.dataset.mediaAction.split(':');if(['retry','later'].includes(action))controller.retry(kind,action==='later'?10000:5000);else{onChoice(kind,action);controller.choose(kind,action);}};
 root.addEventListener('click',click);render();return {...Object.fromEntries(['sync','manual','choose','retry'].map(k=>[k,controller[k]])),get state(){return controller.state;},get canPublish(){return controller.canPublish;},get choices(){return controller.choices;},dispose(){controller.dispose();root.removeEventListener('click',click);}};
}
