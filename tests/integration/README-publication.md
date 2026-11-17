# Local publication and Feed checks

`node --test tests/publication-flow.test.mjs` compiles the production API router and runs it against real in-memory SQLite migrations and SQL transactions. R2 is an in-memory binding, and build transport and analytics are isolated. These tests never contact the network or change cloud data. They cover duplicate publications, concurrent claims, idempotency, version history, old cards/events, migration preservation, retired review API responses, owner-only hiding/restoring, visibility CAS and private pagination.

The HTTP harnesses `discover.mjs`, `work-edit.mjs`, and `versions.mjs` use a compiled **local** Worker with real local D1/R2. After applying all migrations, including `0008_direct_feed_publication.sql`, start that Worker:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev \
  --config dist/server/wrangler.json --local --persist-to .wrangler/state \
  --ip 127.0.0.1 --port 8767 --inspector-port 0
```

No reviewer account or environment variable is required. New works enter Feed directly. The former review endpoints and submission action return `410 REVIEW_DISABLED`; old review records remain intact but no longer gate discovery.

These harnesses verify that publication, version updates and metadata edits remain discoverable without approval. Explicitly hidden works remain hidden until the owner restores them. Distinct works use distinct HTML or URLs; replays of one publication keep the original bytes and idempotency key. Existing assertions for immutable versions, cards and metadata remain in place.

For `discover.mjs`, run `node tests/integration/discover.mjs --seed` **before** starting the Worker; the insert trigger gives each fresh fixture the same listed visibility as a new publication. For complete build/failure coverage in `versions.mjs`, follow [the version fixture preparation guide](fixtures/README-versions.md). Keep one Worker per shared state directory and stop it before running local SQL setup with Wrangler.
