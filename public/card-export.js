import qrcode from './vendor/qrcode-generator.mjs';
import { isCardId, publicCoverPath } from './public-card-links.js';

export function exportCardTarget(value, origin = globalThis.location?.origin) {
  try {
    const url = new URL(value, origin);
    const match = /^\/c\/([^/]+)\/?$/.exec(url.pathname);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin || url.username || url.password || !match || !isCardId(match[1])) return null;
    return { id: match[1], url: new URL('/c/' + match[1], origin).href };
  } catch { return null; }
}

export function qrMatrix(text) {
  const qr = qrcode(0, 'M');
  // QR byte mode; all browser URL strings are UTF-8 encoded explicitly.
  const original = qrcode.stringToBytes;
  try {
    qrcode.stringToBytes = value => [...new TextEncoder().encode(value)];
    qr.addData(text, 'Byte'); qr.make();
  } finally { qrcode.stringToBytes = original; }
  const count = qr.getModuleCount();
  return Array.from({ length: count }, (_, y) => Array.from({ length: count }, (_, x) => qr.isDark(y, x)));
}

export function drawQR(context, matrix, x, y, size) {
  const cell = Math.floor(size / (matrix.length + 8)), extent = cell * (matrix.length + 8);
  const left = x + Math.floor((size - extent) / 2), top = y + Math.floor((size - extent) / 2);
  context.fillStyle = '#ffffff'; context.fillRect(x, y, size, size);
  context.fillStyle = '#18241e';
  matrix.forEach((row, ry) => row.forEach((on, rx) => {
    if (on) context.fillRect(left + (rx + 4) * cell, top + (ry + 4) * cell, cell, cell);
  }));
}

function wrappedText(ctx, value, x, y, width, lineHeight, maxLines) {
  const chars = [...String(value || '')], lines = []; let line = '';
  for (const char of chars) {
    if (char === '\n' || ctx.measureText(line + char).width > width) { lines.push(line); line = char === '\n' ? '' : char; }
    else line += char;
  }
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((text, index) => {
    if (index === maxLines - 1 && lines.length > maxLines) {
      while (text && ctx.measureText(text + '…').width > width) text = text.slice(0, -1);
      text += '…';
    }
    ctx.fillText(text, x, y + index * lineHeight);
  });
}

async function loadPublicCover(work, card, signal) {
  const url = publicCoverPath(work.coverUrl, card.id, work.id, location.origin);
  if (!url) return null;
  try {
    const response = await fetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size > 4 * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(blob.type)) return null;
    return await createImageBitmap(blob);
  } catch { return null; }
}

// A deliberately flat share poster, not a screenshot of the interactive/3D template.
export async function renderCardPoster({ card, url, canvas, signal, locale = 'zh-CN' }) {
  canvas.width = 1200; canvas.height = 1440;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('CANVAS_UNAVAILABLE');
  const english = locale === 'en';
  const works = card.works.slice(0, 3);
  const covers = await Promise.all(works.map(work => loadPublicCover(work, card, signal)));
  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    ctx.fillStyle = '#f6f4ed'; ctx.fillRect(0, 0, 1200, 1440);
    ctx.fillStyle = '#23382c'; ctx.font = '700 42px system-ui, sans-serif'; ctx.fillText('TryMe', 80, 100);
    ctx.font = '600 68px system-ui, sans-serif'; wrappedText(ctx, card.name, 80, 220, 1040, 78, 2);
    ctx.fillStyle = '#66756a'; ctx.font = '30px system-ui, sans-serif';
    wrappedText(ctx, card.headline || card.bio || '', 80, 365, 1040, 44, 2);
    works.forEach((work, index) => {
      const gap = 25, width = works.length === 1 ? 640 : (1040 - gap * (works.length - 1)) / works.length;
      const x = works.length === 1 ? 280 : 80 + index * (width + gap), y = 505, height = 255;
      ctx.fillStyle = ['#dce5db', '#e4ded3', '#dbe1e6'][index]; ctx.fillRect(x, y, width, height);
      const image = covers[index];
      if (image) {
        const scale = Math.max(width / image.width, height / image.height);
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
        ctx.drawImage(image, x + (width - image.width * scale) / 2, y + (height - image.height * scale) / 2, image.width * scale, image.height * scale); ctx.restore();
      } else {
        ctx.fillStyle = '#5e7062'; ctx.font = '700 74px system-ui, sans-serif'; ctx.fillText(String(index + 1).padStart(2, '0'), x + 30, y + 150);
      }
      ctx.fillStyle = '#263a2e'; ctx.font = '600 28px system-ui, sans-serif'; wrappedText(ctx, work.name, x, y + height + 48, width, 40, 2);
    });
    ctx.fillStyle = '#d7ded4'; ctx.fillRect(80, 920, 1040, 2);
    drawQR(ctx, qrMatrix(url), 80, 990, 290);
    ctx.fillStyle = '#263a2e'; ctx.font = '600 36px system-ui, sans-serif'; ctx.fillText(english ? 'Explore my creations' : '一起看看我的作品', 420, 1080);
    ctx.fillStyle = '#6d796f'; ctx.font = '27px system-ui, sans-serif'; ctx.fillText(english ? 'Scan to view · Sign in to play' : '扫码查看名片 · 登录后试玩', 420, 1140);
    ctx.font = '24px system-ui, sans-serif'; ctx.fillText(new URL(url).host, 420, 1200);
    ctx.font = '22px system-ui, sans-serif'; ctx.fillText(english ? (card.works.length > 3 ? `First 3 works · Scan to see all ${card.works.length}` : `${card.works.length} works`) : (card.works.length > 3 ? `展示前 3 件作品 · 扫码查看全部 ${card.works.length} 件` : `${card.works.length} 件作品`), 80, 1365);
    return canvas;
  } finally { for (const cover of covers) cover?.close(); }
}
