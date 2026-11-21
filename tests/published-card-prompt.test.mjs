import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createPublishedCardPrompt, mountPublishedCardChoice } from '../public/published-card-prompt.js';

const owner = 'owner', work = { id: 'new-work-123', authorId: owner };

test('only the successful, owned, active work is offered, once per publication', () => {
  const prompt = createPublishedCardPrompt();
  assert.equal(prompt.shouldOffer(owner, work), false);
  for (const unavailable of [null, { ...work, id: '' }, { ...work, authorId: 'other' }, { ...work, archivedAt: 'today' }]) {
    assert.equal(prompt.published(owner, unavailable), false);
  }
  assert.equal(prompt.published(owner, work), true);
  assert.equal(prompt.shouldOffer('other', work), false);
  assert.equal(prompt.shouldOffer(owner, { ...work, id: 'different-work' }), false);
  assert.equal(prompt.shouldOffer(owner, { ...work, archivedAt: 'today' }), false);
  assert.equal(prompt.shouldOffer(owner, work), true);
  assert.equal(prompt.resolve(owner, work), true);
  assert.equal(prompt.resolve(owner, work), false);
  assert.equal(prompt.published(owner, work), false);
});

test('same-route rerenders keep the choice; leaving, returning and refresh do not reopen it', () => {
  const prompt = createPublishedCardPrompt(), path = '/published/' + work.id;
  prompt.published(owner, work);
  prompt.onRoute(path); prompt.onRoute(path);
  assert.equal(prompt.shouldOffer(owner, work), true);
  prompt.onRoute('/studio/works'); prompt.onRoute(path);
  assert.equal(prompt.shouldOffer(owner, work), false);
  assert.equal(createPublishedCardPrompt().shouldOffer(owner, work), false);
  assert.equal(prompt.published(owner, { ...work, id: 'another-work' }), true);
});

test('confirmation navigates once; not-now stays put; stale callbacks cannot resolve a choice', () => {
  for (const choice of ['add', 'later']) for (const stale of [false, true]) {
    const prompt = createPublishedCardPrompt(); prompt.published(owner, work);
    let handler, focused = 0;
    const navigation = [], panel = { hidden: false }, later = { hidden: true, querySelector: () => ({ focus: () => focused++ }) };
    const root = { querySelectorAll: () => [{ dataset: { publishedCard: choice }, addEventListener: (_, fn) => { handler = fn; } }], querySelector: selector => selector === '.published-card-prompt' ? panel : later };
    mountPublishedCardChoice(root, { prompt, owner, work, current: () => !stale, go: path => navigation.push(path) });
    handler(); handler();
    assert.deepEqual(navigation, !stale && choice === 'add' ? ['/cards/me?addWork=' + work.id] : []);
    assert.equal(panel.hidden, !stale); assert.equal(later.hidden, stale);
    assert.equal(focused, !stale && choice === 'later' ? 1 : 0);
    assert.equal(prompt.shouldOffer(owner, work), stale);
  }
});

// Execute the actual shared submit handler so each source, failed request and
// background completion exercises the integration point, not a copied handler.
const source = ts.createSourceFile('site.js', readFileSync(new URL('../public/site.js', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const submit = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'submitPublish').getText(source);
function submission(kind, { fail = false, leave = false, invalid = false } = {}) {
  const prompt = createPublishedCardPrompt(), paths = [], requests = [];
  const context = vm.createContext({
    FormData, URL, Promise, encodeURIComponent, publishedCardPrompt: prompt,
    publishDraft: { source: kind, name: 'New work', desc: 'Description', url: 'https://example.test/work', key: 'request-key' },
    publishPending: false, githubPending: false, publishError: '', publishFailure: null, publishFile: invalid ? null : {}, coverFile: null,
    draftOwner: owner, me: { id: owner }, uid: () => 'next-key',
    htmlFileError: () => '', githubReady: () => !invalid, safeExternal: value => invalid ? '' : value,
    publishCoverDraft: { canPublish: true, choices: {} }, publishMediaSource: () => ({}), sourceForm: () => new FormData(),
    api: async (...args) => { requests.push(args); if (fail) throw Error('Publish failed'); return { work }; },
    stopBuildPolling() {}, refreshPublishState() {}, refreshCoverPreview() {}, savePublish() {}, fileStore: async () => {}, clearDiscovery() {},
    route: () => ({ path: leave ? '/studio/works' : '/publish' }), go: path => paths.push(path), notify() {}, t: value => value, importErrorText: error => error.message,
  });
  vm.runInContext(submit, context);
  return { prompt, paths, requests, context };
}
for (const kind of ['html', 'github', 'url']) test(`${kind}: only successful foreground publication offers the card question`, async () => {
  for (const options of [{}, { fail: true }, { leave: true }, { invalid: true }]) {
    const f = submission(kind, options);
    await Promise.all([f.context.submitPublish(), f.context.submitPublish()]);
    const success = !options.fail && !options.leave && !options.invalid;
    assert.equal(f.prompt.shouldOffer(owner, work), success);
    assert.deepEqual(f.paths, success ? ['/published/' + work.id] : []);
    assert.equal(f.requests.length, options.invalid ? 0 : 1);
  }
});
