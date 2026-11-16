# Funtrack prototype

A frontend prototype for discovering games, playing and leaving feedback, publishing a linked work, and generating an expandable creator card.

## Structure review wireframe

Open `dist/wireframe.html` directly, or visit `/wireframe.html` on the served site. This standalone HTML file is the current planning artifact; the earlier prototype at `/` is retained for comparison.

The default page is a clickable architecture board. Its three product destinations are work discovery, public creator cards, and the creator center. The center has an overview with a visible personal card, works, analytics, feedback, and a card editor. Cards follow edit → preview → publish → public profile → expandable works. The reviewer toolbar can switch between an established creator, a new creator, and a signed-out visitor.

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
- The site shell has no runtime dependencies, remote font requests, third-party analytics or tracking.

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
