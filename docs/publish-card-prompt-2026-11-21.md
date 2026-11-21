# Publish → card confirmation acceptance

Base: `011b9d200022a51e2e6d3a0cc2cd5a499cda856e` (includes #42).
Branch: `feat/publish-card-prompt-2026-11-21`.

## Behavior

After an HTML, GitHub, or URL publication succeeds, the result page asks **要把这件作品加入名片吗？ / Add this work to your card?** before the work tile. It offers **加入名片 / Add to card** and **暂不加入 / Not now**, with one sentence explaining that the user must continue, preview and save.

Confirmation passes the successful work ID to the existing `/cards/me?addWork=…` flow. A first card goes directly to the city template with that work selected. Existing cards and drafts keep their current explicit starting-point choices. The prompt does not write a card draft or save a card itself. Saving later creates a new card; previous links and work snapshots stay unchanged.

Not now keeps the user on the result page and exposes the ordinary card-builder link. The prompt is bound to the successful publication in the current document, owner and route. Same-route language changes retain it; resolving it, leaving the route or refreshing cannot reopen it. Direct success-page links show the ordinary link. Invalid/failed publications do not arm it, and archived or foreign works do not receive a card action. Stale callbacks and repeated clicks cannot navigate twice.

Production code changes are limited to `public/site.js`, `public/published-card-prompt.js`, `public/publish-wizard.css` and a narrow-screen footer rule in `public/cards-flow.css`. Existing card addition, template and snapshot behavior is reused. No changes to `public/lit-city`, backend APIs, migrations, dependencies or lockfile.

The shared publishing step labels now wrap within their columns on narrow screens; the existing English “Preview result” label otherwise overflowed at 320 px. The card-builder footer reached by confirmation also wraps its English actions at 320 px instead of extending past the viewport.

## Verification

- `npm test`: **738 passed, 0 failed** after integrating the latest mainline.
- `npm run check`: passed (application JS/HTML syntax and TypeScript).
- `npm run build:standalone`: passed; existing vinext dynamic/static import warnings remain nonfatal. No deployment.
- `git diff --check`: passed.
- Browser acceptance uses a separate headless Chrome with **1440, 390 and 320 px × Chinese/English × first card/saved card/existing draft**. Each of the 18 cases checks both confirmation and Not now, keyboard deferral, language rerender, repeat clicks, return/refresh, draft preservation, unchanged saved snapshots, no horizontal overflow and at least 44 px action heights.
- Additional browser paths cover failed publish then retry; leaving an unanswered prompt and back/forward; refreshing an unanswered prompt; a draft without any saved card; duplicate addition; preview without saving; explicit save creating exactly one new snapshot while preserving all prior snapshots.
- Logic tests execute the actual shared submit handler for HTML/GitHub/URL success, invalid input, failed requests and background completion. Existing addition tests cover deduplication, ownership/archive rejection and the 30-work limit without truncation.

Browser evidence: [matrix and checks](evidence/publish-card-prompt-2026-11-21/results.json), [desktop Chinese](evidence/publish-card-prompt-2026-11-21/desktop-zh.png), [390 px Chinese](evidence/publish-card-prompt-2026-11-21/mobile-zh.png), [320 px English](evidence/publish-card-prompt-2026-11-21/narrow-en.png), [preserved draft](evidence/publish-card-prompt-2026-11-21/narrow-draft.png).

## Fixture correction and reproducibility

An initial browser draft test injected `sessionStorage` after the SPA had loaded, then navigated only by hash. The in-memory `cardDraft` correctly retained its original value, so that setup did not represent a restored draft. The runner now reloads after injection, waits for the workspace and preserves the original assertions on IDs, template, signature and saved snapshots. No product draft-protection check was removed or weakened.

The guest-navigation VM harness now provides the real new controller dependency. Repeated acceptance attempts also reached the real private-draft daily quota; the runner now starts a fresh in-memory router fixture on its own available loopback port for every scenario, then terminates only that child process. It does not alter or bypass quotas.

Run from the checkout, using an existing Playwright install (no lockfile change required):

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/browser/published-card-prompt.mjs
```

The runner starts its own fixtures and writes screenshots and `results.json` to `.preview/publish-card-prompt/`. `PUBLISH_CARD_EDGES_ONLY=1` runs only the extra navigation/save/draft edge cases. Full unit/check/build logs are also retained in `.preview/publish-card-prompt/` in the delivery worktree.

## Scope and remaining limits

This is **local fixture acceptance**: actual frontend, HTTP router and SQLite, synthetic accounts and memory object storage. GitHub file download bytes are supplied by a local interception; real GitHub download/cloud build, Clerk login, remote capture/video generation and physical iPhone/Safari behavior are not established by these tests. Desktop Chrome narrow viewports are not physical-device acceptance.

No staging or production publish, resource mutation, migration, merge or deployment was performed for this feature. The Draft PR is for the release session to independently accept, merge and deploy.
