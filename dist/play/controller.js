import { gameCatalog, mountGame } from '../games.js';

/*
 * Child -> same-origin parent:
 * { channel:'funtrack-play', version:1, type, sessionId, kind, seq,
 *   occurredAt, data }
 * type: ready | start | progress | complete | end
 * ready has sessionId:null before the first user-initiated start.
 * complete means mountGame reached a terminal state, including a lost game.
 * Parent commands: { channel:'funtrack-play', version:1, type:'command',
 *   command:'ping'|'end'|'dispose', kind, sessionId? }
 * end/dispose require the current sessionId (null when there is no session).
 * No incoming command can start a session, change kind, or supply code/URLs.
 */

const CHANNEL = 'funtrack-play';
const VERSION = 1;
const ALLOWED_KINDS = new Set(['salt-run', 'orbit', 'tiles']);
const requestedKind = new URLSearchParams(location.search).get('kind') || 'salt-run';
const kind = ALLOWED_KINDS.has(requestedKind) ? requestedKind : null;
const game = kind ? gameCatalog.find(item => item.kind === kind) : null;
const $ = id => document.getElementById(id);
const ui = {
  title: $('game-title'), instructions: $('instructions'), stage: $('stage'),
  cover: $('cover'), host: $('game-host'), startLayer: $('start-layer'),
  start: $('start'), end: $('end'), restart: $('restart'),
  toolbar: $('toolbar'), status: $('status'), error: $('error'),
};
const listeners = new AbortController();
let state = 'idle';
let session = null;
let sequence = 0;
let disposed = false;

function emit(type, data = {}, sessionId = session?.id ?? null) {
  if (!game || location.origin === 'null') return;
  const event = {
    channel: CHANNEL, version: VERSION, type, sessionId, kind,
    seq: ++sequence, occurredAt: new Date().toISOString(), data,
  };
  if (window.parent !== window) {
    try { window.parent.postMessage(event, location.origin); } catch { /* A departing parent may already be gone. */ }
  }
}

function ready() {
  emit('ready', { state, title: game.title });
}

function setError(message) {
  ui.error.textContent = message;
  ui.error.hidden = !message;
}

function showCover() {
  ui.cover.hidden = false;
  ui.host.hidden = true;
}

function sessionId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function clearRuntime(run) {
  const canvases = [...ui.host.querySelectorAll('canvas')];
  try { run?.instance?.destroy(); } finally {
    if (run) run.instance = null;
    // mountGame.destroy cancels its RAF and listeners. Also release backing buffers.
    for (const canvas of canvases) {
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
    }
    ui.host.replaceChildren();
  }
}

function resultFields(result) {
  const fields = {};
  if (Number.isFinite(result?.score)) fields.score = result.score;
  if (typeof result?.label === 'string') fields.label = result.label.slice(0, 200);
  return fields;
}

function endSession(reason, result = {}) {
  const run = session;
  if (!run || run.ended) return;
  run.ended = true;
  session = null;
  clearRuntime(run);
  state = reason === 'game-finished' ? 'finished' : 'ended';
  ui.end.hidden = true;
  ui.restart.hidden = false;
  ui.startLayer.hidden = true;
  showCover();
  ui.status.textContent = reason === 'game-finished'
    ? [result.label || '体验结束', Number.isFinite(result.score) ? `${result.score} 分` : ''].filter(Boolean).join(' · ')
    : '本次试玩已结束';
  emit('end', {
    reason,
    // Wall-clock time since the click; not an asserted active-play duration.
    elapsedMs: Math.max(0, Math.round(performance.now() - run.startedAt)),
    ...resultFields(result),
  }, run.id);
}

function startSession() {
  if (!game || disposed || session || state === 'starting') return;
  setError('');
  state = 'starting';
  ui.start.disabled = true;
  ui.restart.disabled = true;
  const run = {
    id: sessionId(), startedAt: performance.now(),
    instance: null, ended: false, startSent: false, pending: [],
  };
  session = run;
  ui.host.hidden = false;

  // Queue callbacks until mounting succeeds so start always precedes game events.
  function deliver(callback) {
    if (session !== run || run.ended || disposed) return;
    if (!run.startSent) run.pending.push(callback);
    else callback();
  }

  try {
    run.instance = mountGame(ui.host, kind, {
      onProgress(progress) {
        deliver(() => {
          const data = resultFields(progress);
          if (Number.isFinite(progress?.progress)) data.progress = Math.min(1, Math.max(0, progress.progress));
          emit('progress', data, run.id);
          // Progress is available to the parent; avoid announcing every frame to AT.
        });
      },
      onComplete(result) {
        deliver(() => {
          emit('complete', resultFields(result), run.id);
          endSession('game-finished', resultFields(result));
          ui.restart.focus({ preventScroll: true });
        });
      },
    });
    state = 'playing';
    ui.cover.hidden = true;
    ui.startLayer.hidden = true;
    ui.end.hidden = false;
    ui.restart.hidden = true;
    ui.status.textContent = '试玩中';
    emit('start', {}, run.id);
    run.startSent = true;
    const pending = run.pending.splice(0);
    for (const callback of pending) {
      if (session !== run || run.ended) break;
      callback();
    }
  } catch {
    session = null;
    run.ended = true;
    clearRuntime(run);
    state = 'error';
    showCover();
    ui.startLayer.hidden = false;
    ui.end.hidden = true;
    ui.restart.hidden = true;
    ui.status.textContent = '';
    setError('游戏暂时无法开始，请重试。');
    // A failed mount is not a play start, completion, or ended play session.
    emit('ready', { state, title: game.title, error: 'mount-failed' }, null);
  } finally {
    ui.start.disabled = false;
    ui.restart.disabled = false;
  }
}

function dispose(reason = 'parent-dispose') {
  if (disposed) return;
  endSession(reason);
  disposed = true;
  state = 'disposed';
  listeners.abort();
  clearRuntime(null);
  ui.startLayer.hidden = true;
  ui.end.hidden = true;
  ui.restart.hidden = true;
}

function receive(event) {
  if (disposed || window.parent === window || event.source !== window.parent || event.origin !== location.origin) return;
  const command = event.data;
  if (!command || typeof command !== 'object' || Array.isArray(command)
    || command.channel !== CHANNEL || command.version !== VERSION
    || command.type !== 'command' || command.kind !== kind) return;
  if (command.command === 'ping') {
    ready();
    return;
  }
  // An old parent command must not terminate a more recent retry.
  if (command.sessionId !== (session?.id ?? null)) return;
  if (command.command === 'end') endSession('parent-end');
  else if (command.command === 'dispose') dispose();
}

if (!game) {
  state = 'error';
  ui.title.textContent = '找不到这个游戏';
  setError('请选择 Salt Run、Orbit 或点亮九宫格。');
} else {
  ui.title.textContent = game.title;
  ui.instructions.textContent = game.description;
  ui.cover.src = new URL(`../assets/${kind}.svg`, import.meta.url).href;
  ui.stage.hidden = false;
  ui.toolbar.hidden = false;
  document.title = `${game.title} · Funtrack`;
  const options = { signal: listeners.signal };
  ui.start.addEventListener('click', startSession, options);
  ui.restart.addEventListener('click', startSession, options);
  ui.end.addEventListener('click', () => {
    endSession('user-end');
    ui.restart.focus({ preventScroll: true });
  }, options);
  window.addEventListener('message', receive, options);
  window.addEventListener('pagehide', event => {
    endSession('pagehide');
    if (!event.persisted) dispose('pagehide');
  }, options);
  window.addEventListener('pageshow', event => {
    if (event.persisted && !disposed) ready();
  }, options);
  ready();
}
