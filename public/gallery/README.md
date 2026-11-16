# 卡中展厅 adapter

`index.html` is a same-origin iframe renderer adapted from the supplied `卡中展厅` demo. It retains the original thick paper geometry, independently folding walls, hinged bench/figures, paper shaders and shadows. Three.js r128 is bundled locally in `vendor/` under its included MIT license. No CDN, remote font or runtime game renderer is required.

## Parent/child messages

Both sides must check `event.origin === location.origin`. The child additionally requires `event.source === parent`; the parent must require the current iframe's `contentWindow` and validate work IDs before navigating.

Child → parent:

```js
{ type: 'funtrack:gallery:ready' }
{ type: 'funtrack:gallery:open-work', workId: 'orbit', play: true }
{ type: 'funtrack:gallery:state', open: true, face: 'front', page: 0, yaw: 0, inside: true }
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
    open: false, face: 'front', page: 0, yaw: 0, inside: false
  }
}
```

`page` is zero-based and clamped to the current selected-work count; exterior `yaw` is clamped to `[-0.65, 0.85]`, interior to `[-1.3, 1.3]`. Opening always uses the front face. Optional card-back styles are `ink`, `ivory`, and `cobalt`; absent old snapshot fields remain empty/ink. Images must be same-origin HTTP(S) URLs; missing/failed images retain a generated title placeholder. Covers, including SVG, are rasterized to canvas before GPU upload. The first selected work is the representative work printed on the back. An optional website is HTTP(S) only and is also accessible in the HTML details.

## Interaction and limits

- Closed front is the default. Click the card to open; projected, keyboard-accessible controls sit on its corner and lower edge. No outer toolbar is required.
- Each group adapts to 1–9 works. Explicit previous/next controls expose selections larger than 9 without silently dropping works.
- Click a visible wall artwork or its physical frame to request direct play. The parent auto-loads hosted HTML only; external works retain their detail-page outbound action. Canvas picking uses a fresh pointer-up ray and respects solid geometry occlusion. Hover shows the real work title.
- Enter the same room from its floor hotspot; this moves the camera into the existing model, preserving all selected works and versions. Horizontal drag or interior arrow buttons change view. Canvas keyboard: Enter/Space toggles, F flips, G enters, Left/Right rotates, Escape exits the room then closes. Focus returns to Canvas when entering/exiting so shortcuts remain available. The collapsed HTML work list provides keyboard and WebGL fallback access; mobile vertical scrolling remains native.
- Reduced motion immediately selects stable states. Hidden documents pause RAF; static views do not run continuous RAF. Replaced groups dispose their geometry/materials/textures, and page teardown disposes the renderer and render targets.
- WebGL failure/context loss leaves the usable HTML work list. The renderer displays artwork covers; launching actual works remains the parent page's responsibility.
- DOM QA: `#stage[data-state]` is `waiting`, `empty`, `opening`, `closing`, `flipping`, `open`, `closed`, `entering`, `leaving`, `inside`, or `fallback`; `data-face` is `front`/`back`. `#gallery-status` is a visually hidden live region with stable text `已进入展厅`, `展厅已展开`, or `展厅已收起 · 正面/背面`.

The parent controls iframe height from the resize message; the child's stage stays fixed at 570px desktop / 490px narrow screens, avoiding height feedback loops. The camera fits the model's bounding box to the viewport. HTML details expansion changes only the surrounding content height.
