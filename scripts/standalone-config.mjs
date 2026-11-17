import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { isIP } from 'node:net';
import { standaloneAuthConfig } from '../lib/funtrack/standalone-auth.mjs';

export const standaloneRoot = fileURLToPath(new URL('../', import.meta.url));
export const standaloneOutput = path.join(standaloneRoot, 'dist-standalone');
export const standaloneState = path.join(standaloneRoot, '.preview/standalone-state');
export const placeholderDatabaseId = '00000000-0000-4000-8000-000000000000';
export const standaloneConfigPath = () => path.resolve(standaloneRoot, process.env.FUNTRACK_STANDALONE_CONFIG || 'wrangler.standalone.jsonc');

export function readStandaloneConfig(filename = standaloneConfigPath()) {
  const parsed = ts.parseConfigFileTextToJson(filename, readFileSync(filename, 'utf8'));
  if (parsed.error || !parsed.config || typeof parsed.config !== 'object' || Array.isArray(parsed.config)) throw new Error('Standalone configuration must be a valid JSON/JSONC object.');
  return parsed.config;
}
export function isLoopbackOrigin(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.origin === value; } catch { return false; }
}

// Offline validation only. Values are never printed; the secret is used only
// to reject missing/test credentials before an operator plans a deployment.
export function validateStandaloneProduction(config, secretKey) {
  const errors = [], vars = config.vars || {};
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
