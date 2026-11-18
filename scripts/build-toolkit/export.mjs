import {REPOSITORY_LIMITS as LIMITS,htmlSizeMessage} from './limits.mjs';
import {open,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
const filename='/work/.funtrack-bundle/index.html';
if(await realpath(filename)!==filename)throw Error('Output path cannot contain links.');
const file=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
try{const stat=await file.stat();if(!stat.isFile())throw Error('Output is not a regular HTML file.');if(stat.size>LIMITS.html)throw Error(htmlSizeMessage(stat.size));const bytes=await file.readFile();if(bytes.length>LIMITS.html)throw Error(htmlSizeMessage(bytes.length));process.stdout.write(bytes);}finally{await file.close();}
