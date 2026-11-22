const failure = timeout => Object.assign(new Error(timeout
  ? '请求超时，请重试。'
  : '请求已取消。'), { status: 0, code: timeout ? 'REQUEST_TIMEOUT' : 'REQUEST_ABORTED' });

export function apiTimeout(path, options = {}) {
  // Uploads and imports need time for transfer/validation. Individual media
  // controllers can still cancel sooner through their existing signal.
  if (options.body instanceof FormData) return 90000;
  if (/^\/api\/(?:imports\/github|builds)$/.test(path) && options.method === 'POST') return 60000;
  if (/^\/api\/publish-drafts\/[^/]+\/capture$/.test(path)) return 45000;
  return !options.method || ['GET', 'HEAD'].includes(options.method) ? 15000 : 30000;
}

// Bound authentication, transport AND response body decoding. Abort alone is
// insufficient for an SDK promise or transport that ignores its signal.
export async function withRequestDeadline(task, { signal, timeoutMs = 30000, timers = globalThis } = {}) {
  const controller = new AbortController();
  let timer, rejectWait;
  const stopped = new Promise((_, reject) => { rejectWait = reject; });
  const stop = timeout => {
    if (controller.signal.aborted) return;
    const error = failure(timeout);
    controller.abort(error);
    rejectWait(error);
  };
  const abort = () => stop(signal?.reason?.name === 'TimeoutError');
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  else timer = timers.setTimeout(() => stop(true), timeoutMs);
  const work = Promise.resolve().then(() => {
    controller.signal.throwIfAborted();
    return task(controller.signal);
  });
  try { return await Promise.race([work, stopped]); }
  finally { timers.clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
