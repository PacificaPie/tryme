// HTTP boundary checks only: invalid imports never contact GitHub or publish.
// Resolver fixtures and its one live anonymous read are tested separately.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const base=new URL(process.env.FUNTRACK_TEST_URL||'http://127.0.0.1:8767');
assert(['localhost','127.0.0.1','[::1]'].includes(base.hostname),'Only loopback test identities are allowed.');
const user='import_test_'+randomUUID(),report={base:base.origin,checks:[],startedAt:new Date().toISOString()};
async function request(path,{method='GET',body,headers={},authenticated=true}={}){
  const response=await fetch(new URL(path,base),{method,headers:{...(authenticated?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@sites.test'}:{}),...(method==='POST'?{Origin:base.origin,'X-Funtrack-CSRF':'1','Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
}
async function check(name,fn){await fn();report.checks.push(name);console.log('PASS '+name);}
const endpoint='/api/imports/github';
await check('GitHub resolve requires platform identity and same-origin CSRF before any upstream request',async()=>{
  assert.equal((await request(endpoint,{method:'POST',body:{url:'https://github.com/example/repo'},authenticated:false})).status,401);
  for(const headers of [{Origin:'null'},{Origin:'https://other.example'},{'X-Funtrack-CSRF':''}])assert.equal((await request(endpoint,{method:'POST',body:{url:'https://github.com/example/repo'},headers})).status,403);
});
await check('malformed and arbitrary-host imports are rejected without creating works',async()=>{
  assert.equal((await request('/api/works?mine=1')).body.works.length,0);
  for(const url of [undefined,42,'http://github.com/example/repo','https://github.com.evil.example/example/repo','https://127.0.0.1/index.html','https://github.com/example/repo/blob/main/game.js','https://user:pass@github.com/example/repo']){
    const result=await request(endpoint,{method:'POST',body:{url}});assert.equal(result.status,422,JSON.stringify(result.body));assert.equal(result.body.error.code,'INVALID_GITHUB_URL');
  }
  assert.equal((await request(endpoint,{method:'POST',body:{url:'bad'},headers:{'Content-Type':'text/plain'}})).status,415);
  assert.equal((await request('/api/works?mine=1')).body.works.length,0);
});
report.completedAt=new Date().toISOString();await mkdir('.preview',{recursive:true});await writeFile('.preview/local-imports-integration.json',JSON.stringify(report,null,2));
console.log(`Completed ${report.checks.length} checks. Evidence: .preview/local-imports-integration.json`);
