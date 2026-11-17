# Public card sharing — implementation proposal

Approved scope: anonymous card viewing only. Playing, liking, commenting and publishing still require the existing login. The implementation adds only the share HTML, public card projection and scoped covers; it adds no anonymous identity, event, session or database migration. The anonymous-play section below is a deferred design note, not part of this release.

## Current boundaries

- `lib/funtrack/standalone-auth.mjs` protects every `/api`, `/game` and `/media` request, except auth config and the independently authenticated build runner.
- `lib/funtrack/server.ts` also authenticates before returning a card; game and media handlers authenticate separately. `public/site.js` loads `/api/me` before rendering any route.
- Sharing currently produces `/site.html#/card/:id`. A server cannot select card metadata from that fragment.
- Saved `ft_cards.snapshot_json` already freezes the card profile, selected works, version IDs and cover/metadata references. Public sharing must project these snapshots, not refresh them from the current work or profile.
- `ft_play_sessions.actor_id` and `ft_events.actor_id` are strings without a foreign key to a user table. Existing Clerk identities use `clerk:user_…`. Analytics groups by actor; it does not require a Clerk profile.

## Proposed read contract

| Method and route | Result |
| --- | --- |
| `GET /c/:cardId` | Share HTML, card-specific title/description, canonical and Open Graph metadata. Works without JavaScript at least for creator/title/work summaries and join link. |
| `GET /api/public/cards/:cardId` | `{card}` containing a public projection of this saved snapshot only. No `me`, author listing, or card collection endpoints. |
| `GET /api/public/cards/:cardId/works/:workId/cover` | Exactly the cover referenced by this work in this snapshot. |
| `/api/public/cards/:cardId/works/:workId/game` | Not implemented or open. Playing continues through the authenticated, pinned-card route. |

Use an exact route/method allowlist in both the standalone adapter and server dispatch. Do not change the current private `/api/cards/me`, `/api/works`, `/api/analytics`, `/game/:versionId` or `/media/:id` access rules. The adapter must continue stripping untrusted identity headers before dispatch. Unknown public paths fail closed.

The public projection needs only card `id/name/bio/signature/headline/website/backStyle/template/createdAt` and work `id/name/desc/authorName/source/version/versionId/coverUrl`. Rewrite cover URLs to the scoped public route. Omit external game URLs, internal author IDs, lifecycle/discovery/review state, revisions, build provenance and operation fields. Do not simply return `cardSnapshot(JSON.parse(snapshot_json))`, which spreads every stored property.

Resolve work membership from `snapshot.works`, verify the referenced version belongs to that work, and resolve the cover from the exact saved metadata/version reference. Do not accept a caller-selected version or cover key. Old snapshot content remains available even if the live work was hidden, archived, edited or updated. Missing/corrupt pinned references return unavailable for that item; never silently substitute the current version. External works use the saved validated external URL and `noopener noreferrer`.

Use `APP_ORIGIN` for canonical/OG URLs, escape user text in HTML attributes and script payloads, and supply an anonymously readable scoped cover as `og:image` when available. Plain GET/HEAD never writes analytics or creates a visitor. This keeps preview crawlers out of PV. Cache only identity-independent responses; a response carrying a cookie must be private/no-store.

New share/copy actions use `/c/:id`. For existing links, detect only saved-card hash routes before the SPA login gate and replace them with `/c/:id`; builder/preview hashes stay private. The public page has a small “Join Funtrack” action and a login return URL preserving the card/work location. Logged-out like/feedback/publish actions go through the existing login flow.

## If anonymous play is approved

Suggested scoped writes:

| Method and route | Body / result |
| --- | --- |
| `POST /api/public/cards/:cardId/events` | `{eventId,type:'card_view'|'work_view'|'outbound_click',workId?}`; server derives card/work/version. |
| `POST /api/public/cards/:cardId/sessions` | `{workId}` → existing `{id,token,gameUrl,expiresAt}` shape with a scoped game URL. |
| `POST /api/public/cards/:cardId/sessions/:sessionId/events` | Existing `{token,events}` event protocol. Must bind the session to this card. |

Factor the existing session/event core so private and public entry points share event validation, 1-hour expiry, hashed 256-bit token, sequence/order checks, receipt replay and active-time validation. Keep principal resolution and card membership authorization separate. Do not synthesize a Clerk subject/email or inject a fake authenticated-user header.

For anonymous writes, mint a random visitor ID in a server-signed `HttpOnly; Secure; SameSite=Lax; Path=/` cookie with a bounded lifespan. The DB actor is `anon:<randomId>`; ignore any client-supplied actor/owner. Use a separate signing secret. This needs no account or profile record. An authenticated write can retain its real verified Clerk actor so the author's own visits remain filterable; optional authentication failure must not prevent reading a public card.

Add nullable `card_id` to play sessions (or a small session/card association table), created in the same batch as the session. Copy that context to session events for attribution. Public ingestion verifies the card binding and original token, and derives the frozen actor from the session; it must not relabel an in-flight anonymous session after login. No historical rows need backfilling or identity rewriting. A token is sent in POST bodies, never a URL or crawler metadata.

The existing SQL quotas are 30 session creations and 240 events per actor per minute, but are check-then-write and do not prevent visitor-cookie rotation. Reuse these budgets with atomic conditional inserts (the Feed impression service already demonstrates this), plus a short-lived limit keyed by a daily HMAC of the trusted edge IP. Do not store raw IP or use it as the analytics identity. A small expiring bucket table or a configured edge rate limiter can supply this second budget. Initial share GETs must not allocate one database visitor row per crawler. Public game downloads should also have an edge request limit because they can fetch up to 8 MiB from R2 without an event write.

## Metric and ranking impact

- Historical measurements and version attribution remain unchanged. Anonymous activity begins at rollout; no backfill.
- UV/players now deduplicate either a signed-in account or an anonymous browser cookie, not verified people. Another device, deleted cookie or later login can count again. Show this definition where metric help is available.
- Excluding self is exact only for a recognized logged-in owner; logged-out owner visits cannot be reliably recognized.
- Anonymous play can use the existing foreground-time samples and explicit completion event. Neither becomes a verified result.
- Do not merge anonymous actors into Clerk actors at login. That would rewrite unique counts and complicate dedupe/history.
- `recommendationRank` currently counts every distinct `play_start` actor. Explicitly exclude the reserved anonymous namespace from that score for the first release. Anonymous share traffic creates neither Feed impressions nor contribution credits. Analytics can still include it.
- Bots fetching HTML/OG create no event. Client telemetry is best-effort, with retries retaining the same event IDs; failed telemetry must not block viewing the card or loading its scoped game.

## Likely implementation ownership

- Auth allowlist / optional real identity: `lib/funtrack/standalone-auth.mjs`, `tests/standalone-auth.test.mjs`.
- Snapshot projection / membership / share HTML and resource responses: new `lib/funtrack/public-sharing.mjs` (injected DB/storage), thin route `app/c/[cardId]/route.ts`, plus public dispatch before `authenticate()` in `lib/funtrack/server.ts`.
- Anonymous visitor / quotas / session reuse: new isolated visitor/public-play service, additive migration if session context/rate buckets need persistence, small extraction of the current session core. `rules.mjs` game CSP and session validation remain shared.
- Public page: separate `public/shared-card.js` and style, reusing card templates, gallery mount, game-display and play-clock modules without importing authenticated SPA initialization. `public/site.js` only needs new share URLs and the legacy card redirect.
- Analytics labels/definitions and optional source split: analytics service/UI documentation. Recommendation anonymous guard belongs in `lib/funtrack/recommendation-service.mjs`.

## Required behavior checks

Anonymous card/OG/cover/pinned play succeed; all private endpoints remain unauthorized. Forged identity, arbitrary version/cover requests, cross-card work/session access, expired/bad tokens and cross-origin writes fail. Check all five templates and old snapshots after work edit/version/rollback/archive. Verify share GET does not write analytics; concurrent/repeated events retain one receipt; anonymous-to-login transition leaves the existing session actor unchanged; logged-in self filtering still works; share plays do not change recommendation scores. Mobile return, full-screen, language/theme and join-return flow need browser verification after the API tests.
