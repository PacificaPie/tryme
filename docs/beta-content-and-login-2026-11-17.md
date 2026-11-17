# Beta content and signed-out entry

Deployed to `funtrack-staging` on 2026-11-17. Worker version:
`2bd9f42f-618c-4ee8-a544-cb14ead56748`.

## Content changes

Used the authenticated website's visibility controls to hide four redundant
acceptance entries (local HTML, GitHub HTML, GitHub repository and external
Snake). No work, version, event or card was deleted. Kept one listed rain game
and one listed cloud-built Snake.

Uploaded the following existing self-contained examples and matching PNG
covers through the live local-file publication form:

| Work | ID | Browser verification |
| --- | --- | --- |
| 潮汐记忆 · 演示 | `9b93e4c6-ab91-49ad-805f-18f6e13ad70b` | Start and keyboard card flips; not completed |
| 四方数独 · 演示 | `00278aaa-2e0d-44cf-898d-76ecbd99c2e9` | Solved; 1189 points |
| 弧线投篮 · 演示 | `560aca39-c4aa-4223-b632-478a10569a80` | Five shots, five baskets; 1000 points |
| 拍点 · 演示 | `7ad887ef-5382-4f33-97e7-9337b41ea72d` | Start/input/natural end; 0 points |

Read-only D1 verification found one accepted play start and ended session for
each new game, and exactly the three expected completions. All four current
content hashes match the uploaded HTML, with cover keys present. Afterward:
12 works, 15 versions, 16 metadata revisions, one card, six listed works.
Ignored evidence is under `.preview/feed-samples/`.

## Signed-out entry

The authentication-required view uses four real example covers, one heading,
and a sign-in/sign-up action. It supports Chinese/English, small viewports and
reduced motion. The existing authentication URL and return route remain intact;
the legacy Sites provider retains its ChatGPT sign-in label.

Validation: syntax check and 30 existing authentication/i18n tests passed;
staging build, offline preflight and Wrangler dry run passed. On the deployed
site, checked desktop and 360px layout (no horizontal overflow, four covers
loaded), language switching, Clerk form navigation and return to Feed. Did not
create a new account as part of this visual change. The authenticated Feed
still renders its six listed works.

## Formal-domain migration: planned, not implemented here

D1 and R2 persist independently of the hostname. A custom domain alone does
not clear them. Creating new production resources requires copying existing
data and files while preserving IDs and object keys.

Clerk development and production are separate instances. Current ownership
uses `clerk:<subject>`, and this app has no cross-instance identity mapping yet.
Before switching authentication, add verified account linking to preserve
ownership, back up D1/R2, rehearse the data migration, configure production
Clerk and the custom domain, then verify login, upload, version rollback and
existing card links. Keep staging independent of subsequent production writes.

References:
- https://clerk.com/docs/guides/development/managing-environments
- https://clerk.com/docs/guides/development/deployment/production
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
