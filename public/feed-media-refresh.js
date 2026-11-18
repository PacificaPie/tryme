// Covers and previews finish independently after publishing. Refresh only their
// missing presentation fields; never reorder the Feed or reset social state.
export const needsGeneratedMedia = work => work.source === 'html' && (!work.coverUrl || !work.preview?.url);
export function mergeGeneratedMedia(work, fresh) {
  if (!needsGeneratedMedia(work) || !fresh || fresh.id !== work.id || (work.versionId && fresh.versionId !== work.versionId)) return work;
  if ((work.coverUrl || !fresh.coverUrl) && (work.preview?.url || !fresh.preview?.url)) return work;
  const coverUrl = work.coverUrl || fresh.coverUrl;
  const preview = work.preview?.url ? work.preview : fresh.preview?.url ? fresh.preview : undefined;
  if (coverUrl === work.coverUrl && preview === work.preview) return work;
  return { ...work, ...(coverUrl ? { coverUrl } : {}), ...(preview ? { preview } : {}) };
}

export function createFeedMediaRefresh({ api, getWorks, onMedia, visible = () => !document.hidden, timers = globalThis, intervalMs = 15000, maxAttempts = 8 }) {
  const pages = new Map();
  let timer, controller, generation = 0, stopped = false;
  const missing = page => getWorks().some(work => page.ids.has(work.id) && needsGeneratedMedia(work));
  function schedule() {
    if (stopped || timer || controller || !visible()) return;
    for (const [url, page] of pages) if (!missing(page) || page.attempts >= maxAttempts) pages.delete(url);
    if (pages.size) timer = timers.setTimeout(refresh, intervalMs);
  }
  async function refresh() {
    timer = null;
    if (stopped || !visible()) return;
    const entry = [...pages].find(([, page]) => missing(page) && page.attempts < maxAttempts);
    if (!entry) return;
    const [url, page] = entry, version = generation;
    // Rotate pages so an older failed job cannot starve a later page.
    pages.delete(url); pages.set(url, page); page.attempts++;
    const current = new AbortController(); controller = current;
    const deadline = timers.setTimeout(() => current.abort(), 8000);
    try {
      const data = await api(url, { signal: current.signal });
      if (!stopped && version === generation && !current.signal.aborted && visible()) onMedia(data.works || []);
    } catch { /* Keep the current cover and normal Feed controls on failure. */ }
    finally {
      timers.clearTimeout(deadline);
      if (controller === current) { controller = null; schedule(); }
    }
  }
  function reset() {
    generation++; timers.clearTimeout(timer); timer = null;
    controller?.abort(); controller = null; pages.clear();
  }
  return {
    watch(url, works) {
      if (stopped) return;
      const ids = new Set(works.filter(needsGeneratedMedia).map(work => work.id));
      if (ids.size) pages.set(url, { ids, attempts: pages.get(url)?.attempts || 0 });
      else pages.delete(url);
      schedule();
    },
    wake() { schedule(); },
    reset,
    dispose() { stopped = true; reset(); },
  };
}
