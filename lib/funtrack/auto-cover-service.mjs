import {workAccessible} from './moderation-service.mjs';
import { COVER_RESERVATIONS, BROWSER_LEASES } from './media-budget.mjs';
import { ApiError, fail, coverType } from './rules.mjs';
import { COVER_MAX_BYTES, HTML_MAX_BYTES } from './limits.mjs';
import { metadataId, metadataStatements } from './work-metadata.mjs';

// This feature reserves at most 7.5 browser hours per UTC month. Each attempt
// reserves 90s (30s work + 60s provider idle fallback); reservations never refund.
// This cap cannot account for unrelated Browser Run users in the same account.
export const AUTO_COVER_LIMITS = Object.freeze({ attemptSeconds: 90, dailySeconds: 900, monthlySeconds: 27000, maxAttempts: 2, leaseMs: 120000 });
const WORK = `SELECT (${workAccessible()}) moderation_accessible,w.*,v.game_key,CASE WHEN m.id IS NOT NULL THEN m.cover_key ELSE v.cover_key END cover_key,
  CASE WHEN m.id IS NOT NULL THEN m.cover_mime ELSE v.cover_mime END cover_mime FROM ft_works w
  JOIN ft_work_versions v ON v.id=w.current_version_id LEFT JOIN ft_work_metadata m ON m.id=w.current_metadata_id AND m.work_id=w.id`;
const imageURL = work => work.cover_key ? '/media/' + (work.current_metadata_id || work.current_version_id) : '';
async function readInput(request) {
  const max = 1024;
  if (Number(request.headers.get('content-length')) > max) fail(413, 'BODY_TOO_LARGE', '封面请求内容过大');
  const reader = request.body?.getReader(); if (!reader) fail(422, 'INVALID_AUTO_COVER_REQUEST', '封面请求无效');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > max) { void reader.cancel().catch(() => {}); fail(413, 'BODY_TOO_LARGE', '封面请求内容过大'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const value of chunks) { bytes.set(value, offset); offset += value.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(422, 'INVALID_AUTO_COVER_REQUEST', '封面请求无效'); }
}

export function createAutoCoverService({ db, bucket, configured, capture, now = () => new Date(), limits = AUTO_COVER_LIMITS }) {
  const sql = (query, ...values) => db().prepare(query).bind(...values);
  const first = (query, ...values) => sql(query, ...values).first();
  const timestamp = () => now().toISOString();
  const getWork = id => first(WORK + ' WHERE w.id=?', id);
  const getJob = (id, version) => first('SELECT * FROM ft_auto_cover_jobs WHERE work_id=? AND version_id=?', id, version);
  const noCover = work => work && work.source === 'html' && !work.cover_key && !work.archived_at && work.moderation_accessible!==0;
  const reasonFor = work => work.archived_at ? 'WORK_ARCHIVED' : work.source !== 'html' ? 'EXTERNAL_WORK' : null;
  async function owned(id, user) { const work = await getWork(id); if (!work) fail(404, 'WORK_NOT_FOUND', '作品不存在'); if (work.author_id !== user.id) fail(403, 'NOT_OWNER', '只能管理自己的作品'); return work; }
  function base(work) { return { workId: work.id, versionId: work.current_version_id, revision: work.revision, metadataId: work.current_metadata_id || null, coverUrl: imageURL(work), retryable: false }; }
  async function budgetReason() {
    const date = timestamp(), day = date.slice(0, 10), month = date.slice(0, 7);
    const used = await first(`SELECT COALESCE(SUM(CASE WHEN created_at>=? THEN reserved_seconds ELSE 0 END),0) daily,COALESCE(SUM(reserved_seconds),0) monthly FROM ${COVER_RESERVATIONS} WHERE created_at>=?`, day, month);
    if (used.monthly + limits.attemptSeconds > limits.monthlySeconds) return 'MONTHLY_BUDGET';
    if (used.daily + limits.attemptSeconds > limits.dailySeconds) return 'DAILY_BUDGET';
    return null;
  }
  async function status(work) {
    const value = base(work);
    if (work.cover_key) return { ...value, status: 'ready' };
    if (reasonFor(work)) return { ...value, status: 'skipped', reason: reasonFor(work) };
    if (!configured()) return { ...value, status: 'unavailable', reason: 'BROWSER_UNAVAILABLE' };
    try {
      const job = await getJob(work.id, work.current_version_id);
      if (!job) return { ...value, status: 'none' };
      const reason = job.status === 'queued' ? await budgetReason() : job.reason;
      // Restoring/rolling back a still-uncovered version can make a previously
      // superseded task eligible again, but only via an explicit bounded retry.
      const recoverable = job.status === 'failed' || (job.status === 'skipped' && job.reason === 'WORK_CHANGED');
      const state = recoverable ? (job.reason === 'BROWSER_UNAVAILABLE' ? 'unavailable' : 'failed') : job.status;
      return { ...value, status: state, attempts: job.attempts, retryable: recoverable && job.attempts < limits.maxAttempts, ...(reason ? { reason } : {}) };
    } catch { return { ...value, status: 'unavailable', reason: 'ENQUEUE_UNAVAILABLE' }; }
  }
  async function enqueue(workId, versionId, ownerId) {
    let work;
    try {
      work = await getWork(workId);
      if (!work || work.author_id !== ownerId || work.current_version_id !== versionId) return { status: 'skipped', reason: 'VERSION_CHANGED', workId, versionId, retryable: false };
      if (!noCover(work) || !configured()) return status(work);
      const at = timestamp();
      await sql("INSERT OR IGNORE INTO ft_auto_cover_jobs(id,work_id,version_id,owner_id,status,created_at,updated_at) VALUES(?,?,?,?,'queued',?,?)", crypto.randomUUID(), workId, versionId, ownerId, at, at).run();
      return status(work);
    } catch { return { ...(work ? base(work) : { workId, versionId, retryable: false }), status: 'unavailable', reason: 'ENQUEUE_UNAVAILABLE' }; }
  }
  async function handle(request, user) {
    const match = /^\/api\/works\/([^/]+)\/auto-cover$/.exec(new URL(request.url).pathname); if (!match) return null;
    const work = await owned(decodeURIComponent(match[1]), user);
    let value;
    if (request.method === 'GET') value = await status(work);
    else if (request.method === 'POST') {
      const input = await readInput(request);
      if (!input || !['generate', 'retry'].includes(input.action) || typeof input.versionId !== 'string' || Object.keys(input).some(key => !['action', 'versionId'].includes(key))) fail(422, 'INVALID_AUTO_COVER_REQUEST', '封面请求无效');
      if (input.versionId !== work.current_version_id) { const error = new ApiError(409, 'AUTO_COVER_VERSION_CHANGED', '作品版本已变化，请刷新后重试'); error.current = { versionId: work.current_version_id, revision: work.revision }; throw error; }
      value = await status(work);
      if (value.status === 'none') value = await enqueue(work.id, work.current_version_id, user.id);
      else if (input.action === 'retry' && ['failed','unavailable'].includes(value.status) && value.retryable) {
        try { await sql("UPDATE ft_auto_cover_jobs SET status='queued',reason=NULL,updated_at=? WHERE work_id=? AND version_id=? AND (status='failed' OR (status='skipped' AND reason='WORK_CHANGED')) AND attempts<?", timestamp(), work.id, work.current_version_id, limits.maxAttempts).run(); value = await status(work); }
        catch { value = { ...base(work), status: 'unavailable', reason: 'ENQUEUE_UNAVAILABLE' }; }
      }
    } else fail(405, 'METHOD_NOT_ALLOWED', '不支持该请求方法');
    return Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
  }
  async function mark(job, statusValue, reason) {
    await sql('UPDATE ft_auto_cover_jobs SET status=?,reason=?,lease_id=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_id=?', statusValue, reason || null, timestamp(), job.id, job.lease_id).run();
  }
  async function claim() {
    const at = timestamp(), lease = crypto.randomUUID(), until = new Date(now().getTime() + limits.leaseMs).toISOString();
    await sql("UPDATE ft_auto_cover_jobs SET status='failed',reason='CAPTURE_INTERRUPTED',lease_id=NULL,lease_until=NULL,updated_at=? WHERE status='running' AND lease_until<=?", at, at).run();
    const job = await first("SELECT * FROM ft_auto_cover_jobs WHERE status='queued' AND attempts<? ORDER BY created_at,id LIMIT 1", limits.maxAttempts); if (!job) return null;
    const work = await getWork(job.work_id);
    if (!noCover(work) || work.current_version_id !== job.version_id) { await sql("UPDATE ft_auto_cover_jobs SET status='skipped',reason='WORK_CHANGED',updated_at=? WHERE id=? AND status='queued'", at, job.id).run(); return null; }
    const statements = [
      sql(`UPDATE ft_auto_cover_jobs SET status='running',attempts=attempts+1,lease_id=?,lease_until=?,reason=NULL,updated_at=? WHERE id=? AND status='queued' AND attempts<?
        AND NOT EXISTS(SELECT 1 FROM ${BROWSER_LEASES} WHERE status='running' AND lease_until>?)
        AND (SELECT COALESCE(SUM(reserved_seconds),0) FROM ${COVER_RESERVATIONS} WHERE created_at>=?)+?<=?
        AND (SELECT COALESCE(SUM(reserved_seconds),0) FROM ${COVER_RESERVATIONS} WHERE created_at>=?)+?<=?`, lease, until, at, job.id, limits.maxAttempts, at, at.slice(0,10), limits.attemptSeconds, limits.dailySeconds, at.slice(0,7), limits.attemptSeconds, limits.monthlySeconds),
      sql('INSERT INTO ft_auto_cover_attempts(id,job_id,reserved_seconds,created_at) SELECT ?,id,?,? FROM ft_auto_cover_jobs WHERE id=? AND lease_id=?', lease, limits.attemptSeconds, at, job.id, lease),
    ];
    try { await db().batch(statements); } catch (error) { const existing = await first('SELECT * FROM ft_auto_cover_jobs WHERE id=?', job.id); if (existing?.lease_id !== lease) throw error; }
    return first('SELECT * FROM ft_auto_cover_jobs WHERE id=? AND lease_id=?', job.id, lease);
  }
  async function apply(job, result) {
    const work = await getWork(job.work_id);
    if (!noCover(work) || work.current_version_id !== job.version_id) { await mark(job, 'skipped', 'WORK_CHANGED'); return; }
    const bytes = new Uint8Array(result.bytes || []); if (!bytes.length || bytes.length > COVER_MAX_BYTES) throw new Error('Invalid screenshot size');
    const mime = coverType(bytes, result.mime), id = metadataId(), key = 'covers/' + id, initialId = work.initial_metadata_id || metadataId(), at = timestamp();
    await bucket().put(key, bytes, { httpMetadata: { contentType: mime } });
    try {
      await db().batch([
        ...metadataStatements(sql, work, { id, initialId, expected: work.revision, coverKey: key, coverMime: mime, at, actor: job.owner_id }),
        sql(`UPDATE ft_works SET current_metadata_id=?,initial_metadata_id=COALESCE(initial_metadata_id,?),revision=revision+1,updated_at=?
          WHERE id=? AND current_version_id=? AND revision=? AND archived_at IS NULL AND current_metadata_id IS ?
          AND EXISTS(SELECT 1 FROM ft_auto_cover_jobs WHERE id=? AND status='running' AND lease_id=? AND lease_until>?)`, id, initialId, at, work.id, job.version_id, work.revision, work.current_metadata_id || null, job.id, job.lease_id, at),
        sql(`UPDATE ft_auto_cover_jobs SET status='ready',metadata_id=?,reason=NULL,lease_id=NULL,lease_until=NULL,updated_at=?
          WHERE id=? AND lease_id=? AND EXISTS(SELECT 1 FROM ft_works WHERE id=? AND current_metadata_id=?)`, id, at, job.id, job.lease_id, work.id, id),
        // A no-op CAS must roll back the new metadata as well.
        sql("UPDATE ft_auto_cover_jobs SET owner_id=NULL WHERE id=? AND NOT(status='ready' AND metadata_id=?)", job.id, id),
      ]);
    } catch (error) {
      const committed = await first('SELECT * FROM ft_auto_cover_jobs WHERE id=?', job.id);
      if (committed?.status === 'ready' && committed.metadata_id === id) return;
      // A failed confirmation read throws before deletion, retaining harmless
      // orphans rather than deleting an object which might have committed.
      try { await bucket().delete(key); } catch {}
      const current = await getWork(work.id);
      if (!noCover(current) || current.current_version_id !== job.version_id || current.revision !== work.revision) { await mark(job, 'skipped', 'WORK_CHANGED'); return; }
      throw error;
    }
  }
  async function processPending() {
    if (!configured()) return { processed: false, reason: 'BROWSER_UNAVAILABLE' };
    const job = await claim(); if (!job) return { processed: false };
    const started = Date.now(); let outcome = 'failed';
    try {
      const work = await getWork(job.work_id), object = noCover(work) && work.current_version_id === job.version_id ? await bucket().get(work.game_key) : null;
      if (!object || object.size > HTML_MAX_BYTES) { await mark(job, 'skipped', 'GAME_UNAVAILABLE'); outcome = 'skipped'; return { processed: true, status: 'skipped' }; }
      const result = await capture(await object.text()); await apply(job, result); outcome = (await first('SELECT status FROM ft_auto_cover_jobs WHERE id=?', job.id))?.status || 'failed';
      return { processed: true, status: outcome };
    } catch (error) {
      const allowed = ['CAPTURE_TIMEOUT','CAPTURE_EMPTY','CAPTURE_TOO_LARGE','BROWSER_UNAVAILABLE','INVALID_CAPTURE_HTML'];
      const reason = allowed.includes(error?.code) ? error.code : 'CAPTURE_FAILED';
      await mark(job, 'failed', reason); return { processed: true, status: 'failed', reason };
    } finally {
      await sql('UPDATE ft_auto_cover_attempts SET elapsed_ms=?,outcome=? WHERE id=?', Math.max(0,Date.now()-started), outcome, job.lease_id).run();
    }
  }
  return { enqueue, handle, processPending, status };
}
