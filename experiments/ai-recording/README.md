# Bounded gameplay recording experiment

This is a **local, mock-only experiment**, outside the production capture pipeline. It does not call a model API, read credentials, create accounts, or deploy anything. Existing fixed Start-button and exact-hash Rain demonstrations remain unchanged. `verified-fixture` means a reviewed synthetic fixture reached its known objective; it is not an AI success-rate claim.

## Run

From the repository root, with Node 22+ and desktop Chrome/Chromium installed:

```sh
npm run install:ci
npm run experiment:recording:boundaries
npm run experiment:recording
npm run experiment:recording:review
```

On macOS the runner uses `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Elsewhere set `CHROME_PATH` to a local Chromium executable. No browser is downloaded. There is no new npm dependency. The runner launches a separate headless process and disposable profile, keeps Chrome's sandbox enabled, and never connects to a personal browser. Tests are sequential.

Outputs: `.preview/ai-recording/results.json`, MP4 files, before/after JPEGs and a local `cache/`. Keep this directory to test reuse. An existing attempted/failed entry will **not** trigger model exploration again. For a deliberate new local evaluation batch, set `RECORDING_OUTPUT` to a new ignored directory. This is a local experiment ledger, not a global/distributed once-per-version guarantee. Never use separate output directories to bypass a future approved paid budget.

The matrix is DOM game, Canvas game and animation-only website at 960×600 and 390×844 with mobile touch emulation. Each game has fixed Start-only, mock exploration, and cache replay arms. Opening-only pages have two arms. Mock responses are predetermined fixture scripts; their task-solving capability is not being evaluated. All captures use real input events and real browser-rendered pixels.

## Modules and trust boundary

- `contract.mjs`: strict JSON response/action schema, content hash and reviewed target manifest, limits, quality decision, cache key.
- `browser.mjs`: disposable session, existing opaque `captureDocument` iframe/CSP, local dead proxy, blocked requests/transports, navigation/session termination, isolated-world target inspection, bounded real clicks/taps/keys.
- `runner.mjs`: explore at most once per content/manifest/policy/viewport, close exploration, open fresh context, replay without model wait, validate and persist successful script. Model success claims have no authority.
- `recorder.mjs`: existing pixel-frame → trusted-parent MediaRecorder technique, action-boundary snapshots, measured MP4 duration ≤8 s and ≤2 MiB. Production recorder is imported only for its binary validation helper.
- `budget.mjs`: pre-dispatch reservation and usage log; unknown/over-reservation usage halts work. Paid events retain `actualUsd: null`; calculated token cost is an estimate, never a provider invoice. Mock actual charges are zero.
- `store.mjs`: exclusive local attempt claim, atomic script replacement, exact key reuse. Corrupt/failed/stale entries fail closed.

The operator reviews the exact HTML bytes and a local JSON manifest. Target IDs map to reviewed `#id` selectors; the model never chooses a selector. Buttons must be explicit `type="button"`, visible, unobscured, enabled, outside forms/links/editable controls, and pass a sensitive-action label filter. Canvas taps are relative coordinates within the central 90% of a reviewed canvas; game keys are explicitly allowed per canvas. Canvas semantics cannot be inferred safely from pixels alone: only reviewed fixture bytes are eligible in this phase. Label filtering is additional defense, not a semantic security proof.

No arbitrary code, text entry, URL navigation, uploads/downloads, login, payments, form submissions, external tools or caller-supplied JavaScript are model actions. Page text/pixels/hints are explicitly untrusted. DOM inspections run in Puppeteer's isolated world. The model receives only bounded screenshots and allowlisted target summaries, not HTML/source, cookies, tokens, platform sessions or storage. Logs omit raw observations and arbitrary provider/game errors.

## Enforced limits

| Item | Limit |
| --- | --- |
| Exploration | 5 responses / 5 actions, 25 s overall; 4 s per mock response |
| Each browser context | 30 s watchdog; disposable storage and no credentials |
| Replay actions | ≤1 s settle/wait each; ≤6 s replay action window |
| Recording | 7.6 s recorder stop; measured duration 6–8 s; 2 MiB |
| Source HTML | 16 MiB |
| Model input | 192 KiB each / 960 KiB total; JPEG ≤160 KiB; hint ≤400 bytes |
| Model output | 4 KiB strict JSON; unknown fields rejected |
| Target inventory | 12 reviewed IDs maximum |

Late responses are aborted/ignored and cannot continue executing after the context closes. A failure returns `retain-existing-preview-or-cover`; this experiment has no production writer, so it cannot replace an existing preview or cover. Successful cache reuse still replays and checks the new recording; failed reuse invalidates the cached success.

## Quality is deliberately limited

Acceptance requires at least three completed actions, visible difference, enough delivered video frames, valid duration, and a reviewed host-side fixture verifier transitioning from false in the fresh context to true after replay. DOM checks two windows lit; Canvas checks two dots collected. The screenshot difference uses the approved canvas bounds for Canvas games and the viewport otherwise. The motion threshold is a heuristic, not a claim of general game understanding; animation-only pages always remain `OPENING_ANIMATION_ONLY`. Arbitrary uploaded works have no fixture verifier and cannot obtain a verified gameplay result.

Model discovery on unseen controls, randomized/physics games, semantic success on arbitrary Canvas/WebGL, real devices, adversarial browser escapes, CPU/memory isolation at fleet scale and Cloudflare runtime behavior remain unvalidated. This local Chrome proxy/CSP test is not cloud guardrails attestation. Do not attach this to upload/Cron/production until real-model quality, measured costs, independent boundary review and downgrade behavior have been accepted.

See [experiment report and paid pilot proposal](../../docs/ai-gameplay-recording-experiment-2026-11-18.md).
