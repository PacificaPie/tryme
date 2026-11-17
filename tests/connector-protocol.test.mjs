import test from 'node:test';
import assert from 'node:assert/strict';
import { invocationSchema, grantsSchema, sessionOptionsSchema, driverMessageSchema } from '../scripts/connector-preview/protocol.mjs';

test('connector invocation keeps string-keyed arbitrary arguments while rejecting control fields', () => {
  const value = { connectorId: 'fixture', actionName: 'read', arguments: { query: '作品', limit: 3, nested: { values: [1, false, null] } } };
  assert.deepEqual(invocationSchema.parse(value), value);
  assert.equal(invocationSchema.safeParse({ ...value, accountId: 'not-selected-by-agent' }).success, false);
  assert.equal(invocationSchema.safeParse({ ...value, connectorId: '../outside' }).success, false);
  assert.equal(invocationSchema.safeParse({ ...value, arguments: ['not-a-record'] }).success, false);
});

test('connector response records preserve MCP result fields and reject malformed envelopes', () => {
  const id = '72ee711f-f14e-4bae-8295-49e26762769b';
  const value = { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'result' }], structuredContent: { total: 1 }, isError: false } };
  assert.deepEqual(driverMessageSchema.parse(value), value);
  assert.equal(driverMessageSchema.safeParse({ ...value, result: [value.result] }).success, false);
  assert.equal(driverMessageSchema.safeParse({ ...value, method: 'unexpected' }).success, false);
  assert.deepEqual(driverMessageSchema.parse({ jsonrpc: '2.0', method: 'stop' }), { jsonrpc: '2.0', method: 'stop' });
});

test('Zod upgrade preserves read-only grants and bounded preview session settings', () => {
  const grant = { connectorId: 'fixture', actionName: 'read', readOnly: true };
  assert.deepEqual(grantsSchema.parse([grant]), [grant]);
  assert.equal(grantsSchema.safeParse([{ ...grant, readOnly: false }]).success, false);
  assert.deepEqual(sessionOptionsSchema.parse({}), { timeoutMs: 120000, maxConcurrent: 64 });
  for (const invalid of [{ timeoutMs: 2 ** 31 }, { maxConcurrent: 0 }, { maxCalls: 1.5 }, { lifetimeMs: -1 }]) {
    assert.equal(sessionOptionsSchema.safeParse(invalid).success, false);
  }
});
