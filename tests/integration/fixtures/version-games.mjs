// Small, deterministic fixtures; never change a real creator's game to test releases.
import { deflateSync } from 'node:zlib';

export function gameHTML(label, increment = 1, color = '#b65339') {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${label}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:${color};color:white;font:20px system-ui}main{text-align:center}button{padding:16px 28px;border:0;border-radius:12px;font:inherit;cursor:pointer}output{display:block;font-size:56px;margin:24px}</style></head><body><main><h1>${label}</h1><output id="score">0</output><button id="play">每次 +${increment}</button></main><script>let score=0;document.getElementById('play').onclick=()=>{score+=${increment};document.getElementById('score').textContent=score;};</script></body></html>`;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}
export function coverPNG(red, green, blue) {
  const size = 48, header = Buffer.alloc(13), scanlines = Buffer.alloc(size * (1 + size * 3));
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = y * (1 + size * 3) + 1 + x * 3;
    scanlines[offset] = red; scanlines[offset + 1] = green; scanlines[offset + 2] = blue;
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}

export const versions = [
  { marker: 'VERSION_FIXTURE_V1', html: gameHTML('VERSION_FIXTURE_V1', 1, '#b65339'), cover: coverPNG(182, 83, 57) },
  { marker: 'VERSION_FIXTURE_V2', html: gameHTML('VERSION_FIXTURE_V2', 2, '#3262ac'), cover: coverPNG(50, 98, 172) },
  { marker: 'VERSION_FIXTURE_V3', html: gameHTML('VERSION_FIXTURE_V3', 3, '#307c50'), cover: coverPNG(48, 124, 80) },
];
