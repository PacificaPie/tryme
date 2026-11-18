import test from 'node:test';
import assert from 'node:assert/strict';
import {readLimited} from '../cloud-builder/src/protocol.mjs';
import {HTML_MAX_BYTES} from '../lib/funtrack/limits.mjs';

test('cloud artifact transport accepts 16 MiB and classifies both declared and streamed excess',async()=>{
  const options={code:'OUTPUT_TOO_LARGE',label:'最终 HTML'};
  const bytes=await readLimited(new Response(new Uint8Array(HTML_MAX_BYTES)),HTML_MAX_BYTES,true,options);
  assert.equal(bytes.length,16*1024*1024);
  for(const response of [new Response(new Uint8Array(HTML_MAX_BYTES+1)),new Response('',{headers:{'Content-Length':String(HTML_MAX_BYTES+1)}})]){
    await assert.rejects(readLimited(response,HTML_MAX_BYTES,true,options),error=>error.code==='OUTPUT_TOO_LARGE'&&error.message.includes('16 MiB 上限')&&error.message.includes('至少'));
  }
});
