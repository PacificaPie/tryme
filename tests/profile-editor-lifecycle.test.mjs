import test from 'node:test';
import assert from 'node:assert/strict';
import { openProfileEditor } from '../public/profile-editor.js';

const deferred = () => {let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

// A small event-driven DOM fixture lets asynchronous decoding and dialog exit
// finish in either order, without replacing the editor's own event handlers.
function editorEnvironment() {
  class Node {
    constructor(values={}) {Object.assign(this,{value:'',disabled:false,isConnected:true,hidden:false,dataset:{},listeners:new Map(),attributes:{}},values);}
    addEventListener(name,fn) {const handlers=this.listeners.get(name)||[];handlers.push(fn);this.listeners.set(name,handlers);}
    async fire(name,values={}) {await Promise.all((this.listeners.get(name)||[]).map(fn=>fn({type:name,target:this,preventDefault(){},...values})));}
    setAttribute(name,value) {this.attributes[name]=value;}
    focus() {document.activeElement=this;}
    remove() {this.isConnected=false;}
    getBoundingClientRect() {return {width:256};}
  }
  const nodes=new Map(), images=[], canvases=[], revoked=[], exit=deferred();
  const q=selector=>{if(!nodes.has(selector))nodes.set(selector,new Node());return nodes.get(selector);};
  const presets=['sun','moon','sprout','wave'].map(id=>new Node({dataset:{preset:id}}));
  const crops=['zoom','x','y'].map(key=>new Node({value:key==='zoom'?'1':'50',dataset:{crop:key}}));
  const cancels=[new Node(),new Node()];
  for(const key of ['name','bio','headline','website'])nodes.set(`[name="${key}"]`,q('#profile-'+key));
  q('#profile-name').value='Creator';
  for(const control of crops)nodes.set('[data-crop='+control.dataset.crop+']',control);
  function canvas() {
    const node=new Node({draws:[],captured:new Set()}),context={clearRect(){},drawImage(...args){node.draws.push(args);}};
    node.setPointerCapture=id=>node.captured.add(id);node.hasPointerCapture=id=>node.captured.has(id);node.releasePointerCapture=id=>node.captured.delete(id);
    node.getContext=()=>context;node.toBlob=done=>done(new Blob(['normalized pixels'],{type:'image/png'}));canvases.push(node);return node;
  }
  nodes.set('canvas',canvas());
  const form=q('form');form.reportValidity=()=>true;form.querySelectorAll=()=>[...nodes.values(),...presets,...crops,...cancels];
  const dialog=new Node();dialog.querySelector=q;
  dialog.querySelectorAll=selector=>selector==='[data-preset]'?presets:selector==='[data-crop]'?crops:selector==='[data-cancel]'?cancels:[];
  dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;void dialog.fire('close');};
  dialog.animate=()=>({finished:exit.promise,cancel(){}});
  const previous=new Node();
  const originals={document:globalThis.document,Image:globalThis.Image,create:URL.createObjectURL,revoke:URL.revokeObjectURL,matchMedia:globalThis.matchMedia};
  globalThis.document={activeElement:previous,querySelector:()=>null,createElement:tag=>tag==='dialog'?dialog:canvas(),body:{appendChild(){}}};
  globalThis.matchMedia=()=>({matches:false});
  globalThis.Image=class {constructor(){this.pending=deferred();images.push(this);}decode(){return this.pending.promise;}};
  URL.createObjectURL=()=>`blob:fixture-${images.length}`;URL.revokeObjectURL=value=>revoked.push(value);
  return {dialog,form,q,presets,crops,cancels,images,canvases,revoked,exit,previous,
    async upload() {q('#profile-avatar-file').files=[{type:'image/png',size:1024}];const pending=q('#profile-avatar-file').fire('change');return {pending,image:images.at(-1)};},
    restore(){globalThis.document=originals.document;globalThis.Image=originals.Image;globalThis.matchMedia=originals.matchMedia;URL.createObjectURL=originals.create;URL.revokeObjectURL=originals.revoke;}
  };
}

test('cancel immediately seals the editor against submits and late image decoding during its exit animation', async () => {
  const env=editorEnvironment();let calls=0;
  try {
    openProfileEditor({user:{id:'user',name:'Creator'},api:async()=>{calls++;}});
    const {pending,image}=await env.upload();
    await env.cancels[0].fire('click');
    assert.equal(env.dialog.open,true,'The exit animation is still running');
    await env.form.fire('submit');
    image.naturalWidth=900;image.naturalHeight=600;image.pending.resolve();await pending;
    assert.equal(calls,0);
    assert.equal(env.q('.avatar-crop').hidden,true);
    assert.equal(env.revoked.length,1);
    env.exit.resolve();await Promise.resolve();await Promise.resolve();
    assert.equal(env.dialog.isConnected,false);
    assert.equal(document.activeElement,env.previous);
  } finally {env.restore();}
});

test('selecting an illustration wins over a previous image decode and saves only that preset', async () => {
  const env=editorEnvironment(),calls=[];
  try {
    openProfileEditor({user:{id:'user',name:'Creator'},api:async(path,options)=>{calls.push({path,options});return {user:{id:'user',name:'Creator',avatarUrl:'/avatars/moon.svg'}};}});
    const {pending,image}=await env.upload();
    await env.presets[1].fire('click');
    image.naturalWidth=800;image.naturalHeight=600;image.pending.resolve();await pending;
    const saving=env.form.fire('submit');await Promise.resolve();env.exit.resolve();await saving;
    assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/me/profile');
    assert.equal(calls[0].options.body.avatarPreset,'moon');
    assert.equal(env.revoked.length,1);
  } finally {env.restore();}
});

test('pinch and direct drag match the exported crop and retry a failed image after keeping confirmed profile state', async () => {
  const env=editorEnvironment(),calls=[],confirmed=[];let failAvatar=true;
  try {
    openProfileEditor({user:{id:'user',name:'Creator',avatarUrl:'/avatars/sun.svg'},onSaved:user=>confirmed.push(user),api:async(path,options)=>{
      calls.push({path,options});
      if(path.endsWith('/avatar')&&failAvatar)throw new Error('Connection interrupted');
      return {user:{id:'user',name:'Changed',avatarUrl:path.endsWith('/avatar')?'/api/public/avatars/12345678-1234-1234-1234-123456789abc':'/avatars/sun.svg'}};
    }});
    const {pending,image}=await env.upload();image.naturalWidth=1200;image.naturalHeight=600;image.pending.resolve();await pending;
    env.q('#profile-name').value='Changed';
    const preview=env.q('canvas');
    await preview.fire('pointerdown',{pointerId:1,button:0,clientX:100,clientY:100});
    await preview.fire('pointerdown',{pointerId:2,button:0,clientX:200,clientY:100});
    await preview.fire('pointermove',{pointerId:1,clientX:50,clientY:100});
    await preview.fire('pointermove',{pointerId:2,clientX:250,clientY:100});
    await preview.fire('pointerup',{pointerId:1});await preview.fire('pointerup',{pointerId:2});
    assert.equal(env.q('[data-crop-zoom]').textContent,'200%');
    await preview.fire('pointerdown',{pointerId:3,button:0,clientX:100,clientY:100});
    await preview.fire('pointermove',{pointerId:3,clientX:-284,clientY:228});
    await env.form.fire('submit');
    const output=env.canvases.find(node=>node.width===512);
    assert.deepEqual(output.draws[0].slice(1),[900,0,300,300,0,0,512,512]);
    assert.equal(preview.captured.size,0,'Saving ends any captured drag before exporting');
    assert.equal(confirmed.length,1);assert.equal(confirmed[0].name,'Changed');
    assert.match(env.q('.profile-editor-error').textContent,/资料已保存/);
    assert.equal(env.dialog.open,true);assert.equal(env.q('[type=submit]').disabled,false);
    failAvatar=false;const retry=env.form.fire('submit');await Promise.resolve();env.exit.resolve();await retry;
    assert.deepEqual(calls.map(call=>call.path),['/api/me/profile','/api/me/avatar','/api/me/profile','/api/me/avatar']);
    assert.equal(confirmed.at(-1).avatarUrl,'/api/public/avatars/12345678-1234-1234-1234-123456789abc');
  } finally {env.restore();}
});

test('avatar initials are fallback only; removal is contextual and the four profile fields remain editable',async()=>{
  const env=editorEnvironment();
  try{
    openProfileEditor({user:{id:'user',name:'Creator'},api:async()=>assert.fail('Choosing an avatar does not save')});
    const html=env.dialog.innerHTML;
    assert.doesNotMatch(html,/使用首字母|data-initial|type="range"|左右位置|上下位置/);
    for(const field of ['name','bio','headline','website'])assert(html.includes('name="'+field+'"'));
    assert.match(html,/个人资料会同步到主页、名片、Feed 和评论/);
    assert.equal(env.q('[data-remove-avatar]').hidden,true);
    await env.presets[0].fire('click');assert.equal(env.q('[data-remove-avatar]').hidden,false);
    await env.q('[data-remove-avatar]').fire('click');assert.equal(env.q('[data-remove-avatar]').hidden,true);
  }finally{env.restore();}
});

test('wheel, buttons and keyboard zoom remain bounded, and pointer cancellation ends dragging',async()=>{
  const env=editorEnvironment();
  try{
    openProfileEditor({user:{id:'user',name:'Creator'},api:async()=>assert.fail('Crop adjustments do not save')});
    const {pending,image}=await env.upload();image.naturalWidth=1200;image.naturalHeight=600;image.pending.resolve();await pending;
    const preview=env.q('canvas');
    await preview.fire('wheel',{deltaY:-100,deltaMode:0});assert.equal(env.q('[data-crop-zoom]').textContent,'128%');
    await preview.fire('keydown',{key:'Home'});assert.equal(env.q('[data-crop-zoom]').textContent,'100%');assert.equal(env.q('[data-zoom-out]').disabled,true);
    await env.q('[data-zoom-in]').fire('click');assert.equal(env.q('[data-crop-zoom]').textContent,'120%');
    const before=preview.draws.at(-1)[1];await preview.fire('keydown',{key:'ArrowRight'});assert(preview.draws.at(-1)[1]<before,'Image moves right as the source crop moves left');
    for(let i=0;i<10;i++)await preview.fire('keydown',{key:'+'});assert.equal(env.q('[data-crop-zoom]').textContent,'300%');assert.equal(env.q('[data-zoom-in]').disabled,true);
    await preview.fire('pointerdown',{pointerId:7,button:0,clientX:40,clientY:40});assert.equal(preview.captured.size,1);
    await preview.fire('pointercancel',{pointerId:7});assert.equal(preview.captured.size,0);
    const draws=preview.draws.length;await preview.fire('pointermove',{pointerId:7,clientX:999,clientY:999});assert.equal(preview.draws.length,draws);
  }finally{env.restore();}
});
