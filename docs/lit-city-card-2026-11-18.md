# Landscape lit city card

Requested source: https://claude.ai/artifact/BBxTkBMiFwefm4u3SasdsD (灯城名片).

New `city` template adapts the supplied building, route lighting and folding geometry to real selected work snapshots. The front is a landscape card with optional opening animation, a city expansion control and work links. Name, title, biography, avatar, signature and website are on the back; they use the existing creator profile. Ink, ivory and cobalt back styles use the existing settings. This is a card-local theme, not a change to the site's visual system.

The template is available in the catalog, interactive sample, creation preview, saved cards, remix and anonymous public share pages. It supports 1–30 selected works with nine per city page, accessible work links, keyboard selection and reduced motion. Same-origin messaging and media restrictions match the existing gallery integration. WebGL failure retains the work list. No reference demo images, names, external font/CDN requests or screenshot debug endpoint are shipped into the runtime.

Validation: 563 tests, script/TypeScript check, standalone production build and Wrangler deploy dry run passed. Local UI verified front/back, public share, 10-work pagination, keyboard opening of a public snapshot with login-required play, and 390px responsive layout (390px page scroll width, 360px renderer scroll width). A fixed-width local iframe harness was used because the browser viewport capability did not resize the existing tab. No production sample card was created during those checks.

Source attribution and rendering lifecycle details: `public/lit-city/README.md`. Steam-like multi-screenshot work details remain on Hold and are not part of this change.
