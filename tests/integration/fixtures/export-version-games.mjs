// Optional browser-upload fixtures only; no server/database operations.
import { mkdir, writeFile } from 'node:fs/promises';
import { versions } from './version-games.mjs';
await mkdir('.preview/version-fixtures', { recursive: true });
for (const [index, fixture] of versions.entries()) {
  await writeFile(`.preview/version-fixtures/v${index + 1}.html`, fixture.html);
  await writeFile(`.preview/version-fixtures/v${index + 1}.png`, fixture.cover);
}
console.log('Exported red +1, blue +2, green +3 HTML/PNG fixtures to .preview/version-fixtures/.');
