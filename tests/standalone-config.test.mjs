import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  standaloneRoot, readStandaloneConfig, placeholderDatabaseId,
  productionDatabaseIds, validateStandaloneProduction, validateStandaloneStaging,
} from '../scripts/standalone-config.mjs';

const testSecret = 'sk_test_synthetic_offline_config_test';
const liveSecret = 'sk_live_synthetic_offline_config_test';
const publishable = (mode, value = 'example.clerk.accounts.dev$') => `pk_${mode}_${Buffer.from(value).toString('base64')}`;
const staging = () => ({
  name: 'funtrack-staging', main: './worker/standalone.ts',
  workers_dev: true, preview_urls: false,
  vars: { APP_ORIGIN: 'https://funtrack-staging.test-account.workers.dev', CLERK_TEST_MODE: '1', CLERK_PUBLISHABLE_KEY: publishable('test') },
  secrets: { required: ['CLERK_SECRET_KEY'] },
  d1_databases: [{ binding: 'DB', database_name: 'funtrack-staging', database_id: '69196d4d-4dac-4cf4-b2b2-a04a7f22f078' }],
  r2_buckets: [{ binding: 'BUCKET', bucket_name: 'funtrack-staging' }],
});
const production = () => {
  const config = staging();
  Object.assign(config, { name: 'funtrack-production', workers_dev: false, routes: [{ pattern: 'play.funtrack.app', custom_domain: true }] });
  config.vars = { APP_ORIGIN: 'https://play.funtrack.app', CLERK_PUBLISHABLE_KEY: publishable('live') };
  Object.assign(config.d1_databases[0], { database_name: 'funtrack-production', database_id: productionDatabaseIds[0] });
  config.r2_buckets[0].bucket_name = 'funtrack-production';
  return config;
};

test('staging accepts padded and unpadded valid Clerk keys using runtime validation', () => {
  for (const domain of ['a.clerk.accounts.dev$', 'ab.clerk.accounts.dev$', 'abc.clerk.accounts.dev$']) {
    const config = staging();
    config.vars.CLERK_PUBLISHABLE_KEY = publishable('test', domain);
    assert.deepEqual(validateStandaloneStaging(config, testSecret), []);
    config.vars.CLERK_PUBLISHABLE_KEY = config.vars.CLERK_PUBLISHABLE_KEY.replace(/=+$/, '');
    assert.deepEqual(validateStandaloneStaging(config, testSecret), []);
  }
});

test('staging rejects missing, live, mixed or malformed keys and never prints secret values', () => {
  for (const [key, secret] of [
    ['', testSecret], [publishable('test'), undefined], [publishable('test'), 'sk_test_'],
    [publishable('live'), liveSecret], [publishable('live'), testSecret], [publishable('test'), liveSecret],
    ['pk_test_not_base64', testSecret], [publishable('test', 'https://wrong.example/$'), testSecret],
    [publishable('test', 'no-trailing-marker.example'), testSecret],
  ]) {
    const config = staging(); config.vars.CLERK_PUBLISHABLE_KEY = key;
    const errors = validateStandaloneStaging(config, secret);
    assert.ok(errors.length > 0);
    if (secret) assert.ok(!errors.join('\n').includes(secret));
  }
});

test('staging must opt in to test mode explicitly', () => {
  for (const value of [undefined, '0', 1, true, 'true']) {
    const config = staging(); config.vars.CLERK_TEST_MODE = value;
    assert.ok(validateStandaloneStaging(config, testSecret).some(message => message.includes('CLERK_TEST_MODE')));
  }
});

test('staging accepts only its one exact workers.dev origin', () => {
  for (const origin of [
    'http://funtrack-staging.test-account.workers.dev',
    'https://other-staging.test-account.workers.dev',
    'https://funtrack-staging.test-account.workers.dev/',
    'https://funtrack-staging.test-account.workers.dev/path',
    'https://funtrack-staging.test-account.workers.dev?x=1',
    'https://funtrack-staging.test-account.workers.dev:8443',
    'https://user@funtrack-staging.test-account.workers.dev',
    'https://funtrack-staging.test-account.workers.dev.attacker.invalid',
    'https://preview.funtrack-staging.test-account.workers.dev',
    'https://funtrack-staging.example.workers.dev',
    'https://play.funtrack.app', 'http://127.0.0.1:8787',
  ]) {
    const config = staging(); config.vars.APP_ORIGIN = origin;
    assert.ok(validateStandaloneStaging(config, testSecret).some(message => message.includes('APP_ORIGIN')), origin);
  }
});

test('staging cannot expose custom routes or secondary preview URLs', () => {
  for (const patch of [{ workers_dev: false }, { preview_urls: true }, { routes: [{ pattern: 'play.funtrack.app', custom_domain: true }] }, { route: 'play.funtrack.app/*' }]) {
    assert.ok(validateStandaloneStaging({ ...staging(), ...patch }, testSecret).some(message => message.includes('workers_dev')));
  }
});

test('staging rejects production IDs even with a staging database name', () => {
  const config = staging(); config.d1_databases[0].database_id = productionDatabaseIds[0].toUpperCase();
  assert.ok(validateStandaloneStaging(config, testSecret).some(message => message.includes('production D1 database ID')));
  const custom = staging();
  assert.ok(validateStandaloneStaging(custom, testSecret, { databaseIds: [custom.d1_databases[0].database_id] }).length);
  assert.ok(validateStandaloneStaging(custom, testSecret, { bucketNames: [custom.r2_buckets[0].bucket_name] }).length);
});

test('staging requires real, separate named DB and bucket bindings', () => {
  for (const change of [
    config => { config.d1_databases[0].database_id = placeholderDatabaseId; },
    config => { config.d1_databases[0].database_name = 'funtrack-production'; },
    config => { config.r2_buckets[0].bucket_name = 'funtrack-production'; },
    config => { config.d1_databases.push({ ...config.d1_databases[0], binding: 'OTHER' }); },
    config => { config.r2_buckets.push({ ...config.r2_buckets[0], binding: 'OTHER' }); },
    config => { config.d1_databases[0].binding = 'OTHER'; },
    config => { config.name = 'funtrack-staging-production'; },
  ]) {
    const config = staging(); change(config); assert.ok(validateStandaloneStaging(config, testSecret).length);
  }
});

test('staging never permits config secrets or a Sites entry/binding', () => {
  for (const change of [
    config => { config.vars.CLERK_SECRET_KEY = testSecret; },
    config => { config.secrets.required = []; },
    config => { config.main = './worker/index.ts'; },
    config => { config.services = [{ binding: 'CONNECTORS', service: 'example' }]; },
  ]) {
    const config = staging(); change(config); assert.ok(validateStandaloneStaging(config, testSecret).length);
  }
});

test('production rules remain strict and do not accept the staging mode', () => {
  assert.deepEqual(validateStandaloneProduction(production(), liveSecret), []);
  assert.ok(validateStandaloneProduction(staging(), testSecret).length);
  const config = production(); config.vars.CLERK_TEST_MODE = '1';
  assert.ok(validateStandaloneProduction(config, liveSecret).length);
  config.vars.CLERK_TEST_MODE = '0'; config.routes = [];
  assert.ok(validateStandaloneProduction(config, liveSecret).length);
});

test('checked-in staging config has usable public bindings but still requires private secret', () => {
  const config = readStandaloneConfig(`${standaloneRoot}/wrangler.standalone.staging.jsonc`);
  assert.deepEqual(validateStandaloneStaging(config, testSecret), []);
  assert.ok(validateStandaloneStaging(config, undefined).length);
});

test('CLI staging selection is explicit and defaults to production validation', () => {
  const env = { ...process.env, CLERK_SECRET_KEY: testSecret };
  const invoke = args => spawnSync(process.execPath, ['scripts/standalone.mjs', 'validate', '--config', 'wrangler.standalone.staging.jsonc', ...args], { cwd: standaloneRoot, env, encoding: 'utf8' });
  const stage = invoke(['--mode', 'staging']); assert.equal(stage.status, 0, stage.stderr);
  assert.equal(invoke([]).status, 1);
  const unknown = invoke(['--mode', 'preview']); assert.notEqual(unknown.status, 0);
  assert.ok(!`${stage.stdout}${stage.stderr}`.includes(testSecret));
});
