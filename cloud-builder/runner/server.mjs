import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { BuildEngine } from './build.mjs';

const MAX_BODY = 16384;
export function createBuildServer({ token, engine = new BuildEngine() }) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) throw Error('A fresh 32-byte container control token is required.');
  const expected = Buffer.from('Bearer ' + token);
  const authorized = value => { const provided = Buffer.from(typeof value === 'string' ? value : ''); return provided.length === expected.length && timingSafeEqual(provided, expected); };
  const json = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
  async function body(request) {
    if (!String(request.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(Error('请使用 JSON 请求。'), { code: 'INVALID_REQUEST', status: 415 });
    let size = 0; const chunks = [];
    for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) throw Object.assign(Error('请求过大。'), { code: 'BODY_TOO_LARGE', status: 413 }); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw Object.assign(Error('JSON 格式无效。'), { code: 'INVALID_REQUEST', status: 400 }); }
  }
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://container').pathname;
    if (request.method === 'GET' && pathname === '/health') return json(response, 200, { ok: true, phase: engine.phase });
    if (!authorized(request.headers.authorization)) return json(response, 401, { error: { code: 'CONTROL_AUTH_REQUIRED', message: 'Container control authentication required.' } });
    try {
      if (request.method === 'POST' && pathname === '/prepare') return json(response, 200, await engine.prepare(await body(request)));
      if (request.method === 'POST' && pathname === '/build') {
        const input = await body(request); if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).length) throw Object.assign(Error('build 请求应为空对象。'), { code: 'INVALID_REQUEST', status: 422 });
        return json(response, 200, await engine.build());
      }
      if (request.method === 'GET' && pathname === '/artifact') {
        if (engine.phase !== 'ready' || !engine.artifact) return json(response, 409, { error: { code: 'BUILD_NOT_READY', message: '构建产物尚未就绪。' } });
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': engine.artifact.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); return response.end(engine.artifact);
      }
      return json(response, 404, { error: { code: 'NOT_FOUND', message: 'Unknown container control route.' } });
    } catch (error) {
      return json(response, error.status || (error.code === 'BUILD_STATE_CHANGED' ? 409 : 422), { error: { code: error.code || 'BUILD_FAILED', message: String(error.message || 'Build failed.').replaceAll(token, '[REDACTED]').slice(-4000) } });
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000; server.maxConnections = 16;
  return { server, engine };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const token = process.env.FUNTRACK_CONTAINER_CONTROL_TOKEN;
  delete process.env.FUNTRACK_CONTAINER_CONTROL_TOKEN;
  const { server, engine } = createBuildServer({ token });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { void engine.cancel().finally(() => server.close(() => process.exit(0))); });
  server.listen(8080, '0.0.0.0', () => console.log('Funtrack isolated build control is ready on port 8080.'));
}
