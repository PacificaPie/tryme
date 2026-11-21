# 灯城名片实体背面 · 2026-11-21

修正用户指出的体验偏差：此前翻面隐藏了 3D 正面、显示独立 HTML 资料页；现在身份资料贴在同一张有厚度、圆角的 3D 卡片背面，按钮和拖动都能翻到它。

基线 `309bb55`（PR #41 后主线），分支 `fix/city-physical-back-2026-11-21`，独立工作区 `funtrack-city-physical-back-2026-11-21`。本报告为本地交付证据，交由总验收集成和部署。

## 行为

- 翻面保持同一个 canvas 和同一块卡片。约 0.85 秒连续转动，经过侧边可以看到卡片厚度，最后显示贴在背面的作者信息。
- 左右或上下拖动均可完整转到背面、再转回正面；保留任意停留角度。翻面按钮可回到方便阅读的正面或背面。
- 文字、头像、签名、网址均来自清洗后的真实作者 payload。背面印刷材质沿用开屏的圆角几何和 UV 方向，没有引入开屏演示作者、统计或二维码。
- 背面使用浅/深主题及作者选定的 ivory/cobalt 配色。印刷网址可直接点击；触发前对实际背面位置做射线命中检查。
- 正面仍保留自动动画、桌面悬停抬升、手机首次点选抬升/再次打开；背面和翻转过程中不能穿透点击正面作品。快速连续翻面和拖动接管不会误开作品。
- 换主题保留视角和翻转状态；分页、原作品版本和登录回跳继续使用原协议。减少动态效果时直接到目标姿态；页面隐藏时暂停，静止后停止逐帧渲染。
- 长资料在卡面内换行、必要时省略，完整原文与原生网址链接放在默认折叠的「完整资料」。空卡或 WebGL 不可用时仍可使用 HTML 资料及作品目录。

## 实现

新增 `public/lit-city/back.js`：背面几何位于卡片底面之外，只有背向可见；内容以 canvas 纹理印在这块网格上。`camera.js` 围绕卡片中心对镜头及 up 向量做一致刚体旋转，保留真实透视和双面遮挡，同时把两面边界、建筑高度和裁剪面纳入取景。

`player.js` 管理翻面过渡、拖动接管、正反面命中及资源释放；`controller.js` 依据真实朝向更新按钮、分页和辅助资料。没有改变保存格式、作者数据来源、作品快照、公开链接或后端接口。

## 验收

- `npm run check` 通过，`npm test` **732/732** 通过，`npm run build:standalone` 通过。构建只有既有 vinext 静态/动态 import 重复提示。
- 新增 3 项测试：实体背面的朝向/文字 UV、不限双轴角度下两面取景与矩阵有效性、长文本与 Unicode 换行。原 4 项手势测试继续通过。
- `back.js`、camera、controller、player、HTML、CSS 六个生产资源与 standalone 构建产物 SHA-256 一致。
- Chrome 157 桌面及 390×844/DPR 2 触控模拟 **13 项场景通过、0 page error**。结果在 [browser-checks.json](evidence/city-physical-back-2026-11-21/browser-checks.json)。
- 浏览器实际检查同一 canvas、底面网格、镜头位于卡片下方和 HTML 资料默认折叠；按钮翻面、水平/垂直拖动、快速反向翻面、手势接管、主题保留、背面隔绝作品点击、手机原生触控、30 件分页/键盘/v1 详情及登录回跳均通过。
- 空卡、缺图、长资料、减少动态效果、WebGL 降级、作者 ivory/cobalt 配色通过。背面网址命中跳到正确地址，测试导航由浏览器本地拦截，没有请求外部站点。

| 证据 | 文件 |
| --- | --- |
| 实体背面 | [卡面截图](evidence/city-physical-back-2026-11-21/physical-back.png) |
| 实际翻转录屏 | [本地浏览器 WebM](evidence/city-physical-back-2026-11-21/physical-flip.webm) |
| 桌面正背面旋转 | [按钮翻面](evidence/city-physical-back-2026-11-21/desktop-back-light.png) / [横向拖到背面](evidence/city-physical-back-2026-11-21/desktop-dragged-back.png) / [纵向转到背面](evidence/city-physical-back-2026-11-21/desktop-vertical-back.png) |
| 手机 | [浅色背面](evidence/city-physical-back-2026-11-21/mobile-back-light.png) / [深色背面](evidence/city-physical-back-2026-11-21/mobile-back-dark.png) / [触摸拖转](evidence/city-physical-back-2026-11-21/mobile-dragged-back.png) |
| 长资料 | [卡面排版](evidence/city-physical-back-2026-11-21/long-profile-printed.png) / [完整原文](evidence/city-physical-back-2026-11-21/long-profile-complete.png) |

以上使用本地 fixture 身份、存储和实际 HTTP/渲染流程，不是生产数据写入。手机为 Chrome 触控模拟，实体手机、iOS Safari 和微信尚未验收。本工作区未自行部署，最终集成与线上检查由总验收执行。

## 复现

```sh
CITY_PREVIEW_PORT=18841 node diagnostics/settled-city-preview.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node diagnostics/city-physical-back-browser.mjs
```

[稳定预览入口](http://127.0.0.1:18841/__city)；[边界场景](http://127.0.0.1:18841/__city/edge)。旧 consistency/interaction 验收脚本入口转发到当前脚本，原报告与原截图保留为历史记录。
