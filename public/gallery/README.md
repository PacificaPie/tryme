# 卡中展厅 adapter

`index.html` is a same-origin iframe renderer adapted from the supplied `卡中展厅` demo. It retains the original thick paper geometry, independently folding walls, hinged bench/figures, paper shaders and shadows. Three.js r128 is bundled locally in `vendor/` under its included MIT license. No CDN, remote font or runtime game renderer is required.

## Parent/child messages

Both sides must check `event.origin === location.origin`. The child additionally requires `event.source === parent`; the parent must require the current iframe's `contentWindow` and validate work IDs before navigating.

Child → parent:

```js
{ type: 'funtrack:gallery:ready' }
{ type: 'funtrack:gallery:open-work', workId: 'orbit' }
{ type: 'funtrack:gallery:state', open: true, face: 'front', page: 0, yaw: 0 }
{ type: 'funtrack:gallery:resize', height: 642 }
```

Parent → child after ready:

```js
{
  type: 'funtrack:gallery:init',
  payload: {
    author: { id: 'lin', name: '林', bio: '创作者自己的简介' },
    works: [{ id: 'orbit', name: 'Orbit', desc: '已有作品简介',
      cover: 'http://localhost/assets/work-covers/orbit.svg',
      kind: '互动实验', version: 'v1' }],
    open: false, face: 'front', page: 0, yaw: 0
  }
}
```

`page` is zero-based and clamped to the current selected-work count; `yaw` is clamped to `[-0.65, 0.85]`. Opening always uses the front face. Images must be same-origin HTTP(S) URLs; missing/failed images retain a generated title placeholder. Covers, including SVG, are rasterized to canvas before GPU upload.

## Interaction and limits

- Closed front is the default. Open/close/flip are user-controlled and stop at stable states.
- Each group adapts to 1–9 works. Explicit previous/next controls expose selections larger than 9 without silently dropping works.
- Click a visible wall artwork or a labeled HTML work button to request parent navigation. Canvas picking uses a fresh pointer-up ray and respects solid geometry occlusion.
- Horizontal drag or arrow buttons change the open view. Canvas keyboard: Enter/Space toggles, Left/Right rotates, Escape closes. HTML work buttons support keyboard navigation; mobile vertical scrolling remains native.
- Reduced motion immediately selects stable states. Hidden documents pause RAF; static views do not run continuous RAF. Replaced groups dispose their geometry/materials/textures, and page teardown disposes the renderer and render targets.
- WebGL failure/context loss leaves the usable HTML work list. The renderer displays artwork covers; launching actual works remains the parent page's responsibility.
- DOM QA: `#stage[data-state]` is `waiting`, `empty`, `opening`, `closing`, `flipping`, `open`, `closed`, or `fallback`; `data-face` is `front`/`back`. `#gallery-status` is a visually hidden live region with the stable text `展厅已展开` or `展厅已收起 · 正面/背面`.

The parent controls iframe height from the resize message; the child's stage stays fixed at 450px desktop / 350px narrow screens, avoiding height feedback loops.
