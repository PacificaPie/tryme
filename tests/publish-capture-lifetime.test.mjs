import test from 'node:test';
import assert from 'node:assert/strict';
import {retainPublishCapture} from '../lib/funtrack/publish-capture-lifetime.mjs';

test('a disconnected capture retains the admitted response work for same-ID recovery',async()=>{
 let finish,settled=false;const retained=[];
 const response=new Promise(resolve=>finish=resolve),context={waitUntil(p){retained.push(p);}};
 const result=retainPublishCapture(new Request('https://site.test/api/publish-drafts/draft-id/capture',{method:'POST'}),context,response);
 assert.equal(result,response);assert.equal(retained.length,1);
 retained[0].then(()=>settled=true);await Promise.resolve();assert.equal(settled,false);
 const value=Response.json({status:'ready'});finish(value);await retained[0];assert.equal(await result,value);
});

test('retention neither expands to other routes nor suppresses response failures',async()=>{
 const context={waitUntil(){assert.fail('unrelated request retained');}};
 for(const [method,path] of [['GET','/api/publish-drafts/draft-id/capture'],['POST','/api/works'],['POST','/api/publish-drafts'],['POST','/api/publish-drafts/draft-id/capture/extra']]){
  const response=Promise.resolve(new Response());assert.equal(retainPublishCapture(new Request('https://site.test'+path,{method}),context,response),response);
 }
 let retained;const error=Error('failed');const response=Promise.reject(error);
 const result=retainPublishCapture(new Request('https://site.test/api/publish-drafts/draft-id/capture',{method:'POST'}),{waitUntil(p){retained=p;}},response);
 await assert.rejects(result,error);await retained;
});
