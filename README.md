# Funtrack prototype

A frontend prototype for discovering games, playing and leaving feedback, publishing a linked work, and generating an expandable creator card.

## Structure review wireframe

Run the local server and visit `/wireframe.html`; the embedded 3D gallery requires an HTTP(S) origin. This standalone HTML file is the current planning artifact; the earlier prototype at `/` is retained for comparison.

The default page is a clickable architecture board. Its three product destinations are work discovery, public creator cards, and the creator center. The center has an overview with a visible personal card, works, analytics, feedback, and a card builder. Cards follow **select works → choose template → generate → optionally publish**. The reviewer toolbar can switch between an established creator, a new creator, and a signed-out visitor.

### Iteration: content, templates, and cost

- Discovery puts covers, titles, authors, search, and three content filters together. Search/filter state survives opening a work and returning. The creator's works use the same visual identity, with per-work statistics and links to data/feedback.
- Card creation reuses existing author and work records. Selected works can be reordered. Four layouts adapt the original demo directions: 白墙画展, 卡中展厅, 一镜展廊, 作品星球. 卡中展厅 now embeds the original Three.js paper geometry and shader treatment with manual folding and current selected work data. The other three remain HTML wireframe adaptations. The planet layout explicitly uses its flat view above six works.
- Generation creates a snapshot of the selected works, their versions, and the template. Changing the draft does not change the published snapshot. Repeating the same generation reuses its result. Fold/flat viewing state and gallery face survive work navigation; gallery routes also restore page scroll. Covers are included in snapshot identity.
- `/wireframe.html#/costs` is an internal planning calculator, outside the product flow. The generation receipt records actual local configuration size, assembly time, cache reuse, and zero model calls. Assembly time excludes painting and is not a cloud latency measurement. The calculator sends no requests and is not connected to billing.

Research references: [Pinterest discovery](https://help.pinterest.com/en/article/discover-ideas-on-pinterest), [Creator Hub](https://help.pinterest.com/en/business/article/use-the-creator-hub), and [individual Pin stats](https://help.pinterest.com/en/business/article/pin-stats) support a discovery → creator overview → individual-content analysis hierarchy. [Xiaohongshu's official course](https://school.xiaohongshu.com/lesson/normal/af0fe7e97bb0433fac9da5d1df52b07f?fromPage=LessonList&viewSource=LESSON) was available through indexed content about recent data and individual notes; the current authenticated creator dashboard was not visually inspected. Funtrack's specific layout is a design decision, not a claim to reproduce either product.

Cost assumptions checked on 2026-11-16: pure client-side template composition has no model cost. Optional short-text cleanup uses [GPT-6 Luna Standard](https://developers.openai.com/api/docs/models/gpt-6-luna) at $0.10/M input and $0.50/M output tokens. At 2,000 input and 500 total billed output tokens, a 10% extra-call allowance gives $0.000495 per new request or $0.495 per 1,000 requests. This is an unbenchmarked usage/quality scenario, not a measured production cost. Long-context price multipliers and model capacity limits are accounted for.

The separate cloud scenario uses [R2 Standard](https://developers.cloudflare.com/r2/pricing/) with adjustable remaining account-level free allowance and rounded billing units, and [Workers](https://developers.cloudflare.com/workers/platform/pricing/) Free or Paid. Paid includes the shared $5/month base fee. The Free scenario rejects monthly dynamic requests above the maximum of 30 daily allowances; lower monthly volume still does not prove compliance with daily limits. Existing game hosting, authentication, analytics, support, payments, taxes, new image/video generation, and server-side image exports are excluded. Shared fees must not be counted once per card.

This iteration was checked with browser walkthroughs for zero-selection blocking, ordering, template switching, result/publication isolation, fold-state return, login cancellation/resumption, new-creator back navigation, search-return state, and narrow layouts. Separate read-only state and formula checks covered four template variants, direct-route startup, snapshot invalidation, cache reuse, calculator defaults, remaining-quota rounding, long-context pricing, and invalid-capacity states.

All wireframe statistics, identities, game regions, and submissions are illustrative. State lasts only until refresh or a scenario reset. No external game, authentication service, analytics service, or AI generation is called. External-link-only works show unknown gameplay starts as `—`. Outgoing feedback on another author's work does not enter the current creator's inbox.

Wireframe validation: inline JavaScript syntax checked; browser walkthroughs covered login cancellation/resumption, back navigation during login, required publish fields, retained form inputs after back/forward, publication into the work list and card draft, card preview/publication, gallery-to-work return, and 390px creator/data layouts without document overflow. A separate state review checked author identity, incoming/outgoing feedback, retry from the feedback shortcut, and fixed overview chart semantics. These are prototype flow checks, not backend or usability validation.

## Run

`npm run dev` serves `dist/` at http://127.0.0.1:8766. No install or build is needed. `npm run check` checks JavaScript syntax. `npm test` runs the state/storage tests.

## Scope

- Three bundled, playable examples: Salt Run, Orbit, and a 3×3 light puzzle. Their authors are illustrative.
- A local demo identity, not production authentication. No password, email, account registration, or identity provider.
- Works, compressed covers, draft inputs, feedback and creator profile are stored under `funtrack.prototype.v1` in this browser's localStorage. They are not shared across browsers or devices.
- New works are HTTP(S) links. Clicking opens the original site; it does not deploy or instrument its code. External clicks are not labeled as completed plays.
- Cards are deterministic HTML/CSS templates using confirmed profile/works data. No AI request, billing, or game-source analysis.
- The site shell has no remote font requests, third-party analytics or tracking. The embedded gallery vendors Three.js r128 locally under its MIT license.

## Structure

- `dist/app.js`: hash routes, native forms/dialog, UI state and action handlers.
- `dist/store.js`: storage boundary, URL validation, transactional publish and escaping.
- `dist/games.js`: isolated canvas examples; every mount returns a cleanup function.
- `dist/style.css`, `dist/refinements.css`: design system, layouts, responsive and reduced-motion rules.
- `dist/assets/`: local SVG artwork.

Routes: `/discover`, `/work/:id`, `/publish`, `/published/:id`, `/works`, `/card/:authorId`, `/card/me?edit=1` (prefixed by `#`). Browser back/forward and direct route refresh are supported.

The primary actions are opening a game, beginning/ending a play session, submitting feedback, publishing a work and generating/opening a card. Additional actions use overflow menus. Controls use native form semantics, names, labels and links. Hidden faces of the card are inert and absent from the accessibility tree.

## Implementation boundary for a backend

Replace the demo identity and storage adapter first. Preserve separate work/version, feedback and profile records. Add a persistent media service for covers. Game analytics and hosted user code are separate capabilities; they are not required to render a creator card. Do not promote client-reported events to verified usage automatically.

## Validation, 2026-11-16

Five automated state tests cover unsafe links, identity gating, publication/draft transitions, replayed draft identity, storage failure/reload recovery and HTML escaping. Browser checks covered:

- Nine-grid game completed with keyboard input; feedback form appeared.
- Runner accepted jump input and reached a collision result; Orbit mounted and accepted keyboard interaction.
- Guest feedback: cancel login preserved text and focus; login continued submission once.
- Back navigation during the login dialog closed it without executing the stale submission.
- Empty publish validation, typing a draft, returning, browser forward and refresh preserved fields.
- JPEG cover selection, cancelled login and resumed publication produced one work.
- Card generation, open/close, work entry, return, profile editing and work listing.
- Mobile account menu/card at 390 CSS pixels, with no document horizontal overflow.
- Skip-to-content retained the active route.

This is frontend flow verification, not production authentication, analytics accuracy, cross-device syncing, a performance benchmark, or a usability study.

## Card-in-gallery integration

`dist/gallery/` adapts the original 卡中展厅 demo. It receives a same-origin, selected-work snapshot from the card builder. Each work carries its ID, name, description, cover reference and version. The original unrelated sample works, people, invented statistics, card ring and promotional timeline are removed. Salt Run uses the supplied demo image; Orbit and 纸上花园 reuse the existing prototype SVG covers. Missing media stays a placeholder.

The initial view is a stable closed card. The visitor controls unfold/fold and front/back. Direct gallery clicks and equivalent HTML work buttons lead to the corresponding work route. Returning restores gallery state. Reduced-motion requests skip transitions; non-WebGL browsers retain ordinary work navigation. This same-origin frame is a trusted renderer, not a security boundary for uploaded game code.

Generation still performs no model calls. Shared renderer files and existing covers are referenced, not duplicated per card. The generation receipt measures data assembly only; WebGL rendering happens on the visitor's device. Arbitrary hosted games, source understanding, authentication and server-side analytics are not implemented by this integration.

Integration validation: browser checks covered three-work and single-work generation, front/back, manual unfold, a direct raycast click on Orbit, HTML work links, work/feedback/browser-back return, and local publication. Viewports 390px and 360px showed no document overflow; SVG cover upload to WebGL was corrected through CanvasTexture. The actual Three.js model also passed geometry/disposal checks across 1–9 works, plus a 12-work pagination/state restoration check. Browser checks are not real-device performance measurements.

`dist/play/` is a separately prepared local-game harness for the next real-event iteration. It mounts the existing three playable demos only after a user starts a session. Its events are client reports; no remote event store is connected yet. The current wireframe game stage remains explicitly illustrative. See `docs/real-data-plan.md` for the planned durable data boundary.
