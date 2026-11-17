import { readFile, writeFile, unlink, mkdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { configureToolEnvironment } from './tool-environment.mjs';
import { standaloneRoot, standaloneConfigPath, standaloneOutput, standaloneState, readStandaloneConfig, isLoopbackOrigin, validateStandalone } from './standalone-config.mjs';

const [command, ...args] = process.argv.slice(2);
if (!['dev', 'build', 'validate', 'migrate-local'].includes(command)) throw new Error('Usage: node scripts/standalone.mjs dev|build|validate|migrate-local [--config PATH] [dev --port 8787] [validate --mode production|staging]');
let port = 8787, mode = 'production';
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--config' && args[index + 1]) process.env.FUNTRACK_STANDALONE_CONFIG = path.resolve(args[++index]);
  else if (args[index] === '--port' && args[index + 1] && command === 'dev') port = Number(args[++index]);
  else if (args[index] === '--mode' && args[index + 1] && command === 'validate') mode = args[++index];
  else throw new Error('Only --config PATH, dev --port PORT and validate --mode production|staging are supported; remote/host/deploy flags are not accepted.');
}
if (!['production', 'staging'].includes(mode)) throw new Error('Standalone validation mode must be production or staging.');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('The local preview port must be an integer from 1024 to 65535.');
process.chdir(standaloneRoot);
process.env.FUNTRACK_TARGET = 'standalone';
process.env.FUNTRACK_STANDALONE_PORT = String(port);
configureToolEnvironment(standaloneRoot);
const configPath = standaloneConfigPath(), config = readStandaloneConfig(configPath);

if (command === 'validate') {
  const errors = validateStandalone(config, process.env.CLERK_SECRET_KEY, mode);
  if (errors.length) { console.error(`Standalone ${mode} preparation is incomplete:\n` + errors.map(message => '- ' + message).join('\n')); process.exitCode = 1; }
  else console.log(`Offline ${mode} configuration checks passed. No cloud request, resource creation, migration or deployment was performed.`);
} else if (command === 'migrate-local') {
  if (!isLoopbackOrigin(config.vars?.APP_ORIGIN)) throw new Error('migrate-local requires a local APP_ORIGIN configuration. It never accepts --remote.');
  const result = spawnSync(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'DB', '--local', '--config', configPath, '--persist-to', standaloneState], { cwd: standaloneRoot, stdio: 'inherit' });
  if (result.error) throw result.error; process.exitCode = result.status ?? 1;
} else if (command === 'dev') {
  if (!isLoopbackOrigin(config.vars?.APP_ORIGIN)) throw new Error('Standalone dev requires a local configuration; production settings are not used for local preview.');
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: path.join(standaloneRoot, 'vite.config.ts'), server: { host: '127.0.0.1', port, strictPort: true } });
  await server.listen(); server.printUrls();
} else {
  const readOptional = async file => { try { return await readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
  const pointer = path.join(standaloneRoot, '.wrangler/deploy/config.json');
  const marker = path.join(standaloneRoot, 'dist/server/BUILD_ID');
  const [previousPointer, previousMarker] = await Promise.all([readOptional(pointer), readOptional(marker)]);
  try {
    const { createBuilder } = await import('vite');
    const builder = await createBuilder({ configFile: path.join(standaloneRoot, 'vite.config.ts') });
    await builder.buildApp();
    await access(path.join(standaloneOutput, 'server/wrangler.json'));
    const currentMarker = await readOptional(marker);
    if (previousMarker?.toString('hex') !== currentMarker?.toString('hex')) throw new Error('Standalone build unexpectedly changed the Sites BUILD_ID. Stop and inspect output isolation.');
    console.log('Standalone output: dist-standalone/server/wrangler.json + dist-standalone/client. No deployment was performed.');
  } finally {
    // The Cloudflare plugin writes one workspace-wide auto-deploy redirect.
    // Restore it so an independent build cannot silently redirect Sites tooling.
    if (previousPointer) { await mkdir(path.dirname(pointer), { recursive: true }); await writeFile(pointer, previousPointer); }
    else { try { await unlink(pointer); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
}
