# 点亮收藏 · real-work adapter

Template ID: `collection`. Entry: `/collection/index.html`.

This adapts the supplied `.review-demos/点亮收藏` renderer. `core.js`, `shaders.js`, and the solid rounded card, desk-lighting, label and soft-shadow code in `desk.js` retain the original Three.js treatment. The original promotional timeline, unrelated example works, generated poster filler, simulated live games, folder sequence, remote fonts, and debug upload hooks are not used. `assets.js`, `layout.js`, and `controller.js` supply actual user data and interaction.

Three.js is loaded from the existing `/gallery/vendor/three.min.js`; its MIT license remains at `/gallery/vendor/LICENSE`. No new dependency or CDN is required.

## Parent protocol

The same `funtrack:gallery:*` messages are used. Both sides verify exact same origin. The child requires `event.source === parent`; the parent must require the current iframe's `contentWindow` and validate the work ID against the current snapshot.

Child → parent:

```js
{ type: 'funtrack:gallery:ready' }
{ type: 'funtrack:gallery:resize', height: 650 }
{ type: 'funtrack:gallery:state', open: true, face: 'front', inside: false,
  yaw: 0, page: 0, pageSize: 6, focusWorkId: 'work-id' }
{ type: 'funtrack:gallery:open-work', workId: 'work-id', play: true }
```

Parent → child:

```js
{
  type: 'funtrack:gallery:init',
  payload: {
    author: { id: 'user-id', name: '创作者', bio: '', headline: '', signature: '', website: '' },
    works: [{ id: 'work-id', name: '作品名', desc: '实际介绍',
      cover: 'https://same-origin.example/media/version-id', kind: '网页游戏', version: 'v1' }],
    page: 0, pageSize: 6, focusWorkId: null
  }
}
```

`open`, `face`, `inside`, and `yaw` use fixed values for this always-open tabletop. `page` and `focusWorkId` are meaningful and restorable; a valid focus selects its containing page. `backStyle` is accepted as an extra author field by the shared parent payload but has no tabletop-specific effect.

## Layout and interaction

- 1–30 actual selected works; `/gallery/config.js` supplies the shared six-work page capacity. Extra works remain accessible through paging. A short final row is centered; no filler card meshes are created.
- Covers are immediately visible in color after their image loads. Missing images retain a title placeholder. SVG and bitmap images are rasterized to a canvas and contained without stretching or cropping inside the card.
- Pointer movement changes the original desk light and gently raises the pointed-at card. Touch users can directly tap any visible card; no hover is required. A fresh pointer-up ray intersects the actual instanced card mesh before navigation.
- Previous/next controls and horizontal swipes change groups; vertical mobile scrolling remains native. Canvas Left/Right and Home/End select works; Enter/Space opens the selected work. The collapsible HTML list provides ordinary keyboard buttons and expands automatically when WebGL fails.
- The child requests opening only the supplied real work ID. The parent decides whether hosted HTML auto-starts; external works retain their normal detail-page outbound action.
- There is no autoplay or entrance wait. Reduced-motion mode removes interpolation. RAF stops when the light/cards settle and pauses while hidden. Replaced pages dispose their meshes, materials, textures and image listeners; unloading also disposes render targets and the WebGL renderer.

Validation performed locally: syntax; real Three geometry for 1–6 cards at desktop and narrow widths; finite transforms; initial colored state; disposal; message origin gate; 30-work paging/focus restore; keyboard opening; single/empty/seven-work states; fallback paging and teardown. Browser visual validation is owned by the parent integration task.
