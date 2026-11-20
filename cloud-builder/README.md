# Build execution identity

Completion metadata takes `execution.worker` from the public, server-owned
`FUNTRACK_BUILD_WORKER` binding. Only the three known worker names are accepted;
their corresponding environment is also recorded in `execution.environment`.
Neither the job payload, container metadata, site origin nor secrets determine
this identity. Missing or unrecognized values produce `unknown` for both fields
without preventing an otherwise valid build from completing.

| Entry point | `execution.worker` | `execution.environment` |
| --- | --- | --- |
| `wrangler.production.jsonc` | `funtrack-builder-production` | `production` |
| `wrangler.jsonc` | `funtrack-builder-staging` | `staging` |
| `npm --prefix cloud-builder run dev` | `funtrack-builder-local` | `local` |
| Missing/invalid binding | `unknown` | `unknown` |

Both deployed configurations set the binding to their own `name`. Regression
tests check that relationship and the associated site service binding. If a
worker is renamed, update its configuration, the public identity allowlist in
`src/index.mjs`, and the regression expectations together.

Use the package's `dev` command for local Worker development. It explicitly
overrides the worker name and identity and uses `--local` to disable remote
bindings, including when a production config is selected. Direct `wrangler dev`
with a deployment config inherits that config's variables. The dev command does
not provision a local site service or runner credentials; those still need local
setup before jobs can run. Do not supply production credentials for local work.

The separate Docker runner (`../scripts/build-runner.mjs`) does not use this
Worker completion path. The Docker-only check in `tests/local-runner.mjs` keeps
its `local-docker-only` report label. Its raw container metadata is not evidence
of a deployed Worker identity. The existing `execution.provider` describes the
build adapter and is unchanged by this fix.

This changes metadata for future completions only. There is no schema change,
historical task rewrite, or data migration. Historical records may still carry
the old staging label; see `../docs/release-29-30-34-2026-11-19.md`.

## Offline verification

From the repository root, after installing locked root and builder dependencies:

```sh
node --test tests/cloud-builder.test.mjs tests/cloud-artifact-limits.test.mjs cloud-builder/tests/runner.test.mjs
WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false CLOUDFLARE_CF_FETCH_ENABLED=false npm --prefix cloud-builder run check -- --containers-rollout none
WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false CLOUDFLARE_CF_FETCH_ENABLED=false npm --prefix cloud-builder run check -- --config wrangler.production.jsonc --containers-rollout none
```

The tests exercise the real Worker orchestration code with in-memory Durable
Object, container and service substitutes through the completion form. They cover
production/staging/local, invalid configuration, conflicting job/artifact labels,
Vite and prebuilt paths, preserved metadata, and existing isolation/cancellation
behavior. These are local regressions and offline bundle checks; they do not
perform cloud builds, deploy Workers, or establish production acceptance.
`--containers-rollout none` skips building the unchanged local Docker image.

## Verification record — 2026-11-20

Base: `ae684982` (`origin/main` when this isolated worktree was created).

- Targeted Worker/runner/artifact tests: 18 passed.
- Root `npm test`: 704 passed, none skipped.
- Root `npm run check`: passed (application script syntax and TypeScript).
- Root `npm run build:standalone`: passed; existing vinext dynamic-import
  warnings were emitted. Output stayed in the local `dist-standalone` directory.
- Both Wrangler configurations passed dry-run and displayed their expected
  `FUNTRACK_BUILD_WORKER` bindings. The staging check also built the unchanged
  Docker image locally using cached layers and removed its temporary tag; the
  production check used `--containers-rollout none`.

No cloud build job was submitted and no deployment or remote configuration/data
write was performed. The Docker-only real repository integration and a live
local Worker/service session were not run. Release verification remains with the
later integration task.
