import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { isIP } from 'node:net';
import { standaloneAuthConfig } from '../lib/funtrack/standalone-auth.mjs';

export const standaloneRoot = fileURLToPath(new URL('../', import.meta.url));
export const standaloneOutput = path.join(standaloneRoot, 'dist-standalone');
export const standaloneState = path.join(standaloneRoot, '.preview/standalone-state');
export const placeholderDatabaseId = '00000000-0000-4000-8000-000000000000';
// Public resource identifiers, never credentials. A staging name cannot disguise
// a production binding; also include the selected production config when present.
export const productionDatabaseIds = Object.freeze(['106c5ea7-2c17-44ea-93f5-5383168365c0']);
export const standaloneConfigPath = () => path.resolve(standaloneRoot, process.env.FUNTRACK_STANDALONE_CONFIG || 'wrangler.standalone.jsonc');

export function readStandaloneConfig(filename = standaloneConfigPath()) {
  const parsed = ts.parseConfigFileTextToJson(filename, readFileSync(filename, 'utf8'));
  if (parsed.error || !parsed.config || typeof parsed.config !== 'object' || Array.isArray(parsed.config)) throw new Error('Standalone configuration must be a valid JSON/JSONC object.');
  return parsed.config;
}
export function isLoopbackOrigin(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.origin === value; } catch { return false; }
}

export function productionResources() {
  const filename = path.join(standaloneRoot, 'wrangler.standalone.production.jsonc');
  const config = existsSync(filename) ? readStandaloneConfig(filename) : {};
  return {
    databaseIds: [...productionDatabaseIds, ...(config.d1_databases || []).map(database => database.database_id)],
    bucketNames: ['funtrack-production', ...(config.r2_buckets || []).map(bucket => bucket.bucket_name)],
  };
}

function validateWechatSettings(config) {
  const vars = config.vars || {}, enabled = vars.WECHAT_LOGIN_ENABLED;
  const errors = [];
  if (enabled !== undefined && !['0', '1'].includes(enabled)) errors.push('WECHAT_LOGIN_ENABLED must be the string "0" or "1".');
  if (enabled === '1') {
    if (!/^wx[0-9a-f]{16}$/.test(vars.WECHAT_APP_ID || '')) errors.push('Enabled WeChat login requires a valid WECHAT_APP_ID from the approved website application.');
    if (!config.secrets?.required?.includes('WECHAT_APP_SECRET')) errors.push('Enabled WeChat login must declare WECHAT_APP_SECRET in secrets.required.');
  }
  return errors;
}

export function validateStandaloneStaging(config, secretKey, protectedResources = { databaseIds: [], bucketNames: [] }) {
  const errors = validateWechatSettings(config), vars = config.vars || {};
  let origin;
  try { origin = new URL(vars.APP_ORIGIN); } catch {}
  const labels = origin?.hostname.split('.') || [];
  const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (!origin || origin.origin !== vars.APP_ORIGIN || origin.protocol !== 'https:' || origin.port ||
      labels.length !== 4 || labels[2] !== 'workers' || labels[3] !== 'dev' ||
      !dnsLabel.test(labels[0]) || !dnsLabel.test(labels[1]) || labels[0] !== config.name ||
      /^(?:example|placeholder|replace|your-account|your-subdomain)$/.test(labels[1])) {
    errors.push('Staging APP_ORIGIN must be the exact HTTPS <worker-name>.<account-subdomain>.workers.dev origin, matching the Worker name.');
  }
  if (config.workers_dev !== true || config.preview_urls !== false || (config.routes?.length ?? 0) !== 0 || config.route) errors.push('Staging requires workers_dev:true, preview_urls:false and no custom routes.');
  if (vars.CLERK_TEST_MODE !== '1') errors.push('Staging requires explicit CLERK_TEST_MODE:"1".');
  if (typeof vars.CLERK_PUBLISHABLE_KEY !== 'string' || !vars.CLERK_PUBLISHABLE_KEY.startsWith('pk_test_')) errors.push('Staging requires a Clerk pk_test publishable key.');
  if (typeof secretKey !== 'string' || !/^sk_test_[A-Za-z0-9_-]+$/.test(secretKey)) errors.push('Staging requires a Clerk sk_test secret key supplied privately to this process.');
  const auth = standaloneAuthConfig({ ...vars, CLERK_SECRET_KEY: secretKey });
  if (!auth.configured || auth.environment !== 'test') errors.push('Clerk settings must pass the same test configuration validation as the Worker.');
  if (Object.keys(vars).some(name => /SECRET|TOKEN|PASSWORD|PRIVATE_KEY/i.test(name))) errors.push('Secret material must use encrypted Worker secrets, never config.vars.');
  const databases = config.d1_databases || [], buckets = config.r2_buckets || [];
  const database = databases.find(value => value.binding === 'DB'), bucket = buckets.find(value => value.binding === 'BUCKET');
  const stagingName = value => typeof value === 'string' && /(?:^|[-_])staging(?:[-_]|$)/.test(value) && !/(?:^|[-_])(?:prod|production|local|placeholder|replace|site-creator)(?:[-_]|$)/i.test(value);
  if (!stagingName(config.name)) errors.push('The staging Worker name must contain a separate staging segment.');
  if (databases.length !== 1 || !database || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(database.database_id || '') || database.database_id === placeholderDatabaseId || /^0+-/.test(database.database_id || '') || !stagingName(database.database_name)) errors.push('Staging DB must identify one real D1 database with a separate staging name.');
  const forbiddenDatabases = [...productionDatabaseIds, ...(protectedResources.databaseIds || [])].map(value => String(value).toLowerCase());
  if (forbiddenDatabases.includes(String(database?.database_id).toLowerCase())) errors.push('Staging cannot use a production D1 database ID, even under a staging name.');
  if (buckets.length !== 1 || !bucket || !stagingName(bucket.bucket_name) || ['funtrack-production', ...(protectedResources.bucketNames || [])].includes(bucket.bucket_name)) errors.push('Staging BUCKET must identify one separate staging R2 bucket, never a production bucket.');
  if (config.services?.some(value => value.binding === 'CONNECTORS') || config.main?.includes('worker/index.ts')) errors.push('A standalone deployment cannot use the Sites worker or CONNECTORS binding.');
  if (!config.secrets?.required?.includes('CLERK_SECRET_KEY')) errors.push('Declare CLERK_SECRET_KEY in secrets.required; never place its value in the config.');
  return errors;
}

export function validateStandalone(config, secretKey, mode = 'production') {
  if (mode === 'production') return validateStandaloneProduction(config, secretKey);
  if (mode === 'staging') return validateStandaloneStaging(config, secretKey, productionResources());
  throw new Error('Standalone validation mode must be production or staging.');
}

// Offline validation only. Values are never printed; the secret is used only
// to reject missing/test credentials before an operator plans a deployment.
export function validateStandaloneProduction(config, secretKey) {
  const errors = validateWechatSettings(config), vars = config.vars || {};
  let origin;
  try { origin = new URL(vars.APP_ORIGIN); } catch {}
  if (!origin || origin.origin !== vars.APP_ORIGIN || origin.protocol !== 'https:' || isLoopbackOrigin(vars.APP_ORIGIN) || isIP(origin.hostname.replace(/^\[|\]$/g, '')) || /(?:^|\.)(?:example\.(?:com|org|net)|localhost|local|invalid|test)$/.test(origin.hostname)) errors.push('APP_ORIGIN must be one exact public HTTPS domain origin without a trailing slash.');
  if (vars.CLERK_TEST_MODE !== undefined && vars.CLERK_TEST_MODE !== '' && vars.CLERK_TEST_MODE !== '0') errors.push('CLERK_TEST_MODE must be disabled for production.');
  if (typeof vars.CLERK_PUBLISHABLE_KEY !== 'string' || !vars.CLERK_PUBLISHABLE_KEY.startsWith('pk_live_')) errors.push('CLERK_PUBLISHABLE_KEY must be a production pk_live key in the selected config.');
  if (typeof secretKey !== 'string' || !/^sk_live_[A-Za-z0-9_-]+$/.test(secretKey)) errors.push('CLERK_SECRET_KEY must be a production sk_live key supplied privately to this process.');
  const auth = standaloneAuthConfig({ ...vars, CLERK_SECRET_KEY: secretKey });
  if (!auth.configured || auth.environment !== 'production') errors.push('Clerk settings must pass the same production configuration validation as the Worker.');
  if (Object.keys(vars).some(name => /SECRET|TOKEN|PASSWORD|PRIVATE_KEY/i.test(name))) errors.push('Secret material must use encrypted Worker secrets, never config.vars.');
  const databases = config.d1_databases || [], buckets = config.r2_buckets || [];
  const database = databases.find(value => value.binding === 'DB'), bucket = buckets.find(value => value.binding === 'BUCKET');
  if (databases.length !== 1 || !database || typeof database.database_id !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(database.database_id) || database.database_id === placeholderDatabaseId || /^0+-/.test(database.database_id)) errors.push('DB must identify one real, separately created D1 database; the local placeholder cannot be deployed.');
  if (!database?.database_name || /(?:local|placeholder|replace|site-creator)/i.test(database.database_name)) errors.push('DB must have an explicitly configured independent production database name.');
  if (buckets.length !== 1 || !bucket?.bucket_name || /(?:local|placeholder|replace|site-creator)/i.test(bucket.bucket_name)) errors.push('BUCKET must identify one independent production R2 bucket.');
  if (!config.name || /(?:placeholder|replace|site-creator)/i.test(config.name)) errors.push('A separate standalone Worker name is required.');
  if (config.services?.some(value => value.binding === 'CONNECTORS') || config.main?.includes('worker/index.ts')) errors.push('A standalone deployment cannot use the Sites worker or CONNECTORS binding.');
  if (!config.secrets?.required?.includes('CLERK_SECRET_KEY')) errors.push('Declare CLERK_SECRET_KEY in secrets.required; never place its value in the config.');
  if (config.workers_dev !== false || !config.routes?.some(route => typeof route === 'object' && route.custom_domain === true && route.pattern === origin?.hostname)) errors.push('Production requires workers_dev:false and a custom-domain route matching APP_ORIGIN. The template has no public route.');
  return errors;
}
