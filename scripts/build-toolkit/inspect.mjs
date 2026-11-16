import {readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('/work',process.argv[2]||'dist');
if(!root.startsWith('/work/'))throw Error('Invalid output root.');
const files=[];let totalBytes=0;
async function walk(dir,prefix=''){for(const name of await readdir(dir)){if(/[\x00-\x1f\x7f]/.test(name))throw Error('Invalid output name.');const file=path.join(dir,name),info=await lstat(file),relative=prefix+name;if(info.isSymbolicLink())throw Error('Output links are unsupported.');if(info.isDirectory())await walk(file,relative+'/');else if(info.isFile()){totalBytes+=info.size;if(info.size>8*1024*1024||totalBytes>64*1024*1024||files.length>=5000)throw Error('Output limits exceeded.');files.push({path:relative,size:info.size});}else throw Error('Unsupported output type.');}}
await walk(root);console.log(JSON.stringify({files,totalBytes}));
