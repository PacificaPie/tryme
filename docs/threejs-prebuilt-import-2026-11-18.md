# Three.js prebuilt HTML import compatibility

Released on 2026-11-19 through PR #30. Both the production site and builder image were updated; current cloud acceptance and rollout details are in [the release record](release-29-30-34-2026-11-19.md). The original local investigation below is retained as historical evidence.

The production imports of `123bingowinnn/forgetax` at commit `5b619d9ebaf24a7d7993b3a11469c5dd705acb78` stopped with `EXTERNAL_ASSET` during preparation. The 1,084,288-byte root `index.html` already bundles the game. Three.js retains generic `FileLoader` / `ImageBitmapLoader` methods containing variable-argument `fetch` calls. The old regular expressions treated those definitions as evidence of missing resources.

The shared inspector now uses streaming Acorn tokens to inspect explicit URL literals. It skips comments and diagnostic strings, decodes JavaScript escapes, and leaves computed/variable arguments unresolved rather than rejecting them. Static imports, explicit URLs in recognized resource calls, literal resource-property assignments, HTML/CSS references and import-map locations still undergo the inline-only check. JSON and shader script blocks are treated as data. Both pinned GitHub HTML and prebuilt repository imports use the same implementation. The game source is preserved; the repository path adds only its existing source notice.

This remains a compatibility check, not a JavaScript security boundary or proof that every gameplay path works offline. It does not execute imported code or resolve arbitrary computed URLs. The existing `sandbox allow-scripts` and `connect-src 'none'` CSP remain the runtime boundary. The regression fixture is an original minimal loader example, not a vendored copy of the external game.

Acorn 8.16.0 is pinned as a runtime dependency in the site and build toolkit. The Docker image includes the inspector module and makes the trusted toolkit's Acorn package resolvable from `/app`; no game dependency installation is needed for prebuilt imports.

## Validation

- 669 application tests passed; 43 focused importer/runner tests passed, including variable loaders, diagnostic strings/comments, explicit external URLs, JS escapes, importScripts arguments, JSON/shader data, and import maps.
- Application scripts / TypeScript checks and the standalone local-target build passed.
- Live pinned GitHub single-file import returned the original 1,084,288 bytes.
- The local Docker runner downloaded the actual fixed GitHub archive, accepted it as `prebuilt-html`, and completed with no project scripts or dependency installation. Output: 1,084,406 bytes, SHA-256 `1439d29e9eb8919e55b04de5b7241a7270ab1d340f6707da760bf953c8e95e86`. Container network was disconnected before completion; the container was removed afterward.
- The existing real Vite Snake Docker integration still passed with the same 229,573-byte artifact and SHA-256 `47c025db71bd8c6aea689e2427a82b7f8351df6059ff295887c93b696528e48b`, including process-boundary and disconnected-network checks.
- Local headless Chrome rendered forgetax with the actual game CSP in an `allow-scripts` iframe. With browser networking disabled and touch controls selected, “新的契约” entered the first tutorial step with zero game script errors or external asset requests. A separate variable-URL fetch probe was blocked by `connect-src`. This is a startup smoke test, not full-game or desktop pointer-lock acceptance. Browser console also contained harness favicon/offline messages and the expected probe denial.
- A separate 16 MiB JavaScript-heavy input passed under a 96 MiB Node heap limit (about 22 MiB heap used, 6.6 s in the local concurrent test run). This is local scaling evidence, not a production latency guarantee.

Local evidence is in ignored `.preview/threejs-import/` (container and browser reports, offline screenshot) and `.preview/cloud-builder/local-runner-test.json` (Vite regression).

## Release status

Code and local validation only; no cloud deployment or production task retry has been performed. Release requires both the main site Worker (direct HTML import) and the builder container image (repository imports). Existing failed jobs should remain as history; retry the repository as a new import after release.
