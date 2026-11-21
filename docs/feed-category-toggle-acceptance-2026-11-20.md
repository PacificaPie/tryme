# Feed category toggle acceptance — 2026-11-20

Base: `486053406b075f4961753e1f7ddd831676d3d2ad` (PR #39).
Branch: `fix/feed-category-toggle-2026-11-20`.

The work-category row contains only 个人网站 / 游戏 / 其他 (Personal sites / Games / Other). An unselected row means all work categories. Selecting another category switches the filter; activating the selected category again clears it through the existing query/update/request path. The URL omits `category` when cleared; API requests use the existing `category=all` contract.

The separate All content / Works / Cards controls retain their existing behavior. Clearing a work category stays in Works and preserves search, sort and following. Existing #39 typography and responsive CSS are reused without changes.

## Validation

- `node --test tests/discovery-loading.test.mjs tests/work-categories.test.mjs`: 20/20 passed.
- `npm test`: 725/725 passed.
- `npm run check`: passed, including TypeScript.
- `npm run build:standalone`: passed; no deployment. The isolated worktree has no Clerk secret; the build reports this along with Vite import/chunk warnings.
- `git diff --check` and browser-test syntax check: passed.
- `tests/browser/feed-category-toggle.mjs`: isolated headless Chromium, six combinations (1440/390/320 × zh-CN/en), all passed with no page errors.

Browser assertions cover the three labels and default unselected state; selecting/switching/keyboard deselecting; actual API category and URL parameters; refresh and reload; leaving for a work and browser back/forward in both selected and unselected states; search/sort/following preservation; clearing filters; and the retained mixed-card/works/cards views. The node tests also cover aborted requests, late stale responses, pending search debounce and visit cache separation.

All six layouts have no document horizontal overflow, 14px category labels and 44px button height. Selected and unselected screenshots were saved for every combination; desktop and narrow-screen screenshots were visually reviewed.

Machine-readable results: [browser-acceptance.json](evidence/feed-category-toggle/browser-acceptance.json).
Local screenshots: `.preview/feed-category-toggle/{zh-CN,en}-{1440,390,320}-{selected,unselected}.png`.

## Reproduce

Use the optional Playwright runtime at `.preview/browser-runtime` (same convention as the existing browser tests), then run in separate terminals:

```sh
FRONTEND_HIERARCHY_PORT=4966 node tests/fixtures/frontend-hierarchy-browser-server.mjs
QA_ORIGIN=http://127.0.0.1:4966 node tests/browser/feed-category-toggle.mjs
```

Scope: local frontend with the real HTTP router and SQLite fixture, synthetic accounts/content, isolated browser. Production, real Clerk authentication, physical phones and Safari were not tested. No cloud writes, migrations, merge or deployment were performed by this change.
