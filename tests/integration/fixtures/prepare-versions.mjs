// Generates local-only fixture files. This command does NOT execute SQL, start
// a Worker, access credentials, or contact GitHub. Apply the SQL before startup.
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const run = randomUUID(), now = new Date().toISOString();
const leaseExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const fixture = { run, owner: `versions_owner_${run}`, reader: `versions_reader_${run}`, builds: {} };
for (const [name, role, status] of [['ready', 'owner', 'packaging'], ['otherReady', 'reader', 'packaging'], ['queued', 'owner', 'queued'], ['failed', 'owner', 'failed']]) {
  fixture.builds[name] = { id: randomUUID(), owner: fixture[role], status, leaseId: status === 'packaging' ? randomUUID() : null };
}
const quote = value => value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const columns = ['id', 'owner_id', 'idempotency_key', 'request_hash', 'source_url', 'repository', 'commit_sha', 'status', 'logs', 'lease_id', 'lease_expires_at', 'created_at', 'updated_at'];
const statements = Object.values(fixture.builds).map(build => {
  const values = [build.id, build.owner, build.id, 'local-version-fixture', 'https://github.com/yuss-raa/Snake-Game', 'yuss-raa/Snake-Game', '1f76427453c48f6f0a02d09a12e0469451c0d1e3', build.status, '', build.leaseId, build.leaseId ? leaseExpiresAt : null, now, now];
  return `INSERT INTO ft_build_jobs (${columns.join(',')}) VALUES (${values.map(quote).join(',')});`;
});
await mkdir('.preview', { recursive: true });
await writeFile('.preview/version-build-fixtures.json', JSON.stringify(fixture, null, 2));
await writeFile('.preview/version-build-fixtures.sql', '-- Generated local integration fixtures. NEVER apply to production.\n' + statements.join('\n') + '\n');
console.log('Prepared .preview/version-build-fixtures.sql and .json; no database changes were made.');
