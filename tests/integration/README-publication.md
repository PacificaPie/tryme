# Local publication and Feed checks

`node --test tests/publication-flow.test.mjs` compiles the production API router and runs it against real in-memory SQLite migrations and SQL transactions. R2 is an in-memory binding, and build transport and analytics are isolated. These tests never contact the network or change cloud data. They cover duplicate publications, concurrent claims, idempotency, version history, old cards, migration preservation, review permissions, stale approvals, hiding and private pagination.

The HTTP harnesses `discover.mjs`, `work-edit.mjs`, and `versions.mjs` use a compiled **local** Worker with real local D1/R2. After applying all migrations, including `0007_work_publication_controls.sql`, start that Worker with a dedicated reviewer:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev \
  --config dist/server/wrangler.json --local --persist-to .wrangler/state \
  --ip 127.0.0.1 --port 8767 --inspector-port 0 \
  --var FUNTRACK_REVIEWER_IDS:local-reviewer
```

The shared `fixtures/discovery-review.mjs` helper checks `/api/me` and then submits and approves fixtures through the actual owner and reviewer APIs. It does not change approval rows directly or bypass review validation. Set `FUNTRACK_TEST_REVIEWER_ID` on the harness if the local Worker uses a different test reviewer ID. Never add this fixture identity to a deployed Worker's reviewer allowlist.

New publications are absent from Feed until approved. These harnesses assert that boundary before checking search/discovery metadata. Distinct works use distinct HTML or URLs; replays of one publication keep the original bytes and idempotency key. Existing assertions for immutable versions, cards and metadata remain in place.

For `discover.mjs`, run `node tests/integration/discover.mjs --seed` **before** starting the Worker; the subsequent HTTP run submits and reviews each fixture. For complete build/failure coverage in `versions.mjs`, follow [the version fixture preparation guide](fixtures/README-versions.md). Keep one Worker per shared state directory and stop it before running local SQL setup with Wrangler.
