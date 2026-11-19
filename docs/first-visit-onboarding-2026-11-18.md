# First visit and real onboarding integration

The compulsory Feed choice described below is superseded by [the November 19 onboarding flow](onboarding-flow-2026-11-19.md). This file retains the original release and acceptance record.

Based on `origin/main` e57fcdd (PR #28). Includes the finished city template from d72764e, cherry-picked as a8b01db. The opening source is the user-provided [Claude artifact](https://claude.ai/artifact/BhhPzLCWaVnjPi3PRi13hx), locally preserved in `design/opening-animation-2026-11-18`; the production film contains the approved front-only edit and silver/day and dark/night materials. Its example artwork is promotional imagery, not live Feed data. The final card identity is branded TryMe. Saved user cards always use actual profile/selected works through the existing adapter.

## Behavior

- A confirmed signed-out first home visit lazy-loads the opening. It consumes `tryme.opening.seen.v1` before playback; returning browsers, signed-in accounts, private/direct routes, uncertain auth and reduced motion do not play it. A signed-in browser also records it as seen. Storage-denied browsers skip it. The iframe is removed after completion, failures or dismissal.
- Approved balanced film: gallery 6 s, morph 2.6 s, city 4.8 s, settled card 1.6 s, hold 1 s; Feed rises over 0.9 s. No visible skip control. Another click/tap, Escape, Enter or Space dismisses the film. Startup failure falls back after 12 s; runtime/context failures return immediately. The active film makes the underlying page inert; focus is restored on completion.
- Email sign-in and signup remain the existing Clerk component and safe `return_to` flow. No lab code, local fake accounts, verification codes or simulated upload/publish implementations are shipped.
- `/api/me` reports account-scoped onboarding state. Only Clerk accounts created on/after migration rollout are automatically enrolled; trusted creation time comes from the server's Clerk user lookup and forged identity headers are stripped. Existing users are not force-enrolled. Existing works/cards also suppress compulsory onboarding.
- New accounts at Feed choose discovery or creation. Deep work/card/version links return to their content first and defer the choice. Explicit publish/card creation skips the choice and asks for a public nickname. Viewer/creator is a mutable preference, never a permission. “使用偏好” reopens it.
- Nickname and creator preference save atomically through `/api/me/onboarding`, behind the existing CSRF and expected-account checks. Email-only accounts default to “创作者”; no email prefix is copied into their public identity. Existing deliberately saved profile fields remain intact.
- Upload retains real URL/HTML/GitHub handling, private drafts, media generation, explicit cover/video confirmation and publication. With no prior draft or saved card, the first published work is carried directly into the city template selection. Existing drafts/cards retain explicit starting-point confirmation and immutable snapshots.

## Validation

- `npm run check`: passed.
- `npm test`: 671 / 671 passed. Tests include new/existing user eligibility, account-scoped persistence, preference changes without permission changes, atomic nickname/state writes and retry after commit acknowledgement loss, CSRF/account mismatch rejection, bounded next routes, deferred deep links, first-visit guards and first-card selection without overwriting drafts.
- Standalone staging build and deployment dry-run passed. Framework emits the existing ineffective dynamic import warnings.
- Staging D1 exported privately before applying append-only `0022_first_visit_onboarding.sql`. Backup is ignored under `.backups/` and is not a repository artifact. The migration creates preference/rollout tables only; it does not change existing works, profiles, cards or Clerk configuration. No dependency on unshipped WeChat migration 0020.
- Two dedicated real Clerk development users registered through the site's email form using [Clerk reserved test emails](https://clerk.com/docs/guides/development/testing/test-emails-and-phones). Verification and sessions are real; Clerk does not deliver actual email for these addresses. This does not prove production email delivery.
- Account A: new registration → automatic choice → creator → public nickname → real HTML upload → generated cover/video → explicit media confirmation → published work → auto-selected city → preview → saved card.
- Test work: `d41caac0-c293-41a0-bebc-b54956d3a9f6`; version: `bcee1a58-ef83-4d84-8f0b-f7f9767a2c15`; public test card: `/c/543fdb98-b134-4bb6-8a69-921142e47c83`. These are staging-only QA objects.
- Account B: public card work → email registration → returned to the pinned v1 with real game iframe → click changed counter to 1 → exit → homepage showed deferred choice → select discovery → refresh remained on Feed with no opening iframe. Starting upload afterwards went straight to public nickname.
- Existing test account remained on Feed without compulsory onboarding. Public card checked at 390 px in both themes; no horizontal overflow. Screenshots in `docs/evidence/onboarding-2026-11-18/`.
- Production opening controller verified via a loopback-only diagnostic with a fixture Feed: full playback, iframe disposal, click dismissal and refresh without replay. The diagnostic does not authenticate or publish anything, and is outside `public/`. `node diagnostics/opening-preview.mjs` starts it on 127.0.0.1:8794. Original animation lab remains unchanged on 8791.

## Release / rollback

Build with explicit `wrangler.standalone.production.jsonc`; never use the Sites target. Recheck main and the current Worker before deployment. Apply 0022 after a private D1 export, then deploy the matching application. Existing Clerk secrets, cloud builder bindings, and production data are preserved. Application rollback can return to the previous release while retaining the additive onboarding tables; do not drop tables or delete newly saved preferences/cards.

Staging release verified: `86323b65-4dba-4374-9f6c-688cbc9653e3`. Live auth config remains Clerk test; deployed onboarding/site/opening assets match local SHA-256 bytes. Final back/forward choice navigation was rechecked after this deployment.
