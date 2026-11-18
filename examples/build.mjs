import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const downloads = path.join(root, 'public/examples');
await Promise.all([mkdir(here, { recursive: true }), mkdir(downloads, { recursive: true })]);

const source = await readFile(path.join(root, 'public/games.js'), 'utf8');
const coreStart = source.indexOf('const W =');
if (coreStart < 0) throw new Error('Cannot locate the local game engine.');
let core = source.slice(coreStart).replace('export function mountGame', 'function mountGame');
const frameStart = '  function frame(now) {\n    if (destroyed) return;';
if (!core.includes(frameStart)) throw new Error('The game frame lifecycle has changed; review visibility handling before rebuilding.');
core = core.replace(frameStart, `  listen(document, 'visibilitychange', () => {
    keys.clear(); previous = 0;
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!destroyed && !finished && !raf) raf = requestAnimationFrame(frame);
  });
  function frame(now) {
    raf = 0;
    if (destroyed || document.hidden) { previous = 0; return; }`);
core = `const gameCatalog = [{kind:'salt-run'}, {kind:'orbit'}, {kind:'tiles'}];\n${core}`;

const entries = [
  { kind: 'salt-run', title: 'Salt Run', description: '空格、↑ 或轻点画面跳跃，躲过障碍，坚持十八秒。', cover: 'salt-run.jpg', mime: 'image/jpeg' },
  { kind: 'orbit', title: 'Orbit', description: '鼠标、手指或方向键移动光球，按顺序收集六颗星点。', cover: 'orbit.png', mime: 'image/png' },
  { kind: 'tiles', title: '点亮九宫格', description: '点按方格，或用方向键选择、空格翻转。让九格同时亮起。', cover: 'tiles.png', mime: 'image/png' },
];

await copyFile(path.join(root, 'public/assets/work-covers/salt-run.jpg'), path.join(here, 'salt-run.jpg'));
for (const kind of ['orbit', 'tiles']) {
  await sharp(path.join(root, `public/assets/${kind}.svg`), { density: 144 })
    .resize({ width: 1200 }).png().toFile(path.join(here, `${kind}.png`));
}

function documentFor(entry, cover) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light">
<meta name="referrer" content="no-referrer">
<title>${entry.title} · TryMe 本地测试作品</title>
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:#30332b;background:#fafaf7;-webkit-font-smoothing:antialiased}*{box-sizing:border-box}body{margin:0}button{font:inherit;cursor:pointer}button:disabled{cursor:default;opacity:.5}[hidden]{display:none!important}.player{width:min(100%,940px);margin:auto;padding:22px}.heading{margin-bottom:17px}h1{font-size:20px;font-weight:600;margin:0;letter-spacing:-.4px}.provenance{font-size:10px;color:#9b9e92;margin:5px 0 0}.instructions{font-size:12px;color:#777e6d;line-height:1.7;margin:9px 0 0}.stage{position:relative;overflow:hidden;aspect-ratio:45/28;border:1px solid #e2e6d9;border-radius:12px;background:#f3f0e9}.cover,.host{position:absolute;inset:0;width:100%;height:100%}.cover{object-fit:cover}.host canvas{width:100%!important;height:auto!important;border-radius:0!important;display:block}.start-layer{position:absolute;inset:0;display:grid;place-items:center;background:#fff2}.button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:11px 18px;border:1px solid #dce1d2;border-radius:7px;background:#fff;color:#566048;font-size:13px}.button.primary{background:#35432b;border-color:#35432b;color:#fff}.button:hover:not(:disabled){filter:brightness(.96)}.button:focus-visible{outline:2px solid #7b8c68;outline-offset:4px}.toolbar{display:flex;justify-content:space-between;align-items:center;gap:15px;min-height:62px;padding-top:13px}.status{font-size:12px;line-height:1.7;color:#7c8570;margin:0}.error{font-size:12px;color:#985c48;line-height:1.7;margin-top:12px}@media(max-width:520px){.player{padding:16px 12px}.heading{margin-bottom:13px}h1{font-size:18px}.instructions{font-size:12px}.stage{border-radius:8px}.stage.tiles{aspect-ratio:1}.stage.tiles .host canvas{width:150%!important;max-width:none!important;margin-left:-25%;}.status{font-size:11px}.host canvas:focus-visible{outline-offset:-4px!important}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto;transition:none;animation:none}}
</style>
</head>
<body>
<main class="player" aria-labelledby="title">
<header class="heading"><h1 id="title">${entry.title}</h1><p class="provenance">TryMe 本地测试作品</p><p class="instructions">${entry.description}</p></header>
<section class="stage ${entry.kind}" aria-label="游戏画面"><img class="cover" id="cover" src="data:${entry.mime};base64,${cover}" alt="游戏封面" width="900" height="560"><div class="host" id="game-host" hidden></div><div class="start-layer" id="start-layer"><button class="button primary" id="start" type="button">开始游戏</button></div></section>
<div class="toolbar"><p class="status" id="status" role="status" aria-live="polite"></p><button class="button" id="end" type="button" disabled>结束游戏</button></div>
<p class="error" id="error" role="alert" hidden></p>
<noscript><p class="error">请启用 JavaScript 后游玩。</p></noscript>
</main>
<script>
'use strict';
${core}

(() => {
  const host = document.getElementById('game-host');
  const cover = document.getElementById('cover');
  const start = document.getElementById('start');
  const end = document.getElementById('end');
  const layer = document.getElementById('start-layer');
  const status = document.getElementById('status');
  const error = document.getElementById('error');
  let runtime = null;
  let started = false;
  let terminal = false;
  const listeners = new AbortController();

  function clean() {
    const canvases = [...host.querySelectorAll('canvas')];
    runtime?.destroy(); runtime = null;
    for (const canvas of canvases) { canvas.width = 0; canvas.height = 0; canvas.remove(); }
    host.replaceChildren(); host.hidden = true; cover.hidden = false;
  }
  function stop() {
    if (!started || terminal) return;
    terminal = true;
    clean(); end.disabled = true;
    status.textContent = '本局已结束';
  }
  function finished(result) {
    if (terminal) return;
    terminal = true;
    clean(); end.disabled = true;
    status.textContent = result.label + ' · ' + result.score + ' 分';
    // Only a genuine terminal callback invokes the injected platform SDK.
    // A runner collision is terminal too; this is not a claim that the game was won.
    try { window.funtrack?.complete?.({ score: result.score, label: result.label }); }
    catch (error) { console.error('Completion reporting failed.', error); }
  }
  start.addEventListener('click', () => {
    if (started) return;
    started = true; start.disabled = true; host.hidden = false;
    try {
      runtime = mountGame(host, ${JSON.stringify(entry.kind)}, { onComplete: finished });
      cover.hidden = true; layer.hidden = true; end.disabled = false;
      status.textContent = '游戏中';
    } catch (problem) {
      clean(); terminal = true; layer.hidden = true;
      error.hidden = false; error.textContent = '无法启动游戏，请换用支持 Canvas 的浏览器。';
    }
  }, { signal: listeners.signal });
  end.addEventListener('click', stop, { signal: listeners.signal });
  window.addEventListener('pagehide', event => {
    stop();
    if (!event.persisted) { clean(); listeners.abort(); }
  }, { signal: listeners.signal });
})();
</script>
</body>
</html>
`;
}

for (const entry of entries) {
  const cover = await readFile(path.join(here, entry.cover));
  const html = documentFor(entry, cover.toString('base64'));
  if (Buffer.byteLength(html) > 1_000_000) throw new Error(`${entry.kind} exceeds the 1 MB limit.`);
  if (/<(?:script|link)\b[^>]*(?:src|href)\s*=|\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/i.test(html)) throw new Error(`${entry.kind} has an external request capability.`);
  await writeFile(path.join(here, `${entry.kind}.html`), html);
  await copyFile(path.join(here, `${entry.kind}.html`), path.join(downloads, `${entry.kind}.html`));
  await copyFile(path.join(here, entry.cover), path.join(downloads, entry.cover));
  console.log(`${entry.kind}.html: ${Buffer.byteLength(html)} bytes; cover ${entry.cover}`);
}
