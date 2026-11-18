import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('public/vendor', { recursive: true });
await copyFile('node_modules/qrcode-generator/dist/qrcode.mjs', 'public/vendor/qrcode-generator.mjs');
console.log('Copied qrcode-generator 2.0.4 (MIT) with its license header.');
