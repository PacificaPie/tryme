import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp,readdir,lstat,chmod,rm,copyFile,stat} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const BUILD_IMAGE='node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee';
export const LIMITS={archive:16*1024*1024,unpacked:64*1024*1024,files:5000,file:8*1024*1024,html:8*1024*1024,installMs:240000,buildMs:180000,logs:250000};
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const toolkitSource=path.join(root,'scripts/build-toolkit');
const scratchRoot=path.join(root,'.preview/builds');
const ignored=name=>name.split('/').some(part=>['.git','node_modules','.npmrc','.yarnrc','.yarnrc.yml','.pnpmfile.cjs'].includes(part)||part==='.env'||part.startsWith('.env.'));
export class BuildError extends Error{constructor(message,code='BUILD_FAILED'){super(message);this.code=code;}}
const fail=(message,code)=>{throw new BuildError(message,code);};
export function validateJob(job){
  if(!job||typeof job.repository!=='string'||!/^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})$/.test(job.repository)||!/^[a-f0-9]{40}$/i.test(job.commitSha||''))fail('仓库或固定提交无效。','INVALID_REPOSITORY');
  if(['.','..'].includes(job.repository.split('/')[1]))fail('仓库名无效。','INVALID_REPOSITORY');
  return {repository:job.repository,commitSha:job.commitSha.toLowerCase()};
}
function tarText(buf){const zero=buf.indexOf(0);return buf.subarray(0,zero<0?buf.length:zero).toString('utf8');}
function octal(buf){const value=tarText(buf).trim();if(value&&!/^[0-7]+$/.test(value))fail('不支持的 tar 数字格式。','INVALID_ARCHIVE');return parseInt(value||'0',8);}
function pax(data){const values={};let offset=0;while(offset<data.length){const space=data.indexOf(32,offset),length=Number(data.subarray(offset,space).toString());if(space<offset||!Number.isInteger(length)||length<=space-offset+1||offset+length>data.length)fail('无效归档元数据。','INVALID_ARCHIVE');const text=data.subarray(space+1,offset+length-1).toString('utf8'),equals=text.indexOf('=');if(equals>0)values[text.slice(0,equals)]=text.slice(equals+1);offset+=length;}return values;}
export function unpackTar(gz){
  if(gz.length>LIMITS.archive)fail('仓库压缩包超过 16 MiB。','ARCHIVE_TOO_LARGE');
  let tar;try{tar=gunzipSync(gz,{maxOutputLength:LIMITS.unpacked});}catch{fail('仓库压缩包无效或解压后超过 64 MiB。','INVALID_ARCHIVE');}
  const files=[],seen=new Set();let prefix=null,total=0,nextPax={};
  for(let offset=0;offset+512<=tar.length;){const header=tar.subarray(offset,offset+512);if(header.every(x=>x===0))break;
    const expected=octal(header.subarray(148,156));let sum=0;for(let i=0;i<512;i++)sum+=(i>=148&&i<156)?32:header[i];if(expected!==sum)fail('归档校验和无效。','INVALID_ARCHIVE');
    const size=octal(header.subarray(124,136)),type=String.fromCharCode(header[156]||48);if(!Number.isSafeInteger(size)||size<0||size>LIMITS.file||offset+512+size>tar.length)fail('归档文件过大或损坏。','INVALID_ARCHIVE');
    const body=tar.subarray(offset+512,offset+512+size);offset+=512+Math.ceil(size/512)*512;
    if(type==='g'){const meta=pax(body);if(meta.path||meta.linkpath)fail('不支持归档全局路径覆写。','INVALID_ARCHIVE');continue;}
    if(type==='x'){nextPax=pax(body);continue;}
    if(!['0','5'].includes(type))fail('仓库不能包含符号链接、硬链接或设备文件。','UNSAFE_ARCHIVE');
    let name=nextPax.path||[tarText(header.subarray(345,500)),tarText(header.subarray(0,100))].filter(Boolean).join('/');if(nextPax.linkpath)fail('仓库不能包含链接。','UNSAFE_ARCHIVE');nextPax={};
    if(name.startsWith('/')||name.includes('\\')||/[\x00-\x1f\x7f]/.test(name))fail('仓库包含不安全路径。','UNSAFE_ARCHIVE');name=name.replace(/\/$/,'');const parts=name.split('/');if(parts.some(p=>!p||p==='.'||p==='..')||name.length>1000)fail('仓库包含不安全路径。','UNSAFE_ARCHIVE');
    if(prefix===null)prefix=parts[0];if(prefix!==parts[0])fail('归档必须有唯一根目录。','INVALID_ARCHIVE');const relative=parts.slice(1).join('/');if(!relative)continue;
    const key=relative.toLowerCase();if(seen.has(key))fail('仓库包含重复或大小写冲突的路径。','UNSAFE_ARCHIVE');seen.add(key);if(seen.size>LIMITS.files)fail('仓库文件超过 5000 项。','ARCHIVE_TOO_LARGE');
    total+=size;if(total>LIMITS.unpacked)fail('仓库内容超过 64 MiB。','ARCHIVE_TOO_LARGE');if(type==='0'&&!ignored(relative))files.push({path:relative,bytes:Buffer.from(body)});
  }
  if(!files.length)fail('仓库压缩包没有可构建文件。','INVALID_ARCHIVE');return files;
}
export function validateNpmProject(files){
  const get=name=>files.find(f=>f.path===name)?.bytes;
  let pkg,lock;try{pkg=JSON.parse(get('package.json').toString('utf8'));lock=JSON.parse(get('package-lock.json').toString('utf8'));}catch{fail('根目录需要有效的 package.json 和 package-lock.json。','UNSUPPORTED_PROJECT');}
  if(pkg.workspaces||!pkg.scripts?.build||typeof pkg.scripts.build!=='string'||pkg.scripts.build.length>2000||!{...pkg.dependencies,...pkg.devDependencies}.vite)fail('当前支持根目录带 build 脚本及 npm 锁文件的 Vite 静态项目。','UNSUPPORTED_PROJECT');
  if(![2,3].includes(lock.lockfileVersion)||!lock.packages)fail('请使用 npm lockfile v2 或 v3。','UNSUPPORTED_LOCKFILE');
  const badSpec=value=>typeof value==='string'&&(/^(?:git|https?:|ssh:|file:|link:|workspace:|github:|gitlab:|bitbucket:)/i.test(value)||(/^[\w.-]+\/[\w.-]+(?:#.*)?$/.test(value)));
  for(const entry of [pkg,...Object.values(lock.packages)]){
    if(entry.link)fail('暂不支持本地或工作区依赖。','UNSUPPORTED_DEPENDENCY');
    for(const section of ['dependencies','devDependencies','optionalDependencies'])for(const value of Object.values(entry[section]||{}))if(badSpec(value))fail('只支持 npm registry 锁定依赖。','UNSUPPORTED_DEPENDENCY');
    if(entry.resolved){let url;try{url=new URL(entry.resolved);}catch{fail('无效依赖下载地址。','UNSUPPORTED_DEPENDENCY');}if(url.protocol!=='https:'||url.hostname!=='registry.npmjs.org'||url.username||url.password||url.port)fail('依赖仅允许从 registry.npmjs.org 下载。','UNSUPPORTED_DEPENDENCY');if(!/^sha(256|384|512)-[A-Za-z0-9+/=]+$/.test(entry.integrity||''))fail('依赖缺少有效完整性校验。','UNSUPPORTED_DEPENDENCY');}
  }
  for(const key of Object.keys(lock.packages)){if(key&&!lock.packages[key].resolved)fail('依赖必须具有锁定的 registry 下载地址。','UNSUPPORTED_DEPENDENCY');if(key&&(!key.startsWith('node_modules/')||key.split('/').some(p=>p==='..'||p==='.')||key.includes('\\')))fail('锁文件包含不安全依赖路径。','UNSUPPORTED_DEPENDENCY');}
  const licenseFile=files.find(f=>/^(license|licence)(\.(txt|md))?$/i.test(f.path));if(!licenseFile)fail('仓库需要根目录 LICENSE，才能保留原作授权声明。','LICENSE_REQUIRED');
  const license=licenseFile.bytes.toString('utf8');if(license.length>100000||!license.trim())fail('许可证文本无效。','LICENSE_REQUIRED');
  return {pkg,lock,license,licensePath:licenseFile.path};
}
async function fetchArchive(repository,sha){const url=`https://codeload.github.com/${repository}/tar.gz/${sha}`;const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(45000),headers:{'User-Agent':'Funtrack-Isolated-Builder'}});if(!response.ok)fail(`GitHub 仓库下载失败（${response.status}）。`,'FETCH_FAILED');if(response.url!==url)fail('仓库下载发生未允许的重定向。','FETCH_FAILED');if(Number(response.headers.get('content-length'))>LIMITS.archive)fail('仓库压缩包超过 16 MiB。','ARCHIVE_TOO_LARGE');const chunks=[];let length=0;for await(const chunk of response.body){length+=chunk.length;if(length>LIMITS.archive)fail('仓库压缩包超过 16 MiB。','ARCHIVE_TOO_LARGE');chunks.push(chunk);}return Buffer.concat(chunks);}
async function command(command,args,{timeoutMs=60000,maxBytes=LIMITS.logs,signal}={}){
  return await new Promise((resolve,reject)=>{let text='',length=0,done=false;const child=spawn(command,args,{cwd:root,stdio:['ignore','pipe','pipe'],env:process.env});
    const stop=reason=>{if(done)return;done=true;child.kill('SIGKILL');clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(reason);};const abort=()=>stop(new BuildError('构建已取消。','BUILD_CANCELLED'));
    const timer=setTimeout(()=>stop(new BuildError('构建阶段超过时间限制。','BUILD_TIMEOUT')),timeoutMs);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const collect=chunk=>{length+=chunk.length;if(length>maxBytes){stop(new BuildError('构建日志超过上限。','BUILD_LOG_LIMIT'));return;}text+=chunk.toString();};child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.on('error',error=>stop(new BuildError('无法启动构建工具：'+error.code,'BUILD_TOOL_UNAVAILABLE')));child.on('exit',code=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(code!==0)reject(new BuildError(`构建命令失败（${code}）：${text.slice(-2500).replace(/\x1b\[[0-9;]*m/g,'')}`,'BUILD_COMMAND_FAILED'));else resolve(text);});
  });
}
export async function dockerRun(work,args,{network='none',toolkit=null,timeoutMs=LIMITS.buildMs,signal}={}){
  const name='funtrack-build-'+randomUUID();const argv=['run','--rm','--init','--name',name,'--user','1000:1000','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=1g','--memory-swap=1g','--cpus=2','--pids-limit=128','--network',network,'--tmpfs','/tmp:rw,nosuid,nodev,size=256m,mode=1777','--mount',`type=bind,source=${work},target=/work`,'--workdir','/work','--env','npm_config_cache=/tmp/npm'];
  if(toolkit)argv.push('--mount',`type=bind,source=${toolkit},target=/toolkit,readonly`);
  argv.push(BUILD_IMAGE,...args);
  try{return await command('docker',argv,{timeoutMs,signal});}finally{await command('docker',['rm','-f',name],{timeoutMs:10000}).catch(()=>{});}
}
let toolkitPromise;
async function prepareToolkit(signal){
  if(toolkitPromise)return toolkitPromise;
  toolkitPromise=(async()=>{const manifest=await readFile(path.join(toolkitSource,'package-lock.json'));const key=createHash('sha256').update(manifest).digest('hex').slice(0,16),directory=path.join(scratchRoot,'toolkit-'+key);await mkdir(directory,{recursive:true});await chmod(directory,0o777);for(const name of ['package.json','package-lock.json','bundle.mjs','inspect.mjs','export.mjs']){await copyFile(path.join(toolkitSource,name),path.join(directory,name));await chmod(path.join(directory,name),0o644);}try{await stat(path.join(directory,'node_modules/vite-plugin-singlefile/package.json'));}catch{await dockerRun(directory,['npm','ci','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org','--userconfig=/dev/null','--globalconfig=/tmp/funtrack-global-npmrc'],{network:'bridge',timeoutMs:LIMITS.installMs,signal});}return directory;})();
  try{return await toolkitPromise;}catch(error){toolkitPromise=null;throw error;}
}
async function listOutput(directory){const files=[];let total=0;async function visit(dir,prefix=''){for(const name of await readdir(dir)){const absolute=path.join(dir,name),relative=prefix+name,info=await lstat(absolute);if(info.isSymbolicLink())fail('构建产物不能包含链接。','UNSAFE_OUTPUT');if(info.isDirectory())await visit(absolute,relative+'/');else if(info.isFile()){total+=info.size;if(info.size>LIMITS.file||total>LIMITS.unpacked||files.length>=LIMITS.files)fail('构建产物超过大小或数量限制。','OUTPUT_TOO_LARGE');files.push({path:relative,size:info.size});}else fail('构建产物类型不支持。','UNSAFE_OUTPUT');}}await visit(directory);return {files,totalBytes:total};}
export function validatePackedHTML(html){if(typeof html!=='string'||Buffer.byteLength(html)>LIMITS.html||!/<html[\s>]/i.test(html))fail('最终 HTML 无效或超过 8 MiB。','OUTPUT_TOO_LARGE');const markup=html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi,'$1').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,'');for(const match of markup.matchAll(/\b(?:src|poster|srcset)\s*=\s*["']([^"']*)["']/gi))if(match[1]&&!/^(data:|#)/i.test(match[1]))fail('构建仍有未内联静态资源。','EXTERNAL_ASSET');for(const tag of markup.matchAll(/<(link|image|use)\b[^>]*>/gi)){const href=tag[0].match(/\b(?:href|xlink:href)\s*=\s*["']([^"']*)["']/i)?.[1];if(href&&!/^(data:|#)/i.test(href))fail('构建仍有未内联静态资源。','EXTERNAL_ASSET');}return html;}
async function createBuildSandbox(work,toolkit,signal){
  const name='funtrack-repo-'+randomUUID();
  await command('docker',['run','--detach','--init','--name',name,'--user','1000:1000','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=1g','--memory-swap=1g','--cpus=2','--pids-limit=128','--network','bridge','--tmpfs','/tmp:rw,nosuid,nodev,size=128m,mode=1777','--tmpfs','/work:rw,exec,nosuid,nodev,size=768m,uid=1000,gid=1000,mode=0700','--mount',`type=bind,source=${work},target=/input,readonly`,'--mount',`type=bind,source=${toolkit},target=/toolkit,readonly`,'--workdir','/work','--env','npm_config_cache=/tmp/npm',BUILD_IMAGE,'sleep','600'],{timeoutMs:30000,signal});
  return name;
}
async function containerCommand(container,args,options={}){return command('docker',['exec',container,...args],options);}
async function containerFile(container){
  const bytes=await new Promise((resolve,reject)=>{let chunks=[],size=0,done=false;const child=spawn('docker',['exec',container,'node','/toolkit/export.mjs'],{stdio:['ignore','pipe','pipe']});let errorText='';const timer=setTimeout(()=>stop(new BuildError('读取产物超时。','OUTPUT_TIMEOUT')),20000);
    function stop(error){if(done)return;done=true;clearTimeout(timer);child.kill('SIGKILL');reject(error);}
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>LIMITS.html)return stop(new BuildError('产物超过上限。','OUTPUT_TOO_LARGE'));chunks.push(chunk);});child.stderr.on('data',chunk=>errorText+=chunk.toString().slice(0,1000));child.on('error',()=>stop(new BuildError('无法提取构建产物。','OUTPUT_REQUIRED')));child.on('exit',code=>{if(done)return;done=true;clearTimeout(timer);if(code!==0)reject(new BuildError('无法提取构建产物：'+errorText.slice(0,1000),'OUTPUT_REQUIRED'));else resolve(Buffer.concat(chunks));});
  });return bytes.toString('utf8');
}
export async function buildRepository(job,{onProgress=async()=>{},signal}={}){
  const {repository,commitSha}=validateJob(job),started=Date.now(),timings={},logs=[];await mkdir(scratchRoot,{recursive:true});const scratch=await mkdtemp(path.join(scratchRoot,'job-')),work=path.join(scratch,'source');await mkdir(work);let container=null;
  const scopedSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(8*60*1000)]):AbortSignal.timeout(8*60*1000);
  async function stage(status,log,fn){await onProgress(status,log);const t=Date.now();try{return await fn();}finally{timings[status]=Date.now()-t;}}
  try{
    const archive=await stage('fetching','正在读取固定提交并检查仓库文件。',()=>fetchArchive(repository,commitSha)),files=unpackTar(archive),project=validateNpmProject(files);
    for(const file of files){const destination=path.join(work,file.path);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,file.bytes,{mode:0o644});}
    await stage('installing','正在安装锁定依赖（安装脚本已禁用）。',async()=>{const toolkit=await prepareToolkit(scopedSignal);container=await createBuildSandbox(work,toolkit,scopedSignal);await containerCommand(container,['cp','-R','/input/.','/work/'],{timeoutMs:10000,signal:scopedSignal});logs.push(await containerCommand(container,['npm','ci','--ignore-scripts','--include=dev','--no-audit','--no-fund','--registry=https://registry.npmjs.org','--userconfig=/dev/null','--globalconfig=/tmp/funtrack-global-npmrc'],{timeoutMs:LIMITS.installMs,signal:scopedSignal}));});
    // Removing the only network before any project/configuration code executes
    // also prevents access to the Docker Desktop host gateway from that code.
    await command('docker',['network','disconnect','bridge',container],{timeoutMs:15000,signal:scopedSignal});
    const networks=JSON.parse(await command('docker',['inspect','--format','{{json .NetworkSettings.Networks}}',container],{timeoutMs:10000}));if(Object.keys(networks).length)fail('构建容器未成功断网。','ISOLATION_FAILED');
    await stage('building','正在断网容器中执行项目构建。',async()=>logs.push(await containerCommand(container,['npm','--ignore-scripts','run','build'],{timeoutMs:LIMITS.buildMs,signal:scopedSignal})));
    let original;try{original=JSON.parse(await containerCommand(container,['node','/toolkit/inspect.mjs','dist'],{timeoutMs:15000,signal:scopedSignal}));}catch(error){fail('无法验收 dist/ 产物：'+error.message,'OUTPUT_REQUIRED');}
    await stage('packaging','正在封装资源并保留原作许可证。',async()=>logs.push(await containerCommand(container,['node','/toolkit/bundle.mjs'],{timeoutMs:LIMITS.buildMs,signal:scopedSignal})));
    await containerCommand(container,['node','/toolkit/inspect.mjs','.funtrack-bundle'],{timeoutMs:15000,signal:scopedSignal});
    // Docker cp cannot read tmpfs mounts. Stream one O_NOFOLLOW-checked file
    // through a trusted exporter, enforce the byte limit again on the host,
    // then remove the container before processing any returned HTML.
    let html=await containerFile(container);await command('docker',['rm','-f',container],{timeoutMs:10000});container=null;
    const notice=`\n<!--\nSource: https://github.com/${repository}/tree/${commitSha}\n${project.license.replaceAll('--','- -')}\n-->\n`;html=html.replace(/<head(\s[^>]*)?>/i,match=>match+notice);validatePackedHTML(html);
    const resultPath=path.join(scratch,'index.html');await writeFile(resultPath,html);await writeFile(path.join(scratch,'build.log'),logs.join('\n').slice(-LIMITS.logs));
    const metadata={repository,commitSha,sourceUrl:`https://github.com/${repository}/tree/${commitSha}`,framework:'vite',buildCommand:project.pkg.scripts.build,buildCommands:['npm ci --ignore-scripts --include=dev --no-audit --no-fund','npm --ignore-scripts run build','Vite + vite-plugin-singlefile@2.3.4 + static asset inlining'],originalDist:{fileCount:original.files.length,files:original.files.slice(0,32),totalBytes:original.totalBytes,truncated:original.files.length>32},sourceFiles:files.length,archiveBytes:archive.length,outputBytes:Buffer.byteLength(html),outputSha256:createHash('sha256').update(html).digest('hex'),license:{path:project.licensePath,sha256:createHash('sha256').update(project.license).digest('hex'),name:project.license.split('\n')[0].slice(0,150),productionDependencyNotices:'embedded in HTML'},image:BUILD_IMAGE,toolkit:{singlefile:'2.3.4',vite:'7.1.7'},timingsMs:{...timings,total:Date.now()-started},isolation:{workTmpfsMiB:768,tmpMiB:128,memoryMiB:1024,cpus:2,pids:128,sourceMount:'read-only',toolkitMount:'read-only'},network:{install:'npm registry dependencies; scripts disabled',build:'disconnected',packaging:'disconnected'}};
    await writeFile(path.join(scratch,'metadata.json'),JSON.stringify(metadata,null,2));return {html,filename:'index.html',outputPath:resultPath,metadata};
  }catch(error){await writeFile(path.join(scratch,'failure.json'),JSON.stringify({repository,commitSha,error:error.message,timingsMs:timings},null,2)).catch(()=>{});throw error;}
  finally{if(container)await command('docker',['rm','-f',container],{timeoutMs:10000}).catch(()=>{});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [repository,commitSha]=process.argv.slice(2);try{const result=await buildRepository({repository,commitSha},{onProgress:async(status,log)=>console.log(status+': '+log)});console.log(JSON.stringify({outputPath:result.outputPath,metadata:result.metadata},null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
