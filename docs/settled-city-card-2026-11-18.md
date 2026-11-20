# 灯城名片与开屏收稳卡面衔接

**2026-11-20 状态更正**：本改版已经通过 `a8b01db` 进入主线并上线；`ae684982` 中的 `public/lit-city/` 与本次原提交 `d72764e` 一致，生产关键资源字节核对通过。原先“本地实现，尚未部署”的描述已过期。详见[当前核对、视觉修正与证据](city-opening-consistency-2026-11-20.md)。下面保留原始开发与本地验收记录，旧端口不是当前预览入口。

原始开发工作区 `funtrack-settled-city-card-2026-11-18`，分支
`feat/settled-city-card-2026-11-18`，基于开始工作时的最新 `origin/main`：
`e57fcdd`（PR #28，已含名片制作／分享及当前交互修复）。
`funtrack-prototype` 当时停留在 `d608ff5`，因此没有直接在它或其他 session 的 checkout 中编辑。

## 行为与实现

- 保留 `city` 模板 ID 和 `/lit-city/` 路径，模板体验、生成预览、已保存名片和公开链接都使用同一个新版渲染器，无需迁移或重存名片。
- 默认展示已收稳的卡面。日间采用开屏确认的冷灰卡、灰白建筑、石墨刻线；夜间采用深卡、灯光。作品贴图不加灰度滤镜或单独曝光调色。
- 正面刻字接入 payload 中的作者姓名和 headline；headline 为空时使用该卡签名。不生成英文姓名、身份统计或二维码。
- 作者资料、作品选择顺序与版本快照继续走原有接口和同源 iframe 协议。几何槽位的历史内部 ID 仅用于选择建筑形状，已移除其演示作品标题、介绍及曝光设置。
- 保留展开／收回、可选开场、翻面、作品目录、点击打开和键盘导航；九件一页，最多三十件。换主题保留正背面、当前页和城市展开状态。
- 手机使用更正的卡面视角，并为城市高度留出空间；少量作品在一到两排中分布。长名字和楼名在材质中截断，HTML 资料和目录仍保留完整文字；背面随内容增高。
- 修正减少动态效果时的展开状态：建筑与镜头立即到位，无需依赖后续动画帧。

主要改动集中于 `public/lit-city/`：`theme.js`、`controller.js`、`style.css`、
`scene.js`、`camera.js`、`player.js`、`config.js`、`index.html`。
继续复用已有 Three.js 及城市几何，没有新增运行时依赖。

参考只读：`../design/opening-animation-2026-11-18/lab/public/intro/theme.js`、
`lab/prepare.mjs`、`source/card/world.js` 与确认截图。
未编辑该 lab/source、停止 8791 服务或操作其浏览器 tab。

## 本地预览

- 交互预览：<http://127.0.0.1:8792/__city>
- 真实应用名片区：<http://127.0.0.1:8792/site.html#/cards>
- 空数据／长文字／封面失效／减少动态效果／无 WebGL：<http://127.0.0.1:8792/__city/edge>

启动：在此 checkout 中执行 `node diagnostics/settled-city-preview.mjs`。
`CITY_PREVIEW_PORT` 可覆盖默认 8792。数据只在进程内存中，重启会重建测试卡 ID，
因此推荐使用 `/__city` 这个稳定入口。

预览明确使用“林间 · 本地测试”和仓库中已有的示例封面。
数据通过真实 HTTP 路由、SQLite 测试适配层、名片快照与真实页面渲染；
身份与云存储绑定由本地 fixture 提供。测试不调用线上数据库、不需云凭据。
边界场景注入仅存在于此诊断服务器，不进入生产模板。

## 验证

- `npm run check`：页面脚本解析与 TypeScript 检查通过。
- `npm test`：663 / 663 通过。第一次运行使用的旧依赖目录缺少 `jsqr`；改用当前 release 的本地依赖后，全量重跑通过。
- `git diff --check` 通过。
- Chrome 实际界面：模板入口、已保存名片、公开名片均呈现新版卡面。
- 390px 预览：1、3、6、9、10、30 件作品；30 件的最后一页能打开第 30 件作品。
- 日夜切换：展开城市仍保持展开，2 / 4 页仍保持当前页。
- 键盘 End 跳至第 30 件，Enter 打开其保存版本 v1；本地试玩按钮实际变为“已体验”。
- 空草稿、失效封面、长姓名／简介／标题、模拟减少动态效果、模拟无 WebGL 均可用；无 WebGL 时目录仍能发出正确作品打开事件。

截图在 `docs/evidence/settled-city-card-2026-11-18/`：
`desktop-light.png`、`mobile-light.png`、`mobile-city-light.png`、
`mobile-city-dark.png`、`mobile-1-works.png`、`mobile-3-works.png`、
`mobile-6-works.png`、`mobile-10-works.png`、`mobile-work-30.png`、
`long-front.png`、`long-back.png`、`empty.png`、`reduced-motion-city.png`、
`webgl-fallback.png`、`template-in-app.png`、`keyboard-work-play.png`。

## 限制

本记录形成时未执行线上发布或生产账号验收；上线状态已由上面的 11.20 更正更新。390px 为浏览器内的响应式视口，未在实体 iPhone 或低端 Android 上测量性能；11.20 另补 macOS Safari 界面检查，不代表 iOS 真机验收。
现有 PNG 分享图仍使用统一静态排版；新版 3D 卡面展示在名片链接内。
名片模板没有插入完整的 16 秒开屏流程，开屏与首次使用原型仍由另一个 session 维护。
