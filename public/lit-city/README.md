# Lit city card

Adapted at the user's request from the public 灯城名片 artifact:
https://claude.ai/artifact/BBxTkBMiFwefm4u3SasdsD

`config`, `shaders`, `kit`, `plan`, `camera` and the scene/timeline geometry retain the supplied visual design. TryMe's adapter supplies only real selected work snapshots and the current creator profile. Reference images, identity, external CDN/font dependencies, homepage UI and screenshot/debug upload hooks are not used. Three.js is the existing bundled MIT dependency in `../gallery/vendor/`.

Landscape front: folding city, cover windows, optional intro, accessible work index; nine works per page, maximum thirty. Back: name, title, biography, signature, website and avatar. Same-origin parent handshake and media, public and authenticated card views share the renderer. Reduced motion skips intro, rendering pauses when hidden/on the back and settles when idle; renderer resources are released on page replacement. WebGL failure retains the work index and identity.
