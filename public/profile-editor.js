import { t, registerMessages } from './i18n.js';
import { AVATAR_PRESETS, avatarMarkup, safeAvatarURL } from './avatars.js';
import { closeDialog } from './experience.js?v=20261117-creator-actions';

registerMessages({
  '编辑个人资料':'Edit profile', '头像':'Avatar', '上传图片':'Upload image', '使用首字母':'Use initial',
  '默认插画':'Illustrations', 'PNG、JPG 或 WebP，最大 2 MiB。':'PNG, JPG or WebP, up to 2 MiB.',
  '名字':'Name', '简介':'Bio', '身份 / 角色':'Role', '个人网址':'Website',
  '取消':'Cancel', '保存资料':'Save profile', '正在保存…':'Saving…', '个人资料已更新':'Profile updated',
  '调整头像':'Adjust avatar', '缩放':'Zoom', '左右位置':'Horizontal position', '上下位置':'Vertical position',
  '正在读取图片…':'Reading image…', '请上传 PNG、JPG 或 WebP 图片。':'Choose a PNG, JPG or WebP image.',
  '头像图片不能超过 2 MiB。':'Avatar images must be no larger than 2 MiB.',
  '这张图片无法读取，请换一张。':'This image could not be read. Choose another image.',
  '图片尺寸过大，请换用较小的图片。':'Image dimensions are too large. Choose a smaller image.',
  '裁剪头像预览':'Cropped avatar preview', '请等待图片读取完成。':'Wait for the image to finish loading.',
  '暂时无法生成头像，请换一张图片。':'Could not prepare this avatar. Choose another image.',
  '资料已保存，头像暂未保存。请重试。':'Profile saved, but the avatar was not saved. Please retry.',
  '暂时未能确认保存结果，请重试。':'Saving could not be confirmed. Please retry.',
  '头像会用于主页、Feed 和评论。已保存的名片保持原样。':'Your avatar appears on your profile, Feed and comments. Saved cards keep their original appearance.',
  '移除所选图片':'Remove selected image', '关闭':'Close',
  '请填写名字。':'Enter your name.',
});

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function avatarFileError(file) {
  if (!file || !allowedTypes.has(file.type)) return t('请上传 PNG、JPG 或 WebP 图片。');
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > AVATAR_MAX_BYTES) return t('头像图片不能超过 2 MiB。');
  return '';
}

// Source coordinates, independent of preview/output resolution. Sliders cover
// the entire image at every zoom while keeping the crop inside its bounds.
export function avatarCropRect(width, height, { zoom = 1, x = 50, y = 50 } = {}) {
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) throw new RangeError('Invalid image dimensions');
  const side = Math.min(width, height) / clamp(finite(zoom, 1), 1, 3);
  return { x:(width-side)*clamp(finite(x,50),0,100)/100, y:(height-side)*clamp(finite(y,50),0,100)/100, width:side, height:side };
}

export function profileChangeBody(fields, avatarChoice = { type:'keep' }) {
  const body = Object.fromEntries(['name','bio','headline','website'].map(key => [key, String(fields[key] ?? '').trim()]));
  if (avatarChoice.type === 'preset') {
    if (!AVATAR_PRESETS.some(preset => preset.id === avatarChoice.id)) throw new TypeError('Invalid avatar preset');
    body.avatarPreset = avatarChoice.id;
  } else if (avatarChoice.type === 'initial') body.avatarPreset = null;
  return body;
}

export class ProfileSaveError extends Error {
  constructor(cause, stage, savedUser) {
    super(t(savedUser && stage === 'avatar' ? '资料已保存，头像暂未保存。请重试。' : [400,413,415,422].includes(cause?.status) && cause.message ? cause.message : '暂时未能确认保存结果，请重试。'), { cause });
    this.stage = stage; this.savedUser = savedUser;
  }
}

// Profile fields and uploaded images use different server routes. Publish each
// confirmed result immediately so an avatar failure never rolls back the UI's
// already-saved name/bio or falsely announces that nothing changed.
export async function saveProfileEdits({ user, fields, avatarChoice = {type:'keep'}, avatarBlob = null, api, onConfirmed = () => {} }) {
  let confirmed = null, stage = 'profile';
  const accept = result => {
    if (!result?.user || result.user.id !== user.id || typeof result.user.name !== 'string') throw new Error('Invalid profile response');
    confirmed = { ...user, ...result.user }; onConfirmed(confirmed); return confirmed;
  };
  try {
    if (avatarChoice.type === 'upload' && (!(avatarBlob instanceof Blob) || !avatarBlob.size || avatarBlob.size > AVATAR_MAX_BYTES)) throw new Error('Invalid avatar output');
    accept(await api('/api/me/profile', { method:'POST', body:profileChangeBody(fields,avatarChoice), signal:AbortSignal.timeout(30000) }));
    if (avatarChoice.type === 'upload') {
      stage = 'avatar';
      const form = new FormData(); form.append('avatar', avatarBlob, 'avatar.png');
      accept(await api('/api/me/avatar', { method:'POST', body:form, signal:AbortSignal.timeout(30000) }));
    }
    return confirmed;
  } catch (error) { throw new ProfileSaveError(error, stage, confirmed); }
}

export function openProfileEditor({ user, api, onSaved = () => {}, notify = () => {} }) {
  const existing = document.querySelector('#profile-editor-dialog');
  if (existing) return existing;
  const previous = document.activeElement, dialog = document.createElement('dialog');
  dialog.id = 'profile-editor-dialog'; dialog.className = 'share-dialog profile-editor';
  dialog.setAttribute('aria-labelledby','profile-editor-title');
  dialog.innerHTML = `<form class="profile-editor-form"><header class="profile-editor-head"><h2 id="profile-editor-title">${t('编辑个人资料')}</h2><button type="button" class="share-close" data-cancel aria-label="${t('关闭')}">×</button></header><section class="profile-avatar-section" aria-label="${t('头像')}"><div class="profile-avatar-current">${avatarMarkup(user,{className:'profile-avatar-large'})}</div><div class="profile-avatar-options"><div class="profile-avatar-buttons"><button type="button" class="button small" data-upload>${t('上传图片')}</button><button type="button" class="button quiet small" data-initial>${t('使用首字母')}</button><input id="profile-avatar-file" type="file" accept="image/png,image/jpeg,image/webp" hidden></div><p class="profile-editor-hint">${t('PNG、JPG 或 WebP，最大 2 MiB。')}</p><fieldset class="avatar-presets"><legend>${t('默认插画')}</legend><div>${AVATAR_PRESETS.map(preset=>`<button type="button" class="avatar-preset" data-preset="${preset.id}" aria-label="${t(preset.label)}" aria-pressed="false"><img src="/avatars/${preset.id}.svg" alt=""></button>`).join('')}</div></fieldset></div></section><section class="avatar-crop" aria-label="${t('调整头像')}" hidden><div class="avatar-crop-preview"><canvas width="256" height="256" role="img" aria-label="${t('裁剪头像预览')}"></canvas></div><div class="avatar-crop-controls">${[['zoom','缩放',1,3,.05,1],['x','左右位置',0,100,1,50],['y','上下位置',0,100,1,50]].map(([key,label,min,max,step,value])=>`<label for="avatar-crop-${key}">${t(label)}<input id="avatar-crop-${key}" data-crop="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></label>`).join('')}<button type="button" class="button quiet small" data-crop-remove>${t('移除所选图片')}</button></div></section><p class="profile-image-status" role="status" aria-live="polite"></p><div class="profile-editor-fields"><div class="field"><label for="profile-name">${t('名字')}</label><input id="profile-name" name="name" maxlength="80" required value="${escape(user.name)}" autocomplete="name"></div><div class="field"><label for="profile-headline">${t('身份 / 角色')}</label><input id="profile-headline" name="headline" maxlength="120" value="${escape(user.headline)}"></div><div class="field profile-bio-field"><label for="profile-bio">${t('简介')}</label><textarea id="profile-bio" name="bio" maxlength="500" rows="2">${escape(user.bio)}</textarea></div><div class="field profile-website-field"><label for="profile-website">${t('个人网址')}</label><input id="profile-website" name="website" type="url" maxlength="2000" value="${escape(user.website)}" placeholder="https://" autocomplete="url"></div></div><p class="profile-editor-hint">${t('头像会用于主页、Feed 和评论。已保存的名片保持原样。')}</p><p class="profile-editor-error error" role="alert"></p><footer class="profile-editor-footer"><button type="button" class="button quiet" data-cancel>${t('取消')}</button><button type="submit" class="button primary">${t('保存资料')}</button></footer></form>`;
  const q = selector => dialog.querySelector(selector), form = q('form'), fileInput = q('#profile-avatar-file');
  const submit = q('[type=submit]'), error = q('.profile-editor-error'), imageStatus = q('.profile-image-status');
  const canvas = q('canvas'), context = canvas.getContext('2d'), cropPanel = q('.avatar-crop');
  let currentUser = { ...user }, avatarChoice = { type:'keep' }, crop = { zoom:1,x:50,y:50 };
  let image = null, objectURL = '', reading = false, busy = false, closing = false, disposed = false, imageGeneration = 0;
  const alive = () => !disposed && !closing && dialog.isConnected;
  const releaseImage = () => { imageGeneration++; if (objectURL) URL.revokeObjectURL(objectURL); objectURL = ''; image = null; };
  const selectedAvatarURL = () => avatarChoice.type === 'preset' ? `/avatars/${avatarChoice.id}.svg` : avatarChoice.type === 'initial' ? '' : safeAvatarURL(currentUser.avatarUrl);
  function renderAvatar() {
    q('.profile-avatar-current').innerHTML = avatarMarkup({ name:q('#profile-name').value || currentUser.name, avatarUrl:selectedAvatarURL() },{className:'profile-avatar-large'});
    q('[data-initial]').setAttribute('aria-pressed',String(avatarChoice.type==='initial'));
    dialog.querySelectorAll('[data-preset]').forEach(button=>button.setAttribute('aria-pressed',String(selectedAvatarURL()===`/avatars/${button.dataset.preset}.svg`)));
    cropPanel.hidden = !image || avatarChoice.type !== 'upload';
    q('.profile-avatar-current').hidden = !cropPanel.hidden;
    if (!cropPanel.hidden) drawCrop();
  }
  function drawCrop() {
    if (!image || !context) return;
    const rect = avatarCropRect(image.naturalWidth,image.naturalHeight,crop);
    context.clearRect(0,0,256,256); context.drawImage(image,rect.x,rect.y,rect.width,rect.height,0,0,256,256);
    q('[data-crop=x]').disabled = busy || image.naturalWidth-rect.width < .5;
    q('[data-crop=y]').disabled = busy || image.naturalHeight-rect.height < .5;
    q('[data-crop=zoom]').setAttribute('aria-valuetext',`${Math.round(crop.zoom*100)}%`);
  }
  function setBusy(value) {
    busy = value; form.setAttribute('aria-busy',String(value));
    form.querySelectorAll('input,textarea,button').forEach(control=>control.disabled=value);
    submit.disabled = value || reading;
    submit.textContent = t(value?'正在保存…':'保存资料');
    if (!value) drawCrop();
  }
  function choose(choice) {
    if (busy || closing) return;
    releaseImage(); reading = false; avatarChoice = choice; fileInput.value = '';
    imageStatus.textContent = ''; error.textContent = ''; submit.disabled = false; renderAvatar();
  }
  function dismiss() {
    if (busy || closing) return;
    closing = true; releaseImage(); reading = false;
    closeDialog(dialog);
  }
  dialog.querySelectorAll('[data-cancel]').forEach(button=>button.addEventListener('click',dismiss));
  dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});
  dialog.addEventListener('click',event=>{
    if (event.target !== dialog) return;
    const b=dialog.getBoundingClientRect();
    if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)dismiss();
  });
  dialog.addEventListener('close',()=>{disposed=true;releaseImage();dialog.remove();if(previous?.isConnected)previous.focus({preventScroll:true});},{once:true});
  q('[data-upload]').addEventListener('click',()=>fileInput.click());
  q('[data-initial]').addEventListener('click',()=>choose({type:'initial'}));
  q('[data-crop-remove]').addEventListener('click',()=>choose({type:'keep'}));
  dialog.querySelectorAll('[data-preset]').forEach(button=>button.addEventListener('click',()=>choose({type:'preset',id:button.dataset.preset})));
  q('#profile-name').addEventListener('input',renderAvatar);
  fileInput.addEventListener('change',async()=>{
    const file=fileInput.files?.[0]; if(!file||busy||closing)return;
    const validation=avatarFileError(file); if(validation){if(reading){releaseImage();reading=false;avatarChoice={type:'keep'};submit.disabled=false;imageStatus.textContent='';renderAvatar();}error.textContent=validation;fileInput.value='';return;}
    releaseImage();const generation=imageGeneration;
    reading=true;submit.disabled=true;imageStatus.textContent=t('正在读取图片…');error.textContent='';
    cropPanel.hidden=true;q('.profile-avatar-current').hidden=false;
    const candidate=new Image();objectURL=URL.createObjectURL(file);candidate.src=objectURL;
    try {
      await candidate.decode();
      if(!alive()||generation!==imageGeneration)return;
      if(candidate.naturalWidth>8192||candidate.naturalHeight>8192||candidate.naturalWidth*candidate.naturalHeight>32000000)throw new RangeError('Image dimensions too large');
      if(!candidate.naturalWidth||!candidate.naturalHeight||!context)throw new Error('Image unavailable');
      image=candidate;avatarChoice={type:'upload'};crop={zoom:1,x:50,y:50};
      dialog.querySelectorAll('[data-crop]').forEach(control=>control.value=String(crop[control.dataset.crop]));
      imageStatus.textContent='';renderAvatar();
    } catch(cause) {
      if(!alive()||generation!==imageGeneration)return;
      releaseImage();reading=false;submit.disabled=busy;avatarChoice={type:'keep'};fileInput.value='';renderAvatar();
      error.textContent=t(cause instanceof RangeError?'图片尺寸过大，请换用较小的图片。':'这张图片无法读取，请换一张。');imageStatus.textContent='';
    } finally {if(alive()&&generation===imageGeneration){reading=false;submit.disabled=busy;}}
  });
  dialog.querySelectorAll('[data-crop]').forEach(control=>control.addEventListener('input',()=>{crop[control.dataset.crop]=Number(control.value);drawCrop();}));
  const cropBlob = () => new Promise((resolve,reject)=>{
    if(!image)return reject(new Error(t('暂时无法生成头像，请换一张图片。')));
    const output=document.createElement('canvas');output.width=output.height=512;
    const drawing=output.getContext('2d'),rect=avatarCropRect(image.naturalWidth,image.naturalHeight,crop);
    if(!drawing)return reject(new Error(t('暂时无法生成头像，请换一张图片。')));
    drawing.drawImage(image,rect.x,rect.y,rect.width,rect.height,0,0,512,512);
    output.toBlob(blob=>blob?resolve(blob):reject(new Error(t('暂时无法生成头像，请换一张图片。'))),'image/png');
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||closing||disposed)return;if(reading){error.textContent=t('请等待图片读取完成。');return;}
    if(!form.reportValidity())return;
    const fields=Object.fromEntries(['name','bio','headline','website'].map(key=>[key,q(`[name="${key}"]`).value]));
    if(!fields.name.trim()){error.textContent=t('请填写名字。');q('#profile-name').focus();return;}
    setBusy(true);error.textContent='';
    try {
      const blob=avatarChoice.type==='upload'?await cropBlob():null;
      const next=await saveProfileEdits({user:currentUser,fields,avatarChoice,avatarBlob:blob,api,onConfirmed:confirmed=>{currentUser=confirmed;onSaved(confirmed);}});
      currentUser=next;setBusy(false);closing=true;releaseImage();await closeDialog(dialog);notify(t('个人资料已更新'));
    } catch(cause) {
      if(alive())error.textContent=cause instanceof ProfileSaveError?cause.message:t('暂时无法生成头像，请换一张图片。');
    } finally {if(alive())setBusy(false);}
  });
  document.body.appendChild(dialog);dialog.showModal();renderAvatar();q('#profile-name').focus();
  return dialog;
}
