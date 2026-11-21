# 灯城名片直接交互 · 2026-11-20

基线为 `b40a7711d9d6c7757983578eba7d791a39690bda`（PR #40 后的主线）。分支 `fix/city-direct-interaction-2026-11-20`，独立工作区 `funtrack-city-interaction-2026-11-20`。此前 `aded4e4` 已在基线中；本次只交付新增交互，供总验收统一集成。

## 用户可见行为

- 移除「展开城市／播放开场／跳过动画」三个按钮；进入灯城名片自动播放城市生长、收拢动画。原有翻面按钮保留。
- 桌面鼠标悬停建筑抬升，离开后收回，点击打开原作品。
- 手机点一次建筑抬升，再点同一栋打开作品；点空白处收回。拖动卡面旋转，拖动结束、取消触控、多指中断都不会误打开作品。
- 水平方向可以完整绕转；上下可调俯仰，限制在可读的正面角度。镜头按透视、卡片边界、建筑高度及裁剪面取景，极端转角仍保留整张卡片。身份背面仍使用完整可访问的 HTML 排版，由翻面按钮切换。
- 动画期间点击/触摸会结束开场并接管操作，该次接管点击不会直接打开作品。拖动可直接接管并旋转。
- 换主题保留动画进度、抬升状态和视角；翻面暂停、返回继续；超过 9 件作品保留分页，换页保留视角、不重播开场。
- 作品目录和键盘入口保留。方向键/Home/End 选作品，Enter/Space 打开；Shift + 方向键旋转，Escape 结束动画并恢复视角。减少动态效果时直接显示收稳卡面，交互立即生效。

## 实现范围

生产代码仅涉及 `public/lit-city/` 的 controller、player、camera、gestures、HTML、CSS 与说明文档。公共名片、已保存名片、模板体验及预览共用此 renderer，无需迁移或重存名片。

Pointer capture 和 6px 拖动阈值分离点击/旋转；多指、pointercancel、丢失 capture、暂停和卸载都会释放手势状态。事件观察及 Three.js 状态包装仅存在于诊断浏览器的响应拦截中，没有调试全局对象进入生产资源。

## 本地验收

- `npm run check` 通过；`npm test` **729/729** 通过，其中 4 项手势回归覆盖点击/拖动区分、动画接管、多指/取消和资源清理。最终触控焦点调整后再次执行 check、灯城 7/7 测试和构建，全部通过。
- `npm run build:standalone` 通过；构建仅有既有 vinext 静态/动态 import 重复提示。新增 `gestures.js` 及相关静态资源已进入构建目录。
- Chrome 157：桌面 1000×1100、手机 390×844/DPR 2 触控模拟。完整结果见 [browser-checks.json](evidence/city-interaction-2026-11-20/browser-checks.json)。
- 实际 renderer 验证自动播放、翻面暂停/继续、换主题保持进度、悬停抬升/离开收回、拖动与点击区分、上下俯仰极限下绕转不裁切、触屏先抬升再打开、触摸取消、1/3/6/9/10/30 作品及键盘打开第 30 件作品。
- 已保存作品弹出正确 v1 详情，保留对应登录回跳链接；检查空作品、封面缺失、长姓名/简介、减少动态效果、WebGL 不可用及 ivory/cobalt 背面。没有 page error。

| 效果 | 证据 |
| --- | --- |
| 入场自动动画 | [桌面](evidence/city-interaction-2026-11-20/desktop-autoplay.png) |
| 桌面悬停建筑 | [深色](evidence/city-interaction-2026-11-20/desktop-hover-dark.png) |
| 拖动旋转 | [桌面](evidence/city-interaction-2026-11-20/desktop-free-rotation.png) / [手机](evidence/city-interaction-2026-11-20/mobile-drag-rotation.png) |
| 手机首次点选抬升 | [浅色](evidence/city-interaction-2026-11-20/mobile-tap-lift.png) |
| 边界 | [空作品](evidence/city-interaction-2026-11-20/edge-empty.png) / [封面缺失](evidence/city-interaction-2026-11-20/edge-missing.png) / [长文本](evidence/city-interaction-2026-11-20/edge-long.png) / [减少动态](evidence/city-interaction-2026-11-20/edge-reduce.png) / [WebGL 降级](evidence/city-interaction-2026-11-20/edge-webgl.png) |

以上为本地 fixture 身份、存储及 HTTP API，使用实际渲染器和原生指针事件；手机部分为 Chrome 触控模拟，不代表 iOS Safari、微信或实体手机验收。本次没有生产数据写入，也没有自行部署。总验收需要在最终集成提交上复核入口与部署后资源。

## 复现

```sh
CITY_PREVIEW_PORT=18831 node diagnostics/settled-city-preview.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node diagnostics/city-interaction-browser.mjs
```

打开 [名片预览](http://127.0.0.1:18831/__city) 或 [边界场景](http://127.0.0.1:18831/__city/edge)。可用 `CITY_PREVIEW_ORIGIN` 更换 loopback 端口。旧 `city-consistency-browser.mjs` 入口转发到当前验收脚本；此前的一致性截图和报告保留为历史证据。
