# Opening pacing, card back and first-paint refinement

The first-visit film previously compressed the gallery into 6 seconds, held only the front for 1 second, and automatically raised Feed on completion. The site could paint its Feed loading placeholder while authentication resolved; the iframe also exposed its render-preparation frames as soon as it reported ready.

## Result

- Gallery duration: 7.5 seconds on desktop and mobile, reducing travel speed by 20%. The camera route and artwork are unchanged.
- After the city folds back into the card, the front rests for 2.5 seconds and flips to the back over 1.3 seconds. The film then waits indefinitely. The stationary frame does not keep a GPU animation loop running.
- “探索作品” explicitly raises Feed over 900 ms. “翻到正面 / 翻到背面” lets visitors inspect either face. Background taps on the final screen do not dismiss it. During playback an extra tap or Enter/Space/Escape still dismisses, with no visible skip button.
- The opening back is branded TryMe in both themes. It does not show the source artifact's fictional person's job, engagement counts, portrait or QR destination. Saved creator-card profiles are unaffected.
- A head script covers the candidate first Feed visit before any Feed paint. Authentication still decides whether the film may load. The identically styled cover transfers to the film, waits for a clean rendered first frame, and fades before the film clock starts. Warmup and calibration remain covered. Slow auth / module failure has a 12-second release watchdog.
- The existing `tryme.opening.seen.v1` marker is retained. Returning guests and authenticated refreshes do not replay. Deep links and reduced-motion users bypass the film. All cancellation/failure paths release the inert shell.

## Validation

- `npm run check` passed.
- `npm test`: 685 passing tests, including 14 new opening timing, lifecycle, handshake, timeout, origin, manual-entry and preference cases.
- Standalone staging build passed.
- Browser checks: 390 × 844 dark and light, 1280 × 800 light; actual final 3D back, manual flip to front, explicit Feed entry, refresh without a film, and a 3-second simulated auth wait behind the initial logo. Browser console reported no errors in the local film.
- Local diagnostic uses the production controller/assets: `http://127.0.0.1:8794/?authDelay=3000`. Its “重放首次访问” button resets only that loopback origin's marker. It uses a fixture Feed, not the real login flow; the deployed website keeps Clerk unchanged.
- Screenshots are under `design/opening-feedback-2026-11-19/` in the workspace's parent project folder. Original `8791` lab remains the earlier reference, not this release preview.

No database migration, authentication configuration or new account mutation is involved in this refinement.
