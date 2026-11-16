import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Script } from 'node:vm';

function checkDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'vendor') continue;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) checkDirectory(file);
    else if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    else if (file.endsWith('.html')) {
      const source = readFileSync(file, 'utf8');
      for (const [index, match] of [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].entries()) {
        if (/\bsrc\s*=/.test(match[1]) || !match[2].trim()) continue;
        if (/\btype\s*=\s*["']module["']/.test(match[1])) {
          execFileSync(process.execPath, ['--input-type=module', '--check'], { input: match[2], stdio: ['pipe', 'pipe', 'pipe'] });
        } else new Script(match[2], { filename: `${file}:inline-${index + 1}` });
      }
    }
  }
}
checkDirectory('dist');
console.log('Application scripts and inline HTML scripts parsed successfully.');
