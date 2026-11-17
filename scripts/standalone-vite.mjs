import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { standaloneOutput } from './standalone-config.mjs';

/** @param {import('vite').PluginOption[]} plugins @returns {Promise<import('vite').PluginOption[]>} */
export async function standaloneFrameworkPlugins(plugins) {
  const output = [];
  for (const pending of plugins) {
    const plugin = await pending;
    if (Array.isArray(plugin)) output.push(...await standaloneFrameworkPlugins(plugin));
    else if (plugin && plugin.name !== 'vinext:build-id') output.push(plugin);
  }
  return output;
}

// vinext 1.0.0-beta.5's stock build-id plugin writes dist/server even when all
// environment outDirs are customized. Replace only that writer in this target.
/** @returns {import('vite').Plugin} */
export function standaloneIsolationPlugin() {
  const buildId = process.env.__VINEXT_SHARED_BUILD_ID ||= randomUUID();
  return {
    name: 'funtrack:standalone-output-isolation',
    enforce: 'post',
    configResolved(config) {
      if (config.command === 'serve' && !['127.0.0.1', 'localhost', '::1'].includes(config.server.host)) throw new Error('Standalone development is loopback-only.');
      for (const [name, environment] of Object.entries(config.environments)) {
        if (!['client', 'rsc', 'ssr'].includes(name)) continue;
        const relative = path.relative(standaloneOutput, path.resolve(config.root, environment.build.outDir));
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Standalone ${name} output must be inside dist-standalone.`);
      }
    },
    writeBundle() {
      if (this.environment.name !== 'rsc') return;
      const directory = path.join(standaloneOutput, 'server');
      mkdirSync(directory, { recursive: true }); writeFileSync(path.join(directory, 'BUILD_ID'), buildId);
    },
  };
}
