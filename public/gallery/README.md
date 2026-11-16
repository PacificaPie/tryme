# 卡中展厅 adapter

`index.html` is a same-origin iframe renderer adapted from the supplied `卡中展厅` demo. It retains the original thick paper geometry, independently folding walls, hinged bench/figures, paper shaders and shadows. Three.js r128 is bundled locally in `vendor/` under its included MIT license. No CDN, remote font or runtime game renderer is required.

## Parent/child messages

Both sides must check `event.origin === location.origin`. The child additionally requires `event.source === parent`; the parent must require the current iframe's `contentWindow` and validate work IDs before navigating.

Child → parent:

```js
{ type: 'funtrack:gallery:ready' }
{ type: 'funtrack:gallery:open-work', workId: 'orbit', play: true }
{ type: 'funtrack:gallery:state', open: true, face: 'front', page: 0, pageSize: 6, yaw: 0, inside: true, focusWorkId: 'orbit' }
{ type: 'funtrack:gallery:resize', height: 642 }
```

Parent → child after ready:

```js
{
  type: 'funtrack:gallery:init',
  payload: {
    author: { id: 'lin', name: '林', bio: '创作者自己的简介', headline: '小游戏作者', signature: '自己的签名', website: '', backStyle: 'ivory' },
    works: [{ id: 'orbit', name: 'Orbit', desc: '已有作品简介',
      cover: 'http://localhost/assets/work-covers/orbit.svg',
      kind: '互动实验', version: 'v1' }],
    open: false, face: 'front', page: 0, pageSize: 6, yaw: 0, inside: false, focusWorkId: null
  }
}
```

`focusWorkId` is the currently focused work during sequential browsing, or `null` by default. Both sides validate that a non-null ID belongs to this card's `works`; invalid/missing IDs become `null`. A valid focus takes precedence over a stale `page`: set `page = Math.floor(works.findIndex(w => w.id === focusWorkId) / pageSize)`. The parent persists and returns the focused work together with open/face/inside/page/pageSize/yaw when returning to the same card. `config.js` is the single shared capacity setting: `window.FuntrackGallery = {pageSize: 6}`; both the parent and renderer load it before their controller scripts. Legacy saved states without `pageSize` use the former 9-work grouping: locate the first work in that old group and map its index to the new 6-work group. A valid `focusWorkId` always takes priority. Newly emitted states include `pageSize: 6`. `page` is otherwise zero-based and clamped to the current selected-work count; exterior `yaw` is clamped to `[-0.65, 0.85]`, interior to `[-1.3, 1.3]`. Opening always uses the front face. Optional card-back styles are `ink`, `ivory`, and `cobalt`; absent old snapshot fields remain empty/ink. Images must be same-origin HTTP(S) URLs; missing/failed images retain a generated title placeholder. Covers, including SVG, are rasterized to canvas before GPU upload. The first selected work is the representative work printed on the back. An optional website is HTTP(S) only and is also accessible in the HTML details.

## Interaction and limits

- Closed front is the default. Click the card to open; projected, keyboard-accessible controls sit on its corner and lower edge. No outer toolbar is required.
- Each room contains at most 6 works, arranged along the walls in B → R → L order. Only the selected works are hung: fewer works means fewer frames, with no empty frames added. More than 6 works automatically continue into the next group, and previous/next navigation retains access to every selected work.
- Wall covers retain their full original image, contained in the fixed 16:10 artwork surface with a warm paper border when needed. Wide and portrait source images are not center-cropped. Closed-card thumbnails use a separate contained texture fitted to each slot's actual physical aspect ratio, including the wider two-/three-work layouts; the existing folding seam and slot geometry are unchanged. The representative image on the card back is also contained in its slot.
- Click a visible wall artwork or its physical frame to request direct play. The parent auto-loads hosted HTML only; external works retain their detail-page outbound action. Canvas picking uses a fresh pointer-up ray and respects solid geometry occlusion. Hover shows the real work title.
- Enter the same room from its floor hotspot; this moves the camera into the existing model, preserving all selected works and versions. Inside, the ←/→ controls and horizontal swipes browse works one by one, updating `focusWorkId` and its group; clicking the focused artwork or frame still requests direct play. Outside, horizontal drag and Left/Right adjust the room view. Canvas keyboard: Enter/Space toggles, F flips, G enters, Left/Right selects the previous/next work inside (rotates outside), Escape exits the room then closes. Focus returns to Canvas when entering/exiting so shortcuts remain available. The collapsed HTML work list provides keyboard and WebGL fallback access; mobile vertical scrolling remains native.
- Reduced motion immediately selects stable states. Hidden documents pause RAF; static views do not run continuous RAF. Replaced groups dispose their geometry/materials/textures, and page teardown disposes the renderer and render targets.
- WebGL failure/context loss leaves the usable HTML work list. The renderer displays artwork covers; launching actual works remains the parent page's responsibility.
- DOM QA: `#stage[data-state]` is `waiting`, `empty`, `opening`, `closing`, `flipping`, `open`, `closed`, `entering`, `leaving`, `inside`, or `fallback`; `data-face` is `front`/`back`. `#gallery-status` is a visually hidden live region with stable text `已进入展厅`, `展厅已展开`, or `展厅已收起 · 正面/背面`.

The parent controls iframe height from the resize message; the child's stage stays fixed at 570px desktop / 490px narrow screens, avoiding height feedback loops. The camera fits the model's bounding box to the viewport. HTML details expansion changes only the surrounding content height.
