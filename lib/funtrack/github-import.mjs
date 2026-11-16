import {ApiError,htmlSource} from './rules.mjs';

const MAX_BYTES=1048576,TIMEOUT_MS=10000,SHA=/^[a-f0-9]{40}$/i;
const invalid=()=>new ApiError(422,'INVALID_GITHUB_URL','填写公开 GitHub 仓库、HTML 文件的 blob 链接或 raw.githubusercontent.com 链接。');
const multifile=()=>new ApiError(422,'GITHUB_MULTIFILE_PROJECT','此项目需要其他文件或运行时加载资源；请先部署，再用“已有链接”发布。');
const ambiguous=()=>new ApiError(422,'GITHUB_AMBIGUOUS_REF','分支或标签路径存在歧义，请使用包含完整 commit SHA 的 HTML 文件链接。');
const segment=value=>encodeURIComponent(value);

function parseSource(value){
  if(typeof value!=='string'||value.includes('\\')||/(?:\/|%2f)(?:\.|%2e){1,2}(?:\/|%2f|$)/i.test(value))throw invalid();
  let url;try{url=new URL(value);}catch{throw invalid();}
  if(typeof value!=='string'||value.length>4096||url.protocol!=='https:'||url.username||url.password||url.port||url.search||!['github.com','raw.githubusercontent.com'].includes(url.hostname))throw invalid();
  let parts;try{parts=url.pathname.replace(/^\/+|\/+$/g,'').split('/').map(decodeURIComponent);}catch{throw invalid();}
  if(parts.some(part=>!part||part==='.'||part==='..'||/[\\/\x00-\x1f\x7f]/.test(part)))throw invalid();
  const [owner,repo]=parts;
  if(!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner||'')||!/^[A-Za-z0-9_.-]{1,100}$/.test(repo||''))throw invalid();
  if(url.hostname==='github.com'&&parts.length===2)return {owner,repo,ref:null,path:'index.html',tail:null,namespace:null};
  let tail=url.hostname==='github.com'?(parts[2]==='blob'?parts.slice(3):[]):parts.slice(2),namespace=null;
  if(tail[0]==='refs'&&['heads','tags'].includes(tail[1])){namespace=tail[1];tail=tail.slice(2);}
  if(tail.length<2||!tail[0]||!/[.]html?$/i.test(tail.at(-1)))throw invalid();
  return {owner,repo,ref:tail[0],path:tail.slice(1).join('/'),tail,namespace};
}

function fetcher(fetchImpl){
  return async function read(url,{accept='application/vnd.github+json',allowMissing=false}={}){
    const host=new URL(url).hostname;
    if(!['api.github.com','raw.githubusercontent.com'].includes(host))throw invalid();
    const controller=new AbortController();let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ApiError(504,'GITHUB_TIMEOUT','GitHub 读取超时，请稍后重试。'));},TIMEOUT_MS);});
    try{return await Promise.race([timeout,(async()=>{
      const response=await fetchImpl(url,{redirect:'manual',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal,headers:{Accept:accept,'User-Agent':'Funtrack-Public-HTML-Import',...(host==='api.github.com'?{'X-GitHub-Api-Version':'2026-03-10'}:{})}});
      if(response.redirected||(response.url&&new URL(response.url).href!==new URL(url).href)||(response.status>=300&&response.status<400))throw new ApiError(422,'GITHUB_REDIRECT','GitHub 地址发生跳转，请使用仓库或文件的当前正式链接。');
      if(response.status===404&&allowMissing)return null;
      if(response.status===404)throw new ApiError(404,'GITHUB_NOT_FOUND','找不到可匿名读取的仓库、提交或 HTML 文件。');
      if(response.status===429||(response.status===403&&response.headers.get('x-ratelimit-remaining')==='0'))throw new ApiError(429,'GITHUB_RATE_LIMITED','GitHub 匿名读取额度已用尽，请稍后重试或上传 HTML 文件。');
      if(!response.ok)throw new ApiError(502,'GITHUB_UNAVAILABLE','暂时无法从 GitHub 匿名读取文件，请稍后重试。');
      if(Number(response.headers.get('content-length'))>MAX_BYTES){response.body?.cancel().catch(()=>{});throw new ApiError(413,'GITHUB_FILE_TOO_LARGE','GitHub 响应不能超过 1 MiB。');}
      const reader=response.body?.getReader();if(!reader)return new Uint8Array();
      const chunks=[];let length=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_BYTES){reader.cancel().catch(()=>{});throw new ApiError(413,'GITHUB_FILE_TOO_LARGE','GitHub 响应不能超过 1 MiB。');}chunks.push(value);}}finally{reader.releaseLock();}
      const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return bytes;
    })()]);}catch(error){if(error instanceof ApiError)throw error;if(controller.signal.aborted)throw new ApiError(504,'GITHUB_TIMEOUT','GitHub 读取超时，请稍后重试。');throw new ApiError(502,'GITHUB_UNAVAILABLE','暂时无法从 GitHub 匿名读取文件，请稍后重试。');}finally{clearTimeout(timer);}
  };
}
function json(bytes){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ApiError(502,'GITHUB_RESPONSE_INVALID','GitHub 返回的数据无效，请稍后重试。');}}
function entities(value){return value.replace(/&#(x[0-9a-f]+|\d+);?/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/&(colon|tab|newline|quot|apos|amp);/gi,(_,name)=>({colon:':',tab:'\t',newline:'\n',quot:'"',apos:"'",amp:'&'})[name.toLowerCase()]);}
function inlineURL(value){const url=entities(value).trim();if(!url||url.startsWith('#')||/^data:/i.test(url))return;throw multifile();}
function cssDependencies(css){
  const decoded=css.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi,(_,hex,char)=>hex?String.fromCodePoint(Math.min(parseInt(hex,16),0x10ffff)):char);
  for(const match of decoded.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi))inlineURL(match[1]??match[2]??match[3]);
  for(const match of decoded.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi))inlineURL(match[1]??match[2]);
}
// These compatibility checks are intentionally conservative, not a JS security
// boundary. Imported games must still be served with the existing sandbox/CSP.
function selfContained(html){
  const clean=html.replace(/<!--[\s\S]*?-->/g,'');
  for(const style of clean.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi))cssDependencies(style[1]);
  const markup=clean.replace(/(<(?:script|style)\b(?:[^>"']|"[^"]*"|'[^']*')*>)[\s\S]*?<\/(?:script|style)\s*>/gi,'$1');
  for(const tag of markup.matchAll(/<([a-z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)){
    const name=tag[1].toLowerCase();if(name==='base')throw multifile();
    for(const attr of tag[2].matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)){
      const key=attr[1].toLowerCase(),value=attr[2]??attr[3]??attr[4];
      if(key==='style')cssDependencies(entities(value));
      if(key==='srcdoc')throw multifile();
      if(key==='srcset'||key==='imagesrcset'){
        if(!/^data:\S+(?:\s+[\d.]+[wx])?$/i.test(entities(value).trim()))throw multifile();
      }else if(['src','poster'].includes(key)||(key==='data'&&name==='object')||(['href','xlink:href'].includes(key)&&['link','image','use','feimage'].includes(name)))inlineURL(value);
      if(name==='meta'&&key==='http-equiv'&&value.toLowerCase()==='refresh')throw multifile();
    }
  }
  for(const script of clean.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)){
    const code=script[1];
    for(const match of code.matchAll(/\b(?:import|export)\s+(?:[^;\n]*?\bfrom\s*)?(['"])([^'"]+)\1/g))inlineURL(match[2]);
    for(const match of code.matchAll(/\b(?:import|fetch|require|importScripts|Worker|SharedWorker|EventSource|WebSocket|Audio)\s*\(/g)){
      const rest=code.slice(match.index+match[0].length).trimStart();
      if(rest.startsWith(')'))continue;
      const literal=rest.match(/^(['"`])([^'"`]*?)\1/);if(!literal||literal[2].includes('${'))throw multifile();inlineURL(literal[2]);
      if(/importScripts/.test(match[0])&&!/^\s*\)/.test(rest.slice(literal[0].length)))throw multifile();
    }
    if(/\bXMLHttpRequest\b/.test(code))throw multifile();
    for(const match of code.matchAll(/\.(?:src|srcset|poster)\s*=\s*(['"`])([^'"`]*?)\1/g)){if(match[2].includes('${'))throw multifile();inlineURL(match[2]);}
  }
}

/**
 * Anonymous, pinned single-file import. No clone, build step or user credentials.
 * GitHub docs: https://docs.github.com/en/rest/repos/repos#get-a-repository
 * https://docs.github.com/en/rest/commits/commits#get-a-commit (SHA media type)
 * https://docs.github.com/en/rest/git/refs#list-matching-references
 */
export async function resolveGithubHTML(url,{fetchImpl=fetch}={}){
  const source=parseSource(url),{owner,repo}=source,read=fetcher(fetchImpl);
  const repository=`${owner}/${repo}`,base=`https://api.github.com/repos/${segment(owner)}/${segment(repo)}`;
  let ref=source.ref;
  if(!ref){const metadata=json(await read(base));if(metadata.private===true)throw new ApiError(422,'GITHUB_PRIVATE_REPOSITORY','只能导入可匿名访问的公开仓库。');if(typeof metadata.default_branch!=='string'||!metadata.default_branch)throw new ApiError(502,'GITHUB_RESPONSE_INVALID','仓库没有可用的默认分支。');ref=metadata.default_branch;}
  else if(!SHA.test(ref)){
    // A blob URL cannot disambiguate a slash-containing branch from a directory.
    // Look only at official matching-ref lists; never guess the branch boundary.
    const kinds=source.namespace?[source.namespace]:['heads','tags'];
    const lists=await Promise.all(kinds.map(kind=>read(`${base}/git/matching-refs/${kind}/${segment(ref)}`,{allowMissing:true})));
    for(let i=0;i<lists.length;i++){
      if(!lists[i])continue;const refs=json(lists[i]);if(!Array.isArray(refs))throw new ApiError(502,'GITHUB_RESPONSE_INVALID','GitHub 返回的分支信息无效。');
      for(const entry of refs){const name=typeof entry.ref==='string'?entry.ref.replace(/^refs\/(?:heads|tags)\//,''):'';if(name.includes('/')&&source.tail.join('/').startsWith(name+'/'))throw ambiguous();}
    }
    if(source.namespace)ref=`refs/${source.namespace}/${ref}`;
  }
  const commitSha=new TextDecoder().decode(await read(`${base}/commits/${segment(ref)}`,{accept:'application/vnd.github.sha'})).trim();
  if(!SHA.test(commitSha))throw new ApiError(502,'GITHUB_RESPONSE_INVALID','GitHub 没有返回有效的固定提交。');
  const path=source.path,encodedPath=path.split('/').map(segment).join('/'),filename=path.split('/').at(-1);
  const bytes=await read(`https://raw.githubusercontent.com/${segment(owner)}/${segment(repo)}/${commitSha}/${encodedPath}`,{accept:'text/html'});
  const html=htmlSource(bytes,'text/html',filename);selfContained(html);
  return {html,filename,sourceUrl:`https://github.com/${segment(owner)}/${segment(repo)}/blob/${commitSha}/${encodedPath}`,repository,commitSha,path};
}
