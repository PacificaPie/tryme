# Funtrack 独立测试站部署记录

2026-11-16（America/New_York）。按用户确认，先用 Cloudflare 临时域名和 Clerk development 实例，供不持有 ChatGPT 账号的朋友测试。此为 staging，不是正式生产站。

站点：https://funtrack-staging.zhayizha-pacificapie.workers.dev/site

## 实际发布的资源

- Cloudflare 账户：`26ecbb83a9773e88121606953aeca69f`。
- Worker：`funtrack-staging`；部署版本：`0d9fd383-bb8c-4574-a045-d8c7a3c7334d`。
- staging D1：`69196d4d-4dac-4cf4-b2b2-a04a7f22f078`；R2 bucket：`funtrack-staging`。
- Clerk app：`app_3MDOOvzzTsVju7zWvc0C1rRU9og`；development instance：`ins_3MDOOs6bu4DAkAP7qGOSVbYazA1`。
- 另已创建空的 production D1：`106c5ea7-2c17-44ea-93f5-5383168365c0`，尚未绑定正式站。两库各应用 7 个已有 schema 迁移。

用户亲自完成 Cloudflare R2 开通和 Clerk CLI 授权。服务端密钥通过 stdin 写入 Worker Secret；本机副本为忽略且权限 0600 的 `.env.clerk-staging.local`。不把密钥写入公开配置、Git 或部署记录。

登录配置为 Google 或邮箱验证码；注册需验证邮箱。测试账号身份属于独立 Clerk development 实例。未创建常驻 GitHub 构建器，页面会显示仓库构建离线。

## 验收结果

真实公网浏览器验收使用 Clerk 官方保留测试邮箱与测试验证码，不发送真实邮件，也不借用 ChatGPT 登录。通过：

- 未登录页面、注册、退出、已有账号重新登录、刷新后保留会话。
- 从发布页面进入登录，成功后准确回到 `/site#/publish`。
- 新用户 Feed、创作中心、名片的空态。
- 本地 HTML 和封面上传到云端，作品成功发布。
- 游戏 iframe 加载、进入游戏内部、全屏/退出全屏且保持进度、退出试玩。
- 选作品 → 卡中展厅模板 → 预览 → 保存 → 展开 → 进入展厅。
- 上传 v2、v2 预览试玩、回滚 v1；两版本均保留，作品 UUID 未变。
- 回滚后页面刷新仍为 v1；保存的名片始终固定于 v1。

测试作品：`6152ebf5-f101-46cb-beb8-7c1cea799bf1`（隔窗有雨 · 部署测试）。

| 项目 | 实际结果 |
| --- | --- |
| v1 | `3ae68d14-9e12-4970-aa0d-cd57222b313f` |
| v2 | `58096d20-500a-4bbf-96af-38223e6f579f` |
| 回滚后当前版本 / revision | v1 / 3 |
| 名片 | `71160f2c-1946-4d96-a85c-bfdaf5940fe8`，指向 v1 |
| v1 文件 | 2,258,639 bytes，与本地原 HTML 逐字节一致 |
| v1 SHA-256 | `bb9403bf8f3616e5662e5f15e6540d693d342fd476e18979786479c82b003fc5` |
| v2 SHA-256 | `e83c1e3e3e1ff84ffbc09b03d583cc5ba0e7cc1f7ba452a015511855d896e751` |
| 封面 | JPEG，52,054 bytes，R2 可读取 |

v2 仅在测试副本末尾增加 HTML 注释以验证版本链路，原游戏文件未修改。数据库保留发布和回滚操作记录、首次试玩与名片浏览事件。未对旧 Sites 的历史数据进行写入。

未登录及伪造 `oai-authenticated-*` 请求访问 `/api/me`、`/api/works` 均返回 401；公开 `/api/auth/config` 只返回公开配置。真实邮箱投递、真实 Google OAuth、自然会话过期和多设备测试尚未完成，需测试者使用自己的账号确认。

## 代码与安全验证

186/186 单元测试、类型与脚本检查、`git diff --check` 通过；Sites 与独立构建通过，staging 实际产物通过预检和 Wrangler dry-run 后发布。

定向升级 Next、React/RSC、Zod、Sharp、Vite 等依赖并修复 Zod 协议兼容。生产依赖审计为 0；全依赖审计剩 9 项（7 moderate、2 low），无 high/critical。剩余位于构建/本地开发工具或当前未调用的 OG/Satori 链路；不能据此保证未来新增路由不受影响。

原始日志、数据库只读校验、R2 校验副本、截图保存在忽略目录 `.preview/cloud-deployment/`；依赖审计在 `.preview/dependency-audit-after-*.json`。截图：`独立站-全屏试玩.png`、`独立站-卡中展厅.png`。

## 边界与后续

- 测试站不依赖本机运行，网站、数据库和游戏文件均在 Cloudflare 云端。
- 正式域名、Clerk production 配置及生产用户验收仍未完成。测试实例的账号/数据不自动变为正式数据。
- 旧 Sites 站点、作品、名片、统计均保留原处；本轮没有迁移或覆盖。完整迁移需要原始 R2 导出及经过验证的身份归属关联，详见 [迁移审计](./sites-migration-plan.md)。
- staging 已有测试作品，未来不能当空库导入旧数据，也不能为迁移擅自清空。
- 今晚建议测试顺序：用自己的账号登录 → 上传单 HTML（≤8 MiB）和封面 → 试玩 → 生成名片 → 更新版本/回滚。GitHub 仓库构建暂不作为可用测试路径。

重复部署命令见 [独立部署说明](./independent-deployment.md)。

## 后续真实账号验收

用户登录后，已从真实 Chrome 完成本地 HTML、GitHub blob/raw HTML、已部署网站、多文件 GitHub 仓库的发布与试玩。仓库使用一次性隔离 runner 验收，不代表常驻云构建已上线。新增四件标记测试作品，原测试作品、版本及文件一致性通过只读复核。修复与最新部署记录见 [上传验收](./upload-verification-2026-11-16.md)。本节补充上文首次部署时尚未执行的项目，不将历史测试账号验收改写为真实用户证据。

## 后续云构建上线

同日晚已将仓库构建迁到 Cloudflare Containers，主站版本更新为 `66384f74-8f5b-4b49-9669-272102e76f96`。本机 runner 全部停止后，真实 Snake 仓库完成云端构建、预览、发布与正式试玩；取消、超限与资源回收亦已实测。上文“构建器离线”和“一次性本机 runner”描述保留为历史阶段，当前状态以 [云构建部署与验收](./cloud-builder-deployment-2026-11-16.md) 为准。原 Sites 未改动。

## 后续发布与收录规则上线

主站更新为 `28d56664-a51c-4849-94da-bcbe916688d4`，staging 新增第 8 个迁移 `0007_work_publication_controls.sql`；production 库未应用该迁移。新增同作者精确去重、Feed 隐藏/恢复、人工收录与管理员入口。已用新增测试作品完成重复上传、v1→v2、历史文件去重、审核进入 Feed、隐藏与恢复；原六件作品、七个版本、旧名片和历史事件逐字段未变。完整记录见 [发布控制部署与验收](./publication-controls-2026-11-16.md)。云构建器保持原部署。
