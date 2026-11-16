# 真实数据实现与剩余验收

更新于 2026-11-16。当前仓库已经实现上传、隔离运行、事件入库、反馈、名片快照与创作者查询。本地 API、浏览器及 owner-only 生产闭环已验证，具体证据和未测范围见文末。运行命令见 [README](../README.md)，字段细节见 [API 契约](api-contract.md)。

## 已实现的数据路径

1. 创作者用 multipart 表单上传单个 HTML 和可选封面。文件先写 R2，作品与版本再由 D1 batch 一起提交；提交重试使用幂等键。对象键按新版本 UUID 隔离。异常时先确认数据库是否已提交，再清理本次未被发布引用的对象；查库失败宁可留下孤立文件，不删除可能已发布的文件。
2. `/game/:versionId` 注入最小 SDK 并返回带 CSP sandbox 的 HTML，直接打开也受响应头隔离。父页面创建会话后用不含 `allow-same-origin` 的 iframe 运行它；会话令牌只留在父页面。
3. SDK 观察首次可信输入，父页面发送 `play_start`。游戏真实终局可调用 `window.funtrack.complete({score,label})`；正常前端只在已开始的会话接收一次 `game_complete`。退出或导航产生 `session_end`，未开始也可结束。关闭页面和切后台不被当作完成。
4. D1 保存事件与反馈，创作者界面重新查询服务端记录。R2 保存 HTML 与封面；浏览器里的草稿不是服务端发布记录。
5. 名片保存时复制作者展示信息、选中的作品内容、顺序、版本及封面引用。保存另一张名片会产生新 ID，旧名片保持原快照。由旧名片进入作品时只读取该快照，加载失败不静默换成最新作品。

`.openai/hosting.json` 已声明 D1 `DB` 和 R2 `BUCKET`；表定义为 `ft_profiles`、`ft_works`、`ft_work_versions`、`ft_cards`、`ft_play_sessions`、`ft_events`、`ft_feedback`。本地 Miniflare 持久化目录为 `.wrangler/state`，与生产存储分开。生产资源已通过实际上传、D1 原生读表及 R2 文件读取验收。

## 上传、授权与接口

上传仅支持 UTF-8 自包含 `.html` / `.htm`、`text/html`、最多 1 MiB；可选封面为 PNG/JPEG/WebP，最多 2 MiB，检查 MIME 与文件签名。multipart 总请求最多 4 MiB。外部脚本、字体、网络 API、多文件依赖和 ZIP 游戏包未支持。名片支持 1–30 件自己的作品及 `wall` / `fold` 两种模板，不调用 AI。

所有接口要求 Sites 注入的用户身份；POST 还验证准确同源 Origin 和 CSRF 标识。作品数据、反馈收件箱和名片选作进行所有权校验，会话同时绑定用户、作品版本、令牌和一小时有效期。线上访问范围沿用站点 audience；本地开发登录是假身份，不能替代生产身份验收。

| 接口 | 用途 |
| --- | --- |
| `POST /api/works` | 幂等发布 HTML 或 HTTP(S) 外链及版本 |
| `POST /api/sessions` | 为托管 HTML 的指定版本创建会话 |
| `POST /api/sessions/:id/events` | 接收 `play_start`、`game_complete`、`session_end`，每批最多 20 条 |
| `POST /api/events` | 作品页访问、名片访问、出站点击 |
| `POST /api/feedback` / `GET /api/feedback` | 保存反馈与查询当前作者收件箱 |
| `GET /api/analytics` | 当前作者作品统计，支持最近 1–30 天及单件作品筛选 |
| `POST /api/cards` / `GET /api/cards/:id` | 保存及读取不可变名片快照 |

事件按用户/客户端事件 ID、会话/序号、会话/类型建立唯一约束，重试不重复计数。写入回执的 `id` 是服务端记录 ID；`clientEventId` 与请求对应，用于清除客户端队列；`duplicates` 返回客户端事件 ID。视图事件和反馈可明确关联旧作品版本。当前没有作品编辑、删除或替换版本接口。

## 统计边界

- 使用服务端 `received_at` 及 UTC 日期分桶，客户端时长仅供参考。开始试玩按收到 `play_start` 的会话计数，访问按事件计数，反馈按持久化记录计数；不能把它们称为独立真人数量。当前统计按作品聚合，记录保留版本 ID，尚无按版本筛选的分析界面。
- 输入、终局和会话都是**客户端上报**。SDK 的 `isTrusted` 检查可避免正常脚本合成输入误触发，但作者代码与 SDK 在同一 iframe，仍可自行发送消息。来源/会话校验不等于防作弊认证；完成也不等于通关，不应据此兑换积分或声称已验证参与度。
- 退出只产生 `session_end`。示例游戏在 `document.hidden` 时暂停；平台没有证明任意上传游戏都正确暂停，也不会把后台停留自动转成完成事件。
- 页面存活期间重试，数据库负责去重。关页通过 `keepalive` 尽力发送；待发送事件队列在内存中，断网后关页可能丢失，不能承诺最终必达。
- 外链只观察作品页访问及出站点击；`byWork.starts`、`ends` 为 `null`，界面显示 `—`。汇总开始数仅包含可观测的托管游戏，不能推断外链试玩。
- 服务端成功回执证明该记录已被接受，不能单独证明浏览器真的发生了相应操作。接口测试直接提交事件只验证存储和约束。

## 已有证据与下一步

**本地 API 已验证：** `.preview/local-api-integration.json` 记录 10 项检查通过，使用编译后 Worker 与真实本地 Miniflare D1/R2。覆盖身份缺失/跨源拒绝、上传重试、非法文件不发布、游戏隔离响应及封面、事件去重、会话所有权、反馈收件箱、旧名片不变、作者统计和外链未知。测试仅允许 loopback 地址，使用独立测试身份。另对实际发布函数进行内存故障注入，确认“提交成功但回执丢失”“后续查库失败”“确实回滚”三种情况下的 R2 清理策略；这不是云端故障演练。

**示例自动检查已验证：** `node examples/verify.mjs` 检查三份单文件游戏的依赖、体积、终局、键盘/点击操作、手动结束、隐藏暂停和清理。它使用确定性执行环境，不替代真实浏览器输入或服务端收据验收。

**当前本地浏览器已验证：** 实际上传 `examples/tiles.html` 和 `tiles.png`，刷新后仍可读取；进入游戏并三步完成 1000 分，反馈成功；重玩未输入即退出后，数据页开始试玩、反馈、访问各为 1。选作生成 fold 名片、保存并展开 3D，作品图片内容正确。本轮最新构建、11 项自动测试及 10 项 API 集成检查再次通过。本地浏览器使用测试身份，早期 wireframe 检查不自动适用于当前应用。

**生产已验证：** 提交 `3932837db3c6ba6a186497d44f52702cde1bbcae` 的部署 `appgdep_6afb69617f048191a3a6bb5019aa7961` 状态为 `succeeded`。使用 Sites 真实身份 Pacifica Zhang，通过实际文件选择器上传 Salt Run、Orbit、九宫格三件作品；D1 原生读表确认作品记录，R2 HTML 与封面均可正常读取。

线上九宫格以键盘三步完成 1000 分。原生 D1 工具查询 `ft_events` 确认 `work_view`、`play_start`、`game_complete`（score 为 1000，label 为三步全部点亮的终局文字）及 `session_end`，`ft_feedback` 包含实际提交的反馈。数据页刷新后显示访问 2（九宫格和 Orbit）、开始 1、反馈 1。

生成并保存 fold 名片 `6bf58d6f-daa9-4502-933c-121044a18899`，D1 快照包含三件作品及对应的正确 versionId。关闭、展开、旋转、从名片进入 Orbit、返回后保持展开均通过；360px 浏览器视口无水平溢出。截图为 `.preview/production-card-closed.png`、`.preview/production-card-open.png`、`.preview/production-data.png`。

**具体边界：** 生产仍保持 owner-only。独立账号、多用户公开访问、跨浏览器及真机表现未测试；单一账号的实际闭环不构成公开玩家分发、负载性能或可用性研究。上述生产验收不改变客户端上报、外链未知和关页尽力送达的统计边界。
