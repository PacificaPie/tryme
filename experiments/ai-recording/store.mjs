import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail } from './contract.mjs';

export function fileStore(directory) {
  const file = key => { if (!/^[a-f0-9]{64}$/.test(key)) throw fail('INVALID_CACHE_KEY'); return join(directory, key + '.json'); };
  return {
    async get(key) {
      const path = file(key);
      try { return JSON.parse(await readFile(path, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return null; throw fail('CACHE_INVALID'); }
    },
    async claim(key, value) {
      await mkdir(directory, { recursive: true });
      try { await writeFile(file(key), JSON.stringify(value), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code === 'EEXIST') throw fail('EXPLORATION_ALREADY_ATTEMPTED'); throw error; }
    },
    async set(key, value) {
      const temp = file(key) + '.' + randomUUID();
      await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
      await rename(temp, file(key));
    },
  };
}
