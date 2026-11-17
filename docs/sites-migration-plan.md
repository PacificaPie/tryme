# Sites → 独立部署：数据迁移审计与后续方案

审计日期：2026-11-16。源 Site：`appgprj_6afb3d21de448191b57481c82d3564a2`，D1 逻辑绑定 `DB`，R2 逻辑绑定 `BUCKET`。

旧站审计只读取了源码与 Sites 数据库工具返回的数据，没有修改旧站生产数据、重写 owner、建立身份桥或复制旧站文件。下面的旧站计数是审计时逐表读取结果，不是同一事务中的备份快照。旧站事件与会话只读取了第一页。后续 staging 核对另见下节。

## 结论与实际阻塞

现有数据结构支持保留作品 ID、全部版本、metadata 快照、名片及历史统计，但现有应用 API **不能完成保真的整站导出**。当前实际阻塞是原始 R2 文件导出通道尚未具备；直接保存试玩页面不能代替原文件备份。

独立 staging 已上线：[funtrack-staging.zhayizha-pacificapie.workers.dev](https://funtrack-staging.zhayizha-pacificapie.workers.dev)。它已有独立 D1/R2，使用 Clerk **开发实例**（`CLERK_TEST_MODE=1`、`pk_test`），根代理已通过真实 UI 注册/登录并发布本地 HTML。staging 不再是空库，但其中是新建测试数据；**旧 Sites 的 11 件作品、版本、卡片和历史数据仍未迁入**。独立 staging 可测试不等于生产 Clerk 身份、正式域名或旧数据迁移已经完成。

### Staging 只读后端核对

核对截止：2026-11-17 02:19 UTC（美东 2026-11-16 晚）。使用 `wrangler.standalone.staging.jsonc` 对 remote D1 执行 SELECT，并通过 remote R2 `object get` 下载原始对象到 `.preview/cloud-deployment/`。全部 SELECT 返回 `rows_written:0`；未上传、删除或修改远端对象，未读取/输出会话 token hash 或秘密。

- D1 的 `d1_migrations` 已有 `0000`–`0006` 共 7 个迁移。
- 当时 staging 仅有 1 件作品：`6152ebf5-f101-46cb-beb8-7c1cea799bf1`，名称“隔窗有雨 · 部署测试”。`source=html`，`revision=1`，当前版本 `v1` / `3ae68d14-9e12-4970-aa0d-cd57222b313f`，`ordinal=1`。current version、current metadata、initial metadata 均指向此作品的记录，metadata 与版本引用同一 JPEG 封面。
- 原始游戏对象 `games/3ae68d14-9e12-4970-aa0d-cd57222b313f.html` 下载成功，与本地 `rain-between-rooms/immersive/dist/隔窗有雨.html` **逐字节相同**：2,258,639 字节，SHA-256 `bb9403bf8f3616e5662e5f15e6540d693d342fd476e18979786479c82b003fc5`；D1 `content_hash` 也是这一值。下载副本为 `.preview/cloud-deployment/staging-rain-v1-3ae68d14.html`。
- 封面对象 `covers/3ae68d14-9e12-4970-aa0d-cd57222b313f` 下载成功：52,054 字节，JPEG 文件头 `ffd8ff`，SHA-256 `207a5b8a26f385c49235c49bdef9abbfad79c56f69ed5c3a14244a727f19d985`。下载副本为 `.preview/cloud-deployment/staging-rain-cover-3ae68d14.jpg`。
- 当时已产生 1 个试玩会话，`work_view`、`play_start`、`session_end` 各 1 条；结束事件包含 `activeMs=24480`。这是这次 UI 测试的记录，不是实际用户规模或留存证据。
- 当时尚无版本操作及卡片记录。根代理随后继续进行版本更新、回滚、名片与其他 UI 验收；上述明确版本/时间的检查不会因后续 `v2` 或 revision 变化失效，但也不据此宣称后续链路已通过。

## 线上数据清单

Sites `read_database_overview` 返回 15 张用户表，无遗漏。以下完整读取的表均返回 `truncated:false`、`truncated_values:0`、`omitted_rows:0`、`next_offset:null`。

| 表 | 审计时记录数 | 必须保留的意义 |
| --- | ---: | --- |
| `ft_profiles` | 1 | 创作者资料与名片默认信息 |
| `ft_works` | 11 | 全部为站内 HTML，当前只有 1 个作品作者；保留当前/初始 metadata、当前版本、revision |
| `ft_work_versions` | 14 | 原始游戏 key、版本序号、说明、来源与封面；其中 3 条有已存 content hash |
| `ft_work_metadata` | 2 | 不可变名称、介绍与封面快照 |
| `ft_cards` | 4 | 全部已保存名片，而不是仅最新一张；每张含 3 件作品快照 |
| `ft_version_operations` | 5 | 更新/回滚记录及幂等键 |
| `ft_work_edit_operations` | 1 | 信息编辑记录及冻结的响应 JSON |
| `ft_feedback` | 1 | 旧版作者收件箱反馈 |
| `ft_comments` | 0 | 评论与回复关系；未来迁移必须保留显式 `seq` |
| `ft_work_likes` / `ft_comment_likes` | 各 0 | actor 与内容之间的点赞关系 |
| `ft_build_jobs` | 1 | 状态 `ready`，含原仓库 commit、产物 key/hash 与构建记录 |
| `ft_build_workers` | 1 | 构建器心跳运行状态，不应当作目标端在线证明 |
| `ft_events` | 至少 26 | 第一页 25 条且 `has_more:true`，尚未遍历完整计数 |
| `ft_play_sessions` | 至少 26 | 第一页 25 条且 `has_more:true`，尚未遍历完整计数 |

数据库目前引用 **29 个不同 R2 key**：14 个游戏、14 个封面、1 个构建产物。这只是引用清单：尚未读取原 bucket，不能据此确认 29 个对象实际都存在，也不能排除未被数据库引用的孤立文件。四张卡的作品封面 URL 都是相对 `/media/…` 路径，保留相同 ID/key 后可在新 origin 使用。

## 为什么不能直接用当前 API 搬迁

- `GET /api/works` 上限 200 且只给当前展示字段；`/api/discover` 可分页，但同样不是原始记录导出。作品的幂等键、request hash 与原始存储 key 不完整。
- 版本历史可由作品作者分页读取，但不暴露全部存储字段；没有列出历史 metadata 或编辑/版本操作原始记录的 API。
- `GET /api/cards` 只列每位作者最新一张，`/api/cards/me` 也只取最新一张。已知 ID 可以读旧卡，但没有完整历史列表。返回还经过 `cardSnapshot` 展示兼容处理；恢复应保留原 `snapshot_json` 字符串。
- 最新卡的选择使用 SQLite `rowid DESC`。正式导出应包含卡的原始 rowid 或明确的每位作者最新卡 ID，恢复时保留顺序；不要假定任意导入顺序等价。当前四张卡的创建时间恰好各不相同，但这不是未来数据的保证。
- `/api/analytics` 是最多 90 天范围内的聚合查询。无法从 PV/UV/时长汇总反推出 actor、事件、会话及固定版本。应迁移原始 events/sessions/social 表，再重新计算相同日期与筛选下的统计。
- `/game/:versionId` 和构建 `/preview` 都先调用 `gameDocument()`，在 HTML 前注入包含当前 origin 的桥接脚本。它们不是 R2 原字节；再次上传会改变内容/hash，并可能重复注入。`/media/:id` 返回封面原 body，可用于有限的封面取回，但不是整桶导出或完整对象元数据清单。
- Sites 数据库工具能只读分页；每页最多 25 行，必须沿返回的 `next_offset` 继续，并检查所有截断标记。它不提供事务快照、任意 SQL、原始 D1 导出或 R2 列表/下载。本轮可见数据较小且已读页未截断，但不能把这种检查当成普遍可靠的生产备份器。

代码依据：`db/schema.ts`；`lib/funtrack/server.ts` 的 GET 路由、`mediaResponse`、`gameResponse`；`rules.mjs` 的 `gameDocument`；`analytics-query.mjs` 的原始事实聚合。

## 身份：保留 canonical app user ID，避免重写历史 owner

当前 `standalone-auth.mjs` 验证 Clerk 后直接生成 `clerk:<subject>`，而原作品/资料使用 Sites 用户 ID。仅复制数据库会导致新账号的“我的作品”、编辑权限与统计查询看不到旧数据。

推荐新增**仅服务端维护的身份关联表**，将已验证的 `(provider, issuer/instance, subject)` 关联到稳定 `app_user_id`。旧用户沿用原 Sites ID；新用户仍可分配 `clerk:<subject>`。Clerk token 验证、实例校验、邮箱验证成功之后，再把 canonical ID 传给现有业务层。不要接受浏览器自报的旧 ID，也不要把客户端请求头作为关联依据。

这样不必改 `ft_works.author_id`、`ft_profiles.id`、名片 JSON 内嵌作者 ID、各表 owner/created_by、历史 actor、幂等约束或冻结响应。统计中 `actor_id <> owner` 的“排除本人”、作者去重与旧点赞状态也能保持原语义。把 owner 改成新 ID 而保留旧 actor 会把以前自己的测试算成其他访客；批量把所有 actor 改为一个账号又会破坏 UV 和历史归因。

关联需有可核验的双方账户控制证据，例如旧 Sites 已登录身份与新 Clerk 已验证会话共同完成的领取流程；当前唯一作品作者也不能只凭同名或同邮箱自动认领。关联记录应保存旧 ID、Clerk instance/subject、目标环境、审核/证明依据、创建时间和撤销记录，并限制一对一关联，防止一个旧作者被多个新账号领取。

**Clerk 开发实例与生产实例不能混用映射。** 使用明确 instance/issuer 和环境命名空间；开发账号、token、关联记录不自动复制到生产。真实生产账号须在生产实例重新验证归属。

应在新账号产生内容之前完成关联。若新账号已经用 `clerk:<subject>` 发布作品或产生互动，切到旧 canonical ID 会隐藏那部分数据；此时需要另行设计有冲突检查的账户合并，不能静默改映射。现阶段不实现身份桥，不写关联记录。

## 最小后续脚本与可逆流程

1. **先打通原始导出。** 若 Sites 提供可用的完整 D1/R2 导出能力，优先使用；目前未验证存在可用的源端 Cloudflare 资源 ID/凭据，不能假定新账户凭据可读取 Sites 管理的资源。否则需要给旧应用部署临时、严格授权、短期有效的只读导出通道：固定表白名单、固定查询、分页与逐对象读取，不提供任意 SQL。导出权限不能仅等同于普通已登录用户。原始 R2 `get()` body 必须直接传输，不经 `gameDocument` 或字符编码往返。
2. **制作 `migration-export`。** 生成包含源 Site、schema/source 版本、截止时间、各表行数/校验值、卡顺序、对象 key/字节数/SHA-256/MIME 的 manifest；数据用完整 JSONL 或受控 SQL 转储，文件按原 key 单独保存。检查所有 JSON、引用、NULL 值、幂等字段及未截断标记。完整备份还需列出整个 R2 bucket；只搬迁 29 个引用对象必须在 manifest 明确这是“业务引用文件集”。导出包含私人资料、会话 hash 与事件，放在受限且不纳入 Git 的位置。
3. **建立一致截止点。** 迁移窗口停止源端写入并停止/排空 builder，形成同一个表与文件快照；保留原站及原存储。仅挡 POST/PATCH 不一定够：现有构建 job GET 路径会执行 `expireBuilds()` 并改状态。需要确保导出期间所有这类副作用也不改变源数据。若不暂停写入，就必须额外实现可靠增量追平与变更日志；现有 schema 没有通用 CDC。
4. **`migration-verify` 先离线检查。** 验证 work→current/initial metadata/version、卡快照中的 work/version/metadata、event→session/version/card、reply→parent 以及全部对象引用。旧版本 `content_hash=NULL` 保持 NULL，不伪造旧记录；对文件重新计算导出包 checksum 用于复制校验。原始 HTML 不执行。
5. **`migration-import` 仅写新空目标。** 校验目标账户/库/bucket与空库断言；使用已有 7 个 schema 迁移，不复制 Sites 的迁移账冒充 Wrangler 的 `d1_migrations`。当前 staging 已有新测试数据，不再满足空库前提；正式迁移应准备独立空目标，或先另行设计并验证显式合并方案，不能清空 staging 或静默覆盖其内容。先复制并核验对象，再按外键顺序恢复数据，保留所有业务 ID、revision、ordinal、时间、JSON 与幂等键；不要通过普通“发布作品”API重建。支持按相同 checksum 重跑，遇到同 ID 不同内容立即停止，不用 `INSERT OR REPLACE` 覆盖。迁移批次清单应单独记录，供删除整个未开放目标或重建独立目标回退。
6. **运行状态另行处理。** 旧 build worker 心跳与租约不能迁为目标在线状态；目标 builder 使用独立配置和凭据重新注册。保存原始历史备份后，目标端应让旧活跃会话失效、撤销旧 lease，防止跨站继续上报/完成任务；变更仅针对运行凭据字段并记入转换清单，不能删除统计所需的 sessions/events。当前源 build 已 `ready`，仍需在正式截止点复查。
7. **映射和验收后才开放写入。** 用经过验证的生产账号建立 canonical ID 关联；对照相同日期、作品、版本与 excludeSelf 的统计，验证原作品路径、旧四张卡、全部历史游戏与封面、更新/回滚、信息编辑、名片生成和新试玩上报。完整文件按字节/hash比较；不能只看封面正常就认定游戏已迁移。旧会话与新会话分开验证，不复用旧 token。

导入顺序可用：profiles → works → versions/metadata → cards → sessions → events；comments 先根后回复，再 likes；反馈、操作历史、build history 在其引用对象就绪后恢复。当前 work 的 current 指针没有数据库外键，仍需离线与导入后主动验证其完整性。评论显式 `seq` 与后续自增行为都要检查。

## 回退与链接边界

开放新站写入之前，保留源端原样、导出包和目标导入 manifest，即可放弃目标、关闭关联、继续使用原站。不要为“回滚”反向重写旧 owner 或覆盖旧名片。

开放新站写入后，切回旧站会遗漏新站期间新增内容/互动。真正无损回退需要先停止新站写入、保存新站快照并做增量回灌/合并；目前没有这种通道。不能承诺只切域名就能无损回滚。

**复制数据不自动迁移原站链接。** 保持 UUID 可以让新 origin 下相同 `#/work/<id>`、卡片 ID 与 `/media/<id>` 路径工作，但别人保存的 Sites 完整 URL 仍指向旧 Site，访问规则也仍属于 Sites。需要保留原站，或另行实现明确的旧站跳转/迁站入口。不要把旧名片快照批量重写成新 URL；当前相对资源路径可以直接复用。

当前尚未完成：旧 Sites 完整数据库导出、旧 R2 原始文件获取、Clerk **生产**身份与关联、正式目标的数据导入、跨站链接处理及旧数据全流程验收。staging D1/R2 创建、新测试账号与本地 HTML 发布已完成，原始上传字节已核对；这些不等于旧站迁移完成。
