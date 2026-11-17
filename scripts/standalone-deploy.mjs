// Production preparation only. This script intentionally has no execution flag:
// an operator must review and run any cloud mutation as a separate action.
import { access } from 'node:fs/promises';
import path from 'node:path';
import { standaloneOutput, readStandaloneConfig, validateStandaloneProduction } from './standalone-config.mjs';

if (process.argv.length > 2) throw new Error('This command only validates the built standalone target; it accepts no deploy or remote flags.');
const configPath = path.join(standaloneOutput, 'server/wrangler.json');
try { await access(configPath); } catch { throw new Error('Build the independent target first with node scripts/standalone.mjs build.'); }
const config = readStandaloneConfig(configPath), errors = validateStandaloneProduction(config, process.env.CLERK_SECRET_KEY);
if (errors.length) { console.error('Standalone deployment plan rejected:\n' + errors.map(message => '- ' + message).join('\n')); process.exitCode = 1; }
else {
  console.log('Built target passed offline preflight. Credentials, DNS and account ownership have not been verified.');
  console.log('After separately applying reviewed D1 migrations and setting CLERK_SECRET_KEY via Wrangler secret put stdin, review:');
  console.log('node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js deploy --dry-run --config dist-standalone/server/wrangler.json');
  console.log('Then, only when ready to publish, run that command without --dry-run.');
  console.log('This script performed no network request, deployment, migration, resource creation or secret update.');
}
