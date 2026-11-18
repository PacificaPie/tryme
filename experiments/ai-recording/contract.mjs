import { createHash } from 'node:crypto';

export const LIMITS = Object.freeze({
  actions: 5, calls: 5, actionMs: 1000, timelineMs: 6000, recordMs: 7600,
  explorationMs: 25000, sessionMs: 30000, modelMs: 4000,
  htmlBytes: 16 * 1024 * 1024, observationBytes: 192 * 1024,
  totalObservationBytes: 960 * 1024, responseBytes: 4096, hintBytes: 400,
  targets: 12, screenshotBytes: 160 * 1024, videoBytes: 2 * 1024 * 1024,
});
export const VERSION = 'bounded-recording-v1';
export const fail = code => Object.assign(new Error(code), { code });
export const hash = value => createHash('sha256').update(value).digest('hex');
export const byteLength = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const integer = (n, low, high) => Number.isSafeInteger(n) && n >= low && n <= high;
const id = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(value);
const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];

// Manifests are operator-reviewed local files, NEVER model/game output.
export function validateManifest(manifest, html) {
  if (typeof html !== 'string' || !html.length || byteLength(html) > LIMITS.htmlBytes) throw fail('HTML_LIMIT');
  if (!manifest || manifest.contentHash !== hash(html) || !['dom', 'canvas', 'opening'].includes(manifest.kind)) throw fail('UNREVIEWED_CONTENT');
  if (!Array.isArray(manifest.targets) || manifest.targets.length > LIMITS.targets) throw fail('TARGET_LIMIT');
  const ids = new Set();
  for (const target of manifest.targets) {
    if (!exact(target, ['id', 'selector', 'kind', 'keys']) || !id(target.id) || ids.has(target.id)
      || !/^#[a-zA-Z][\w-]{0,63}$/.test(target.selector) || !['button', 'canvas'].includes(target.kind)
      || !Array.isArray(target.keys) || target.keys.some(key => !keys.includes(key))
      || (target.kind !== 'canvas' && target.keys.length)) throw fail('INVALID_MANIFEST');
    ids.add(target.id);
  }
  return structuredClone(manifest);
}

export function validateAction(action, manifest) {
  if (!action || typeof action !== 'object') throw fail('INVALID_ACTION');
  if (action.type === 'wait') {
    if (!exact(action, ['type', 'ms']) || !integer(action.ms, 100, LIMITS.actionMs)) throw fail('INVALID_ACTION');
    return structuredClone(action);
  }
  const target = manifest.targets.find(item => item.id === action.target);
  if (!target) throw fail('TARGET_NOT_ALLOWED');
  if (action.type === 'click') {
    if (!exact(action, ['type', 'target', 'settleMs']) || target.kind !== 'button') throw fail('INVALID_ACTION');
  } else if (action.type === 'tap') {
    if (!exact(action, ['type', 'target', 'x', 'y', 'settleMs']) || target.kind !== 'canvas'
      || !Number.isFinite(action.x) || !Number.isFinite(action.y)
      || action.x < 0.05 || action.x > 0.95 || action.y < 0.05 || action.y > 0.95) throw fail('INVALID_ACTION');
  } else if (action.type === 'key') {
    if (!exact(action, ['type', 'target', 'key', 'settleMs']) || target.kind !== 'canvas'
      || !target.keys.includes(action.key)) throw fail('KEY_NOT_ALLOWED');
  } else throw fail('ACTION_NOT_ALLOWED');
  if (!integer(action.settleMs, 100, LIMITS.actionMs)) throw fail('INVALID_ACTION');
  return structuredClone(action);
}
export function validateResponse(raw, manifest) {
  if (typeof raw !== 'string' || byteLength(raw) > LIMITS.responseBytes) throw fail('RESPONSE_LIMIT');
  let data;
  try { data = JSON.parse(raw); } catch { throw fail('INVALID_JSON'); }
  if (exact(data, ['done']) && data.done === true) return null;
  if (!exact(data, ['action'])) throw fail('INVALID_RESPONSE');
  return validateAction(data.action, manifest);
}
export function validatePlan(plan, manifest) {
  if (!Array.isArray(plan) || plan.length > LIMITS.actions) throw fail('ACTION_LIMIT');
  const clean = plan.map(action => validateAction(action, manifest));
  if (clean.reduce((sum, action) => sum + (action.ms ?? action.settleMs), 0) > LIMITS.timelineMs) throw fail('TIMELINE_LIMIT');
  return clean;
}
export function cacheKey(manifest, viewport) {
  return hash(JSON.stringify({ version: VERSION, manifest, viewport }));
}
export function quality({ kind, completed, actions, changed, verified, durationMs, frames }) {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 8000 || frames < 2) return { accepted: false, reason: 'INVALID_VIDEO' };
  if (completed !== actions) return { accepted: false, reason: 'INCOMPLETE_ACTIONS' };
  if (!changed) return { accepted: false, reason: 'NO_VISIBLE_CHANGE' };
  if (kind === 'opening') return { accepted: false, reason: 'OPENING_ANIMATION_ONLY' };
  if (actions < 3 || !verified) return { accepted: false, reason: 'GAMEPLAY_UNVERIFIED' };
  return { accepted: true, reason: 'REVIEWED_FIXTURE_GAMEPLAY' };
}
