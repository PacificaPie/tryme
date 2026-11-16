import {ApiError} from './rules.mjs';

const MAX_BYTES=1048576, TIMEOUT_MS=10000, SHA=/^[a-f0-9]{40}$/i;
const OWNER=/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO=/^[A-Za-z0-9_.-]{1,100}$/;
const invalid=()=>new ApiError(422,'INVALID_GITHUB_REPOSITORY','填写公开 GitHub 仓库的根链接，例如 https://github.com/作者/仓库。');
const badResponse=()=>new ApiError(502,'GITHUB_RESPONSE_INVALID','GitHub 返回的仓库信息无效，请稍后重试。');
const empty=()=>new ApiError(422,'GITHUB_EMPTY_REPOSITORY','这个仓库还没有可构建的提交。');

function parseRepository(value){
  if(typeof value!=='string')throw invalid();
  const input=value.trim();
  // Validate the literal path before URL can normalize dot segments or slashes.
  if(input.length>2048||/[\\\x00-\x20\x7f?#]/.test(input)||!/^https:\/\/github\.com\//i.test(input))throw invalid();
  let url;try{url=new URL(input);}catch{throw invalid();}
  if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||url.port||url.search||url.hash)throw invalid();
  const path=input.slice(input.indexOf('/',8));
  if(!/^\/[^/]+\/[^/]+\/?$/.test(path))throw invalid();
  let parts;try{parts=path.replace(/\/$/,'').slice(1).split('/').map(decodeURIComponent);}catch{throw invalid();}
  const owner=parts[0],repo=parts[1].replace(/\.git$/i,'');
  if(!OWNER.test(owner)||!REPO.test(repo)||['.','..'].includes(repo))throw invalid();
  return {owner,repo,repository:`${owner}/${repo}`,url:`https://github.com/${owner}/${repo}`};
}

function readGithub(fetchImpl){
  return async function read(url,{commit=false}={}){
    if(new URL(url).origin!=='https://api.github.com')throw invalid();
    const controller=new AbortController();let timer;
    const timedOut=()=>new ApiError(504,'GITHUB_TIMEOUT','GitHub 读取超时，请稍后重试。');
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(timedOut());},TIMEOUT_MS);});
    try{return await Promise.race([timeout,(async()=>{
      const response=await fetchImpl(url,{
        redirect:'manual',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal,
        headers:{Accept:commit?'application/vnd.github.sha':'application/vnd.github+json','User-Agent':'Funtrack-Public-Repository-Import','X-GitHub-Api-Version':'2026-03-10'}
      });
      if(response.redirected||(response.url&&new URL(response.url).href!==url)||(response.status>=300&&response.status<400))throw new ApiError(422,'GITHUB_REDIRECT','仓库地址发生跳转，请填写仓库当前的正式链接。');
      if(response.status===404)throw new ApiError(404,'GITHUB_NOT_FOUND','找不到可匿名读取的公开仓库或默认分支。');
      if(commit&&response.status===409)throw empty();
      if(response.status===429||(response.status===403&&response.headers.get('x-ratelimit-remaining')==='0'))throw new ApiError(429,'GITHUB_RATE_LIMITED','GitHub 匿名读取额度已用尽，请稍后重试。');
      if(!response.ok)throw new ApiError(502,'GITHUB_UNAVAILABLE','暂时无法读取 GitHub 仓库，请稍后重试。');
      const tooLarge=()=>new ApiError(413,'GITHUB_RESPONSE_TOO_LARGE','GitHub 响应不能超过 1 MiB。');
      if(Number(response.headers.get('content-length'))>MAX_BYTES){response.body?.cancel().catch(()=>{});throw tooLarge();}
      const reader=response.body?.getReader();if(!reader)return new Uint8Array();
      const abort=()=>{reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',abort,{once:true});
      const chunks=[];let length=0;
      try{
        while(true){const {done,value}=await reader.read();if(controller.signal.aborted)throw timedOut();if(done)break;length+=value.byteLength;if(length>MAX_BYTES){reader.cancel().catch(()=>{});throw tooLarge();}chunks.push(value);}
      }finally{controller.signal.removeEventListener('abort',abort);reader.releaseLock();}
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
    })()]);}
    catch(error){if(error instanceof ApiError)throw error;if(controller.signal.aborted)throw timedOut();throw new ApiError(502,'GITHUB_UNAVAILABLE','暂时无法读取 GitHub 仓库，请稍后重试。');}
    finally{clearTimeout(timer);}
  };
}

function decode(bytes){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw badResponse();}}
function parseJSON(bytes){try{return JSON.parse(decode(bytes));}catch{throw badResponse();}}

/** Resolve only repository identity and an immutable default-branch commit.
 * Does not download, execute, install, build or publish repository content.
 * `license` is GitHub's metadata summary, not a redistribution approval.
 */
export async function resolveGithubRepository(value,{fetchImpl=fetch}={}){
  const source=parseRepository(value),read=readGithub(fetchImpl);
  const base=`https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`;
  const metadata=parseJSON(await read(base));
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw badResponse();
  if(metadata.private!==false||(metadata.visibility!==undefined&&metadata.visibility!=='public'))throw new ApiError(422,'GITHUB_PRIVATE_REPOSITORY','只能导入可匿名访问的公开仓库。');
  if(metadata.disabled===true)throw new ApiError(422,'GITHUB_DISABLED_REPOSITORY','这个仓库已被 GitHub 禁用，暂时无法构建。');
  if(typeof metadata.full_name!=='string')throw badResponse();
  let canonical;try{canonical=parseRepository(`https://github.com/${metadata.full_name}`);}catch{throw badResponse();}
  if(canonical.repository.toLowerCase()!==source.repository.toLowerCase())throw badResponse();
  if(metadata.html_url!==undefined){let reported;try{reported=parseRepository(metadata.html_url);}catch{throw badResponse();}if(reported.repository!==canonical.repository)throw badResponse();}
  const defaultBranch=metadata.default_branch;
  if(defaultBranch===null||defaultBranch==='')throw empty();
  if(typeof defaultBranch!=='string'||defaultBranch.length>1024||/[\\\x00-\x20\x7f]/.test(defaultBranch)||defaultBranch.split('/').some(part=>!part||part==='.'||part==='..'))throw badResponse();
  // A zero-KiB repository may still contain a tiny commit. Let GitHub's commit
  // response establish emptiness rather than rejecting `metadata.size === 0`.
  const commitSha=decode(await read(`${base}/commits/${encodeURIComponent(defaultBranch)}`,{commit:true})).trim().toLowerCase();
  if(!SHA.test(commitSha))throw badResponse();
  let license=null;
  if(metadata.license&&typeof metadata.license==='object'&&!Array.isArray(metadata.license)){
    const {spdx_id,name}=metadata.license;
    if(typeof spdx_id==='string'&&spdx_id.length<=100&&typeof name==='string'&&name.length<=300)license={spdxId:spdx_id,name};
  }
  return {url:canonical.url,repository:canonical.repository,commitSha,defaultBranch,description:typeof metadata.description==='string'?metadata.description.slice(0,1000):null,license};
}
