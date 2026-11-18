import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { launchLocal, bounded } from './browser.mjs';
import assert from 'node:assert/strict';

// Decode the actual encoded MP4s, not the original game screenshots.
const output = resolve(process.env.RECORDING_OUTPUT || '.preview/ai-recording');
const data = JSON.parse(await readFile(join(output, 'results.json'), 'utf8'));
const local = await launchLocal(), decoded = [], samples = [];
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
try {
  const page = await local.browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });
  for (const row of data.rows.filter(row => row.video)) {
    const video = (await readFile(join(output, row.id + '.mp4'))).toString('base64');
    const sample = await bounded(page.evaluate(async base64 => {
      const video = document.createElement('video'); video.muted = true;
      await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; video.src = 'data:video/mp4;base64,' + base64; });
      const durationMs = Math.round(video.duration * 1000), frames = [];
      const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      for (const time of [0.16, 1.4, 3.6, 7]) {
        await new Promise((resolve, reject) => { video.onseeked = resolve; video.onerror = reject; video.currentTime = time; });
        canvas.getContext('2d').drawImage(video, 0, 0); frames.push(canvas.toDataURL('image/jpeg', 0.8));
      }
      video.removeAttribute('src'); video.load(); return { durationMs, frames };
    }, video), 8000, 'DECODE_TIMEOUT');
    assert.ok(sample.durationMs <= 8000 && sample.durationMs >= 6000);
    decoded.push({ id: row.id, durationMs: sample.durationMs, decodedFrames: sample.frames.length });
    if (row.id.endsWith('-mock')) samples.push({ id: row.id, reason: row.reason, frames: sample.frames });
  }
  const styles = 'body{font:16px system-ui;background:#f2f1ed;color:#272620;margin:28px}h1{font-size:27px}section{margin:24px 0}h2{font-size:16px}figure{margin:0}img{display:block;width:100%;height:220px;object-fit:contain;background:#e9e7df;border-radius:10px}.frames{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}figcaption{font-size:12px;margin-top:6px}video{width:100%;max-height:360px;background:#eee}a{color:#183f35}';
  const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TryMe 本地录制评测</title><style>' + styles + '</style><h1>TryMe · 本地录制实验 / Mock only</h1><p>实际 MP4 解码画面；无真实模型调用。开屏动效不计玩法成功。</p>' + samples.map(row => '<section><h2>' + escape(row.id) + ' · ' + escape(row.reason) + '</h2><div class="frames">' + row.frames.map((src, i) => '<figure><img src="' + src + '"><figcaption>' + [0.16, 1.4, 3.6, 7][i] + ' s</figcaption></figure>').join('') + '</div></section>').join('');
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: join(output, 'decoded-contact-sheet.png'), fullPage: true });
  const players = '<h2>全部视频</h2>' + data.rows.filter(row => row.video).map(row => '<section><p>' + escape(row.id) + ' · ' + row.video.durationMs + ' ms · ' + escape(row.reason) + '</p><video controls preload="metadata" src="' + escape(row.id) + '.mp4"></video></section>').join('');
  await writeFile(join(output, 'review.html'), html + players);
  await writeFile(join(output, 'decode-checks.json'), JSON.stringify({ decoded }, null, 2) + '\n');
} finally { await local.close(); }
console.log(`Decoded ${decoded.length} MP4s; saved review.html and decoded-contact-sheet.png`);
