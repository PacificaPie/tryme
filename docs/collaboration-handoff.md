# Funtrack 协作开发交接

更新日期：2026-11-17。本文面向接手代码的合作者；部署是否已经完成，以对应环境的实际验收记录为准。

最新导入限额与仓库成品支持见 [2026-11-17 导入验收](import-limits-2026-11-17.md)：HTML 16 MiB、仓库压缩 64 MiB／解压 256 MiB／单文件 32 MiB。非 Vite 仓库可直接导入自包含的 `dist/index.html` 或根 `index.html`；《隔窗有雨》的真实仓库已在 staging 导入为 ready，并通过游戏预览交互验收。压缩、解压、单文件与最终产物超限分别提示。

最新创作者主页、关注、名片工作台与拖拽头像裁切已部署到 staging：[方案与验收](creator-home-2026-11-17.md)，463 项测试，部署版本 `0850a3d4-5b03-4d4f-8013-f9dff91420be`。顶栏保留「名片」工作台，仅管理自己的名片并探索模板；个人主页和关注列表从头像菜单进入。**名片的姓名、简介、身份、网址和头像实时读取个人资料；模板、签名、选片及作品版本保留保存内容。** 本次修正读取投影，无新增迁移；后续开发勿再把个人身份固定为名片快照，并保留头像所有权与账号／路由隔离。

后续界面修整已部署到 staging：菜单浮层、名片删除/分享与动效见 [创作者操作验收](creator-actions-2026-11-17.md)，含迁移 `0012`、365 项测试及当前部署 ID。以下封面与协作记录保留其原有提交与验收时间。

此前封面验收的应用代码提交为 [`b7adba1`](https://github.com/PacificaPie/funtrack/commit/b7adba1)，staging 部署为 `13c9a469`；359 项自动测试通过，[GitHub CI 44028978849](https://github.com/PacificaPie/funtrack/actions/runs/44028978849) 已成功。既有作品补封面与新 HTML 无封面发布均已由云端生成真实开屏，见 [验收记录](interface-validation-2026-11-17.md)。

## 先打开哪里

- 应用：`/site.html#/feed`（Cloudflare 会将静态 HTML 地址规范化为 `/site`）。
- 私有代码仓库：[PacificaPie/funtrack](https://github.com/PacificaPie/funtrack)。仓库已建立并推送；尚未发送合作者邀请，接手前需由仓库所有者按合作者 GitHub 用户名授予权限。
- 已有独立测试站：[Funtrack staging](https://funtrack-staging.zhayizha-pacificapie.workers.dev/site)。它使用 Clerk development 实例，不要求 ChatGPT 账号。
- 新公开名片入口：`/c/<cardId>`。本轮实现为免登录读名片、封面和展厅；试玩进入登录，再回到该名片保存的作品版本。公开页不创建试玩会话或匿名事件。
- 本轮界面：[界面系统记录](interface-system-2026-11-17.md)。分享边界：[公开名片方案](public-card-sharing-plan.md)。部署步骤：[独立部署](independent-deployment.md)。

旧 `README` 的 Sites 验收段、`wireframe.html` 和早期 prototype 是历史资料。当前上传 HTML 限制为 **16 MiB**，名片有 5 个模板；不要从历史的 1 MiB / 两模板说明推导当前行为。

## 第一次在自己的电脑运行

需要 Node.js ≥22.13；目前本地检查使用 Node 22.22.0、npm 10.9.4。克隆仓库并进入仓库根目录后执行：

```sh
npm run install:ci
npm run check
npm test
npm run build:standalone
```

安装依赖需要 npm 网络或已有缓存；后面三步不需要 Cloudflare/Clerk 账号、云端密钥或部署权限。`build:standalone` 默认读取本地模板 `wrangler.standalone.jsonc`，只生成 `dist-standalone/`。它不发布、不创建云资源、不执行数据库迁移。不要在同一工作目录同时跑不同目标的 build。

初始化独立的本地 D1，再启动页面：

```sh
node scripts/standalone.mjs migrate-local
npm run dev:standalone
```

本地地址是 `http://127.0.0.1:8787/site.html#/feed`，D1/R2 模拟状态保存在 `.preview/standalone-state/`。本地数据与 staging 云数据不同；刚建的本地库没有测试站作品，也没有可直接查看的旧名片。

**无登录配置不等于可完整试玩。** 默认模板没有 Clerk key：静态页面可打开，`/api/auth/config` 为 `configured:false`，登录和受保护 API 无法完成。完整本地注册、上传、试玩需合作者自己的 Clerk development 配置，或经项目负责人安排的测试实例权限。将本地 `APP_ORIGIN` 保持为精确的 `http://127.0.0.1:8787`，在所选本地配置中填写公开的 `CLERK_PUBLISHABLE_KEY`；`CLERK_SECRET_KEY` 由 `.dev.vars` 或安全环境变量提供。密钥不要进入 Git、聊天、URL 或前端文件。

仓库的 `npm run dev` / `npm run build` 仍是原 **Sites** 目标，使用另一套入口、绑定和本地身份机制。它们不是独立 Clerk 登录的替代验收。新开发默认选择带 `:standalone` 的命令。

## 目录分工

| 范围 | 主要目录/文件 | 修改时一起检查 |
| --- | --- | --- |
| 登录后的产品页面 | `public/site.js`、`site.html`、`discovery.js`、`analytics.js`、`versioning.js`、`work-edit.js` | 路由、加载/空态、移动端、语言切换、返回位置 |
| 组件样式与动效 | `public/theme.*`、`experience.*`、`surface.css`、`cards-flow.css` | 语义颜色 token、浅/深/系统主题、键盘焦点、减少动态效果 |
| 名片与公开分享 | `public/card-templates.js`、`public-card.*`、`public-card-links.js`、`gallery/`、`collection/`、`app/c/` | 固定快照、公共封面、3D 握手/重试、登录后试玩回跳 |
| API 与业务 | `app/api/`、`lib/funtrack/` | 所有权、白名单 DTO、输入限制、幂等和状态转换 |
| 数据结构 | `db/schema.ts`、`drizzle/` | 只追加迁移、已有记录、版本/metadata/名片引用 |
| 身份与部署 | `worker/standalone.ts`、`standalone-auth.mjs`、`wrangler.standalone*.jsonc`、`scripts/standalone*` | 精确 origin、目标环境、资源绑定和静态路由优先级 |
| 公开仓库构建 | `cloud-builder/`、`build-service.ts`、`scripts/repo-builder.mjs` | 不可信代码隔离、任务状态、构建超时、产物约束 |
| 自动封面 | `lib/funtrack/auto-cover-service.mjs`、`auto-cover-capture.mjs`、`public/auto-cover.js`、`worker/standalone.ts` | Browser Run 隔离、Cron/D1 任务、预算、手动封面优先、旧快照不变 |
| 自动检查 | `tests/`、`examples/verify.mjs` | 行为测试与真实浏览器/云端验收的区别 |

`public/site.js` 仍是共享入口。两个人开发时尽量按模块分工；需要同时改它时先约定函数范围，把可独立逻辑抽到已有或新的小模块。不要把上传游戏代码并入可信页面脚本。

## 云端、本地与登录各负责什么

| 组件 | 当前职责 | 本地替代/限制 |
| --- | --- | --- |
| Cloudflare Worker | 网站静态资源、API、Clerk 服务端身份校验 | Vite/Miniflare 本地运行；本地模板不能直接当正式部署配置 |
| D1 | 作品、版本、metadata、名片快照、互动、统计和构建任务 | `.preview/standalone-state/` 中的模拟数据库 |
| R2 | HTML/构建产物、封面等二进制对象 | 同一独立本地状态目录；不是电脑文件夹直接对公网暴露 |
| Clerk | 注册/登录/会话；业务作者 ID 为 `clerk:<userId>` | 完整登录仍需真实 development 实例及配置 |
| Cloudflare Containers 构建器 | 通过私有服务绑定执行公开仓库构建任务 | 普通前端开发与 CI 不启动 Docker，不验证真实云容器构建 |
| Cloudflare Browser Run | 通过 `BROWSER` 绑定在隔离浏览器中截取托管 HTML 的开屏 | 默认本地配置未连接云浏览器；不能仅靠本地页面证明截图可用 |
| Worker Cron + D1 截图任务 | 每分钟触发 `scheduled`，领取 D1 中待处理的截图任务；成功后写 R2 和新 metadata | 发布不等待截图；自动测试不替代真实 Cron/Browser Run 验收 |

staging 使用 `wrangler.standalone.staging.jsonc`；正式域名/Clerk production 是另一套配置与验收工作。不要把 staging 数据库或 R2 直接填进本地模板，也不要为了测试修改共享 staging 作品。测试新建自己的作品并标明测试用途。

自动封面迁移 `0011_automatic_work_covers.sql` 已应用，功能由 `FUNTRACK_AUTO_COVER_ENABLED` 和 `BROWSER` 绑定控制。任务以 D1 状态和租约协调，截图不计玩家会话，不自动点击游戏；外链不截图。每个版本最多两次尝试，并有 UTC 日/月预算；达到预算会排队等待，前端停止自动轮询并保留手动刷新和上传。已有封面、后续人工封面及名片历史快照不能被后台任务覆盖。两条真实截图任务均一次成功，封面已落库并显示；新 Cron 传播会暂时排队，不能据此承诺发布后立即有图。

## 每个 PR 的工作方式

1. 从最新 `main` 建功能分支，例如 `feat/public-card-polish` 或 `fix/upload-feedback`。一个 PR 解决一个可说明的问题。
2. 在 PR 中写清用户触发方式、改后的行为、检查结果、是否涉及迁移和仍未实测的地方；截图可用于 UI 对比，但不替代流程验证。
3. 本地至少执行 `npm run check`、受影响测试及提交前 `npm test`。涉及打包、路由、依赖或资源路径时执行 `npm run build:standalone`。
4. 由另一位合作者看过变更后合并。部署由项目负责人按显式环境配置执行；合并本身不会部署。

`.github/workflows/ci.yml` 在 PR、`main` push 或手动触发时执行安装、检查、测试和本地目标构建。它只有仓库读取权限，没有 Cloudflare/Clerk secrets，也不做迁移或部署。[首次远端 CI](https://github.com/PacificaPie/funtrack/actions/runs/44028978849) 已成功；这仍不包含真实登录、上传、Cron 或 Browser Run 验收。工作流使用官方 [checkout](https://github.com/actions/checkout) 和 [setup-node](https://github.com/actions/setup-node)，固定当前核实的 v6 commit。

忽略目录包括 `.env*`、`.dev.vars*`、`.preview/`、`.wrangler/`、`.sites-runtime/`、`node_modules/` 和构建产物。提交前查看暂存差异；公开的 Publishable Key/资源 ID 与服务端 Secret Key 不是同一种信息。

## 不可破坏的契约

- **迁移只追加。** 不改已部署迁移来“修正历史”。同时更新 schema、迁移文件和必要的迁移元数据；在新的本地数据库及已有测试数据上验证。远端迁移由负责人先核对迁移账和目标资源后执行。
- **作品 ID 保持稳定。** 更新/回滚改变当前版本指针；已有版本、metadata、历史统计和名片引用继续保留。归档用于移出日常管理列表，不是删除历史数据。
- **旧名片固定快照。** 用保存时的作品版本、说明和封面，不能改成读取 live/current 数据。公开 DTO 不暴露 authorId、构建凭据、游戏资源路径或内部存储 key。
- **分享可读不等于匿名试玩。** 只公开指定名片及其封面的 GET/HEAD；游戏、会话、事件、上传和创作者 API 继续鉴权。公开页面不请求私有 API、不记录匿名 `card_view`。
- **部署要包含动态公开路径。** `/c/*` 与 `/api/public/cards/*` 必须到 Worker；不能被 static asset fallback 吞掉。本轮现有 assets 策略下已实测 `/c` 返回 200，无需新增 Worker-first 覆盖；后续改变 fallback 策略仍须复核动态路由与匿名请求。
- **可信展厅与不可信游戏分离。** gallery/collection 只使用作品资料和封面；上传游戏走隔离 iframe/CSP。明暗主题不能通过反相滤镜改变作品图像或游戏画面。
- **数据以服务端口径为准。** 不能把入口点击当完成、把外链访问推断为真实游戏时长，或用生成的数值填补没有采集的指标。

## 当前进展与下一步

| 状态 | 范围 | 证据/边界 |
| --- | --- | --- |
| 已有 staging 实测记录 | Clerk 测试登录、8 MiB HTML、版本更新/回滚、公开仓库云构建、推荐排序与曝光 | 见部署、版本及推荐验收文档；不代表换正式域名后无需复测 |
| 本轮已实现并有自动检查 | 明暗/系统主题、组件与动效、聚合数据页、5 种名片模板、可恢复归档 | 提交 `b7adba1`、359 项自动测试及远端 CI 通过，部署 `13c9a469`；真机、跨浏览器仍需扩大覆盖 |
| 本轮公开分享已上线并实测 | `/c`、公开白名单 DTO/封面、免登录展示、登录回固定快照 | 早先已通过匿名 editorial/dialog、Clerk 取消返回、展厅展开/进入、filmstrip 连续切换及固定 v1 试玩；`13c9a469` 上 Chrome 再次首访旧公开 fold，真实 3D 无需手动重试即显示；匿名 game 和 api/me 的鉴权边界已验证 |
| 保留观察项 | 旧登录后管理页的 fold 名片首次加载偶发超时 | 历史验收中出现过，重载后真实 3D 正常；现已补 5 秒无 ready 时的一次有界自动恢复，15 秒仍保留手动重试。公开页首访通过不等同于所有浏览器/管理页首载均已证明正常 |
| 已部署并通过两条云端实测 | 托管 HTML 发布后自动截取开屏封面 | Snake 补封面、Prism 无封面发布均 ready，真实图片已查看，metadata 新增且游戏版本不变，截图没有增加会话或事件。保留人工上传，不阻塞发布；后续监控失败率和实际账单 |
| 方案阶段 | 微信登录 | 见 [可行性调研](wechat-login-feasibility-2026-11-17.md)；没有可用微信应用、凭据或已验收登录链路 |
| 后续工作 | 正式域名、Clerk production、数据/账号迁移、共创、收费 | 未因本轮协作准备而自动完成 |

明天优先以一个全新测试账号走登录 → 上传 → 试玩 → 更新/回滚 → 名片生成/分享；另用退出登录的浏览器查看分享，再登录试玩并检查仍是快照版本。其次复核归档/恢复、空作品账户、手机尺寸和键盘返回。不要在这轮引入收费、匿名试玩或共创权限模型。

零作品页面当前采用真实 renderer 配合隔离测试数据，不能记成真实新账号全流程通过。6 件早期重复/验收作品与新 Prism 验收作品均已归档；最终 13 件作品、16 个版本、3 张名片、7 件归档、6 件 Feed 展示，当前作者活跃列表 5 件。3 张名片快照哈希与本轮前基线一致。

## 进一步阅读

- [独立部署与本地配置](independent-deployment.md)
- [真实云构建](cloud-builder-deployment-2026-11-16.md) · [版本更新验证](versioning-validation.md)
- [推荐实验与验收](recommendation-experiment-2026-11-16.md) · [数据契约](analytics-contract.md)
- [公开分享边界](public-card-sharing-plan.md) · [微信登录可行性](wechat-login-feasibility-2026-11-17.md)
