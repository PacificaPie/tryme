// An impression means a card was at least half visible for one continuous
// second. These client observations are not evidence of a human attention span.
const ledgers = new Map();
const MAX_PENDING = 96, MAX_SEEN = 600, BATCH_SIZE = 24;

function ledgerFor(userId, day) {
  let ledger = ledgers.get(userId);
  if (!ledger) { ledger = { pending: new Map(), seen: new Map() }; ledgers.set(userId, ledger); }
  for (const map of [ledger.pending, ledger.seen]) for (const key of map.keys()) if (!key.startsWith(day + ':')) map.delete(key);
  while (ledgers.size > 8) ledgers.delete(ledgers.keys().next().value);
  return ledger;
}

export function mountFeedImpressions(container, { api, userId, sort, host = container, environment = {} }) {
  const doc = environment.document || globalThis.document;
  const Observer = environment.IntersectionObserver || globalThis.IntersectionObserver;
  const DetachObserver = environment.MutationObserver || globalThis.MutationObserver;
  const later = environment.setTimeout || globalThis.setTimeout;
  const cancel = environment.clearTimeout || globalThis.clearTimeout;
  const now = environment.now || Date.now;
  const randomUUID = environment.randomUUID || (() => globalThis.crypto.randomUUID());
  if (!Observer || !userId) return { refresh() {}, dispose() {} };
  const day = () => new Date(now()).toISOString().slice(0, 10);
  const ledger = ledgerFor(userId, day()), tracked = new Map();
  let stopped = false, flushTimer = null, inFlight = false;
  const alive = () => !stopped && container.isConnected && host.isConnected;

  function remember(key) {
    ledger.pending.delete(key); ledger.seen.set(key, true);
    while (ledger.seen.size > MAX_SEEN) ledger.seen.delete(ledger.seen.keys().next().value);
  }
  function scheduleFlush(delay = 120) {
    if (!alive() || flushTimer !== null || !ledger.pending.size) return;
    flushTimer = later(() => { flushTimer = null; void flush(); }, delay);
  }
  async function flush() {
    if (inFlight || !ledger.pending.size) return;
    // Do not replay an observation from a previous UTC day as today's exposure.
    for (const key of ledger.pending.keys()) if (!key.startsWith(day() + ':')) ledger.pending.delete(key);
    const batch = [...ledger.pending.values()].slice(0, BATCH_SIZE);
    if (!batch.length) return;
    inFlight = true;
    let retryAfter = 0;
    try {
      const response = await api('/api/feed/impressions', { method: 'POST', body: { expectedActorId: userId, impressions: batch.map(({ eventId, workId, sort: itemSort }) => ({ eventId, workId, sort: itemSort })) } });
      // A successful HTTP status alone does not prove delivery. Settle only
      // acknowledged IDs; malformed or partial replies retry the remaining IDs.
      const accepted = Array.isArray(response?.accepted) ? response.accepted : [];
      const settled = new Set([...(Array.isArray(response?.duplicates) ? response.duplicates : []), ...(Array.isArray(response?.ignored) ? response.ignored : [])]);
      let missing = false;
      for (const item of batch) {
        if (settled.has(item.eventId) || accepted.some(receipt => receipt?.eventId === item.eventId && receipt.workId === item.workId)) remember(item.key);
        else missing = true;
      }
      if (missing) throw new Error('Missing impression acknowledgement');
    } catch (error) {
      const transient = !error?.status || error.status === 408 || error.status === 429 || error.status >= 500;
      for (const item of batch) {
        if (!ledger.pending.has(item.key)) continue;
        item.attempts++;
        if (!transient || item.attempts >= 4) remember(item.key);
        else retryAfter = Math.max(retryAfter, Math.min(4000, 1000 * 2 ** (item.attempts - 1)));
      }
    } finally {
      inFlight = false;
      if (alive()) scheduleFlush(retryAfter || 120);
    }
  }
  function reset(record) {
    if (record.timer !== null) cancel(record.timer);
    record.timer = null;
  }
  function visibleEnough(element) {
    const bounds = element.getBoundingClientRect();
    const viewport = doc.documentElement;
    const width = Math.max(0, Math.min(bounds.right, viewport.clientWidth) - Math.max(bounds.left, 0));
    const height = Math.max(0, Math.min(bounds.bottom, viewport.clientHeight) - Math.max(bounds.top, 0));
    return bounds.width > 0 && bounds.height > 0 && width * height >= bounds.width * bounds.height / 2;
  }
  function start(element, record) {
    if (record.timer !== null || doc.visibilityState !== 'visible' || !alive()) return;
    const key = day() + ':' + record.workId;
    if (ledger.seen.has(key) || ledger.pending.has(key)) return;
    record.timer = later(() => {
      record.timer = null;
      if (!alive() || !element.isConnected || doc.visibilityState !== 'visible' || record.ratio < 0.5 || !visibleEnough(element)) return;
      const currentKey = day() + ':' + record.workId;
      if (ledger.seen.has(currentKey) || ledger.pending.has(currentKey) || ledger.pending.size >= MAX_PENDING) return;
      ledger.pending.set(currentKey, { key: currentKey, eventId: randomUUID(), workId: record.workId, sort, attempts: 0 });
      scheduleFlush();
    }, 1000);
  }
  const observer = new Observer(entries => {
    if (!alive()) { dispose(); return; }
    for (const entry of entries) {
      const record = tracked.get(entry.target); if (!record) continue;
      record.ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
      if (record.ratio >= 0.5) start(entry.target, record); else reset(record);
    }
  }, { threshold: [0, 0.5] });
  function visibilityChanged() {
    for (const [element, record] of tracked) {
      reset(record); record.ratio = 0;
      // A newly visible document needs a fresh intersection observation; time
      // in a background tab must never complete the previous timer.
      if (doc.visibilityState === 'visible') { observer.unobserve(element); observer.observe(element); }
    }
    if (doc.visibilityState === 'visible') scheduleFlush();
  }
  function refresh() {
    if (!alive()) { dispose(); return; }
    const elements = new Set([...container.children].filter(element => element.dataset.workId));
    for (const [element, record] of tracked) if (!elements.has(element)) { reset(record); observer.unobserve(element); tracked.delete(element); }
    for (const element of elements) if (!tracked.has(element)) {
      tracked.set(element, { workId: element.dataset.workId, ratio: 0, timer: null }); observer.observe(element);
    }
    scheduleFlush();
  }
  const detachObserver = DetachObserver ? new DetachObserver(() => { if (!alive()) dispose(); }) : null;
  function dispose() {
    if (stopped) return;
    // Flush only already-qualified cards. No timers survive a route change.
    if (flushTimer !== null) cancel(flushTimer);
    flushTimer = null; stopped = true;
    for (const record of tracked.values()) reset(record);
    tracked.clear(); observer.disconnect(); detachObserver?.disconnect(); doc.removeEventListener('visibilitychange', visibilityChanged);
    void flush();
  }
  doc.addEventListener('visibilitychange', visibilityChanged);
  if (host.parentNode) detachObserver?.observe(host.parentNode, { childList: true });
  refresh();
  return { refresh, dispose };
}
