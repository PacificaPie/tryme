import {REPOSITORY_LIMITS as LIMITS} from './limits.mjs';
// Trusted adapter, executed only in the offline build container.
import {readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {viteSingleFile} from 'vite-plugin-singlefile';
import {parse,serialize} from 'parse5';
const root='/work',output='/work/.funtrack-bundle';
const vitePackage=JSON.parse(await readFile(root+'/node_modules/vite/package.json','utf8'));
const major=Number(vitePackage.version.split('.')[0]);
if(major<5||major>7)throw Error('当前构建适配器支持 Vite 5–7 静态项目。');
const {build}=await import(pathToFileURL(root+'/node_modules/vite/dist/node/index.js'));
await build({root,base:'./',plugins:[viteSingleFile({removeViteModuleLoader:true})],build:{outDir:output,emptyOutDir:true,assetsInlineLimit:()=>true,cssCodeSplit:false,sourcemap:false,rollupOptions:{output:{inlineDynamicImports:true}}}});
const types={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.avif':'image/avif','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.mp4':'video/mp4','.webm':'video/webm'};
const files=new Map();let totalBytes=0;
async function walk(dir,prefix=''){
  for(const name of await readdir(dir)){const absolute=path.join(dir,name),relative=prefix+name,stat=await lstat(absolute);if(stat.isSymbolicLink())throw Error('构建产物不能包含符号链接。');if(stat.isDirectory())await walk(absolute,relative+'/');else if(stat.isFile()){totalBytes+=stat.size;if(stat.size>LIMITS.file||totalBytes>LIMITS.unpacked||files.size>=LIMITS.files)throw Error('构建产物超过单文件、总大小或文件数量限制。');files.set(relative,await readFile(absolute));}else throw Error('构建产物类型不支持。');}
}
await walk(output);
if(!files.has('index.html'))throw Error('构建没有生成根目录 index.html。');
let html=files.get('index.html').toString('utf8');
function dataURL(value){
  if(!value||value.startsWith('#')||/^data:/i.test(value))return value;
  if(/^[a-z][\w+.-]*:/i.test(value)||value.startsWith('//'))throw Error('构建仍依赖外部资源：'+value.slice(0,150));
  let relative;try{relative=decodeURIComponent(value.split(/[?#]/)[0]).replace(/^\.\//,'').replace(/^\//,'');}catch{throw Error('无效资源路径。');}
  if(relative.split('/').some(x=>x==='..'||x==='.')||relative.includes('\\'))throw Error('无效资源路径。');
  const bytes=files.get(relative),mime=types[path.extname(relative).toLowerCase()];
  if(!bytes||!mime)throw Error('资源未被内联：'+value.slice(0,150));
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
function inlineCSS(css){if(/@import\s+["']/i.test(css))throw Error('构建仍依赖未内联的 CSS import。');return css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,(_,a,b,c)=>`url("${dataURL((a??b??c).trim())}")`);}
const document=parse(html);
function visit(node){
  if(node.attrs){
    if(node.tagName==='base')throw Error('构建产物含不支持的 base 标签。');
    for(const attr of node.attrs){
      if(attr.name==='style')attr.value=inlineCSS(attr.value);
      if(attr.name==='srcset'||attr.name==='imagesrcset')throw Error('当前不支持未内联的响应式资源集合。');
      if(['src','poster'].includes(attr.name)||(attr.name==='data'&&node.tagName==='object')||(['href','xlink:href'].includes(attr.name)&&['link','image','use','feImage'].includes(node.tagName)))attr.value=dataURL(attr.value);
    }
  }
  if(node.tagName==='style')for(const child of node.childNodes||[])if(child.nodeName==='#text')child.value=inlineCSS(child.value);
  if(node.tagName==='script')for(const child of node.childNodes||[])if(child.nodeName==='#text'){
    // Public assets referenced as literal JS strings are not handled by Vite's asset pipeline.
    for(const [relative,bytes] of files){const mime=types[path.extname(relative).toLowerCase()];if(!mime)continue;const data=`data:${mime};base64,${bytes.toString('base64')}`;
      for(const reference of [relative,'./'+relative,'/'+relative])for(const quote of ['"',"'"]){const token=quote+reference+quote;child.value=child.value.split(token).join(quote+data+quote);}
    }
  }
  for(const child of node.childNodes||[])visit(child);if(node.content)visit(node.content);
}
visit(document);html=serialize(document);
const lock=JSON.parse(await readFile('/work/package-lock.json','utf8')),notices=[];let noticeBytes=0;
for(const [directory,entry] of Object.entries(lock.packages||{})){
  if(!directory||entry.dev===true)continue;
  const packageRoot=path.resolve('/work',directory);if(!packageRoot.startsWith('/work/node_modules/'))throw Error('Invalid runtime dependency path.');
  let names;try{names=await readdir(packageRoot);}catch{if(entry.optional)continue;throw Error('Runtime dependency missing: '+directory);}
  const licenseNames=names.filter(name=>/^(license|licence|copying|notice)(?:[.-].*)?$/i.test(name));
  for(const name of licenseNames){const file=path.join(packageRoot,name),info=await lstat(file);if(info.isSymbolicLink()||!info.isFile())continue;if(info.size>128*1024)throw Error('Dependency license is too large.');const text=await readFile(file,'utf8');noticeBytes+=Buffer.byteLength(text);if(noticeBytes>512*1024)throw Error('Dependency license notices exceed limit.');notices.push(`${directory}/${name}\n${text}`);}
  if(!licenseNames.length)throw Error('Runtime dependency requires license review: '+directory);
}
const notice='\n<!-- Third-party runtime dependency notices\n'+notices.join('\n\n').replaceAll('--','- -')+'\n-->\n';
html=html.replace(/<head(\s[^>]*)?>/i,match=>match+notice);
await writeFile(output+'/index.html',html);
console.log('Funtrack: bundled entry with static assets inlined.');
