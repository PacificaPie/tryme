import {fail,requiredText} from './rules.mjs';

export function expectedRevision(value){
  if(typeof value==='string'&&/^[1-9]\d*$/.test(value))value=Number(value);
  if(!Number.isSafeInteger(value)||value<1||value>=Number.MAX_SAFE_INTEGER)fail(422,'INVALID_REVISION','请提供有效的作品修订号');
  return value;
}
export const releaseNotes=value=>requiredText(value??'','更新说明',1000,0);
export function versionPage(params,workId){
  const limit=params.has('limit')?Number(params.get('limit')):20;
  if(!Number.isInteger(limit)||limit<1||limit>50)fail(422,'INVALID_LIMIT','每页须为 1–50 个版本');
  const raw=params.get('cursor');let before=null;
  if(raw){try{if(raw.length>512)throw Error();const value=JSON.parse(atob(raw));if(value.workId!==workId||!Number.isSafeInteger(value.before)||value.before<1)throw Error();before=value.before;}catch{fail(422,'INVALID_CURSOR','版本分页标识无效');}}
  return {limit,before};
}
export const versionCursor=(workId,before)=>btoa(JSON.stringify({workId,before}));
export function cardWorkRefs(workIds,refs){
  if(refs===undefined)return null;
  if(!Array.isArray(refs)||refs.length!==workIds.length||refs.some((ref,i)=>!ref||typeof ref!=='object'||ref.workId!==workIds[i]||typeof ref.versionId!=='string'||ref.versionId.length>128))fail(422,'INVALID_WORK_REFS','名片作品与预览版本须一一对应');
  return refs.map(ref=>({workId:ref.workId,versionId:ref.versionId}));
}
