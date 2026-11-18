import {fail} from './rules.mjs';

export const AVATAR_MAX_BYTES=2*1024*1024;
export const AVATAR_PRESETS=Object.freeze(['sun','moon','sprout','wave']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function avatarReadRoute(request){
  if(!['GET','HEAD'].includes(request.method))return null;
  const match=/^\/api\/public\/avatars\/([^/]+)$/.exec(new URL(request.url).pathname);
  return match&&UUID.test(match[1])?match[1].toLowerCase():null;
}
export function safeAvatarURL(value){
  if(typeof value!=='string')return '';
  const preset=/^\/avatars\/([a-z]+)\.svg$/.exec(value);
  if(preset&&AVATAR_PRESETS.includes(preset[1]))return value;
  const upload=/^\/api\/public\/avatars\/([^/]+)$/.exec(value);
  return upload&&UUID.test(upload[1])?'/api/public/avatars/'+upload[1].toLowerCase():'';
}
const ascii=(bytes,start,length)=>String.fromCharCode(...bytes.slice(start,start+length));
const invalid=()=>fail(415,'INVALID_AVATAR','请选择完整有效的 PNG、JPEG 或 WebP 图片');
export function avatarImage(bytes,mime){
  if(!bytes.length||bytes.length>AVATAR_MAX_BYTES)fail(413,'AVATAR_TOO_LARGE','头像须在 2 MiB 以内');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let width=0,height=0,detected='';
  if(bytes.length>=45&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)){
    detected='image/png';
    if(view.getUint32(8)!==13||ascii(bytes,12,4)!=='IHDR')invalid();
    width=view.getUint32(16);height=view.getUint32(20);
    let position=8,hasData=false,ended=false;
    while(position+12<=bytes.length){
      const length=view.getUint32(position),type=ascii(bytes,position+4,4);
      if(position+12+length>bytes.length)invalid();
      if(type==='acTL')fail(415,'ANIMATED_AVATAR','请使用静态图片作为头像');
      if(type==='IDAT'&&length>0)hasData=true;
      position+=length+12;
      if(type==='IEND'){if(length!==0||position!==bytes.length)invalid();ended=true;break;}
    }
    if(!hasData||!ended)invalid();
  }else if(bytes.length>=20&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255){
    detected='image/jpeg';
    if(bytes.at(-2)!==255||bytes.at(-1)!==217)invalid();
    let position=2,hasScan=false;
    while(position+4<=bytes.length){
      if(bytes[position++]!==255)invalid();
      while(bytes[position]===255)position++;
      const marker=bytes[position++];
      if(marker===217)break;
      if(marker===1||(marker>=208&&marker<=215))continue;
      if(position+2>bytes.length)invalid();
      const length=view.getUint16(position);if(length<2||position+length>bytes.length)invalid();
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
        if(length<8)invalid();height=view.getUint16(position+3);width=view.getUint16(position+5);
      }
      if(marker===218){hasScan=true;break;}
      position+=length;
    }
    if(!hasScan)invalid();
  }else if(bytes.length>=26&&ascii(bytes,0,4)==='RIFF'&&ascii(bytes,8,4)==='WEBP'){
    detected='image/webp';if(view.getUint32(4,true)+8!==bytes.length)invalid();
    let position=12,hasImage=false;
    while(position+8<=bytes.length){
      const type=ascii(bytes,position,4),length=view.getUint32(position+4,true),start=position+8;
      if(start+length>bytes.length)invalid();
      if(type==='VP8X'){
        if(length<10)invalid();
        // Animated avatars add motion and ambiguous snapshots; accept still images only.
        if(bytes[start]&2)fail(415,'ANIMATED_AVATAR','请使用静态图片作为头像');
        width=1+bytes[start+4]+(bytes[start+5]<<8)+(bytes[start+6]<<16);
        height=1+bytes[start+7]+(bytes[start+8]<<8)+(bytes[start+9]<<16);
      }else if(type==='VP8 '){
        if(length<10||ascii(bytes,start+3,3)!=='\x9d\x01\x2a')invalid();
        width=view.getUint16(start+6,true)&16383;height=view.getUint16(start+8,true)&16383;hasImage=true;
      }else if(type==='VP8L'){
        if(length<5||bytes[start]!==47)invalid();
        const bits=view.getUint32(start+1,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;hasImage=true;
      }
      position=start+length+(length%2);
    }
    if(!hasImage||position!==bytes.length)invalid();
  }
  if(!detected||detected!==mime||!width||!height)invalid();
  if(width>4096||height>4096||width*height>16777216)fail(422,'AVATAR_DIMENSIONS','头像尺寸须不超过 4096 × 4096');
  return {mime:detected,width,height};
}
