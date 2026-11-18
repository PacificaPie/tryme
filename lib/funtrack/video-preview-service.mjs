import { ApiError, fail } from './rules.mjs';
import { HTML_MAX_BYTES } from './limits.mjs';
import { VIDEO_PREVIEW, validatePreview } from './video-preview-capture.mjs';

// A separate maximum of 2.5 reserved browser hours/month, ten attempts/day.
// Each reservation covers the hard 30s deadline plus provider idle fallback.
export const PREVIEW_LIMITS = Object.freeze({ attemptSeconds: 90, dailySeconds: 900, monthlySeconds: 9000, maxAttempts: 2, leaseMs: 120000 });
const WORK = `SELECT w.*,v.game_key,v.content_hash FROM ft_works w JOIN ft_work_versions v ON v.id=w.current_version_id`;
const valid = work => work && work.source === 'html' && work.game_key && work.content_hash && !work.archived_at;
const eligible = (work, job) => valid(work) && work.current_version_id === job.version_id && work.content_hash === job.content_hash && work.author_id === job.owner_id;
const mediaURL = (id, job, isPublic = false) => `/api/${isPublic ? 'public/' : ''}works/${encodeURIComponent(id)}/preview/${encodeURIComponent(job.id)}`;

export function createVideoPreviewService({ db, bucket, configured, capture, now = () => new Date(), limits = PREVIEW_LIMITS }) {
  const sql = (query, ...values) => db().prepare(query).bind(...values);
  const first = (query, ...values) => sql(query, ...values).first();
  const timestamp = () => now().toISOString();
  const getWork = id => first(WORK + ' WHERE w.id=?', id);
  const getJob = work => first('SELECT * FROM ft_video_preview_jobs WHERE work_id=? AND version_id=?', work.id, work.current_version_id);
  const reasonFor = work => work.archived_at ? 'WORK_ARCHIVED' : work.source !== 'html' ? 'EXTERNAL_WORK' : !valid(work) ? 'GAME_UNAVAILABLE' : null;
  async function budgetReason() {
    const at = timestamp();
    const used = await first('SELECT COALESCE(SUM(CASE WHEN created_at>=? THEN reserved_seconds ELSE 0 END),0) daily,COALESCE(SUM(reserved_seconds),0) monthly FROM ft_video_preview_attempts WHERE created_at>=?', at.slice(0, 10), at.slice(0, 7));
    if (used.monthly + limits.attemptSeconds > limits.monthlySeconds) return 'MONTHLY_BUDGET';
    if (used.daily + limits.attemptSeconds > limits.dailySeconds) return 'DAILY_BUDGET';
    return null;
  }
  async function status(work) {
    const base = { workId: work.id, versionId: work.current_version_id, retryable: false };
    if (reasonFor(work)) return { ...base, status: 'skipped', reason: reasonFor(work) };
    if (!configured()) return { ...base, status: 'unavailable', reason: 'BROWSER_UNAVAILABLE' };
    try {
      const job = await getJob(work);
      if (!job) return { ...base, status: 'none' };
      const retryable = (job.status === 'failed' || job.status === 'skipped' && job.reason === 'WORK_CHANGED') && job.attempts < limits.maxAttempts;
      const reason = job.status === 'queued' ? await budgetReason() : job.reason;
      return { ...base, status: job.status, attempts: job.attempts, retryable, ...(reason ? { reason } : {}), ...(job.status === 'ready' ? { preview: { url: mediaURL(work.id, job), mime: 'video/mp4', durationMs: job.duration_ms } } : {}) };
    } catch { return { ...base, status: 'unavailable', reason: 'ENQUEUE_UNAVAILABLE' }; }
  }
  async function enqueue(workId, versionId, ownerId) {
    // Publication is committed before this optional insert. A queue outage must
    // never turn a successful publish into a failed/duplicated upload.
    try {
      if (!configured()) return;
      const work = await getWork(workId);
      if (!valid(work) || work.author_id !== ownerId || work.current_version_id !== versionId) return;
      const at = timestamp();
      await sql("INSERT OR IGNORE INTO ft_video_preview_jobs(id,work_id,version_id,owner_id,content_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?)", crypto.randomUUID(), workId, versionId, ownerId, work.content_hash, at, at).run();
    } catch { /* Owner can explicitly request generation after recovery. */ }
  }
  async function handle(request, user) {
    const match = /^\/api\/works\/([^/]+)\/auto-preview$/.exec(new URL(request.url).pathname); if (!match) return null;
    const work = await getWork(decodeURIComponent(match[1]));
    if (!work) fail(404, 'WORK_NOT_FOUND', '作品不存在');
    if (work.author_id !== user.id) fail(403, 'NOT_OWNER', '只能管理自己的作品');
    if (request.method === 'POST') {
      const reader = request.body?.getReader(); if (!reader) fail(422, 'INVALID_PREVIEW_REQUEST', '预览请求无效');
      let text = '', size = 0; const decoder = new TextDecoder();
      try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1024) { void reader.cancel().catch(() => {}); fail(413, 'BODY_TOO_LARGE', '预览请求过大'); } text += decoder.decode(value, { stream: true }); } text += decoder.decode(); } finally { reader.releaseLock(); }
      let input; try { input = JSON.parse(text); } catch { fail(422, 'INVALID_PREVIEW_REQUEST', '预览请求无效'); }
      if (!input || !['generate', 'retry'].includes(input.action) || typeof input.versionId !== 'string' || Object.keys(input).some(key => !['action', 'versionId'].includes(key))) fail(422, 'INVALID_PREVIEW_REQUEST', '预览请求无效');
      if (input.versionId !== work.current_version_id) throw new ApiError(409, 'PREVIEW_VERSION_CHANGED', '作品版本已变化，请刷新后重试');
      const state = await status(work);
      if (state.status === 'none') await enqueue(work.id, work.current_version_id, user.id);
      else if (input.action === 'retry' && state.retryable) await sql("UPDATE ft_video_preview_jobs SET status='queued',reason=NULL,updated_at=? WHERE work_id=? AND version_id=? AND (status='failed' OR (status='skipped' AND reason='WORK_CHANGED')) AND attempts<?", timestamp(), work.id, work.current_version_id, limits.maxAttempts).run();
    } else if (request.method !== 'GET') fail(405, 'METHOD_NOT_ALLOWED', '不支持该请求方法');
    return Response.json(await status(work), { headers: { 'Cache-Control': 'no-store' } });
  }
  async function decorate(works, userId) {
    if (!configured() || !works.length) return works;
    try {
      const byId = new Map();
      for (let offset = 0; offset < works.length; offset += 80) {
        const ids = works.slice(offset, offset + 80).map(work => work.id);
        const result = await sql(`SELECT p.*,d.visibility FROM ft_video_preview_jobs p JOIN ft_works w ON w.id=p.work_id AND w.current_version_id=p.version_id JOIN ft_work_versions v ON v.id=p.version_id AND v.content_hash=p.content_hash LEFT JOIN ft_work_discovery d ON d.work_id=w.id WHERE p.status='ready' AND w.archived_at IS NULL AND p.work_id IN (${ids.map(() => '?').join(',')})`, ...ids).all();
        for (const job of result.results) byId.set(job.work_id, job);
      }
      return works.map(work => { const job = byId.get(work.id); return job && work.versionId === job.version_id && (job.visibility === 'listed' || job.owner_id === userId) ? { ...work, preview: { url: mediaURL(work.id, job, job.visibility === 'listed'), mime: 'video/mp4', durationMs: job.duration_ms } } : work; });
    } catch { return works; }
  }
  async function media(request, workId, previewId, user = { id: '' }) {
    if (!configured()) fail(404, 'MEDIA_NOT_FOUND', '预览不存在');
    const job = await first(`SELECT p.*,w.author_id,w.archived_at,w.current_version_id,d.visibility FROM ft_video_preview_jobs p JOIN ft_works w ON w.id=p.work_id JOIN ft_work_versions v ON v.id=p.version_id AND v.content_hash=p.content_hash LEFT JOIN ft_work_discovery d ON d.work_id=w.id WHERE p.id=? AND p.work_id=? AND p.status='ready'`, previewId, workId);
    if (!job || job.archived_at || job.current_version_id !== job.version_id || !(job.visibility === 'listed' || user?.id === job.author_id)) fail(404, 'MEDIA_NOT_FOUND', '预览不存在');
    const object = await bucket().get(job.object_key);
    if (!object || object.size !== job.byte_size || object.size > VIDEO_PREVIEW.maxBytes) fail(404, 'MEDIA_NOT_FOUND', '预览不存在');
    const size = object.size, headers = { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Accept-Ranges': 'bytes', 'Content-Length': String(size) };
    let start = 0, end = size - 1, statusCode = 200;
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) { if (!match[1]) start = Math.max(0, size - Number(match[2])); else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); } } else start = size;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': '0' } });
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`; headers['Content-Length'] = String(end - start + 1); statusCode = 206;
    }
    return new Response(request.method === 'HEAD' ? null : range ? (await object.arrayBuffer()).slice(start, end + 1) : object.body, { status: statusCode, headers });
  }
  async function mark(job, state, reason) { await sql('UPDATE ft_video_preview_jobs SET status=?,reason=?,lease_id=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_id=?', state, reason || null, timestamp(), job.id, job.lease_id).run(); }
  async function claim() {
    const at = timestamp(), lease = crypto.randomUUID(), until = new Date(now().getTime() + limits.leaseMs).toISOString();
    await sql("UPDATE ft_video_preview_jobs SET status='failed',reason='CAPTURE_INTERRUPTED',lease_id=NULL,lease_until=NULL,updated_at=? WHERE status='running' AND lease_until<=?", at, at).run();
    const job = await first("SELECT * FROM ft_video_preview_jobs WHERE status='queued' AND attempts<? ORDER BY created_at,id LIMIT 1", limits.maxAttempts); if (!job) return null;
    if (!eligible(await getWork(job.work_id), job)) { await sql("UPDATE ft_video_preview_jobs SET status='skipped',reason='WORK_CHANGED',updated_at=? WHERE id=? AND status='queued'", at, job.id).run(); return null; }
    try { await db().batch([
      sql(`UPDATE ft_video_preview_jobs SET status='running',attempts=attempts+1,lease_id=?,lease_until=?,reason=NULL,updated_at=? WHERE id=? AND status='queued' AND attempts<?
        AND NOT EXISTS(SELECT 1 FROM ft_video_preview_jobs WHERE status='running' AND lease_until>?)
        AND (SELECT COALESCE(SUM(reserved_seconds),0) FROM ft_video_preview_attempts WHERE created_at>=?)+?<=?
        AND (SELECT COALESCE(SUM(reserved_seconds),0) FROM ft_video_preview_attempts WHERE created_at>=?)+?<=?`, lease, until, at, job.id, limits.maxAttempts, at, at.slice(0, 10), limits.attemptSeconds, limits.dailySeconds, at.slice(0, 7), limits.attemptSeconds, limits.monthlySeconds),
      sql('INSERT INTO ft_video_preview_attempts(id,job_id,reserved_seconds,created_at) SELECT ?,id,?,? FROM ft_video_preview_jobs WHERE id=? AND lease_id=?', lease, limits.attemptSeconds, at, job.id, lease),
    ]); } catch (error) { if ((await first('SELECT lease_id FROM ft_video_preview_jobs WHERE id=?', job.id))?.lease_id !== lease) throw error; }
    return first('SELECT * FROM ft_video_preview_jobs WHERE id=? AND lease_id=?', job.id, lease);
  }
  async function apply(job, result) {
    if (!eligible(await getWork(job.work_id), job)) { await mark(job, 'skipped', 'WORK_CHANGED'); return; }
    const bytes = validatePreview(result.bytes), key = `previews/${job.id}/${job.lease_id}.mp4`, at = timestamp();
    if (result.mime !== 'video/mp4' || !Number.isInteger(result.durationMs) || result.durationMs < 6000 || result.durationMs > 10000) throw new Error('Invalid preview');
    await bucket().put(key, bytes, { httpMetadata: { contentType: 'video/mp4' } });
    try { await sql(`UPDATE ft_video_preview_jobs SET status='ready',object_key=?,byte_size=?,duration_ms=?,reason=NULL,lease_id=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_id=? AND lease_until>? AND status='running'
      AND EXISTS(SELECT 1 FROM ft_works w JOIN ft_work_versions v ON v.id=w.current_version_id WHERE w.id=? AND w.current_version_id=? AND w.archived_at IS NULL AND v.content_hash=?)`, key, bytes.length, result.durationMs, at, job.id, job.lease_id, at, job.work_id, job.version_id, job.content_hash).run(); }
    catch { /* Confirm a possibly committed write before deleting any object. */ }
    const saved = await first('SELECT status,object_key FROM ft_video_preview_jobs WHERE id=?', job.id);
    if (saved?.status === 'ready' && saved.object_key === key) return;
    try { await bucket().delete(key); } catch {}
    if (!eligible(await getWork(job.work_id), job)) await mark(job, 'skipped', 'WORK_CHANGED');
    else throw new Error('Preview result could not be committed');
  }
  async function processPending() {
    if (!configured()) return { processed: false };
    const job = await claim(); if (!job) return { processed: false };
    const start = Date.now(); let outcome = 'failed';
    try {
      const work = await getWork(job.work_id), object = eligible(work, job) ? await bucket().get(work.game_key) : null;
      if (!object || object.size > HTML_MAX_BYTES) { await mark(job, 'skipped', 'GAME_UNAVAILABLE'); outcome = 'skipped'; return { processed: true, status: outcome }; }
      const bytes = new Uint8Array(await object.arrayBuffer());
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
      if (digest !== job.content_hash) throw Object.assign(new Error('Content changed'), { code: 'CONTENT_CHANGED' });
      await apply(job, await capture(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); outcome = (await first('SELECT status FROM ft_video_preview_jobs WHERE id=?', job.id))?.status || 'failed';
      return { processed: true, status: outcome };
    } catch (error) {
      const allowed = ['DEMO_INCOMPLETE', 'CAPTURE_TIMEOUT', 'CAPTURE_EMPTY', 'CAPTURE_TOO_LARGE', 'BROWSER_UNAVAILABLE', 'INVALID_CAPTURE_HTML', 'CONTENT_CHANGED'];
      const reason = allowed.includes(error?.code) ? error.code : 'CAPTURE_FAILED';
      await mark(job, 'failed', reason); return { processed: true, status: 'failed', reason };
    } finally { await sql('UPDATE ft_video_preview_attempts SET elapsed_ms=?,outcome=? WHERE id=?', Date.now() - start, outcome, job.lease_id).run(); }
  }
  return { enqueue, handle, status, decorate, media, processPending };
}
