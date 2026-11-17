# Automatic opening-screen covers

Implemented locally on 2026-11-17. Cloud rendering, the actual image and cloud billing behavior still require staging acceptance. No remote migration or deployment was performed by this implementation task.

## Behavior

Hosted HTML published without a cover is queued after its normal publication commit. A version update retains an existing cover. External-link works are never captured. Publication does not wait for a browser and does not fail because the optional queue is unavailable.

The scheduled Worker claims one eligible task per minute. It loads only the current hosted HTML object from the platform's R2 bucket, renders the opening screen without clicking or pressing keys, and stores a JPEG cover. The result creates a new metadata revision; old version records, publication receipts and saved card snapshots remain unchanged. An atomic version/revision/metadata/lease check prevents a delayed result from replacing a manual cover or applying to an archived or superseded work.

Previously published, uncovered hosted works can request generation explicitly. Failures may be retried explicitly, with at most two browser attempts for the same work/version. Archiving or changing versions can skip a task; restoring that still-uncovered version exposes an explicit retry without resetting the attempt counter.

## Owner API

`GET /api/works/:id/auto-cover`

`POST /api/works/:id/auto-cover` with `{ "action": "generate" | "retry", "versionId": "current-version-id" }`. The JSON body is streamed with a 1 KiB byte limit, including when Content-Length is missing. Additional keys (including `url`) are rejected. Normal authentication, ownership and write-origin checks apply.

The response is top-level JSON:

```json
{
  "status": "queued",
  "workId": "...",
  "versionId": "...",
  "revision": 1,
  "metadataId": "...",
  "coverUrl": "",
  "retryable": false,
  "attempts": 0
}
```

States: `none`, `queued`, `running`, `ready`, `failed`, `skipped`, `unavailable`. Optional `reason` explains a failure, skip or daily/monthly budget wait. `ready` includes the current `/media/:metadataId` URL; fetch the work again before rebasing an edit draft. A stale POST returns 409 `AUTO_COVER_VERSION_CHANGED`, with the current version and revision. A missing binding returns `unavailable`, not a simulated success.

## Capture boundary

- A fresh Browser Run session is launched with `guardrails: { allowedDomains: [] }`. There is no arbitrary-URL navigation, outbound Worker exception, session reuse, browser recording, cookie injection or Clerk credential.
- The raw R2 HTML is escaped into an opaque `sandbox="allow-scripts"` iframe. There is no player wrapper, analytics SDK, bridge identifier or play session. CSP disallows connections, external assets, forms, child documents and base URLs. Request interception independently rejects protocols other than data/blob/about.
- Cloudflare documents guardrails for HTTP/HTTPS. A Puppeteer new-document preload additionally disables RTC constructors and WebTransport before user scripts, including child frames; the sandbox/CSP also constrain other browser channels. This is defense in depth, not a claim that a general browser is an operating-system security sandbox.
- Input remains limited to 8 MiB; JPEG output to 2 MiB. The viewport is 1200 × 750. Only an opening-screen image is captured; no Start button, keyboard input or gameplay-driving automation is used.
- Script/style-only, hidden and zero-area documents fail the visible-content check. This is not game classification or image-quality scoring. External dependencies, network multiplayer, eval-dependent code and content that appears only after interaction may not render; failure leaves the work playable with its normal default cover and manual replacement available.

Official references: [session guardrails](https://developers.cloudflare.com/browser-run/features/guardrails/), [Puppeteer integration](https://developers.cloudflare.com/browser-run/puppeteer/), [new-document hooks](https://pptr.dev/api/puppeteer.page.evaluateonnewdocument).

## Budget and timeout

The platform reserves 90 seconds before each browser attempt, in the same atomic batch as its lease. The reservation is never refunded, including launch, capture or storage failures. Daily and monthly limits use UTC calendar boundaries:

| Limit | Value |
| --- | --- |
| Simultaneous active task leases | 1 |
| Attempts per work/version | 2 |
| Daily reserved seconds | 900 (10 attempts) |
| Monthly reserved seconds | 27,000 (300 attempts, 7.5 hours) |
| Capture deadline, including bounded close wait | 30 seconds |
| Recovery lease | 120 seconds |

The 90-second reservation assumes up to 30 seconds of client capture plus the provider's documented default 60-second inactivity timeout if `browser.close()` fails. `finally` always attempts close and does not extend the client deadline; late launch results close themselves. No keep-alive extension or post-timeout heartbeat is sent. A runtime crash, provider behavior change or unconfirmed close can still differ from a local elapsed-time estimate; the attempts table is a conservative reservation ledger, not an authoritative Cloudflare bill. Review Browser Run session history/close reasons after staging validation. [Provider lifecycle limits](https://developers.cloudflare.com/browser-run/limits/)

Workers Paid currently includes 10 Browser Run hours per month and 10 monthly-average concurrent browsers; excess time is $0.09/hour. This feature's cap is below that time allocation, but the allowance is shared across the account and this database cannot see other apps' usage. It cannot promise zero incremental account charges. For scale, a 30-second capture corresponds to $0.00075 of time at the excess rate, or $0.00225 for a full 90-second reservation. Existing Worker, D1 and R2 charges remain separate. No additional plan or secret was added. [Official pricing](https://developers.cloudflare.com/browser-run/pricing/)

## Deployment and validation

Migration: `drizzle/0011_automatic_work_covers.sql`. It adds task and attempt tables only. Existing works, metadata, versions, cards and historical events are not rewritten. Staging declares `BROWSER`, enables `FUNTRACK_AUTO_COVER_ENABLED=1`, and schedules `* * * * *`. The standalone production template declares the binding but keeps the feature disabled (`0`) and has no cron. Apply migration 0011 before deploying the staging build. The normal site remains available when the feature or its binding is unavailable.

Local tests use the real HTTP router, SQLite transactions and an R2 fixture; the remote browser client is injected. `node --test tests/auto-cover.test.mjs` verifies immutable history, ownership, current-version validation, manual-cover races, restored-work retry, atomic global budgets, interrupted/failed work, lost commit receipts, byte limits, absent binding/migration, no event writes and capture isolation/deadlines. `npm run check` checks scripts and TypeScript.

Staging acceptance still required: generate a cover for an existing uncovered hosted Snake, publish a second uncovered HTML, view both actual JPEGs, confirm the new metadata revision, inspect old card/version/media URLs, confirm no increase in play sessions/events, and inspect Browser Run close reason and duration. Do not report these as passed based on mocked browser tests.
