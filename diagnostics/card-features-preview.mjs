// Loopback-only acceptance fixture. Real router/SQL and real UI; synthetic user,
// in-memory D1/R2, no Clerk, cloud credentials, or production writes.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fixture, OWNER, handleAPI } from '../tests/helpers/router-fixture.mjs';
import { createPublicSharingService } from '../lib/funtrack/public-sharing.mjs';
const f = fixture({ after() {} }), port = 8894, origin = `http://127.0.0.1:${port}`;
await f.api('/api/me/profile', { method: 'POST', body: { name: 'Lin · 本地验收', bio: '把想象做成可以体验的小作品。', headline: 'Creative developer', avatarPreset: 'sun' } });
const works = [];
for (const [index, name] of ['Orbit Playground', '像素花园', '纸上漫游'].entries()) {
  const result = await f.publish({ name, bytes: `<html><body style="background:#dae7f0"><button>${name}</button></body></html>` });
  if (result.status !== 201) throw Error(JSON.stringify(result));
  works.push(result.work);
}
const { card } = await f.api('/api/cards', { method: 'POST', body: { name: 'Lin · 本地验收', template: 'city', signature: 'Small worlds, real curiosity.', workIds: [works[0].id, works[1].id] } });
const originalSnapshot = f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json;
const sharing = createPublicSharingService({ db: () => f.db, bucket: () => f.bucket, origin: () => origin });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const published = '/site.html#/published/' + works[2].id;
http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(403); return res.end(); }
    const url = new URL(req.url, origin);
    if (url.pathname === '/__qa') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Local card acceptance fixture</title></head><body style="font:16px system-ui;background:#e5e9ed"><p>LOCAL FIXTURE · 390 × 844 · simulated identity, real UI/router</p><p><a href="${published}">Desktop publication</a> · <a href="/c/${card.id}">Original city card</a> · <a href="/site.html#/cards">Workspace</a></p><iframe title="Mobile acceptance viewport" style="width:390px;height:844px;border:1px solid #ccc;background:white" src="${published}"></iframe></body></html>`);
    }
    if (url.pathname === '/__qa/state') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ originalCardId: card.id, workIds: works.map(w => w.id), cards: f.count('ft_cards'), originalUnchanged: originalSnapshot === f.database.prepare('SELECT snapshot_json FROM ft_cards WHERE id=?').get(card.id).snapshot_json })); }
    let response;
    if (url.pathname.startsWith('/c/')) response = await sharing.page(new Request(url, { method: req.method }), url.pathname.split('/')[2]);
    else if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const headers = new Headers(req.headers); headers.set('Origin', 'https://site.test');
      if (!url.pathname.startsWith('/api/public/')) { headers.set('oai-authenticated-user-id', OWNER); headers.set('oai-authenticated-user-full-name', 'Local fixture'); headers.set('oai-authenticated-user-email', 'fixture@example.test'); }
      response = await handleAPI(new Request('https://site.test' + url.pathname + url.search, { method: req.method, headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) }));
    } else {
      const root = path.resolve('public'), pathname = url.pathname === '/site' ? '/site.html' : url.pathname;
      let file = path.resolve(root, '.' + pathname);
      if (!file.startsWith(root + '/')) throw Error('Invalid path');
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      response = new Response(await readFile(file), { headers: { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' } });
    }
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { res.writeHead(404); res.end('Fixture resource unavailable'); console.error(error.message); }
}).listen(port, '127.0.0.1', () => console.log(`Local fixture: ${origin}/__qa\nPublication: ${origin}${published}\nOriginal card: ${origin}/c/${card.id}`));
