import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { exportCardTarget } from '../public/card-export.js';
const source = ts.createSourceFile('sharing.js', readFileSync('public/sharing.js', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const node = source.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === 'mountCardExport');
const id = '71160f2c-1946-4d96-a85c-bfdaf5940fe8', origin = 'https://trymecard.com';
class Element {
  hidden = false; isConnected = true; children = new Map(); events = new Map();
  querySelector(key) { if (!this.children.has(key)) this.children.set(key, new Element()); return this.children.get(key); }
  addEventListener(type, callback) { this.events.set(type, callback); }
  before() {} setAttribute() {} focus() {} getContext() { return {}; }
}
async function fixture(url = origin + '/c/' + id) {
  const dialog = new Element(), section = new Element(), requests = [], revoked = [], rendered = [], created = [];
  let respond = async () => new Response(JSON.stringify({ card: { id, name: 'Current public name', works: [] } }));
  let render = async options => { rendered.push(options); };
  const context = vm.createContext({
    AbortController, setTimeout, clearTimeout, File, Error,
    t: value => value, getLocale: () => 'zh-CN', navigator: {},
    URL: { createObjectURL: blob => { created.push(blob); return 'blob:poster-' + created.length; }, revokeObjectURL: value => revoked.push(value) },
    document: { createElement: tag => tag === 'section' ? section : { toBlob: done => done(new Blob(['png'], { type: 'image/png' })) } },
    fetch: async (...args) => { requests.push(args); return respond(...args); },
    exportTools: { exportCardTarget: value => exportCardTarget(value, origin), qrMatrix: () => [], drawQR() {}, renderCardPoster: options => render(options) },
  });
  vm.runInContext(node.getText(source).replace("await import('./card-export.js')", 'exportTools'), context);
  await context.mountCardExport(dialog, url);
  return { dialog, section, requests, revoked, rendered, created,
    button: section.querySelector('.share-qr-row button'), preview: section.querySelector('.share-poster-preview'), status: dialog.querySelector('.share-status'),
    respond: value => { respond = value; }, render: value => { render = value; },
  };
}

test('export reads only the public DTO and makes the same generated image available for download and fallback', async () => {
  const f = await fixture(); await f.button.onclick();
  assert.equal(f.requests[0][0], '/api/public/cards/' + id);
  assert.equal(f.requests[0][1].credentials, 'omit'); assert.equal(f.requests[0][1].redirect, 'error');
  assert.equal(f.rendered[0].card.name, 'Current public name');
  assert.equal(f.preview.hidden, false);
  assert.equal(f.preview.querySelector('[data-download]').href, f.preview.querySelector('[data-open-image]').href);
  assert.equal(f.preview.querySelector('[data-share-image]').hidden, true);
  assert.match(f.preview.querySelector('p').textContent, /长按保存/);
  f.dialog.events.get('close')(); assert.deepEqual(f.revoked, ['blob:poster-1']);
});

test('a failed regeneration removes the prior downloadable image and leaves link sharing available', async () => {
  const f = await fixture(); await f.button.onclick();
  f.respond(async () => new Response('{}', { status: 404 })); await f.button.onclick();
  assert.equal(f.preview.hidden, true); assert.deepEqual(f.revoked, ['blob:poster-1']);
  assert.equal(f.button.disabled, false); assert.match(f.status.textContent, /名片已不可访问/);
  assert.equal(f.dialog.isConnected, true);
});

test('closing during rendering aborts export and prevents late object URLs or previews', async () => {
  const f = await fixture(); let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  f.render(async options => { started(options); await new Promise(resolve => { release = resolve; }); });
  const pending = f.button.onclick(), options = await entered;
  f.dialog.isConnected = false; f.dialog.events.get('close')(); release(); await pending;
  assert.equal(options.signal.aborted, true); assert.equal(f.created.length, 0); assert.equal(f.preview.hidden, true);
});

test('ordinary work links do not initialize export or make a card request', async () => {
  const f = await fixture(origin + '/site.html#/work/work-one');
  assert.equal(f.button.onclick, undefined); assert.equal(f.requests.length, 0);
  f.dialog.events.get('close')();
});
