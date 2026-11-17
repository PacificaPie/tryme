import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createThemeController, THEME_STORAGE_KEY, THEME_CHANGE_EVENT } from '../public/theme.js';

function environment(saved = null, systemDark = false, denied = false) {
  const events = new EventTarget(), media = new EventTarget();
  media.matches = systemDark;
  const root = { dataset: {}, style: {} }, writes = [], updates = [];
  const store = { getItem() { if (denied) throw new Error('Denied'); return saved; }, setItem(key, value) { if (denied) throw new Error('Denied'); writes.push([key, value]); } };
  events.addEventListener(THEME_CHANGE_EVENT, event => updates.push(event.detail));
  const controller = createThemeController({ root, storage: () => store, events, media });
  return { controller, root, events, media, writes, updates, store,
    changeSystem(dark) { media.matches = dark; media.dispatchEvent(new Event('change')); },
    changeStorage(value, key = THEME_STORAGE_KEY, storageArea = store) { const event = new Event('storage'); Object.assign(event, { key, newValue: value, storageArea }); events.dispatchEvent(event); },
  };
}

test('default follows system while an explicit choice survives system changes', () => {
  const env = environment(null, true);
  assert.deepEqual(env.controller.getState(), { preference: 'system', theme: 'dark' });
  env.changeSystem(false);
  assert.equal(env.root.dataset.theme, 'light');
  env.controller.setPreference('dark');
  env.changeSystem(true); env.changeSystem(false);
  assert.equal(env.root.dataset.theme, 'dark');
  assert.equal(env.root.style.colorScheme, 'dark');
  assert.deepEqual(env.writes, [[THEME_STORAGE_KEY, 'dark']]);
  env.controller.setPreference('system');
  assert.equal(env.root.dataset.theme, 'light');
  env.changeSystem(true);
  assert.equal(env.root.dataset.theme, 'dark');
  env.controller.dispose();
});

test('another tab updates appearance without writing back or echo loops', () => {
  const env = environment('light', false);
  env.changeStorage('dark');
  assert.deepEqual(env.controller.getState(), { preference: 'dark', theme: 'dark' });
  env.changeStorage('light', 'funtrack.locale');
  env.changeStorage('light', THEME_STORAGE_KEY, {});
  assert.equal(env.root.dataset.theme, 'dark');
  env.changeStorage(null);
  assert.deepEqual(env.controller.getState(), { preference: 'system', theme: 'light' });
  assert.deepEqual(env.writes, []);
  env.controller.dispose();
});

test('denied storage does not block switching, and invalid preferences are ignored', () => {
  const env = environment(null, false, true);
  assert.doesNotThrow(() => env.controller.setPreference('dark'));
  assert.equal(env.root.dataset.theme, 'dark');
  env.controller.setPreference('invalid');
  assert.equal(env.root.dataset.themePreference, 'dark');
  env.controller.dispose();
});

test('disposal stops system and cross-tab changes', () => {
  const env = environment(null, false);
  env.controller.dispose();
  env.changeSystem(true); env.changeStorage('dark'); env.controller.setPreference('dark');
  assert.equal(env.root.dataset.theme, 'light');
});

test('first-paint script matches controller for saved, system and denied-storage cases', async () => {
  const source = await readFile(new URL('../public/theme-init.js', import.meta.url), 'utf8');
  for (const [saved, dark, denied] of [[null, true, false], ['light', true, false], ['dark', false, false], ['bad', true, false], [null, true, true]]) {
    const root = { dataset: {}, style: {} };
    vm.runInNewContext(source, { document: { documentElement: root }, localStorage: { getItem() { if (denied) throw new Error('Denied'); return saved; } }, matchMedia: () => ({ matches: dark }) });
    const env = environment(saved, dark, denied);
    assert.equal(root.dataset.theme, env.root.dataset.theme);
    assert.equal(root.dataset.themePreference, env.root.dataset.themePreference);
    assert.equal(root.style.colorScheme, env.root.style.colorScheme);
    env.controller.dispose();
  }
});

function luminance(hex) {
  if (hex.length === 4) hex = '#' + [...hex.slice(1)].map(char => char + char).join('');
  const values = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
}
function contrast(a, b) { const one = luminance(a), two = luminance(b); return (Math.max(one, two) + .05) / (Math.min(one, two) + .05); }

test('both themes preserve readable small text and primary action contrast', async () => {
  const css = await readFile(new URL('../public/theme.css', import.meta.url), 'utf8');
  for (const selector of [':root', ':root[data-theme="dark"]']) {
    const content = css.slice(css.indexOf(selector + ' {')).split('}')[0];
    const tokens = Object.fromEntries([...content.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{3,6})(?=[;\s])/gi)].map(match => [match[1], match[2]]));
    for (const foreground of ['--text', '--text-secondary', '--text-tertiary']) {
      for (const background of ['--bg', '--surface', '--surface-raised']) {
        assert.ok(contrast(tokens[foreground], tokens[background]) >= 4.5, `${selector}: ${foreground} on ${background}`);
      }
    }
    assert.ok(contrast(tokens['--primary'], tokens['--on-primary']) >= 4.5, `${selector}: primary action`);
  }
});
