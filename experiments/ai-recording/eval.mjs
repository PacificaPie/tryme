import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { launchLocal } from './browser.mjs';
import { mockPlanner, runExperiment } from './runner.mjs';
import { fileStore } from './store.mjs';

const root = resolve('experiments/ai-recording/fixtures');
const output = resolve(process.env.RECORDING_OUTPUT || '.preview/ai-recording');
await mkdir(output, { recursive: true });
const local = await launchLocal(), rows = [];
const click = target => ({ type: 'click', target, settleMs: 600 });
const plans = {
  dom: [click('start'), click('left'), click('right')],
  canvas: [click('start'), { type: 'tap', target: 'board', x: 0.5, y: 0.5, settleMs: 600 }, { type: 'tap', target: 'board', x: 0.75, y: 0.5, settleMs: 600 }],
  opening: [{ type: 'wait', ms: 600 }, { type: 'wait', ms: 600 }, { type: 'wait', ms: 600 }],
};
const viewports = [{ name: 'desktop', width: 960, height: 600 }, { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true }];
try {
  for (const view of viewports) {
    const { name: size, ...viewport } = view;
    for (const name of ['dom', 'canvas', 'opening']) {
      const html = await readFile(join(root, name + '.html'), 'utf8'), manifest = JSON.parse(await readFile(join(root, name + '.json'), 'utf8'));
      const verify = name === 'opening' ? async () => false : session => session.evaluate(kind =>
        kind === 'dom' ? document.querySelector('#status')?.textContent === '已点亮 2 / 2'
          : document.querySelector('#score')?.textContent === '收集 2 / 2', name);
      const store = fileStore(join(output, 'cache'));
      for (const mode of ['fixed', 'mock', ...(name === 'opening' ? [] : ['reuse'])]) {
        const id = `${name}-${size}-${mode}`;
        const result = await runExperiment({ browser: local.browser, html, manifest, viewport, store, verify,
          planner: mode === 'reuse' ? { mode: 'mock', next() { throw new Error('Cache must not call planner'); } } : mockPlanner(plans[name], { delayMs: 200 }),
          ...(mode === 'fixed' ? { fixedPlan: name === 'opening' ? [] : [click('start')] } : {}) });
        const { recording, ...data } = result;
        if (recording) {
          await writeFile(join(output, id + '.mp4'), recording.bytes);
          await writeFile(join(output, id + '-before.jpg'), recording.initial);
          await writeFile(join(output, id + '-after.jpg'), recording.final);
        }
        const row = { id, ...data, video: recording ? { durationMs: recording.durationMs, bytes: recording.bytes.length, frames: recording.frames, difference: recording.difference, differenceRegion: recording.differenceRegion } : null };
        rows.push(row); await writeFile(join(output, 'results.json'), JSON.stringify({ environment: 'local Chrome; synthetic fixtures; no model API', rows }, null, 2) + '\n');
        console.log(JSON.stringify({ id, status: result.status, reason: result.reason, durationMs: recording?.durationMs, calls: result.ledger.calls.length, cacheHit: result.ledger.cacheHit || false }));
        if (mode === 'fixed' || name === 'opening') assert.equal(result.status, 'fallback', id);
        else assert.equal(result.status, 'verified-fixture', id + ': ' + result.reason);
        if (mode === 'reuse') { assert.equal(result.ledger.cacheHit, true); assert.equal(result.ledger.calls.length, 0); }
      }
    }
  }
} finally { await local.close(); }
console.log(`Saved ${rows.length} local evaluations to ${output}`);
