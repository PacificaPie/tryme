import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import jsQR from 'jsqr';
import { exportCardTarget, qrMatrix, drawQR } from '../public/card-export.js';

const id = 'f9c6cf26-9a1f-40c2-bf79-0acf94c6e821';
test('poster accepts only this origin and a saved public card, stripping transient URL state', () => {
  assert.deepEqual(exportCardTarget(`https://trymecard.com/c/${id}?from=share#work=x`, 'https://trymecard.com'), { id, url: `https://trymecard.com/c/${id}` });
  for (const url of [`https://evil.test/c/${id}`, `https://user:pass@trymecard.com/c/${id}`, '/c/preview', '/site#/cards', 'javascript:alert(1)']) assert.equal(exportCardTarget(url, 'https://trymecard.com'), null);
});
test('independent decoder reads exported QR modules at both preview and poster size', () => {
  for (const url of [`https://trymecard.com/c/${id}`, `http://127.0.0.1:8881/c/${id}`, 'https://example.com/作品']) {
    for (const size of [220, 290]) {
      const data = new Uint8ClampedArray(size * size * 4); data.fill(255);
      const ctx = { fillStyle: '', fillRect(x, y, w, h) { const value = this.fillStyle === '#ffffff' ? 255 : 24;
        for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) { const offset = (row * size + col) * 4; data[offset] = data[offset + 1] = data[offset + 2] = value; }
      } };
      drawQR(ctx, qrMatrix(url), 0, 0, size);
      assert.equal(jsQR(data, size, size)?.data, url);
    }
  }
});
test('browser QR vendor is identical to the pinned, licensed dependency', async () => {
  assert.deepEqual(await readFile('public/vendor/qrcode-generator.mjs'), await readFile('node_modules/qrcode-generator/dist/qrcode.mjs'));
});
