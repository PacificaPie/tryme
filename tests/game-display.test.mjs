import test from 'node:test';
import assert from 'node:assert/strict';
import { mountGameDisplay } from '../public/game-display.js';

class Classes {
  values = new Set();
  contains(name) { return this.values.has(name); }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  toggle(name, value) { if (value) this.add(name); else this.remove(name); }
}
class Element extends EventTarget {
  constructor(doc) { super(); this.ownerDocument = doc; this.classList = new Classes(); this.children = []; this.inert = false; this.isConnected = true; this.attributes = new Map(); this.focusCount = 0; }
  add(child) { this.children.push(child); child.parentElement = this; return child; }
  contains(target) { for (let node = target; node; node = node.parentElement) if (node === this) return true; return false; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  focus() { this.ownerDocument.activeElement = this; this.focusCount++; }
}
function fixture() {
  const doc = new EventTarget(), scrolls = [];
  doc.defaultView = { scrollX: 0, scrollY: 320, scrollTo(x, y) { scrolls.push([x, y]); } };
  doc.documentElement = new Element(doc); doc.body = doc.documentElement.add(new Element(doc));
  const header = doc.body.add(new Element(doc)), main = doc.body.add(new Element(doc)), alreadyInert = doc.body.add(new Element(doc)); alreadyInert.inert = true;
  const page = main.add(new Element(doc)), area = page.add(new Element(doc)), aside = page.add(new Element(doc));
  const shell = area.add(new Element(doc)), button = shell.add(new Element(doc)), iframe = shell.add(new Element(doc));
  Object.defineProperty(iframe, 'src', { get: () => '/game/pinned-version', set: () => { throw new Error('The running iframe must not reload'); } });
  doc.fullscreenElement = null; doc.fullscreenEnabled = true;
  const changed = () => doc.dispatchEvent(new Event('fullscreenchange'));
  const display = mountGameDisplay(shell, { button, labels: { enter: '全屏', exitNative: '退出全屏', exitExpanded: '退出大屏' } });
  return { doc, shell, button, iframe, header, aside, alreadyInert, scrolls, changed, display };
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('unsupported fullscreen expands the same iframe and Escape restores scroll, focus and prior inert state', async () => {
  const f = fixture(), originalParent = f.iframe.parentElement;
  await f.display.enter();
  assert.equal(f.display.mode, 'expanded'); assert.equal(f.button.textContent, '退出大屏');
  assert.equal(f.iframe.parentElement, originalParent); assert.equal(f.iframe.src, '/game/pinned-version');
  assert(f.header.inert && f.aside.inert); assert(f.doc.documentElement.classList.contains('game-display-open'));
  const key = new Event('keydown', { cancelable: true }); Object.defineProperty(key, 'key', { value: 'Escape' }); f.doc.dispatchEvent(key);
  assert(key.defaultPrevented); assert.equal(f.display.mode, 'inline');
  assert.equal(f.header.inert, false); assert.equal(f.aside.inert, false); assert.equal(f.alreadyInert.inert, true);
  assert.deepEqual(f.scrolls.at(-1), [0, 320]); assert.equal(f.doc.activeElement, f.button);
  assert.equal(f.button.attributes.get('aria-pressed'), 'false'); f.display.dispose();
});
test('a rejected fullscreen request falls back without changing the iframe or its session URL', async () => {
  const f = fixture(); f.shell.requestFullscreen = async () => { throw new Error('Permission denied'); };
  await f.display.enter(); assert.equal(f.display.mode, 'expanded'); assert.equal(f.button.disabled, false);
  assert.equal(f.iframe.src, '/game/pinned-version'); f.display.dispose();
  assert.equal(f.display.mode, 'inline'); assert.equal(f.header.inert, false); assert.equal(f.scrolls.length, 0);
});
test('native fullscreen follows browser Escape, preserves the iframe and uses native labels', async () => {
  const f = fixture(); f.shell.requestFullscreen = async () => { f.doc.fullscreenElement = f.shell; f.changed(); };
  await f.display.enter(); assert.equal(f.display.mode, 'native'); assert.equal(f.button.textContent, '退出全屏');
  assert.equal(f.button.attributes.get('aria-pressed'), 'true');
  f.doc.fullscreenElement = null; f.changed();
  assert.equal(f.display.mode, 'inline'); assert.equal(f.button.textContent, '全屏');
  assert.equal(f.iframe.src, '/game/pinned-version'); assert.equal(f.header.inert, false); f.display.dispose();
});
test('exit options do not refocus the game or restore scroll when moving to discussion', async () => {
  const f = fixture(); f.shell.requestFullscreen = async () => { f.doc.fullscreenElement = f.shell; f.changed(); };
  f.doc.exitFullscreen = async () => { f.doc.fullscreenElement = null; f.changed(); };
  await f.display.enter(); const before = f.button.focusCount;
  await f.display.exit({ restoreFocus: false, restoreScroll: false });
  assert.equal(f.button.focusCount, before); assert.equal(f.scrolls.length, 0); assert.equal(f.display.mode, 'inline'); f.display.dispose();
});
test('leaving the route during native entry cleans late fullscreen without exiting any unrelated element', async () => {
  const f = fixture(), request = deferred(); let exits = 0;
  f.shell.requestFullscreen = () => request.promise;
  f.doc.exitFullscreen = async () => { exits++; f.doc.fullscreenElement = null; f.changed(); };
  const entering = f.display.enter(); f.display.dispose();
  assert.equal(f.doc.documentElement.classList.contains('game-display-open'), false);
  f.doc.fullscreenElement = f.shell; request.resolve(); await entering;
  assert.equal(exits, 1); assert.equal(f.display.mode, 'inline'); assert.equal(f.scrolls.length, 0);
  const other = fixture(), later = deferred(), foreign = new Element(other.doc); let foreignExits = 0;
  other.shell.requestFullscreen = () => later.promise; other.doc.exitFullscreen = async () => { foreignExits++; };
  const pending = other.display.enter(); other.display.dispose(); other.doc.fullscreenElement = foreign; later.resolve(); await pending;
  assert.equal(foreignExits, 0); assert.equal(other.doc.fullscreenElement, foreign);
});
test('exit during entry prevents a late fallback or a second overlapping request', async () => {
  const f = fixture(), request = deferred(); let calls = 0;
  f.shell.requestFullscreen = () => { calls++; return request.promise; };
  const entering = f.display.enter(); await f.display.exit();
  await f.display.enter(); assert.equal(calls, 1); assert.equal(f.button.disabled, true);
  request.reject(new Error('Cancelled')); await entering;
  assert.equal(f.display.mode, 'inline'); assert.equal(f.button.disabled, false);
  assert.equal(f.doc.documentElement.classList.contains('game-display-open'), false); f.display.dispose();
});
test('a failed native exit remains accurately fullscreen and can be retried', async () => {
  const f = fixture(); f.shell.requestFullscreen = async () => { f.doc.fullscreenElement = f.shell; f.changed(); };
  f.doc.exitFullscreen = async () => { throw new Error('Not now'); };
  await f.display.enter(); await f.display.exit();
  assert.equal(f.display.mode, 'native'); assert.equal(f.button.textContent, '退出全屏'); assert.equal(f.button.disabled, false);
  f.doc.exitFullscreen = async () => { f.doc.fullscreenElement = null; f.changed(); };
  await f.display.exit(); assert.equal(f.display.mode, 'inline'); f.display.dispose();
});
