import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AVATAR_PRESETS, safeAvatarURL, avatarMarkup, avatarContent } from '../public/avatars.js';
import { avatarCropRect, avatarFileError, AVATAR_MAX_BYTES, profileChangeBody, saveProfileEdits, ProfileSaveError } from '../public/profile-editor.js';
import { setLocale } from '../public/i18n.js';

test('only canonical first-party avatar images may be rendered; names remain text', () => {
  const id='a5d324d5-9521-4b50-a132-91a5cb439ada';
  for(const preset of AVATAR_PRESETS)assert.equal(safeAvatarURL('/avatars/'+preset.id+'.svg'),'/avatars/'+preset.id+'.svg');
  assert.equal(safeAvatarURL('/api/public/avatars/'+id),'/api/public/avatars/'+id);
  for(const value of ['https://evil.test/a.png','//evil.test/a.png','data:image/svg+xml,<svg onload=alert(1)>','javascript:alert(1)','/avatars/other.svg','/avatars/sun.svg?redirect=evil','/avatars/../x.svg','/api/public/avatars/'+id+'/anything',null,{}])assert.equal(safeAvatarURL(value),'');
  const markup=avatarMarkup({name:'<script>',avatarUrl:'javascript:alert(1)'},{className:'avatar" onclick="bad',decorative:false});
  assert(!markup.includes('<img'));assert(markup.includes('&lt;'));assert(!markup.includes(' onclick="bad'));assert(markup.includes('role="img"'));
  assert(avatarContent({name:'🌱',avatarUrl:'/avatars/sprout.svg'}).includes('alt=""'));
});

test('the four built-in avatar illustrations are self-contained vector images', () => {
  for(const preset of AVATAR_PRESETS){
    const source=readFileSync(new URL('../public/avatars/'+preset.id+'.svg',import.meta.url),'utf8');
    assert(source.includes('viewBox="0 0 128 128"'));
    assert.match(source,/<svg\b[^>]*\bwidth="128"[^>]*\bheight="128"/, 'SVGs need fixed intrinsic dimensions for reliable canvas source cropping');
    assert(!/<script|<foreignObject|<image|\son[a-z]+\s*=|href=/i.test(source));
  }
});

test('crop coordinates stay square and in bounds for landscape, portrait and zoomed images', () => {
  assert.deepEqual(avatarCropRect(1200,600),{x:300,y:0,width:600,height:600});
  assert.deepEqual(avatarCropRect(600,1200,{zoom:2,x:100,y:0}),{x:300,y:0,width:300,height:300});
  for(const [width,height] of [[1,1],[900,1600],[1600,900],[512,512]])for(const zoom of [1,1.7,3,100])for(const x of [-20,0,50,100,200]){
    const c=avatarCropRect(width,height,{zoom,x,y:100-x});
    assert.equal(c.width,c.height);assert(c.x>=0&&c.y>=0);assert(c.x+c.width<=width+.00001);assert(c.y+c.height<=height+.00001);
  }
  assert.throws(()=>avatarCropRect(0,1),RangeError);assert.throws(()=>avatarCropRect(Infinity,512),RangeError);
});

test('avatar input rejects unsupported and oversized images before decoding', () => {
  for(const type of ['image/png','image/jpeg','image/webp'])assert.equal(avatarFileError({type,size:AVATAR_MAX_BYTES}),'');
  for(const file of [{type:'image/svg+xml',size:100},{type:'image/gif',size:100},{type:'image/png',size:0},{type:'image/png',size:AVATAR_MAX_BYTES+1}])assert(avatarFileError(file));
});

test('profile edits preserve uploaded avatars unless a preset or initial is explicitly selected', () => {
  const fields={name:' Creator ',bio:' bio ',headline:' maker ',website:' https://example.com ',avatarUrl:'https://untrusted.test/avatar',id:'another-user'};
  const body={name:'Creator',bio:'bio',headline:'maker',website:'https://example.com'};
  assert.deepEqual(profileChangeBody(fields),body);
  assert.deepEqual(profileChangeBody(fields,{type:'upload'}),body);
  assert.deepEqual(profileChangeBody(fields,{type:'initial'}),{...body,avatarPreset:null});
  assert.deepEqual(profileChangeBody(fields,{type:'preset',id:'moon'}),{...body,avatarPreset:'moon'});
  assert.throws(()=>profileChangeBody(fields,{type:'preset',id:'unknown'}),TypeError);
});

test('successful image save publishes each confirmed profile and sends a file, never a user-selected URL', async () => {
  const user={id:'user-1',name:'Old',avatarUrl:'/avatars/sun.svg'},fields={name:'New',bio:'A bio'},calls=[],confirmed=[];
  const uploaded='/api/public/avatars/a5d324d5-9521-4b50-a132-91a5cb439ada';
  const api=async(path,options)=>{calls.push({path,options});return {user:{...user,name:'New',bio:'A bio',avatarUrl:path.endsWith('/avatar')?uploaded:user.avatarUrl}};};
  const result=await saveProfileEdits({user,fields,avatarChoice:{type:'upload'},avatarBlob:new Blob(['image'],{type:'image/png'}),api,onConfirmed:u=>confirmed.push(u)});
  assert.deepEqual(calls.map(c=>c.path),['/api/me/profile','/api/me/avatar']);
  assert.equal(Object.hasOwn(calls[0].options.body,'avatarPreset'),false);
  assert(calls[1].options.body instanceof FormData);assert.equal(calls[1].options.body.get('avatar').name,'avatar.png');
  assert.equal(confirmed.length,2);assert.equal(confirmed[0].avatarUrl,user.avatarUrl);assert.equal(confirmed[1].avatarUrl,uploaded);assert.equal(result.avatarUrl,uploaded);
});

test('avatar failure exposes the already-confirmed profile and can be retried without false rollback', async () => {
  const user={id:'user-1',name:'Old',avatarUrl:'/avatars/sun.svg'},saved={...user,name:'New'},confirmed=[];
  let calls=0;
  const api=async()=>{if(++calls===1)return {user:saved};throw new Error('Upload disconnected');};
  await assert.rejects(saveProfileEdits({user,fields:{name:'New'},avatarChoice:{type:'upload'},avatarBlob:new Blob(['image'],{type:'image/png'}),api,onConfirmed:u=>confirmed.push(u)}),error=>{
    assert(error instanceof ProfileSaveError);assert.equal(error.stage,'avatar');assert.deepEqual(error.savedUser,saved);assert(error.message.includes('资料已保存'));return true;
  });
  assert.deepEqual(confirmed,[saved]);assert.equal(calls,2);
});

test('profile failure never starts an avatar upload and mismatched-user responses are not accepted', async () => {
  for(const failure of [()=>{throw Object.assign(new Error('Invalid name'),{status:422});},()=>({user:{id:'different',name:'Wrong'}})]){
    let calls=0,confirmed=0;
    await assert.rejects(saveProfileEdits({user:{id:'user-1',name:'Old'},fields:{name:'New'},avatarChoice:{type:'upload'},avatarBlob:new Blob(['image']),api:async()=>{calls++;return failure();},onConfirmed:()=>confirmed++}),error=>error instanceof ProfileSaveError&&error.savedUser===null);
    assert.equal(calls,1);assert.equal(confirmed,0);
  }
  let called=false;
  await assert.rejects(saveProfileEdits({user:{id:'user-1'},fields:{name:'New'},avatarChoice:{type:'upload'},avatarBlob:null,api:async()=>{called=true;}}),ProfileSaveError);
  assert.equal(called,false);
});

test('avatar labels and save errors have English equivalents', async () => {
  setLocale('en');
  try {
    assert.match(avatarMarkup({name:'Sam'},{decorative:false}),/Sam’s avatar/);
    assert.equal(avatarFileError({type:'image/svg+xml',size:100}),'Choose a PNG, JPG or WebP image.');
    assert.match(new ProfileSaveError(new Error('network'),'avatar',{id:'a'}).message,/Profile saved/);
  } finally {setLocale('zh-CN');}
});
