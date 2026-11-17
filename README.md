# Funtrack

新合作者请先看 [协作开发交接](docs/collaboration-handoff.md)：包含环境安装、目录分工、分支/PR、迁移与名片快照契约，以及已完成和待验收的边界。当前独立站使用 Cloudflare Worker + D1 + R2 + Clerk；配置见 [独立部署](docs/independent-deployment.md)，本轮分享入口见 [公开名片方案](docs/public-card-sharing-plan.md)。

```sh
npm run install:ci
npm run check
npm test
npm run build:standalone
```

这些检查和本地目标构建不需要云端密钥；完整本地登录、上传和试玩仍需配置 Clerk development 实例。GitHub CI 只检查、测试和构建，不部署。

**以下保留原 Sites 阶段的历史说明与验收证据。** 其中 1 MiB、两模板、owner-only、旧登录与初始迁移命令不再代表当前独立站；当前 HTML 上限为 8 MiB，名片有 5 种模板。新开发按上方协作交接操作，历史推荐验收见 [2026-11-16 记录](docs/recommendation-experiment-2026-11-16.md)。

发现作品、上传并试玩小游戏、留下反馈，以及用自己的作品制作可分享名片。当前应用入口是 `/site.html#/`，已经连接服务端 API、D1 和 R2；`/wireframe.html` 及早期前端演示仅保留作设计参考，其中的身份和统计不属于当前应用数据。

## 本地运行

需要 Node.js ≥22.13。首次安装、构建并初始化本地数据库：

```sh
npm install
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_dapper_pet_avengers.sql
```

这条初始迁移只对新的本地数据库执行一次；已有表时不要重复执行。随后启动开发预览：

```sh
npm run dev -- --hostname 127.0.0.1 --port 8766
```

打开 `http://127.0.0.1:8766/site.html#/`。本地便携开发模式的登录入口 `/signin-with-chatgpt?return_to=/site.html` 使用测试身份；它不验证生产 ChatGPT 登录。生产身份由 Sites 注入，当前功能均要求登录，分享链接的访问范围仍受站点 audience 限制。

本地 D1/R2 状态保存在 `.wrangler/state`；它与云端数据分开。`.openai/hosting.json` 声明 `DB`、`BUCKET` 绑定；生产上传、文件读取及 D1 持久化已通过下述验收。

## 当前功能与限制

- **发布：** 自包含 UTF-8 `.html` / `.htm`，最多 1 MiB；可选 PNG/JPEG/WebP 封面，最多 2 MiB。脚本、样式和图片应内联，外部脚本、网络 API、字体、多文件与 ZIP 游戏包不在支持范围。也可发布 HTTP(S) 外链。
- **试玩：** 上传 HTML 由 `/game/:versionId` 返回，响应本身强制 CSP sandbox，嵌入 iframe 也不允许 `allow-same-origin`。可信的 Three.js 名片展厅使用另一套同源消息协议。
- **反馈与数据：** 发布、反馈和事件保存在 D1，游戏文件及封面保存在 R2。创作者只能查询自己作品的统计和收件箱；草稿与尚未发送的内容另保存在当前浏览器。
- **名片：** 从 1–30 件自己的作品选择、排序并预览，提供白墙画展和卡中展厅。保存会追加不可变快照，包含作品版本及封面引用；修改草稿或保存另一张名片不会改动旧链接。没有 AI 请求，也没有作品编辑、删除或替换版本接口。

`examples/` 和 `/examples/` 提供三个明确标注为本地测试作品的单文件游戏及封面。最快验收使用 `tiles.html` + `tiles.png`：开始后依次点击左上、正中、右下，三步终局为 1000 分。完整操作见 [示例说明](examples/README.md)。ZIP 仅用于下载，上传时仍选择单个 HTML。

## 数据含义

统计使用已入库记录和服务端接收时间，日期按 UTC 分桶。作品页访问不是独立访客数；“开始试玩”表示收到 `play_start` 的会话数。正常 SDK 在首次可信输入时上报开始，游戏调用 `window.funtrack.complete({score,label})` 上报终局，退出只记 `session_end`。完成事件不等于通关，后台停留也不自动记为完成。

这些都是**客户端上报事件**，不能证明真人、认真试玩或无作弊。上传的游戏可自行发送消息，来源检查和入库回执不是防作弊认证。事件在页面存活期间重试并由数据库去重；关页使用 `keepalive` 尽力送达，内存队列不会保证断网关页后的补报。

外链只记录作品页访问及出站点击；试玩次数保持未知，界面显示 `—`。不据此推断外部游戏开始或完成。

## 验证状态

截至 2026-11-16：

| 层级 | 已有证据 / 尚待验证 |
| --- | --- |
| 本地 API | Miniflare 的真实本地 D1/R2 集成检查通过 10 项：上传与重试、失败不发布、隔离响应、事件去重、会话及数据所有权、反馈、不可变名片、统计、外链未知。运行报告在 `.preview/local-api-integration.json`。 |
| 示例游戏 | 自动检查覆盖自包含文件、大小、键盘/点击终局、单次完成、手动结束、隐藏暂停及资源清理；不是浏览器实测。 |
| 当前应用本地浏览器 | 已实际上传 tiles HTML + PNG，刷新后仍可读取；三步完成 1000 分并发送反馈；重玩未输入即退出后，数据页开始/反馈/访问各为 1；fold 名片生成、保存、展开 3D 及图片内容正常。 |
| 生产 | Sites 真实身份 Pacifica Zhang 登录；实际上传 Salt Run、Orbit、九宫格，D1 记录与 R2 HTML/封面可读。线上九宫格键盘三步完成 1000 分、反馈入库；fold 名片保存、展开、旋转、进入 Orbit 并返回保持展开通过，360px 无水平溢出。 |

生产验收对应提交 `3932837db3c6ba6a186497d44f52702cde1bbcae`，部署 `appgdep_6afb69617f048191a3a6bb5019aa7961` 状态为 `succeeded`。原生 D1 查询确认 `work_view`、`play_start`、1000 分 `game_complete`、`session_end` 及实际反馈；数据页刷新后访问为 2（九宫格、Orbit）、开始为 1、反馈为 1。名片 `6bf58d6f-daa9-4502-933c-121044a18899` 的 D1 快照含三件作品的正确版本 ID。

本轮构建、11 项自动测试及 10 项 API 集成检查通过。生产保持 owner-only，独立账号、多用户公开访问、跨浏览器和真机表现未测试；360px 检查是浏览器视口检查。旧 wireframe 的证据不自动继承为当前版本证据。生产截图保存在 `.preview/production-card-closed.png`、`.preview/production-card-open.png`、`.preview/production-data.png`；详细边界见 [验收记录](docs/real-data-plan.md)。

常规检查：

```sh
npm run check
npm test
node examples/verify.mjs
```

重跑 API 集成检查时，先重新构建，在一个终端启动编译后的本地 Worker，再于另一个终端运行测试：

```sh
npm run build
npm start -- --port 8767
```

```sh
FUNTRACK_TEST_URL=http://127.0.0.1:8767 node tests/integration/api.mjs
```

该脚本仅允许 loopback 地址，为隔离的测试身份创建本地记录，并直接发送事件验证持久化与去重；它不模拟真人浏览器输入，也不应对生产环境运行。

## 代码与契约

- `public/site.html`、`public/site.js`：当前应用、表单、名片与事件队列。
- `app/api/`、`app/game/`、`app/media/`：API 和隔离资源响应。
- `lib/funtrack/`：授权、输入约束、存储与统计；`db/schema.ts`、`drizzle/`：D1 表与迁移。
- `public/gallery/`：复用本地 Three.js 的可信名片渲染器；不执行上传游戏代码。
- [API 契约](docs/api-contract.md) · [真实数据实现与剩余验收](docs/real-data-plan.md)。
