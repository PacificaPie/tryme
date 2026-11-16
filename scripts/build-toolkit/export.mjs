import {open,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
const filename='/work/.funtrack-bundle/index.html';
if(await realpath(filename)!==filename)throw Error('Output path cannot contain links.');
const file=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
try{const stat=await file.stat();if(!stat.isFile()||stat.size>8*1024*1024)throw Error('Output is not a bounded regular HTML file.');const bytes=await file.readFile();if(bytes.length>8*1024*1024)throw Error('Output limit exceeded.');process.stdout.write(bytes);}finally{await file.close();}
