// Starts a fresh loopback fixture per scenario, so daily publication quotas and
// other sessions' fixtures are preserved. Real frontend + HTTP router + SQLite;
// synthetic auth/memory storage. GitHub
// download bytes are stubbed locally. No production, cloud build or capture.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
let base, fixture;
async function startFixture() {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  base = `http://127.0.0.1:${port}`;
  fixture = spawn(process.execPath, ['tests/fixtures/creator-workspace-browser-server.mjs'], { env: { ...process.env, CREATOR_WORKSPACE_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(Error('Fixture startup timed out: ' + log)), 15000);
    fixture.once('error', error => { clearTimeout(timer); reject(error); });
    fixture.once('exit', code => { clearTimeout(timer); reject(Error('Fixture exited ' + code + ': ' + log)); });
    fixture.stderr.on('data', chunk => { log += chunk; });
    fixture.stdout.on('data', chunk => { log += chunk; if (log.includes('Workspace fixture:')) { clearTimeout(timer); resolve(); } });
  });
}
async function stopFixture() { if (fixture && fixture.exitCode === null) { const closed = once(fixture, 'exit'); fixture.kill('SIGTERM'); await closed; } fixture = null; }
const out = process.env.PUBLISH_CARD_EVIDENCE || '.preview/publish-card-prompt';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const records = [], errors = [];
const widths = process.env.PUBLISH_CARD_EDGES_ONLY ? [] : process.env.PUBLISH_CARD_WIDTHS?.split(',').map(Number) || [1440, 390, 320];
let page;
const ready = async selector => { await page.locator(selector).first().waitFor(); await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); }); };
const visit = async (route, selector) => { await page.goto(base + '/site.html#' + route); await ready(selector); };
const offered = () => page.locator('.published-card-prompt:visible');
const state = async context => (await context.request.get(base + '/__workspace')).json();
const draft = owner => page.evaluate(owner => JSON.parse(sessionStorage.getItem('funtrack.real.card:' + owner)), owner);
const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
let serial = 0;
async function publish(kind, { failFirst = false } = {}) {
  await visit('/publish', '#publish-form');
  assert.equal(await offered().count(), 0);
  const token = 'prompt-' + Date.now() + '-' + (++serial), html = `<!doctype html><html><body><button>${token}</button></body></html>`;
  if (kind === 'html') await page.locator('#game-file').setInputFiles({ name: 'prompt.html', mimeType: 'text/html', buffer: Buffer.from(html) });
  if (kind === 'url') { await page.locator('[name="source"][value="url"]').check(); await page.locator('#publish-url').fill('https://example.test/' + token); }
  if (kind === 'github') {
    await page.route('**/api/imports/github', route => route.fulfill({ json: { html, filename: 'index.html', sourceUrl: 'https://github.com/local/fixture/blob/main/index.html', repository: 'local/fixture', commitSha: 'a'.repeat(40), path: 'index.html' } }));
    await page.locator('[name="source"][value="github"]').check();
    await page.locator('#github-url').fill('https://github.com/local/fixture/blob/main/index.html'); await page.locator('#github-read').click();
    await page.waitForFunction(() => !document.querySelector('#github-read').disabled);
  }
  await page.getByRole('button', { name: /^(下一步|Next)$/ }).click(); await ready('#publish-name');
  await page.locator('#publish-name').fill('新作品 · A small world');
  await page.locator('#publish-desc').fill('一件用于本地验收的新作品。A local acceptance work.');
  await page.locator('#publish-category').selectOption('game');
  await page.getByRole('button', { name: /^(下一步|Next)$/ }).click();
  await page.locator('[data-media-action="cover:skip"]').click(); await page.locator('[data-media-action="video:skip"]').click();
  const submit = page.getByRole('button', { name: /^(确认并发布|Confirm and publish)$/ });
  if (failFirst) {
    await page.route('**/api/works', route => route.request().method() === 'POST' ? route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Local failure test' } } }) : route.continue(), { times: 1 });
    await submit.click(); await page.waitForFunction(() => document.querySelector('#publish-error')?.textContent.includes('Local failure test'));
    assert.equal(await offered().count(), 0); assert.equal(new URL(page.url()).hash, '#/publish');
  }
  // Two submit events in one task exercise the application's pending guard.
  await submit.evaluate(button => { button.click(); button.click(); });
  await ready('.published-card-prompt');
  assert.equal(await offered().count(), 1);
  return new URL(page.url()).hash.split('/published/')[1];
}
try {
  for (const width of widths) for (const locale of ['zh-CN', 'en']) for (const mode of ['first', 'saved', 'draft']) {
    await startFixture();
    const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1050 : 844 }, reducedMotion: 'reduce', colorScheme: locale === 'en' ? 'dark' : 'light' });
    await context.addInitScript(locale => localStorage.setItem('funtrack.locale', locale), locale);
    page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    const owner = mode === 'first' ? 'workspace-empty' : 'publication-owner';
    await context.request.get(base + '/__workspace?account=' + (mode === 'first' ? 'empty' : 'existing'));
    const before = await state(context), kind = { first: 'html', saved: 'url', draft: 'github' }[mode];
    await visit('/studio/works', '.creator-workspace');
    const originalDraft = mode === 'draft' ? { ids: [before.works[2]], template: 'editorial', signature: 'Keep my draft', backStyle: 'ivory' } : await draft(owner);
    if (mode === 'draft') {
      await page.evaluate(({ owner, value }) => sessionStorage.setItem('funtrack.real.card:' + owner, JSON.stringify(value)), { owner, value: originalDraft });
      await page.reload(); await ready('.creator-workspace');
    }
    const id = await publish(kind, { failFirst: width === 1440 && locale === 'zh-CN' && mode === 'first' });
    assert.deepEqual(await draft(owner), originalDraft, 'publishing must not alter a card draft');
    assert.deepEqual((await state(context)).cards, before.cards, 'publication must not save or replace cards');
    await noOverflow();
    const layout = await offered().evaluate(el => ({ text: el.innerText, top: el.getBoundingClientRect().top, buttons: [...el.querySelectorAll('button')].map(button => { const rect = button.getBoundingClientRect(); return { width: rect.width, height: rect.height, left: rect.left, right: rect.right }; }) }));
    for (const button of layout.buttons) { assert(button.height >= 44); assert(button.left >= 0 && button.right <= width); }
    assert.match(layout.text, locale === 'en' ? /preview and save/ : /预览并保存后生效/);
    assert(layout.top < 600, 'question is prominent before the work tile');
    await page.screenshot({ path: `${out}/${width}-${locale}-${mode}-offer.png`, fullPage: true });
    // Same-route language changes keep the offer and its functional controls.
    await page.locator('#locale-toggle').click(); await ready('.published-card-prompt');
    await page.locator('#locale-toggle').click(); await ready('.published-card-prompt');
    await page.locator('[data-published-card="add"]').evaluate(button => { button.click(); button.click(); });
    if (mode === 'first') {
      await ready('#card-profile'); assert.equal(new URL(page.url()).hash, '#/cards/me/template');
      assert.deepEqual((await draft(owner)).ids, [id]); assert.equal((await draft(owner)).template, 'city');
    } else {
      await ready('.card-start-options'); assert.equal(new URL(page.url()).hash, '#/cards/me?addWork=' + id);
      assert.deepEqual(await draft(owner), originalDraft, 'confirmation must not replace a competing draft');
      assert.equal(await page.locator('[data-add-source="draft"]').count(), mode === 'draft' ? 1 : 0);
      await page.locator(`[data-add-source="${mode === 'draft' ? 'draft' : 'card'}"]`).click(); await ready('.select-work');
      const result = await draft(owner), oldIds = mode === 'draft' ? originalDraft.ids : before.works.slice(0, 2);
      assert.deepEqual(result.ids, [...oldIds, id]);
      assert.equal(result.template, mode === 'draft' ? originalDraft.template : 'wall');
      if (mode === 'draft') assert.equal(result.signature, originalDraft.signature);
    }
    assert.deepEqual((await state(context)).cards, before.cards, 'adding only prepares a draft');
    await noOverflow();
    if (locale === 'zh-CN') await page.screenshot({ path: `${out}/${width}-${mode}-builder.png`, fullPage: true });
    // Return and reload after confirmation retain a normal, usable card link.
    await visit('/published/' + id, '.published-result'); assert.equal(await offered().count(), 0);
    await page.reload(); await ready('.published-result'); assert.equal(await offered().count(), 0);
    assert.equal(await page.locator('.published-card-later:visible a').getAttribute('href'), '#/cards/me?addWork=' + id);
    // Every viewport, language and card state also exercises explicit deferral.
    const kept = await draft(owner), laterId = await publish(kind);
    await page.locator('[data-published-card="later"]').focus(); await page.keyboard.press('Space');
    assert.equal(await offered().count(), 0); assert.equal(new URL(page.url()).hash, '#/published/' + laterId);
    assert.deepEqual(await draft(owner), kept);
    assert.equal(await page.locator('.published-card-later a').evaluate(el => el === document.activeElement), true);
    await page.reload(); await ready('.published-result'); assert.equal(await offered().count(), 0);
    await page.locator('#published-work-tile .tile-title a').click(); await ready('.work-page');
    await page.goBack(); await ready('.published-result'); assert.equal(await offered().count(), 0);
    assert.deepEqual((await state(context)).cards, before.cards);
    records.push({ width, locale, mode, source: kind, id, laterId, layout, result: 'passed' });
    console.log(`Passed ${width} ${locale} ${mode}: confirm + not now`);
    await context.close();
    await stopFixture();
  }
  // Leave an unanswered prompt; back/forward and reload must not show it again.
  await startFixture();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await context.request.get(base + '/__workspace?account=existing');
  const before = await state(context), id = await publish('html');
  await page.locator('#published-work-tile .tile-title a').click(); await ready('.work-page');
  await page.goBack(); await ready('.published-result'); assert.equal(await offered().count(), 0);
  await page.goForward(); await ready('.work-page'); await page.goBack(); await ready('.published-result'); assert.equal(await offered().count(), 0);
  await page.locator('.published-card-later a').click(); await ready('.card-start-options');
  await page.locator('[data-add-source="card"]').click(); await ready('.select-work');
  await page.locator('#to-template').click(); await ready('#card-profile');
  await page.getByRole('button', { name: /^(生成预览 →|Generate preview →)$/ }).click(); await ready('#save-card');
  assert.deepEqual((await state(context)).cards, before.cards);
  await page.locator('#save-card').click(); await ready('.saved-label');
  const after = await state(context);
  assert.equal(after.cards.length, before.cards.length + 1);
  for (const saved of before.cards) assert.deepEqual(after.cards.find(card => card.id === saved.id), saved);
  assert(after.cards.some(card => !before.cards.some(old => old.id === card.id) && card.snapshot_json.includes(id)));
  records.push({ result: 'passed', checks: 'Unanswered leave/back/forward; fallback resumes; only explicit preview/save creates a new card; prior snapshots unchanged' });
  await context.close();
  // A draft without a saved card must also be preserved. Refreshing an
  // unanswered question falls back to its normal link, and re-adding dedupes.
  const draftContext = await browser.newContext({ viewport: { width: 320, height: 844 }, reducedMotion: 'reduce' });
  page = await draftContext.newPage(); page.on('pageerror', error => errors.push(error.message));
  await draftContext.request.get(base + '/__workspace?account=empty');
  const draftWork = await publish('url');
  await page.locator('[data-published-card="later"]').click();
  const initial = { ids: [draftWork], template: 'editorial', signature: 'Draft without a saved card', backStyle: 'cobalt' };
  await page.evaluate(value => sessionStorage.setItem('funtrack.real.card:workspace-empty', JSON.stringify(value)), initial);
  await page.reload(); await ready('.published-result');
  const freshId = await publish('html');
  await page.reload(); await ready('.published-result'); assert.equal(await offered().count(), 0);
  assert.deepEqual(await draft('workspace-empty'), initial);
  await page.locator('.published-card-later a').click(); await ready('.card-start-options');
  assert.equal(await page.locator('[data-add-source="card"]').count(), 0);
  await page.locator('[data-add-source="draft"]').click(); await ready('.select-work');
  const merged = { ...initial, ids: [draftWork, freshId] };
  assert.deepEqual(await draft('workspace-empty'), merged);
  await visit('/published/' + freshId, '.published-result');
  await page.locator('.published-card-later a').click(); await ready('.card-start-options');
  await page.locator('[data-add-source="draft"]').click(); await ready('.select-work');
  assert.deepEqual(await draft('workspace-empty'), merged);
  await noOverflow();
  records.push({ result: 'passed', checks: 'Draft without a saved card; refresh of unanswered prompt; fallback keeps template/signature/order; duplicate addition remains a single work' });
  await draftContext.close();
  assert.deepEqual(errors, []);
  await writeFile(out + '/results.json', JSON.stringify({ passed: true, browser: browser.version(), base, scope: 'Local fixture only, synthetic auth/data; real frontend/router/SQLite, stubbed GitHub file download; no real cloud build, capture, staging, production or physical-device acceptance', records, errors }, null, 2) + '\n');
} catch (error) {
  await page?.screenshot({ path: out + '/failure.png', fullPage: true });
  console.error(page?.url(), (await page?.locator('#main').innerText())?.slice(0, 2500)); throw error;
} finally { await browser.close(); await stopFixture(); }
