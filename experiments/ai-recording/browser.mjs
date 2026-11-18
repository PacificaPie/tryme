import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Puppeteer } from '@cloudflare/puppeteer';
import { captureDocument } from '../../lib/funtrack/auto-cover-capture.mjs';
import { fail, LIMITS, validateAction } from './contract.mjs';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function bounded(promise, ms, code, cancel = () => {}) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => { cancel(); reject(fail(code)); }, ms);
    })]);
  } finally { clearTimeout(timer); }
}

// Dedicated headless process, never a user's Chrome profile. No cloud binding.
export async function launchLocal() {
  const executable = process.env.CHROME_PATH || (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/chromium');
  const profile = await mkdtemp(join(tmpdir(), 'tryme-recording-'));
  const child = spawn(executable, ['--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-quic',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let browser;
  const shutdown = async () => {
    try { await bounded(browser?.close(), 1000, 'CLOSE_TIMEOUT'); } catch {}
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGKILL'); await bounded(exited, 1500, 'EXIT_TIMEOUT').catch(() => {});
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 3 });
  };
  try {
    const endpoint = await bounded(new Promise((resolve, reject) => {
      let buffer = '';
      child.once('error', reject); child.once('exit', () => reject(fail('CHROME_EXIT')));
      child.stderr.on('data', data => { buffer = (buffer + data).slice(-8192); const match = buffer.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/); if (match) resolve(match[1]); });
    }), 10000, 'CHROME_START_TIMEOUT');
    const socket = new WebSocket(endpoint);
    await bounded(new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; }), 5000, 'CDP_TIMEOUT');
    const transport = { send: message => socket.send(message), close: () => socket.close() };
    socket.onmessage = event => transport.onmessage?.(String(event.data));
    socket.onclose = () => transport.onclose?.();
    browser = await new Puppeteer({ isPuppeteerCore: true }).connect({ transport, protocolTimeout: 5000 });
    return { browser, close: shutdown };
  } catch (error) { await shutdown(); throw error; }
}

// This reviewed function runs in Puppeteer's isolated world, not the game's JS
// world. Only DOM-derived data leaves it. No model strings are evaluated as code.
function inspectTargets(targets) {
  const forbidden = /login|log[ -]?in|sign[ -]?in|register|checkout|payment|pay\b|purchase|subscribe|submit|send\b|delete|登录|登入|注册|付款|支付|购买|訂閱|订阅|提交|发送|刪除|删除/i;
  return targets.map(target => {
    const all = document.querySelectorAll(target.selector), element = all.length === 1 ? all[0] : null;
    if (!element) return { id: target.id, available: false };
    const r = element.getBoundingClientRect(), label = `${element.textContent || ''} ${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''}`.trim().slice(0, 160);
    let visible = r.width > 4 && r.height > 4 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
    for (let el = element; el; el = el.parentElement) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) < 0.1) visible = false;
    }
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const available = visible && (hit === element || element.contains(hit)) && !element.disabled
      && element.getAttribute('aria-disabled') !== 'true' && !element.closest('a,form,[contenteditable],input,textarea,select')
      && !element.hasAttribute('form') && !element.hasAttribute('formaction') && !forbidden.test(label)
      && (target.kind === 'canvas' ? element.tagName === 'CANVAS' : element.tagName === 'BUTTON' && element.getAttribute('type') === 'button');
    return { id: target.id, available, label: label.slice(0, 80), kind: target.kind,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
  });
}

function disableTransports() {
  for (const key of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection', 'WebTransport', 'WebSocket']) {
    Object.defineProperty(globalThis, key, { value: undefined, writable: false, configurable: false });
  }
}

export async function openSession(browser, html, manifest, viewport) {
  const context = await browser.createBrowserContext();
  const started = Date.now(); let timer, closed = false, navigated = false, ready = false;
  const stats = { blockedRequests: 0, dialogs: 0, errors: 0 };
  const close = async () => { if (!closed) { closed = true; clearTimeout(timer); await context.close().catch(() => {}); } };
  timer = setTimeout(() => { void close(); }, LIMITS.sessionMs);
  try {
    await context.overridePermissions('http://localhost', []);
    const page = await context.newPage();
    await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(disableTransports);
    await page.setRequestInterception(true);
    page.on('request', request => {
      const allowed = /^(?:data:|blob:|about:)/i.test(request.url()) && !(ready && request.isNavigationRequest());
      if (!allowed) stats.blockedRequests++;
      void (allowed ? request.continue() : request.abort()).catch(() => {});
    });
    page.on('dialog', dialog => { stats.dialogs++; void dialog.dismiss().catch(() => {}); });
    page.on('pageerror', () => stats.errors++);
    page.on('popup', popup => { void popup.close(); });
    page.on('framenavigated', () => { if (ready) { navigated = true; void close(); } });
    page.on('frameattached', frame => { if (frame.parentFrame()?.parentFrame()) { navigated = true; void close(); } });
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId: context.id });
    // Chromium setContent/srcdoc did not run evaluateOnNewDocument in local
    // testing. Put the immutable guard before any submitted script as well.
    const guarded = '<script>(' + disableTransports.toString() + ')();</script>' + html;
    const document = captureDocument(guarded).replace('<!doctype html>', '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">');
    await page.setContent(document, { waitUntil: 'load', timeout: 5000 });
    const frame = page.frames().find(item => item.parentFrame());
    if (!frame) throw fail('FRAME_MISSING');
    ready = true;
    await sleep(250);
    const alive = () => { if (closed || navigated) throw fail(navigated ? 'NAVIGATION_BLOCKED' : 'SESSION_TIMEOUT'); };
    const evaluate = (fn, ...args) => { alive(); return frame.isolatedRealm().evaluate(fn, ...args); };
    const inspect = () => evaluate(inspectTargets, manifest.targets);
    const screenshot = async () => {
      alive();
      const bytes = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false, captureBeyondViewport: false });
      if (bytes.length > LIMITS.screenshotBytes) throw fail('SCREENSHOT_LIMIT');
      return Buffer.from(bytes);
    };
    const execute = async input => {
      alive(); const action = validateAction(input, manifest);
      if (action.type === 'wait') { await sleep(action.ms); alive(); return; }
      const candidate = (await inspect()).find(item => item.id === action.target);
      if (!candidate?.available) throw fail('TARGET_UNAVAILABLE');
      const target = manifest.targets.find(item => item.id === action.target);
      if (action.type === 'key') {
        const focused = await evaluate(selector => { const el = document.querySelector(selector); el.focus({ preventScroll: true }); return document.activeElement === el; }, target.selector);
        if (!focused) throw fail('FOCUS_UNAVAILABLE');
        await page.keyboard.press(action.key);
      } else {
        const x = candidate.rect.x + candidate.rect.width * (action.x ?? 0.5);
        const y = candidate.rect.y + candidate.rect.height * (action.y ?? 0.5);
        const hit = await evaluate(({ selector, x, y }) => { const el = document.querySelector(selector), top = document.elementFromPoint(x, y); return el === top || el.contains(top); }, { selector: target.selector, x, y });
        if (!hit) throw fail('TARGET_OCCLUDED');
        if (viewport.isMobile) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
      }
      await page.mouse.move(0, 0);
      await sleep(action.settleMs); alive();
    };
    return { page, frame, evaluate, inspect, screenshot, execute, close, stats, started, alive };
  } catch (error) { await close(); throw error; }
}
