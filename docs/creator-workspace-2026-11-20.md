# P07 · 创作工作台导航整合

日期：2026-11-20（America/New_York）。基线 `origin/main = ae684982`；独立分支 `feat/creator-workspace-2026-11-20`。本变更完成本地实现与验收，未推送、未部署；由统一集成任务处理远端集成和发布。

原先作品管理只链接数据页，名片制作使用另一套导航，历史反馈缺少固定入口。现在作品、名片、数据和反馈共用工作台导航；公开主页、资料编辑、Feed 是独立且明确的入口。既有用户直接进入任务页，不增加必须经过的工作台首页。

## 页面与流程

| 入口 | 用途与行为 |
| --- | --- |
| 管理作品 | 发布、编辑、展示设置、版本、归档；作品菜单可显式加入/更新名片 |
| 管理名片 | 当前名片、继续草稿、模板体验、制作与封面更新；空状态同时提供发布作品入口 |
| 查看数据 | 现有访问、试玩与趋势页面，保留作品/时间/版本筛选 |
| 互动反馈 | 直接打开 `#/studio/feedback?tab=history`，支持作品筛选与历史私密反馈；原无 tab 路由到消息中心的兼容行为保留 |
| 公开个人主页 | 查看访客看到的资料与公开作品，不把管理页面称为公开主页 |
| 编辑个人资料 | 使用既有资料编辑对话框 |
| 浏览 Feed | 随时回到发现；不按设备或角色限制体验/创作 |

- 发布表单保存草稿并返回后，作品页显示继续发布入口；文件和填写内容在当前浏览器的既有草稿存储中保留。
- 发布结果页直接提供返回作品管理，并定位刚发布的作品。加入名片仍经过现有的明确起点选择，不自动替换旧草稿。
- 名片页现在接收真实的 `hasCardDraft` 状态，显示继续草稿。制作时通过工作台导航离开，再回来可继续已选作品和签名。
- 名片保存结果页顶部提供返回名片管理和返回作品管理。保存仍生成新的名片 ID，既有作品版本和旧卡快照不变。
- 工作台框架覆盖作品详情管理、上传/发布结果、名片制作/模板/封面更新。公开作者页、其他作者名片、Feed、游客登录视图、旧关注列表不套管理框架。

## 实现与并行集成边界

新增 `public/creator-workspace.js` 和独立 CSS。`applyHTML` 按当前路由和已登录用户包装页面，原有子页面渲染与路由保留。旧的双项 studio 导航由统一四项导航替换。

`public/site.js` 仅修改模块导入、页面包装、草稿状态传递、作品/发布结果/名片返回链接。未修改 `identity()`、account menu、Feed API、灯城 renderer、分享实现、持久化 schema 或任何数据写入规则。`public/site.html` 只增加样式链接。

旧 `#/studio`、`#/studio/review`、`#/studio/card` 等兼容逻辑保留。工作台反馈导航显式带 `tab=history`，避免改变已有通知深链接行为。

## 验证

- `npm run check`：通过，前端语法与 TypeScript 检查。
- `npm test`：704/704 通过，包含 3 项工作台路由/草稿/语言测试和 1 项真实名片页面草稿状态回归；原空账号、归档历史、权限、版本与名片测试保留。
- `node scripts/standalone.mjs build --config wrangler.standalone.staging.jsonc`：通过，只生成本地产物；未运行部署。
- 本地 Chrome 157 浏览器验收：1440×1050 桌面、390×844 移动尺寸、320px 英文窄屏。没有横向溢出或页面 JavaScript 错误。
- 实际前端、HTTP router、SQLite、作品发布与名片保存代码执行；数据页使用实际 `readAnalytics` 查询本地 SQLite。身份、对象存储为 fixture；自动媒体请求在本地返回 503（未配置云捕获），随后明确跳过封面与视频完成发布。未执行真实云截图/视频生成。
- 已完成：四项导航及筛选、资料对话框/公开页/Feed 分别可达、上传文件与文字草稿保存/刷新恢复、发布后定位作品、从已存名片加入新作品、名片草稿跨页恢复、另存新卡后返回管理、旧路由、键盘链接顺序、空账号和仅归档作品账号路径。
- 保存新卡前后逐条对比：原名片 `snapshot_json` 与已有 `ft_work_versions` 记录不变，仅新增测试作品版本及新名片。

机器结果见 [browser-results.json](evidence/creator-workspace-2026-11-20/browser-results.json)。这是本地 fixture 和浏览器尺寸验证，不代表真实 Clerk、实体手机、Safari/微信或 production/staging 的完整验收；没有更新共享环境。

## 预览与复现

本地预览：`http://127.0.0.1:4937/site.html#/studio/works`。该端口由本工作区的 fixture 使用，内存数据只用于验收。预览若已停止，从本工作区启动：

```sh
node tests/fixtures/creator-workspace-browser-server.mjs
```

每次完整验收使用新启动的 fixture（脚本会新增测试作品/名片），在另一终端运行：

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node tests/integration/creator-workspace-browser.mjs
```

可用 `CREATOR_WORKSPACE_PORT` 和 `CREATOR_WORKSPACE_URL` 指向自己的空闲 loopback 端口。测试拒绝远端 URL。默认结果输出到 `.preview/creator-workspace/`；Playwright 未增加到应用生产依赖。

## 截图

| 页面 | 桌面 | 移动尺寸 |
| --- | --- | --- |
| 作品管理 | [桌面作品](evidence/creator-workspace-2026-11-20/desktop-works.png) | [移动作品](evidence/creator-workspace-2026-11-20/mobile-works.png) |
| 名片管理 | [桌面名片](evidence/creator-workspace-2026-11-20/desktop-cards.png) | [移动名片](evidence/creator-workspace-2026-11-20/mobile-cards.png) |
| 发布/保存结果 | [发布结果](evidence/creator-workspace-2026-11-20/desktop-published.png) | [新卡保存结果](evidence/creator-workspace-2026-11-20/mobile-saved-card.png) |
| 空账号与归档 | — | [空作品](evidence/creator-workspace-2026-11-20/mobile-empty-works.png) · [空名片](evidence/creator-workspace-2026-11-20/mobile-empty-cards.png) · [归档恢复入口](evidence/creator-workspace-2026-11-20/mobile-archived-builder.png) |
