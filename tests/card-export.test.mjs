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
    for (const size of [130, 220, 290]) {
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

test('uppercase card links normalize to the canonical card id', () => {
  assert.equal(exportCardTarget('/c/' + id.toUpperCase(), 'https://trymecard.com').id, id);
});

test('poster loads only public snapshot covers, tolerates image failure and closes decoded images', async t => {
  const { renderCardPoster } = await import('../public/card-export.js');
  const original = { fetch: globalThis.fetch, location: globalThis.location, createImageBitmap: globalThis.createImageBitmap };
  t.after(() => Object.assign(globalThis, original));
  globalThis.location = { origin: 'https://trymecard.com' };
  let closed = 0, drawn = 0; const requests = [], texts = [];
  globalThis.createImageBitmap = async () => ({ width: 100, height: 80, close() { closed++; } });
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } });
  };
  const context = { fillRect() {}, fillText: text => texts.push(text), measureText: text => ({ width: text.length * 15 }), save() {}, beginPath() {}, rect() {}, clip() {}, drawImage() { drawn++; }, restore() {} };
  const canvas = { getContext: () => context };
  const card = { id, name: 'Live identity', headline: 'A maker', template: 'city', works: [
    { id: 'work-one', name: 'Pinned title', coverUrl: `/api/public/cards/${id}/works/work-one/cover` },
    { id: 'work-two', name: 'Private forbidden', coverUrl: '/api/media/private-key' },
    { id: 'work-three', name: 'External forbidden', coverUrl: 'https://external.test/image.png' },
  ] };
  await renderCardPoster({ card, url: 'https://trymecard.com/c/' + id, canvas });
  assert.equal(canvas.width, 1200); assert.equal(canvas.height, 1440);
  assert.equal(requests.length, 1); assert.equal(requests[0].options.credentials, 'omit'); assert.equal(requests[0].options.redirect, 'error');
  assert.equal(drawn, 1); assert.equal(closed, 1); assert(texts.includes('Live identity')); assert(texts.includes('Pinned title'));
  globalThis.fetch = async () => { throw Error('Unavailable'); };
  await renderCardPoster({ card, url: 'https://trymecard.com/c/' + id, canvas });
  const task = new AbortController(); task.abort();
  await assert.rejects(renderCardPoster({ card, url: 'https://trymecard.com/c/' + id, canvas, signal: task.signal }), { name: 'AbortError' });
});
