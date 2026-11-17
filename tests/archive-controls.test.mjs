import test from 'node:test';
import assert from 'node:assert/strict';
import { createArchiveRequest, hasPendingArchiveControl, changeArchive, disposeArchiveControls, archiveGuardMarkup } from '../public/archive-controls.js';
import { discoveryState, publicationFailureActions, publicationFailureMessage, changeVisibility, hasPendingPublicationControl } from '../public/publication-controls.js';
import { renderWorkEdit, disposeWorkEdit } from '../public/work-edit.js';
import { renderVersioning, disposeVersioning } from '../public/versioning.js';
import { setLocale, t } from '../public/i18n.js';

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const work = () => ({ id: 'my-work', authorId: 'owner', name: 'A <game>', source: 'html', revision: 4, archivedAt: null, discovery: { revision: 90, visibility: 'listed' } });
const archived = () => ({ ...work(), revision: 5, archivedAt: '2026-11-17T00:00:00Z', discovery: { revision: 91, visibility: 'unlisted' } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fakeTimers() {
  let id = 0, now = 0; const tasks = new Map();
  return { tasks, setTimeout(callback, delay) { const key = ++id; tasks.set(key, { callback, at: now + delay }); return key; }, clearTimeout(key) { tasks.delete(key); }, advance(ms) { now += ms; for (const [key, task] of [...tasks]) if (task.at <= now) { tasks.delete(key); task.callback(); } } };
}

test('one archive intent deduplicates clicks, freezes the work revision and does not optimistically change the work', async () => {
  const initial = work(), gate = deferred(), calls = [], changes = [];
  const request = createArchiveRequest(initial, 'archive', (...args) => { calls.push(args); return gate.promise; }, state => changes.push({ ...state }));
  const first = request.run(); assert.equal(request.run(), first); assert.equal(hasPendingArchiveControl(), true); assert.equal(hasPendingPublicationControl(), true);
  initial.revision = 6; await Promise.resolve();
  assert.equal(calls.length, 1); assert.deepEqual(calls[0][1].body, { action: 'archive', expectedRevision: 4 });
  assert.equal(initial.archivedAt, null); assert.equal(initial.discovery.visibility, 'listed');
  gate.resolve({ work: archived() }); assert.deepEqual(await first, archived());
  assert.equal(hasPendingArchiveControl(), false); assert.equal(request.state.error, null);
  assert.deepEqual(changes.map(state => state.pending), [true, false]);
});

test('an ambiguous transport failure retries the same intent but a revision conflict requires refresh', async () => {
  const bodies = []; let attempt = 0;
  const request = createArchiveRequest(work(), 'archive', async (_url, options) => {
    bodies.push(options.body); if (++attempt === 1) throw new Error('connection lost'); return { work: archived() };
  });
  assert.equal(await request.run(), null); assert.equal(request.state.needsRefresh, false);
  assert.deepEqual(await request.run(), archived()); assert.deepEqual(bodies[0], bodies[1]);
  let calls = 0;
  const conflict = createArchiveRequest(work(), 'archive', () => { calls++; throw Object.assign(new Error('changed'), { code: 'ARCHIVE_CONFLICT' }); });
  assert.equal(await conflict.run(), null); assert.equal(conflict.state.needsRefresh, true);
  assert.equal(await conflict.run(), null); assert.equal(calls, 1); assert.equal(hasPendingArchiveControl(), false);
});

test('restore requires an acknowledgement for the intended work and archive state', async () => {
  const responses = [{ work: { ...work(), id: 'someone-else' } }, { work: { id: 'my-work', revision: 6 } }, { work: archived() }, { work: { ...work(), revision: 6, discovery: { visibility: 'unlisted' } } }];
  const request = createArchiveRequest(archived(), 'restore', async () => responses.shift());
  for (let i = 0; i < 3; i++) { assert.equal(await request.run(), null); assert.equal(request.state.error.code, 'ARCHIVE_UNCONFIRMED'); }
  const restored = await request.run(); assert.equal(restored.archivedAt, null); assert.equal(restored.discovery.visibility, 'unlisted');
});

test('a stalled mutation releases controls at its deadline without claiming cancellation or accepting its late receipt', async () => {
  const timers = fakeTimers(), first = deferred(), retry = deferred(), calls = [], changes = [];
  const request = createArchiveRequest(work(), 'archive', (_url, options) => { calls.push(options); return calls.length === 1 ? first.promise : retry.promise; }, state => changes.push({ ...state }), { timers });
  const waiting = request.run(); await Promise.resolve(); timers.advance(29999);
  assert.equal(request.state.pending, true); assert.equal(calls[0].signal.aborted, false);
  timers.advance(1); assert.equal(await waiting, null);
  assert.equal(request.state.pending, false); assert.equal(request.state.uncertain, true); assert.equal(request.state.error.code, 'ARCHIVE_TIMEOUT');
  assert.equal(calls[0].signal.aborted, true); assert.equal(hasPendingArchiveControl(), false); assert.equal(timers.tasks.size, 0);
  const checking = request.run(); await Promise.resolve(); assert.deepEqual(calls[1].body, calls[0].body);
  const count = changes.length; first.resolve({ work: archived() }); await Promise.resolve(); await Promise.resolve();
  assert.equal(changes.length, count); assert.equal(request.state.pending, true);
  retry.resolve({ work: archived() }); assert.deepEqual(await checking, archived()); assert.equal(timers.tasks.size, 0);
});

function dialogDOM() {
  let dialog;
  const document = {
    querySelector: () => dialog?.isConnected ? dialog : null,
    createElement() {
      const nodes = new Map(), listeners = new Map();
      const node = selector => { if (!nodes.has(selector)) nodes.set(selector, { disabled: false, textContent: '', focus() {} }); return nodes.get(selector); };
      dialog = { innerHTML: '', isConnected: false, querySelector: node, addEventListener: (name, handler) => listeners.set(name, handler), showModal() {}, remove() { this.isConnected = false; }, close() { listeners.get('close')?.(); }, emit: (name, event) => listeners.get(name)?.(event) };
      return dialog;
    },
    body: { appendChild(node) { node.isConnected = true; } },
  };
  return { document, current: () => dialog };
}

test('a submitted confirmation may be closed without cancelling the mutation, and cannot reload a later route', async () => {
  const previous = globalThis.document, dom = dialogDOM(), gate = deferred(); globalThis.document = dom.document;
  let current = true, reloads = 0, changed = 0, notices = 0;
  try {
    changeArchive(work(), 'archive', { esc, api: () => gate.promise, isCurrent: () => current, reload: () => reloads++, onChanged: () => changed++, notify: () => notices++ });
    const dialog = dom.current(), confirm = dialog.querySelector('[data-archive-confirm]'), back = dialog.querySelector('[data-archive-back]');
    assert.match(dialog.innerHTML, /原链接、版本、名片与历史数据保留/); assert.doesNotMatch(dialog.innerHTML, /A <game>/);
    const saving = confirm.onclick(); assert.equal(confirm.disabled, true); assert.equal(back.disabled, false);
    assert.equal(back.textContent, '关闭窗口'); assert.match(dialog.querySelector('.archive-request-status').textContent, /不会撤回/);
    let prevented = false; dialog.emit('cancel', { preventDefault() { prevented = true; } }); assert.equal(prevented, false);
    back.onclick(); assert.equal(dialog.isConnected, false); assert.equal(hasPendingArchiveControl(), true);
    current = false; disposeArchiveControls(); gate.resolve({ work: archived() }); await saving;
    assert.equal(changed, 1); assert.equal(notices, 1); assert.equal(reloads, 0); assert.equal(hasPendingArchiveControl(), false);
  } finally { globalThis.document = previous; }
});

test('a lost response exposes refresh and retry instead of reporting server cancellation', async () => {
  const previous = globalThis.document, dom = dialogDOM(); globalThis.document = dom.document;
  let reloads = 0;
  try {
    changeArchive(work(), 'archive', { esc, api: async () => { throw new Error('connection lost'); }, isCurrent: () => true, reload: () => reloads++, notify() {} });
    const dialog = dom.current(), confirm = dialog.querySelector('[data-archive-confirm]'), refresh = dialog.querySelector('[data-archive-refresh]');
    await confirm.onclick(); assert.equal(confirm.disabled, false); assert.equal(confirm.textContent, '重试确认'); assert.equal(refresh.hidden, false);
    assert.match(dialog.querySelector('.error').textContent, /尚未确认/); assert.doesNotMatch(dialog.querySelector('.error').textContent, /取消|cancel/);
    refresh.onclick(); assert.equal(reloads, 1); assert.equal(dialog.isConnected, false);
  } finally { globalThis.document = previous; }
});

test('a conflicting confirmation offers refresh instead of sending a second stale mutation', async () => {
  const previous = globalThis.document, dom = dialogDOM(); globalThis.document = dom.document;
  let calls = 0, reloads = 0;
  try {
    changeArchive(work(), 'archive', { esc, api: async () => { calls++; throw Object.assign(new Error('changed'), { code: 'ARCHIVE_CONFLICT' }); }, isCurrent: () => true, reload: () => reloads++, notify() {} });
    const dialog = dom.current(), confirm = dialog.querySelector('[data-archive-confirm]'); await confirm.onclick();
    assert.equal(confirm.disabled, false); assert.equal(confirm.textContent, '刷新状态');
    await confirm.onclick(); assert.equal(calls, 1); assert.equal(reloads, 1); assert.equal(dialog.isConnected, false);
  } finally { globalThis.document = previous; }
});

test('archived duplicate and Feed controls direct the author to restore, in either language', () => {
  for (const locale of ['zh-CN', 'en']) {
    setLocale(locale);
    const error = { code: 'DUPLICATE_WORK', existingWork: archived() }, actions = publicationFailureActions(error, { esc });
    assert.match(actions, /#\/studio\/works\?state=archived&work=my-work/); assert.doesNotMatch(actions, /\/update/);
    assert.match(actions, /A &lt;game>/); assert.doesNotMatch(actions, /A <game>/);
    const message = t(publicationFailureMessage(error)); assert.match(message, locale === 'en' ? /Restore the existing work/ : /恢复已有作品/);
    assert.deepEqual(discoveryState(archived()), { listed: false, canHide: false, canRestore: false, label: '已归档' });
    let notices = 0; changeVisibility(archived(), 'restore', { notify() { notices++; }, api() { assert.fail('archived works cannot restore Feed directly'); } }); assert.equal(notices, 1);
  }
  setLocale('zh-CN');
});

test('old editing and update deep links resolve to restore without loading drafts or mutating a work', async () => {
  const previous = globalThis.document, dom = dialogDOM(); globalThis.document = dom.document;
  try {
    for (const render of [renderWorkEdit, renderVersioning]) {
      let markup = '', fileReads = 0; const calls = [];
      const h = { esc, owner: 'owner', isCurrent: () => true, render: html => { markup = html; return true; }, fileStore: () => { fileReads++; }, api: async (path, options) => { calls.push([path, options]); return path === '/api/works/my-work' ? { work: archived() } : { online: true, status: 'online' }; } };
      assert.equal(await render({ path: '/studio/works/my-work/' + (render === renderWorkEdit ? 'edit' : 'update'), params: new URLSearchParams() }, h), true);
      assert.match(markup, /archive-guard/); assert.match(markup, /前往归档恢复/); assert.doesNotMatch(markup, /<form/);
      assert.equal(fileReads, 0); assert(calls.every(([, options]) => !options?.method || options.method === 'GET'));
    }
    assert.match(archiveGuardMarkup(archived(), { esc }), /A &lt;game>/);
  } finally { disposeWorkEdit(); disposeVersioning(); globalThis.document = previous; }
});
