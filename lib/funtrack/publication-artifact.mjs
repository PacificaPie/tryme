import {fail,eventId,htmlSource,coverType} from './rules.mjs';

// Both initial publication and version updates use exactly the same validation.
// Only the trusted build service may supply an artifact above the upload limit.
export async function publicationArtifact(form,source,ownerId,getBuildArtifact){
  let gameBytes=null,coverBytes=null,coverMime=null,provenanceJSON=null;
  const rawBuildId=form.get('buildId'),buildId=typeof rawBuildId==='string'&&rawBuildId?eventId(rawBuildId):null;
  if(rawBuildId&&typeof rawBuildId!=='string')fail(422,'INVALID_BUILD_ID','构建任务标识无效');
  if(buildId&&source!=='html')fail(422,'INVALID_BUILD_SOURCE','构建产物须发布为站内作品');
  if(source==='html'){
    if(buildId){
      if(form.has('file'))fail(422,'AMBIGUOUS_BUILD_SOURCE','构建产物和本地文件不能同时发布');
      const artifact=await getBuildArtifact(buildId,ownerId);gameBytes=artifact.bytes;provenanceJSON=JSON.stringify(artifact.provenance);
    }else{
      const file=form.get('file');if(!file||typeof file==='string')fail(422,'FILE_REQUIRED','请选择 HTML 文件');
      gameBytes=new Uint8Array(await file.arrayBuffer());htmlSource(gameBytes,file.type,file.name);
    }
  }
  const cover=form.get('cover');
  if(cover&&typeof cover!=='string'&&cover.size){
    if(cover.size>2097152)fail(413,'COVER_TOO_LARGE','封面须在 2 MiB 以内');
    coverBytes=new Uint8Array(await cover.arrayBuffer());coverMime=coverType(coverBytes,cover.type);
  }
  if(typeof cover==='string'&&cover)fail(422,'INVALID_COVER','封面须为图片文件');
  return {gameBytes,coverBytes,coverMime,provenanceJSON,buildId};
}
