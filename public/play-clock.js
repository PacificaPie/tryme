// Measure visible play time after the first game input. The clock is local to a
// session, and never treats a missing end event as a zero-length play.
export function createPlayClock(now = () => performance.now(), visible = true) {
  let started = false, finished = false, runningSince = null, activeMs = 0;
  const boundedNow = () => Number(now());
  function settle(at) {
    if (runningSince !== null) activeMs = Math.min(3600000, activeMs + Math.max(0, at - runningSince));
    runningSince = null;
  }
  return {
    start() {
      if (started || finished) return;
      started = true;
      if (visible) runningSince = boundedNow();
    },
    setVisible(value) {
      const next = Boolean(value);
      if (next === visible || finished) return;
      const at = boundedNow();
      settle(at); visible = next;
      if (started && visible) runningSince = at;
    },
    finish() {
      if (!finished) { settle(boundedNow()); finished = true; }
      return started ? { timingVersion: 1, activeMs: Math.round(activeMs) } : null;
    },
  };
}
