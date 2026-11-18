# 名片制作、更新与分享｜P10 / P11

日期：2026-11-18（America/New_York）。状态：独立分支实现及本地验收；待另一位合作者审阅，未合并、未部署、未写入正式数据。

## 范围与基线

- 独立克隆 `funtrack-card-features-2026-11-18`，分支 `feat/card-create-share-2026-11-18`。接手及提交前刷新 `origin/main`，均为 `77be1fa3e1eff41220a428a51c2a3740c9b06ef3`（PR #19）。
- 正式站只读抽查 `/site.js` 内容 SHA-256 与该主线相同：`4b733fdc918943cb067b56269469b59351ea3f1059474ed840fd3263cfa706c6`。没有将交接中的部署 ID 当作本轮重新核验的部署结果。
- 从旧 Draft PR #10 的工作区中只提取 `card-addition`、QR/PNG 导出及相关测试作为起点，再适配当前主线。未整包合并旧分支；未修改上传、接口诊断或其他工作区。
- 无数据库迁移、无保存 API 修改、无 `server.ts` 修改。未改登录、作品隔离、品牌、Steam 多图详情。

## 改后的行为

1. 发布成功页直接提供“加入或更新名片”，携带本次作品 ID。选择加入现有草稿、从当前名片继续、或仅用这件作品开始；进入页面本身不改草稿。
2. 已存名片和名片工作台提供“更新名片”，先明确选择起点。保存按钮写为“保存为新名片”：创建新 ID/链接，旧卡链接、选片、作品版本、说明和封面保持原快照。新卡读取生成预览时所选作品的当前版本及 metadata。
3. 草稿会筛掉不可选作品并说明从旧卡移除的数量，去重并保留顺序；超过 30 件时阻止添加，不静默截断。起点确认会清空旧预览；沿用原有账号隔离的 sessionStorage。与已存卡一致的副本不再在此选择页标为未完成草稿。
4. 工作台、已存卡和公开卡共用分享弹窗：文案/链接、真实 QR、PNG 生成、下载链接、打开原图、支持时的系统图片分享。
5. PNG 为统一的 1200×1440 静态分享图，支持六个现有模板，包括灯城；使用当前公开身份、最多前三件作品的快照封面和标题、总作品数及 QR。它不是动态/3D 模板截图；双面与互动在链接中查看。已有图片不会随资料变更自动更新。
6. 导出只请求无凭据的 `/api/public/cards/:id` 及该卡的公开封面，不请求私有媒体或外部图片。不依赖第三方 QR 服务。缺图/图片解码失败使用占位；创建失败保留链接分享。重新生成先撤下旧图；关闭会取消请求并回收 Blob URL，迟到结果不能重现。

## 本地验证

最终命令及结果见 [验收摘要](evidence/card-features-2026-11-18/verification.json)。测试数量是本分支此次执行结果，不代表真实账号或正式环境操作数量。

- `npm run check`：脚本解析、TypeScript。
- `npm test`：完整回归；新增测试覆盖草稿合并/替换、去重/容量、来源/所有权、失效回调、六模板创建新卡、幂等重试、旧快照不变、当前身份投影、公开 DTO、归档/他人作品拒绝、QR 独立解码、公开封面白名单、导出失败/关闭清理。
- `npm run build:standalone`：独立目标本地构建，不部署。保留框架现有的动态导入优化警告。
- `git diff --check`：无空白错误。

### 真实页面操作（隔离 fixture）

`node diagnostics/card-features-preview.mjs` 启动 `http://127.0.0.1:8894/__qa`。此脚本仅绑定 loopback，使用真实产品 JS、renderer、API router 和 SQL，D1/R2 为内存替身，用户为合成身份。它不测试 Clerk，也不替代 Cloudflare/生产链路。停止后数据消失；正式构建不包含该脚本。

已操作：

- 390×844 iframe 中从发布结果加入已有灯城卡，保留前两件顺序并追加第三件；打开原卡再返回，三件选片仍在；生成预览、保存新卡，看到“已保存”。
- 同一页面确认新卡显示三件作品，原卡仍为两件。fixture 原卡 `snapshot_json` 字节比较为 true，保存两张新卡后共三张。
- 顶层 390px 页面选择“只用这件作品开始”，白墙默认、仅一件选中；刷新模板页后恢复，成功预览并另存。已存卡“更新名片”进入正确来源卡，保存副本不再误报未完成草稿。
- 公开灯城卡展示三件作品，翻背显示当前身份和签名；匿名公开分享弹窗可生成 PNG。
- 390px 分享弹窗：页面宽 390，弹窗外宽 358，内部 scrollWidth/clientWidth 均 341，无横向溢出。浅色与深色的更新页均查看。
- 通过浏览器生成图的下载链接工具取得实际 PNG；独立 `jsQR` 从 PNG 像素解码得到 `http://127.0.0.1:8894/c/141d7d72-e4e4-45d3-8dfa-b56b4c934abc`，尺寸为 1200×1440。自动测试另解码正式域名格式和 UTF-8 URL。

证据中的 QR 指向临时本地 fixture，不是可供手机访问的正式卡。

| 可见证据 | 文件 |
| --- | --- |
| 草稿起点与替换提示 | [手机页面](evidence/card-features-2026-11-18/mobile-draft-choice.png) |
| 灯城三作品预览 | [390px iframe](evidence/card-features-2026-11-18/mobile-city-preview.png) |
| 新卡更新与深色主题 | [手机页面](evidence/card-features-2026-11-18/mobile-update-dark.png) |
| QR、PNG 与下载/保存提示 | [手机弹窗](evidence/card-features-2026-11-18/mobile-share-dialog.png) · [桌面弹窗](evidence/card-features-2026-11-18/desktop-share-dialog.png) |
| 实际导出结果 | [PNG 文件](evidence/card-features-2026-11-18/downloaded-share-poster.png) |

## 验证边界与集成依赖

- 真实手机扫码、Safari/微信内置浏览器长按保存、系统文件分享及真实 Clerk 登录后回跳尚未执行。现有回跳自动测试通过不等于这轮真人登录验收。
- 初次 Chrome 控制连接超时，后续使用 IAB 完成本地流程与尺寸验证。iframe 内普通下载事件监听超时，工具提示不支持嵌入框架 Blob 下载；在顶层页通过浏览器下载链接工具取得 PNG。不能据此声称所有浏览器的普通下载点击都已通过。
- 浏览器安全策略阻止“打开原图”的 Blob 页面导航，未绕过。回退入口、同源生成图及说明已实现，导航和长按保存仍待真人验证；不是站点被判定不可用。
- “TryMe｜名片接口与 badcase 排查”聊天 `01a1f09a-160d-7a91-93d4-fe7879e79cc5` 的文档记录了 C01（工作台草稿提示未接线）与 C02（编辑后绕回旧预览）。本次只读了解，没有替它宣称复现，也没有修改 `renderCards` / `invalidatePreview`。这些共享行为需在合并前与该聊天的最终补丁对齐；本 PR 的起点确认自身会清除旧预览。
- 同一诊断聊天另在推进“只更新封面并保留作品版本/说明”的独立能力及模板缩略图。这里的“更新名片”是重新选作品并以当前版本制作新卡，两者语义不同；集成时需保留各自明确文案，不能把更新封面改成自动升级作品版本。
- 上传聊天将重写 `renderPublished`；本 PR 仅改成功页底部 CTA 为 `#/cards/me?addWork=<work.id>`，合并时把该入口接到它最终的成功页。没有宣称新私有媒体上传链路已经验收。

## 共享文件审阅范围

- `public/site.js`：新增模块 import；`renderPublished` 底部 CTA；`renderBuilder` 的来源路由分支与预览说明；`saveCard` 仅按钮文案；`renderCard` 的更新链接。保存请求和 API 契约未改。
- `public/card-workspace.js`：当前卡更新链接及译文；未改模板缩略图实现。
- `public/public-card.js`：增加共用分享入口；`lib/funtrack/public-sharing.mjs` 仅给公开页 shell 加载现有 `experience.css`，DTO/鉴权/路由不变。
- QR vendor 固定 `qrcode-generator@2.0.4`，保留许可证头；`npm run vendor:qrcode` 可重建，测试逐字节比较。`jsqr@1.4.0` 只用于独立解码测试，两者均为开发依赖；线上使用 vendored ESM。

按照 `docs/collaboration-handoff.md` 的“由另一位合作者看过变更后合并”约定交付审阅，不自行合并或部署。
