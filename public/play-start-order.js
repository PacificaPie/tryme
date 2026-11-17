// Let an already-started play reach the server before a qualifying interaction.
// Analytics failure must not stop a like/comment, so waiting is always bounded.
export async function waitForPendingPlayStart(queues, { workId, ownerId, flush, timeoutMs = 2000, environment = {} }) {
  const now = environment.now || Date.now;
  const later = environment.setTimeout || globalThis.setTimeout;
  const cancel = environment.clearTimeout || globalThis.clearTimeout;
  const pending = [...queues].filter(queue => queue.workId === workId && queue.ownerId === ownerId && queue.expiresAt > now() && queue.pending.some(event => event.type === 'play_start'));
  if (!pending.length) return true;
  let timer;
  try {
    return await Promise.race([
      Promise.all(pending.map(async queue => {
        await flush(queue);
        return !queue.pending.some(event => event.type === 'play_start');
      })).then(results => results.every(Boolean), () => false),
      new Promise(resolve => { timer = later(() => resolve(false), Math.max(0, Math.min(2000, timeoutMs))); }),
    ]);
  } finally { if (timer !== undefined) cancel(timer); }
}
