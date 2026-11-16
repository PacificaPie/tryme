import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = new Map();
for (const kind of ['salt-run', 'orbit', 'tiles']) {
  const buffer = await readFile(path.join(here, `${kind}.html`));
  const html = buffer.toString('utf8');
  assert.ok(buffer.length < 1_000_000, `${kind}: below 1 MB`);
  assert.ok(html.includes('Funtrack 本地测试作品'));
  assert.equal(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/i.test(html), false);
  assert.equal(/<(?:script|link)\b[^>]*(?:src|href)\s*=/i.test(html), false);
  assert.equal(/\b(?:sk-proj-|sk-[A-Za-z0-9]{20}|OPENAI_API_KEY|BEGIN PRIVATE KEY)/.test(html), false);
  assert.equal(/authorId|3,204|96%|@azhu/.test(html), false);
  for (const attribute of html.matchAll(/\b(?:src|href)="([^"]*)"/g)) {
    assert.ok(attribute[1].startsWith('data:image/'), `${kind}: embedded asset only`);
  }
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  new vm.Script(scripts[0][1], { filename: `${kind}.html` });
  files.set(kind, scripts[0][1]);
}
for (const name of ['orbit', 'tiles']) {
  const metadata = await sharp(path.join(here, `${name}.png`)).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1200);
}

function setup(kind) {
  const raf = new Map(), completions = [], targets = [];
  let nextId = 0, time = 0, document;
  class Target extends EventTarget {
    constructor() { super(); this.handlers = new Map(); targets.push(this); }
    addEventListener(type, handler, options) {
      if (!this.handlers.has(type)) this.handlers.set(type, new Set());
      this.handlers.get(type).add(handler);
      if (options?.signal) options.signal.addEventListener('abort', () => this.handlers.get(type)?.delete(handler), { once: true });
      super.addEventListener(type, handler, options);
    }
    removeEventListener(type, handler, options) {
      this.handlers.get(type)?.delete(handler);
      super.removeEventListener(type, handler, options);
    }
  }
  const context2d = new Proxy({}, {
    get: (target, key) => key in target ? target[key] : (() => {}),
    set: (target, key, value) => (target[key] = value, true),
  });
  class Element extends Target {
    constructor(tag = 'div') { super(); this.tagName = tag.toUpperCase(); this.style = {}; this.children = []; this.width = 900; this.height = 560; this.hidden = false; this.disabled = false; this.textContent = ''; }
    replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = children; for (const child of children) child.parentNode = this; }
    querySelectorAll(tag) { return this.children.filter(child => child.tagName === tag.toUpperCase()); }
    remove() { if (this.parentNode) { const parent = this.parentNode; parent.children = parent.children.filter(child => child !== this); this.parentNode = null; } }
    getContext() { return context2d; }
    setAttribute() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 560 }; }
    focus() { document.activeElement = this; }
    closest() { return null; }
    setPointerCapture() {}
  }
  const elements = Object.fromEntries(['game-host', 'cover', 'start', 'end', 'start-layer', 'status', 'error'].map(id => [id, new Element()]));
  document = new Target();
  Object.assign(document, { hidden: false, activeElement: null, getElementById: id => elements[id], createElement: tag => new Element(tag) });
  const window = new Target();
  Object.assign(window, { devicePixelRatio: 1, funtrack: { complete: result => completions.push(result) } });
  const context = vm.createContext({
    document, window, Element, AbortController, Date, console,
    requestAnimationFrame: callback => { const id = ++nextId; raf.set(id, callback); return id; },
    cancelAnimationFrame: id => raf.delete(id),
  });
  new vm.Script(files.get(kind), { filename: `${kind}.html` }).runInContext(context);
  const click = id => elements[id].dispatchEvent(new Event('click'));
  const pointer = (canvas, clientX, clientY) => {
    const event = new Event('pointerdown', { cancelable: true });
    Object.assign(event, { clientX, clientY }); canvas.dispatchEvent(event);
  };
  const key = code => {
    const down = new Event('keydown', { cancelable: true }); Object.assign(down, { code, repeat: false }); window.dispatchEvent(down);
    const up = new Event('keyup'); Object.assign(up, { code }); window.dispatchEvent(up);
  };
  const frame = (ms = 1000 / 60) => {
    time += ms;
    const callbacks = [...raf.values()]; raf.clear();
    for (const callback of callbacks) callback(time);
  };
  const hidden = value => { document.hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
  return { elements, document, window, raf, completions, click, pointer, key, frame, hidden };
}

const keyboard = setup('tiles');
assert.equal(keyboard.raf.size, 0); assert.equal(keyboard.completions.length, 0);
keyboard.click('start');
const keyboardCanvas = keyboard.elements['game-host'].children[0];
for (const code of ['ArrowUp', 'ArrowLeft', 'Space', 'ArrowDown', 'ArrowRight', 'Space', 'ArrowDown', 'ArrowRight', 'Space']) keyboard.key(code);
assert.equal(keyboard.completions.length, 1);
assert.equal(keyboard.completions[0].score, 1000);
assert.equal(keyboard.completions[0].label, '3 步，全部点亮！');
assert.equal(keyboard.raf.size, 0); assert.equal(keyboardCanvas.width, 0); assert.equal(keyboardCanvas.height, 0);
assert.equal(keyboard.window.handlers.get('keydown').size, 0);
assert.equal(keyboard.document.handlers.get('visibilitychange').size, 0);
keyboard.click('start'); keyboard.key('Space'); keyboard.pointer(keyboardCanvas, 337, 160);
assert.equal(keyboard.completions.length, 1); assert.equal(keyboard.elements['game-host'].children.length, 0);

const touch = setup('tiles'); touch.click('start');
const touchCanvas = touch.elements['game-host'].children[0];
for (const point of [[337, 160], [450, 274], [560, 387]]) touch.pointer(touchCanvas, ...point);
assert.equal(touch.completions.length, 1); assert.equal(touch.completions[0].score, 1000);

for (const kind of ['salt-run', 'orbit', 'tiles']) {
  const stopped = setup(kind); stopped.click('start'); stopped.click('start');
  assert.equal(stopped.elements['game-host'].children.length, 1); assert.equal(stopped.raf.size, 1);
  stopped.click('end');
  assert.equal(stopped.completions.length, 0, `${kind}: a manual end does not assert game completion`);
  assert.equal(stopped.raf.size, 0); assert.equal(stopped.elements['game-host'].children.length, 0);
}

const runner = setup('salt-run'); runner.click('start');
for (let i = 0; i < 30; i++) runner.frame();
runner.hidden(true); assert.equal(runner.raf.size, 0);
runner.frame(120_000); assert.equal(runner.completions.length, 0);
runner.hidden(false); assert.equal(runner.raf.size, 1);
runner.frame(); assert.equal(runner.completions.length, 0);
for (let i = 0; i < 420 && !runner.completions.length; i++) runner.frame();
assert.equal(runner.completions.length, 1); assert.equal(runner.completions[0].label, '撞到障碍了');
assert.equal(runner.raf.size, 0);
console.log('PASS: size/dependencies/secrets, PNG covers, actual tiles keyboard/pointer solution, one terminal result, manual end, visibility pause, natural runner terminal, resource cleanup.');
console.log('These are deterministic automated checks, not a claim of browser input or server receipt verification.');
