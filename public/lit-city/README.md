# Lit city card

Adapted at the user's request from the public 灯城名片 artifact:
https://claude.ai/artifact/BBxTkBMiFwefm4u3SasdsD

`config`, `shaders`, `kit`, `plan`, `camera` and the scene/timeline geometry retain the supplied visual design. TryMe's adapter supplies only real selected work snapshots and the current creator profile. Reference images, identity, external CDN/font dependencies, homepage UI and screenshot/debug upload hooks are not used. Three.js is the existing bundled MIT dependency in `../gallery/vendor/`.

The front and reverse are surfaces of the same thick, rounded 3D card. The front automatically plays the folding-city intro. Desktop hover lifts a building and click opens it; touch lifts on the first tap and opens on the second. Dragging horizontally or vertically can turn the card all the way over. The flip button eases to a readable front/back orientation in the same canvas. Shift + arrow keys rotate; Escape ends the intro and returns to the front.

The reverse geometry/UV orientation follows the opening's physical card in `opening/card/world.js`, printed with the cleaned creator name, headline, biography, avatar, signature and website from the parent payload. Ink follows the site theme; ivory/cobalt remain the creator's paper choice. Back links use a ray hit on the printed website. Work hits are disabled on the reverse and during a flip. Complete profile text and a native website link remain in a collapsed detail section, with visible HTML fallback for empty cards or unavailable WebGL.

There are nine works per page, maximum thirty. Public, saved and preview cards share the renderer and same-origin message protocol. Theme changes preserve view and in-flight flip state. Reduced motion shows the final pose immediately; hidden documents pause, idle cards stop rendering, and resources are released on page replacement.

The settled front now matches the approved opening study in
`design/opening-animation-2026-11-18/lab/`: silver-grey card, pale buildings and
graphite engravings in light mode; dark card and illuminated city in dark mode.
`theme.js` ports the approved material values without importing the opening's
demonstration identity, artwork, stats, QR or full opening sequence. It follows
the site's shared theme controller. Work textures retain their original colors.

The front engraving uses the supplied author name and headline (or card signature).
Full text also remains available in HTML; long engraving and building labels are
ellipsized within their texture bounds. Mobile uses the opening's more upright
settled angle, a centered composition, and a city view that stays inside the card.
The camera uses continuous rigid rotations about the slab centre and rotates its up vector too. Both card surfaces and raised buildings are included in the perspective/clipping fit. Captured drags, cancellation and multi-touch never activate a work. The canvas owns touch dragging; surrounding content stays scrollable.

Current local review and verification: `docs/city-physical-back-2026-11-21.md`.
