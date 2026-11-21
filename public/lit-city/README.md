# Lit city card

Adapted at the user's request from the public 灯城名片 artifact:
https://claude.ai/artifact/BBxTkBMiFwefm4u3SasdsD

`config`, `shaders`, `kit`, `plan`, `camera` and the scene/timeline geometry retain the supplied visual design. TryMe's adapter supplies only real selected work snapshots and the current creator profile. Reference images, identity, external CDN/font dependencies, homepage UI and screenshot/debug upload hooks are not used. Three.js is the existing bundled MIT dependency in `../gallery/vendor/`.

Landscape front: automatic folding-city intro, cover windows and accessible work index; nine works per page, maximum thirty. Hover lifts a building on desktop; touch lifts on the first tap and opens the work on the second. Dragging or Shift + arrow keys rotates the view, with full horizontal orbit and bounded vertical tilt. Escape ends the intro and resets the view. The flip button reveals name, title, biography, signature, website and avatar. Same-origin parent handshake and media, public and authenticated card views share the renderer. Reduced motion skips intro, rendering pauses when hidden/on the back and settles when idle; renderer resources are released on page replacement. WebGL failure retains the work index and identity.

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
Reduced motion applies selection and rotation immediately. Theme changes preserve
animation progress, selected building and rotation; page changes preserve rotation
without replaying the intro. Captured drags and cancelled/multitouch gestures never
activate a work. The canvas owns touch dragging; surrounding content stays scrollable.

Current local review and verification: `docs/city-direct-interaction-2026-11-20.md`.
