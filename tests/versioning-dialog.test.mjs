import test from 'node:test';
import assert from 'node:assert/strict';
import { renderVersioning, disposeVersioning } from '../public/versioning.js';

test('a successful activation from a disposed route does not close a newer confirmation dialog', async () => {
  const prior = { document: globalThis.document, sessionStorage: globalThis.sessionStorage };
  let dialog = null, current = 1; const nodes = new Map(), requests = [], storage = new Map();
  const node = () => ({ hidden: false, disabled: false, textContent: '', innerHTML: '', listeners: new Map(), addEventListener(name, handler) { this.listeners.set(name, handler); }, focus() {}, after() {} });
  const select = selector => {
    if (selector === '#version-activate-dialog') return dialog?.isConnected ? dialog : null;
    if (selector === '#version-preview-dialog') return null;
    if (selector.startsWith('#activate-')) return dialog?.isConnected ? dialog.nodes.get(selector) : null;
    if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector);
  };
  globalThis.document = { querySelector: select, body: { appendChild(item) { item.isConnected = true; } }, createElement() {
    const listeners = new Map();
    dialog = { isConnected: false, innerHTML: '', nodes: new Map(['#activate-confirm', '#activate-back', '#activate-error'].map(key => [key, node()])), addEventListener(name, handler) { listeners.set(name, handler); }, showModal() {}, remove() { this.isConnected = false; }, close() { listeners.get('close')?.(); } }; return dialog;
  } };
  globalThis.sessionStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const work = { id: 'work', authorId: 'owner', name: 'game', version: 'v1', versionId: 'v1', revision: 1 };
  const data = { work, currentVersionId: 'v1', revision: 1, nextCursor: null, versions: ['v1', 'v2', 'v3'].map(id => ({ id, version: id, createdAt: '2026-11-17' })) };
  const h = token => ({ owner: 'owner', esc: String, isCurrent: () => current === token, render() { nodes.clear(); return true; }, onChanged() {}, notify() {}, go() { assert.fail('an old route must not navigate the new route'); }, api: async (_path, options) => {
    if (!options?.method) return data; return new Promise(resolve => requests.push({ resolve, options }));
  } });
  const route = { path: '/studio/works/work/versions' };
  try {
    await renderVersioning(route, h(1));
    select('#version-list').listeners.get('click')({ target: { closest: () => ({ dataset: { activate: 'v2' } }) } });
    const first = select('#activate-confirm').onclick(); assert.equal(requests.length, 1);
    current = 2; disposeVersioning(); await renderVersioning(route, h(2));
    select('#version-list').listeners.get('click')({ target: { closest: () => ({ dataset: { activate: 'v3' } }) } });
    const nextDialog = dialog; assert.equal(nextDialog.isConnected, true);
    requests[0].resolve({ version: { version: 'v2' }, current: { versionId: 'v2' }, operation: { action: 'activate', toVersionId: 'v2', changed: true } }); await first;
    assert.equal(nextDialog.isConnected, true); assert.equal(select('#activate-confirm').disabled, false); assert.equal(requests.length, 1);
  } finally { disposeVersioning(); Object.assign(globalThis, prior); }
});
