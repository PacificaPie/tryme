import { HTML_MAX_BYTES, COVER_MAX_BYTES } from './limits.mjs';
import { coverType } from './rules.mjs';

export const CAPTURE_DEADLINE_MS = 30000;
const fail = (code, message) => Object.assign(new Error(message), { code });
const attribute = text => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
// The hosted document is rendered in an opaque, script-only iframe. No player
// SDK, Clerk cookie, session token, bridge ID or platform URL reaches the game.
export function captureDocument(html) {
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'none'; child-src 'none'; form-action 'none'; base-uri 'none'";
  const isolated = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + policy + '">' + html;
  return '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f2f1ed}iframe{display:block;width:100vw;height:100vh;border:0}</style><iframe sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="' + attribute(isolated) + '"></iframe>';
}

export async function captureHostedHTML(binding, html, { launch, timers = globalThis, timeoutMs = CAPTURE_DEADLINE_MS } = {}) {
  if (!binding || typeof binding.fetch !== 'function') throw fail('BROWSER_UNAVAILABLE', 'Cloud browser is unavailable.');
  if (typeof html !== 'string' || !html.length || new TextEncoder().encode(html).length > HTML_MAX_BYTES) throw fail('INVALID_CAPTURE_HTML', 'Hosted HTML is unavailable or too large.');
  const start = Date.now(); let browser, expired = false, deadline;
  const close = async target => { if (target) try { await target.close(); } catch { /* Default provider idle expiry remains in the reserved budget. */ } };
  const timeout = new Promise((_, reject) => { deadline = timers.setTimeout(() => { expired = true; void close(browser); reject(fail('CAPTURE_TIMEOUT', 'Opening screen capture timed out.')); }, timeoutMs); });
  const work = (async () => {
    const puppeteer = launch ? null : (await import('@cloudflare/puppeteer')).default;
    const open = launch || puppeteer.launch.bind(puppeteer);
    try { browser = await open(binding, { guardrails: { allowedDomains: [] } }); }
    catch { throw fail('BROWSER_UNAVAILABLE', 'The isolated cloud browser is unavailable.'); }
    if (expired) { await close(browser); throw fail('CAPTURE_TIMEOUT', 'Opening screen capture timed out.'); }
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 750, deviceScaleFactor: 1 });
    // Session guardrails cover HTTP(S). Disable peer/socket transports before
    // any game script runs, including newly attached child-frame documents.
    await page.evaluateOnNewDocument(() => {
      for (const key of ['RTCPeerConnection','webkitRTCPeerConnection','mozRTCPeerConnection','WebTransport']) {
        Object.defineProperty(globalThis, key, { value: undefined, writable: false, configurable: false });
      }
    });
    await page.setRequestInterception(true);
    page.on('request', request => { const url = request.url(); void (/^(?:data:|blob:|about:)/i.test(url) ? request.continue() : request.abort()).catch(() => {}); });
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
    await page.setContent(captureDocument(html), { waitUntil: 'load', timeout: 8000 });
    const frame = page.frames().find(item => item.parentFrame());
    if (!frame) throw fail('CAPTURE_EMPTY', 'The opening screen did not load.');
    const rendered = await frame.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!document.body) return false;
      return [document.body, ...document.body.querySelectorAll('*')].some(element => {
        if (/^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE)$/.test(element.tagName)) return false;
        const bounds = element.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0 || bounds.bottom <= 0 || bounds.right <= 0 || bounds.top >= innerHeight || bounds.left >= innerWidth) return false;
        for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (style.display === 'none' || ['hidden','collapse'].includes(style.visibility) || Number(style.opacity) === 0) return false;
        }
        const style = getComputedStyle(element);
        return /^(CANVAS|SVG|IMG|VIDEO|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(element.tagName)
          || [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
          || (style.backgroundColor !== 'transparent' && style.backgroundColor !== 'rgba(0, 0, 0, 0)')
          || style.backgroundImage !== 'none';
      });
    });
    if (!rendered) throw fail('CAPTURE_EMPTY', 'The opening screen is empty.');
    // Give self-contained animation/font initialization a brief settling window;
    // do not click Start, press a key or create a measured play session.
    await new Promise(resolve => timers.setTimeout(resolve, 500));
    if (expired) throw fail('CAPTURE_TIMEOUT', 'Opening screen capture timed out.');
    const bytes = new Uint8Array(await page.screenshot({ type: 'jpeg', quality: 80, fullPage: false, captureBeyondViewport: false, timeout: 5000 }));
    if (!bytes.length || bytes.length > COVER_MAX_BYTES) throw fail('CAPTURE_TOO_LARGE', 'The screenshot exceeds the cover limit.');
    coverType(bytes, 'image/jpeg');
    return { bytes, mime: 'image/jpeg', elapsedMs: Date.now() - start };
  })();
  try { return await Promise.race([work, timeout]); }
  finally {
    timers.clearTimeout(deadline); expired = true;
    let closeDeadline;
    // Closing is always attempted, but a hung close must not extend the hard
    // capture deadline. A late launch also closes itself before doing any work.
    const remaining = Math.max(0, Math.min(1000, timeoutMs - (Date.now() - start)));
    try { await Promise.race([close(browser), new Promise(resolve => { closeDeadline = timers.setTimeout(resolve, remaining); })]); }
    finally { timers.clearTimeout(closeDeadline); }
  }
}
