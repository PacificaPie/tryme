# Local version fixtures

`versions.mjs` uses the real local Worker's D1 and R2 bindings. It refuses non-loopback targets. It never starts a Worker or executes SQL. Keep exactly one local Worker on the shared state directory; stop it before preparing migrations/SQL with Wrangler.

After applying the platform migrations locally, generate fixture SQL:

```sh
node tests/integration/fixtures/prepare-versions.mjs
```

Before starting the Worker, apply both files with the project's local D1 configuration and state directory:

- `.preview/version-build-fixtures.sql`
- `tests/integration/fixtures/version-failure-trigger.sql`

The first file adds isolated build jobs under a unique test owner. The second installs a trigger matching only the dedicated test owner prefix and release note. That trigger raises a real SQLite error after a current-version update, so the harness can verify D1 rolls back the complete batch. Neither file is a production migration.

Start the local Worker with the same dummy `FUNTRACK_BUILD_RUNNER_TOKEN` used by the harness. Then run:

```sh
FUNTRACK_TEST_URL=http://127.0.0.1:8767 \
FUNTRACK_TEST_D1_FAILURES=1 \
FUNTRACK_TEST_BUILD_FIXTURE=.preview/version-build-fixtures.json \
FUNTRACK_BUILD_RUNNER_TOKEN=local-build-integration-only-20261116-do-not-deploy \
node tests/integration/versions.mjs
```

The harness uploads deterministic artifacts through the authenticated build-worker endpoint into real R2. This verifies version publication from build artifacts and rejects foreign, queued, and failed builds; it does not run npm or contact GitHub.

The report is `.preview/local-versions-integration.json`, including unique test identities and IDs for inspection. Fixtures stay in local storage. Omit the two optional test variables for core HTTP checks only; omitted fault/build cases are explicitly reported as skipped. Generate fresh fixture files and apply them before another full run, since each run intentionally changes version pointers and completes build jobs.

The local trigger can be removed while the Worker is stopped with `DROP TRIGGER IF EXISTS ft_test_reject_version_commit`. A real R2 write failure and a lost D1 commit response require injected dependency tests; this HTTP harness does not claim to simulate them. `version-games.mjs` provides red +1, blue +2, and green +3 games with different PNG covers for browser inspection without modifying a real game.

To create files for manual browser uploads, run `node tests/integration/fixtures/export-version-games.mjs`. It writes `.preview/version-fixtures/v1.html` through `v3.html` and corresponding PNG covers without modifying the build SQL/JSON fixtures.
