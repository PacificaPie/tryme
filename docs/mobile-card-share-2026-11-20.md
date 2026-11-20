# Public-card sharing browser review · 2026-11-20

Base: `origin/main` / `ae684982ae6a0328f0a7752eee621a3fd6cd79ae`. Branch: `fix/mobile-card-share-2026-11-20`. This is a local fix and acceptance report, not a deployment record. No production/staging configuration, user cards, user works, or real account state was changed.

## Existing capability and evidence

The current code already provides `/c/:id`, public-only cover reads, QR generation, 1200×1440 PNG export, image download/open fallback, native sharing capability checks, and a sign-in return target containing both work and card IDs. These features were not rebuilt.

[`release-24-27-2026-11-18.md`](release-24-27-2026-11-18.md) records real staging PNG download/independent QR decoding and a second Clerk development test account signing in from an old public card to its saved v1. It explicitly leaves iOS/Safari/WeChat camera scan, long-press save and native file sharing unverified. That historical result is distinct from the local fixture below; real Clerk sign-in was not repeated in this task.

## Reproduced defects and fixes

1. **Long names were clipped or caused horizontal scrolling.** A valid 76-character name (`LongCreatorName` repeated five times plus `张`) overflowed the white-card heading: 250 px available / 1321 px content at a 320 CSS px viewport. The sharing dialog had 286 px available / 575 px content in both Chrome and WebKit. Scoped `overflow-wrap:anywhere` now keeps the public card and share title within their containers. Afterward those values are 250/250 and 286/286. The poster's existing two-line ellipsis remains intentional.
2. **Unavailable public covers displayed broken images.** Removing only a synthetic saved cover object caused a 404 and broken-image glyphs in the wall, editorial, filmstrip and work dialog. A capturing resource-error listener replaces only those public work images with a text placeholder. The saved work name remains readable/clickable; neither live covers nor private media are substituted. Empty covers and PNG numeric placeholders continue to work.
3. **WebKit lost focus after dismissing the public share dialog.** Pointer activation did not focus the trigger, so `document.activeElement` was the body. The public button now supplies an explicit return-focus target. Escape and the close button restore it. Other callers keep the existing default behavior.

Business changes are confined to `public/public-card.js`, `public/public-card.css`, `public/sharing.js` and the share-title rule in `public/experience.css`. No `site.js`, renderer, account-menu, studio navigation, API or database changes.

## Verified locally

The fixture uses the actual public page shell, client modules, public projection, HTTP router, SQLite schema and snapshot/version logic. Only accounts, storage and the identity-establishment redirect are synthetic. It listens on loopback and has no cloud bindings.

| Area | Result and evidence boundary |
| --- | --- |
| Browser matrix | Installed Chrome **157.0.8103.79** and Playwright WebKit **27.2**; 320×640, 390×844 and 1280×900 CSS px; light and dark; all **12 combinations passed**. These are desktop engines with resized viewports. |
| Public layouts | Wall, editorial and filmstrip long names and missing covers checked in every combination; no card/dialog horizontal overflow. Public work modal also shows the missing-cover placeholder. |
| Clipboard | Real `navigator.clipboard.writeText` succeeded in both engines; Chrome clipboard was independently read back. Denial was injected to confirm selected manual-copy text and instructions. |
| QR | The actual dialog canvas was independently decoded with jsQR in all 12 combinations. Both downloaded PNGs also decoded to the exact local public-card URL. No camera was used. |
| PNG / fallback | Real download events produced **1200×1440** PNGs in both engines. Each original-image link opened a browser Blob image with natural width 1200. Normal, empty and 404 covers were included. The `Image` decoder fallback was exercised with `createImageBitmap` disabled. |
| Native sharing | Both browsers exposed `share` and `canShare`. Injected handlers checked URL/file payloads, PNG MIME/name/size, preserved user activation, success, `AbortError` cancellation, denial, unsupported files and absent API. **No real OS share sheet or recipient delivery was tested.** |
| Login return | The real local auth page retained card/work/from/play and its public-card back link. A clearly synthetic Sites-provider sign-in established test account B; the actual application/router loaded a game iframe containing **Saved v1 0**, despite live v2. Stored play-session version and actor were checked. This is not real Clerk sign-in. |
| Expiry and account boundaries | Clearing the isolated QA cookie left the public card readable and private card/game reads at 401. Existing full-suite tests additionally exercise account-switch races, expected-account headers, forged identity rejection and the installed Clerk verifier with locally signed expired/future/wrong-party tokens. No real user session was expired. |
| Public privacy | Public viewing, opening works and sharing made only GET requests and did not initialize `/api/me`. Read-only access and immutable/cross-work cover boundaries are also covered by the existing public-sharing tests. |
| English/mobile smoke | All six templates' public share wrappers passed at 320 CSS px with mobile/touch options and English labels, including native clipboard write, close and focus restore. Tap events were automated. macOS WebKit still reported `maxTouchPoints=0`; this is not touch-hardware acceptance. 3D renderer visuals were outside this check. |

`npm run check`, **700/700** tests (0 skipped), `npm run build:standalone` and `git diff --check` passed after the business fixes. The build used the local target and performed no deployment; existing vinext dynamic-import warnings remain.

The installed Safari is 26.5. Its WebDriver session request was rejected because **Allow remote automation** is disabled. No Safari settings were changed. Playwright WebKit is reported separately and does not establish Safari app or iOS acceptance.

## Evidence and reproduction

All images use synthetic data. Their QR codes point to the local fixture, not a production card. IDs change whenever the fixture restarts.

- [Machine-readable browser results](evidence/mobile-share-2026-11-20/results.json) and [English/tap smoke](evidence/mobile-share-2026-11-20/touch-english.json).
- At 320 px: [before card](evidence/mobile-share-2026-11-20/chrome-before-card.png), [after card](evidence/mobile-share-2026-11-20/chrome-after-card.png), [before sharing](evidence/mobile-share-2026-11-20/chrome-before-dialog.png), [after sharing](evidence/mobile-share-2026-11-20/chrome-after-320-dialog.png), [WebKit sharing](evidence/mobile-share-2026-11-20/webkit-after-320-dialog.png).
- Downloaded posters: [Chrome](evidence/mobile-share-2026-11-20/chrome-poster.png), [WebKit](evidence/mobile-share-2026-11-20/webkit-poster.png).
- Pinned-v1 play: [Chrome](evidence/mobile-share-2026-11-20/chrome-pinned-v1.png), [WebKit](evidence/mobile-share-2026-11-20/webkit-pinned-v1.png).

From this checkout, install locked application dependencies and optional isolated browser tooling:

```sh
npm run install:ci
npm install --prefix .preview/browser-runtime --no-audit --no-fund playwright@1.65.1 pngjs@7.0.0
PLAYWRIGHT_BROWSERS_PATH=.preview/browsers node .preview/browser-runtime/node_modules/playwright/cli.js install webkit
node tests/fixtures/mobile-share-browser-server.mjs
```

The fixture defaults to `http://127.0.0.1:4898/`; use an unoccupied `PORT` if necessary. In a second terminal, run:

```sh
PLAYWRIGHT_BROWSERS_PATH=.preview/browsers node tests/browser/mobile-share.mjs
PLAYWRIGHT_BROWSERS_PATH=.preview/browsers node tests/browser/mobile-share-touch.mjs
```

If changing the port, pass the same loopback `QA_ORIGIN` to both browser runners. Chrome must be installed. The optional browser packages do not change the application's dependencies/lockfile. New results and screenshots go to `.preview/mobile-share/`. Only these local fixtures create test data; never deploy them.

## Remaining manual device acceptance

After unified integration makes this patch available in the intended QA environment, use an existing authorized test card. Do not change a user's card or publish a new work just to run these steps. Record device, OS/browser version, URL and outcome.

1. On **a real iPhone in Safari**, open the public card while logged out. Check long names and failed/empty covers at portrait width; open/close sharing, rotate the device, and confirm all controls remain reachable. Repeat in the **WeChat embedded browser**.
2. Copy the public link into a local Notes document; open it and verify the same anonymous card. Deny clipboard access where possible and use the manual-copy fallback.
3. Generate the PNG. Try Save image, then Open full image → long-press save to Photos/Files. Inspect the saved file and confirm 1200×1440 and readable text. Browser download success alone does not prove iOS long-press saving.
4. Open URL and image system-share panels and **cancel**; confirm no error. If supported, save locally to Files. If file sharing is unsupported, confirm download/open/copy remain usable. No message to another person is needed.
5. Scan the saved QR with a physical camera on a second device. It must open the same public card anonymously. Select a work with a known saved v1/live v2 difference, sign in using an authorized QA account, and verify v1; cancel/back should return to the card.
6. Repeat the play entry after that isolated QA session expires or signs out. Reauthentication must retain the old-card target; public viewing remains available and private resources stay protected.

Real Safari UI, iPhone/WeChat, long-press/Photos persistence, camera scanning, native sharing UI and a fresh real Clerk login therefore remain explicitly unverified here.
