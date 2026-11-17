// Offline preflight only; actual cloud commands remain explicit.
import { access } from 'node:fs/promises';
import path from 'node:path';
import { standaloneOutput, readStandaloneConfig, validateStandalone } from './standalone-config.mjs';

const args = process.argv.slice(2);
const mode = args.length === 0 ? 'production' : args.length === 2 && args[0] === '--mode' ? args[1] : null;
if (!['production', 'staging'].includes(mode)) throw new Error('Usage: node scripts/standalone-deploy.mjs [--mode production|staging]. This command only validates; no deploy or remote flags.');
const configPath = path.join(standaloneOutput, 'server/wrangler.json');
try { await access(configPath); } catch { throw new Error('Build the independent target first with node scripts/standalone.mjs build.'); }
const config = readStandaloneConfig(configPath), errors = validateStandalone(config, process.env.CLERK_SECRET_KEY, mode);
if (errors.length) { console.error('Standalone deployment plan rejected:\n' + errors.map(message => '- ' + message).join('\n')); process.exitCode = 1; }
else {
  console.log(`Built ${mode} target passed offline preflight. Credentials, DNS and account ownership have not been verified.`);
  console.log('After applying D1 migrations and setting CLERK_SECRET_KEY via Wrangler secret put stdin, run:');
  console.log('node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js deploy --dry-run --config dist-standalone/server/wrangler.json');
  console.log('When configuration is ready, run that command without --dry-run to publish.');
  console.log('This script performed no network request, deployment, migration, resource creation or secret update.');
}
