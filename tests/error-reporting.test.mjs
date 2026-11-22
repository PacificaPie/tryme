import test from 'node:test';
import assert from 'node:assert/strict';
import {reportUnexpectedError} from '../lib/funtrack/error-reporting.mjs';
import {fixture} from './helpers/router-fixture.mjs';

test('unexpected errors log only bounded metadata, never exception strings, SQL or credentials',()=>{
  const records=[],secret='secret-synthetic-do-not-log';
  for(const error of [new TypeError(secret),{name:secret,message:secret,stack:secret,cause:secret},secret,null]){
    const id=reportUnexpectedError(error,secret,{error:entry=>records.push(JSON.parse(entry))});
    assert.match(id,/^[a-f0-9-]{36}$/);assert.equal(records.at(-1).requestId,id);
  }
  assert(!JSON.stringify(records).includes(secret));assert(records.every(r=>r.event==='application_error'&&r.operation==='api'));
  assert.equal(records[0].errorType,'TypeError');assert.equal(new Set(records.map(r=>r.requestId)).size,4);
  assert.doesNotThrow(()=>reportUnexpectedError(Error('Failure'),'media',{error(){throw Error('Log sink unavailable');}}));
});

test('HTTP 500 responses correlate to a safe log record and expected denials do not create exception logs',async t=>{
  const f=fixture(t),records=[],original=console.error;
  console.error=entry=>records.push(JSON.parse(entry));t.after(()=>{console.error=original;});
  f.db.prepare=()=>{throw Error('SQL contains a private value');};
  const failed=await f.api('/api/me');assert.equal(failed.status,500);assert.equal(failed.error.code,'INTERNAL_ERROR');
  assert.equal(records.length,1);assert.equal(records[0].requestId,failed.error.requestId);
  assert(!JSON.stringify({failed,records}).includes('private value'));
  const denied=await f.api('/api/me',{extraHeaders:{'X-Funtrack-Expected-User':'other'}});assert.equal(denied.status,409);assert.equal(records.length,1);
});
