import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {checkOperations} from '../scripts/operations-healthcheck.mjs';
const healthy=url=>new URL(url).pathname==='/site'?new Response('<html>TryMe</html>'):new URL(url).pathname==='/api/public/discover'?Response.json({works:[]}):new URL(url).pathname==='/api/auth/config'?Response.json({provider:'clerk',configured:true}):Response.json({error:{code:'AUTH_REQUIRED'}},{status:401});
test('health probe requires public data, configured auth and an intact anonymous boundary',async()=>{
 assert.equal((await checkOperations('https://example.test',{fetchImpl:healthy})).ok,true);
 for(const path of ['/site','/api/public/discover','/api/auth/config','/api/me']){
  const result=await checkOperations('https://example.test',{fetchImpl:url=>new URL(url).pathname===path?Response.json({private:'never logged'}):healthy(url)});assert.equal(result.ok,false);assert(!JSON.stringify(result).includes('never logged'));
 }
});
test('health probe bounds a stalled response body and rejects credential-bearing origins',async t=>{
 const server=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.write('{');});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 const result=await checkOperations('http://127.0.0.1:'+server.address().port,{timeoutMs:100});assert.equal(result.ok,false);assert(result.checks.some(c=>c.reason==='TIMEOUT'));
 await assert.rejects(checkOperations('https://user:password@example.test'),/bare HTTPS/);
});
