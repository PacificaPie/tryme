import {t,registerMessages} from './i18n.js';
registerMessages({
 '上传步骤':'Publishing steps','选择作品':'Choose work','填写介绍':'Add details','确认媒体':'Choose cover','预览结果':'Preview result',
 '选择作品的来源':'Choose where your work lives','上传文件、导入仓库，或填写已经上线的网址。':'Upload a file, import a repository, or enter a live website URL.',
 '介绍你的作品':'Introduce your work','让大家一眼知道这是什么、有什么值得体验。':'Help people understand what it is and why they should try it.',
 '准备好第一眼的样子':'Choose the first impression','确认封面和视频后发布，也可以上传自己的图片或明确跳过。':'Choose your cover and video before publishing, or upload an image or explicitly skip.',
 '上一步':'Back','下一步':'Next','确认并发布':'Confirm and publish','预览正在准备':'Preparing your preview',
 '截图正在后台处理，你可以先填写介绍。':'Your cover is being captured while you add the details.',
 '候选封面已准备好，下一步确认。':'Your suggested cover is ready to review in the next step.',
 '封面已选好。':'Your cover is selected.','先填写介绍，随后选择封面。':'Add the details, then choose your cover.',
 '发布后在这里查看自动截图和 8 秒视频预览，不会自动跳回 Feed。':'After publishing, review the automatic cover and 8-second video here. You will stay on this page.',
 '作品已发布，已保存你确认的封面和视频选择。':'Your work is published with the cover and video choices you confirmed.',
 '作品已发布，可以在这里完善封面。':'Your work is published. Finish choosing its cover here.',
 '作品已发布，可以在这里确认自动封面、查看视频。':'Your work is published. Review its cover and video here.',
 '外链封面已保存，可以查看作品的展示效果。':'Your website cover is saved. Review how your work appears.',
 '完成，去看 Feed':'Done, view Feed','请先选择作品文件。':'Choose your work file first.','请先完成仓库导入。':'Finish importing the repository first.',
 '请填写完整的作品网址。':'Enter a complete work URL.','请填写作品名称。':'Enter a work name.','请填写一句介绍。':'Add a short description.','请选择作品类型。':'Choose a work type.',
});
export function publishStepIssue(step,{source,file,ready,url,name,desc,category}){
 if(step===0){
  if(source==='html'&&!file)return {field:'game-file',message:'请先选择作品文件。'};
  if(source==='github'&&!ready)return {field:'github-url',message:'请先完成仓库导入。'};
  if(source==='url'){try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol)||!u.hostname)throw Error();if(u.hostname==='github.com')return {field:'publish-url',message:'这是 GitHub 仓库页面，请选择 GitHub 导入，或填写部署后的 GitHub Pages 地址。'};}catch{return {field:'publish-url',message:'请填写完整的作品网址。'};}}
 }
 if(step===1){if(!name?.trim())return {field:'publish-name',message:'请填写作品名称。'};if(!desc?.trim())return {field:'publish-desc',message:'请填写一句介绍。'};if(!['website','game','other'].includes(category))return {field:'publish-category',message:'请选择作品类型。'};}
 return null;
}
const labels=['选择作品','填写介绍','确认媒体','预览结果'];
export function publishProgress(current){return `<nav class="publish-progress" aria-label="${t('上传步骤')}">${labels.map((label,i)=>`<span class="${i===current?'current':i<current?'complete':''}" ${i===current?'aria-current="step"':''}><b>${i<current?'✓':i+1}</b><span>${t(label)}</span></span>`).join('')}</nav>`;}
export function mountPublishWizard(form,{getState,onStep,onError,initialStep=0}){
 let step=Math.max(0,Math.min(2,Number(initialStep)||0)),disposed=false;
 form.noValidate=true;form.classList.add('publish-wizard');
 const progress=document.createElement('div');progress.innerHTML=publishProgress(step);form.prepend(progress);
 const stage=document.createElement('div');stage.className='publish-stage';progress.after(stage);
 const panels=Array.from({length:3},(_,i)=>{const p=document.createElement('section');p.className='publish-panel';p.dataset.step=i;p.setAttribute('aria-label',t(labels[i]));stage.append(p);return p;});
 const field=id=>form.querySelector('#'+id)?.closest('.field');
 const move=(i,nodes)=>nodes.filter(Boolean).forEach(node=>panels[i].append(node));
 move(0,[form.querySelector('.source-picker'),form.querySelector('#publish-import-availability'),field('game-file'),field('github-url'),field('publish-url'),form.querySelector('#publish-size-notice'),form.querySelector('#publish-related'),form.querySelector('.sample-links:not(#publish-related)')]);
 move(1,[field('publish-name'),field('publish-desc'),field('publish-category')]);
 move(2,[form.querySelector('#publish-cover-draft'),field('cover-file')]);
 const titles=['选择作品的来源','介绍你的作品','准备好第一眼的样子'],subtitles=['上传文件、导入仓库，或填写已经上线的网址。','让大家一眼知道这是什么、有什么值得体验。','确认封面和视频后发布，也可以上传自己的图片或明确跳过。'];
 panels.forEach((p,i)=>{const intro=document.createElement('header');intro.className='publish-step-intro';intro.innerHTML=`<h2 tabindex="-1">${t(titles[i])}</h2><p>${t(subtitles[i])}</p>`;p.prepend(intro);});
 const status=document.createElement('div');status.className='publish-background-status';status.setAttribute('role','status');panels[1].append(status);
 const videoNote=document.createElement('p');videoNote.className='publish-video-note';videoNote.textContent=t('预览仅自己可见，确认并发布后才会进入 Feed。');panels[2].append(videoNote);
 const footer=form.querySelector('.form-footer'),submit=form.querySelector('[type="submit"]');
 const back=document.createElement('button');back.type='button';back.className='button quiet';back.textContent=t('上一步');
 const next=document.createElement('button');next.type='button';next.className='button primary';next.textContent=t('下一步');footer.prepend(back);submit.before(next);
 function validate(index){const issue=publishStepIssue(index,getState());if(issue){onError(issue.message);form.querySelector('#'+issue.field)?.focus();return false;}return true;}
 function show(nextStep,focus=true){
  const direction=nextStep<step?-1:1;step=nextStep;progress.innerHTML=publishProgress(step);panels.forEach((p,i)=>p.hidden=i!==step);
  const panel=panels[step];if(focus&&!matchMedia('(prefers-reduced-motion: reduce)').matches)panel.animate([{opacity:0,transform:`translateX(${direction*24}px)`},{opacity:1,transform:'translateX(0)'}],{duration:220,easing:'cubic-bezier(.2,.7,.2,1)'});
  back.hidden=step===0;next.hidden=step===2;submit.hidden=step!==2;onStep(step);refresh();if(focus){panel.querySelector('h2').focus({preventScroll:true});form.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
 }
 function advance(){if(getState().pending||!validate(step))return;onError('');show(Math.min(2,step+1));}
 const previous=()=>{if(!getState().pending){onError('');show(Math.max(0,step-1));}};
 const enter=event=>{if(step<2){event.preventDefault();event.stopImmediatePropagation();advance();}else{for(const index of [0,1])if(publishStepIssue(index,getState())){event.preventDefault();event.stopImmediatePropagation();show(index);validate(index);break;}}};
 function refresh(){if(disposed)return;const state=getState();back.disabled=next.disabled=Boolean(state.pending);videoNote.hidden=state.source==='url';submit.textContent=t(state.pending?'正在发布…':'确认并发布');status.dataset.loading=['waiting','running'].includes(state.captureStatus)?'true':'false';status.textContent=t(state.cover?'封面已选好。':state.captureStatus==='ready'?'候选封面已准备好，下一步确认。':['waiting','running'].includes(state.captureStatus)?'截图正在后台处理，你可以先填写介绍。':'先填写介绍，随后选择封面。');}
 back.addEventListener('click',previous);next.addEventListener('click',advance);form.addEventListener('submit',enter,true);
 // A saved later step is only restored if its earlier requirements still hold.
 for(let i=0;i<step;i++)if(publishStepIssue(i,getState())){step=i;break;}
 show(step,false);
 return {refresh,dispose(){disposed=true;back.removeEventListener('click',previous);next.removeEventListener('click',advance);form.removeEventListener('submit',enter,true);}};
}
