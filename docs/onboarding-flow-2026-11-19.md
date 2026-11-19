# First login: browse freely, upload deliberately

## Behavior

New accounts now land directly on Feed. Eligible new accounts see a dismissible invitation above the works with “上传第一件作品” and “先随便看看”. Browsing works, searching, filtering, and visiting the studio do not require choosing an identity or saving a preference.

The upload action leads to the existing public nickname step only when the account needs one. A successful nickname save proceeds to `/publish`; an established creator can go straight to uploading. Both the optional welcome page and nickname page offer “先随便看看”. This exit is available even while saving or after a save failure, and a late response cannot navigate the visitor back into creation. The account menu now calls the optional page “开始创作”.

Dismissal is stored under an account-specific browser-local key, with an in-memory fallback if storage is denied. It does not write a discover/creator preference or wait for the network. A second account on the same browser can still see its own invitation. Clearing browser storage or using another device may show the invitation again; Feed remains accessible in every case. Existing server eligibility, nickname transactions, auth/CSRF checks, and stored preferences are unchanged. No migration is required.

## Verification

- `npm run check`: passed.
- `npm test`: 689 / 689 passed. Added regression coverage for account-specific dismissal, denied storage, browsing without writes, creator destination, duplicate submit prevention, failure/retry, and late route/account responses.
- `npm run build:standalone -- --config wrangler.standalone.production.jsonc`: passed. Existing framework ineffective-dynamic-import warnings remain.
- Chrome with the loopback fixture `node tests/fixtures/onboarding-browser-server.mjs`: new account A reaches Feed with an invitation and real seeded work tiles; nickname-page browse returns immediately; reload stays on Feed without the invitation; returning to upload and saving a nickname opens the actual upload wizard. New account B sees its independent invitation. Injected nickname save failure retains entered text and allows immediate browsing.
- Visual inspection at desktop and 390 × 844: Chinese/light Feed, English/dark Feed, optional welcome page, and nickname failure. The English Feed and welcome page have no horizontal overflow at 390 px. Screenshots are in [evidence/onboarding-flow-2026-11-19](evidence/onboarding-flow-2026-11-19/).

The fixture uses the real frontend, API router, and in-memory SQLite with fictional accounts. It does not validate a real production Clerk sign-in. No staging or production deployment was performed for this change.

## Release

Review and deploy the application through the existing standalone release process after checking the latest main branch. No data migration, secret change, or account permission change is needed. Rolling back the application restores the prior behavior; browser-local dismissal keys are inert in older versions.
