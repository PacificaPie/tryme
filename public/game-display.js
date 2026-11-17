// Changes only the existing shell's presentation. The game iframe, its src,
// sandbox and session remain owned by the caller and are never moved or replaced.
export function mountGameDisplay(shell, {
  button,
  labels = {},
  onChange = () => {},
} = {}) {
  if (!shell || !button) throw new TypeError('A game shell and display button are required.');
  const doc = shell.ownerDocument, win = doc.defaultView;
  const text = { enter: 'Fullscreen', exitNative: 'Exit fullscreen', exitExpanded: 'Exit expanded view', ...labels };
  let mode = 'inline', pending = false, disposed = false, desired = false, intent = 0, entering = false, exiting = false, exitOptions = null;
  let hiddenSiblings = [], origin = null, pageWasOpen = false, isolated = false;

  function render() {
    shell.classList.toggle('game-display-active', mode !== 'inline');
    shell.classList.toggle('game-display-expanded', mode === 'expanded');
    const label = mode === 'native' ? text.exitNative : mode === 'expanded' ? text.exitExpanded : text.enter;
    button.textContent = label; button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(mode !== 'inline'));
    button.setAttribute('aria-busy', String(pending)); button.disabled = pending;
    if (!disposed) onChange({ mode, pending });
  }
  function isolate() {
    if (isolated) return; isolated = true;
    pageWasOpen = doc.documentElement.classList.contains('game-display-open');
    doc.documentElement.classList.add('game-display-open');
    // Keep the iframe in its current DOM position. Inert only the branches
    // beside the path to the shell, including the page navigation.
    for (let branch = shell; branch && branch !== doc.body; branch = branch.parentElement) {
      const parent = branch.parentElement; if (!parent) break;
      for (const sibling of parent.children) if (sibling !== branch && !sibling.inert) {
        hiddenSiblings.push(sibling); sibling.inert = true;
      }
    }
  }
  function release({ restoreFocus = true, restoreScroll = true } = {}) {
    for (const sibling of hiddenSiblings) sibling.inert = false;
    hiddenSiblings = [];
    if (isolated && !pageWasOpen) doc.documentElement.classList.remove('game-display-open');
    isolated = false;
    if (restoreFocus && button.isConnected) button.focus({ preventScroll: true });
    if (restoreScroll && origin && shell.isConnected) win?.scrollTo?.(origin.x, origin.y);
    origin = null;
  }
  function show(next) {
    mode = next;
    if (mode !== 'inline') isolate();
    render();
  }
  function inline(options) {
    mode = 'inline'; release(options); render();
  }
  async function exitOwnedFullscreen() {
    // Never exit a different component's fullscreen, including a newer game.
    if (doc.fullscreenElement !== shell || typeof doc.exitFullscreen !== 'function') return;
    try { await doc.exitFullscreen(); } catch { /* An explicit exit can be retried. */ }
  }
  async function enter() {
    if (disposed || !shell.isConnected || pending || mode !== 'inline') return mode;
    if (doc.fullscreenElement && doc.fullscreenElement !== shell) return mode;
    desired = true; exitOptions = null; const version = ++intent;
    origin = { x: win?.scrollX || 0, y: win?.scrollY || 0 };
    if (typeof shell.requestFullscreen !== 'function' || doc.fullscreenEnabled === false) {
      show('expanded'); button.focus({ preventScroll: true }); return mode;
    }
    entering = true; pending = true; render();
    try {
      // Invoke synchronously in the button's user activation; do not fetch first.
      await shell.requestFullscreen();
      if (disposed || version !== intent || !desired || !shell.isConnected) {
        await exitOwnedFullscreen(); return mode;
      }
      if (doc.fullscreenElement === shell) show('native');
      else { desired = false; inline(); }
    } catch {
      if (!disposed && version === intent && desired && shell.isConnected) {
        if (doc.fullscreenElement === shell) show('native');
        else if (!doc.fullscreenElement) { show('expanded'); button.focus({ preventScroll: true }); }
        else { desired = false; inline(); }
      }
    } finally {
      entering = false;
      if (!disposed) { pending = exiting; render(); }
    }
    return mode;
  }
  async function exit(options = {}) {
    if (disposed) return mode;
    desired = false; exitOptions = options; const version = ++intent;
    if (doc.fullscreenElement === shell) {
      exiting = true; pending = true; render();
      await exitOwnedFullscreen();
      exiting = false;
      if (disposed || version !== intent) return mode;
      pending = entering;
      if (doc.fullscreenElement === shell) { desired = true; show('native'); }
      else inline(options);
    } else { pending = entering; inline(options); }
    return mode;
  }
  function toggle() { return mode === 'inline' && !pending ? enter() : exit(); }
  function fullscreenChanged() {
    if (disposed) return;
    if (doc.fullscreenElement === shell) {
      if (desired && shell.isConnected) show('native');
      else void exitOwnedFullscreen();
    } else if (mode === 'native') {
      // Browser Escape may arrive before requestFullscreen() resolves.
      if (desired) { desired = false; intent++; pending = entering || exiting; }
      inline(exitOptions || undefined);
    }
  }
  function keydown(event) {
    if (mode === 'expanded' && event.key === 'Escape') {
      event.preventDefault(); void exit();
    }
  }
  function focusin(event) {
    if (mode === 'expanded' && !shell.contains(event.target)) button.focus({ preventScroll: true });
  }
  const click = () => { void toggle(); };
  button.addEventListener('click', click);
  doc.addEventListener('fullscreenchange', fullscreenChanged);
  doc.addEventListener('keydown', keydown, true);
  doc.addEventListener('focusin', focusin, true);
  render();
  return {
    enter, exit, toggle,
    get mode() { return mode; },
    dispose() {
      if (disposed) return;
      disposed = true; desired = false; intent++; pending = false;
      button.removeEventListener('click', click);
      doc.removeEventListener('fullscreenchange', fullscreenChanged);
      doc.removeEventListener('keydown', keydown, true);
      doc.removeEventListener('focusin', focusin, true);
      inline({ restoreFocus: false, restoreScroll: false });
      // DOM/page cleanup is synchronous. Any in-flight enter also checks the
      // disposed flag on completion and exits only this shell if it arrived late.
      void exitOwnedFullscreen();
    },
  };
}
