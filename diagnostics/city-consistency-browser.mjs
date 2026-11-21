// Compatibility entry point: the city now autoplays and uses direct gestures.
// The current suite includes the saved-work, theme, paper and fallback checks.
// Historical consistency screenshots remain unchanged in docs/evidence/.
// Start CITY_PREVIEW_PORT=18841 node diagnostics/settled-city-preview.mjs first.
await import('./city-interaction-browser.mjs');
