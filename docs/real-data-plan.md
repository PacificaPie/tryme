# 最小真实数据回收方案

2026-11-16，基于当前仓库与 Sites 只读核对。目标是跑通真实发布、运行、事件入库和创作者查询；不把页面内计数当作服务端数据。

**当前基础。** `.openai/hosting.json` 指向现有项目 `appgprj_6afb3d21de448191b57481c82d3564a2`，仅有 `static.directory = dist`；仓库没有后端接口或数据库迁移。线上已存在版本 3，数据库检查返回无 D1 binding、无表。当前访问为 custom，只有 1 个允许用户、0 个外部访客。沿用该项目与私有访问范围；本阶段不更改 audience、不新建服务或修改 hosting。

**第一条真实闭环。** 先接通一件现有可玩的小游戏，再接通单文件 HTML 上传。创作者上传并发布作品版本，打开该版本并产生交互，服务器保存会话与事件，数据页从数据库重新查询。换浏览器或刷新后仍能查到记录，才算数据回收完成。示例数据应独立标示，不能混入真实统计。

1. **后端与身份：** 在现有 Sites 项目中准备 server-backed 迁移，保留现有页面、素材与 Three.js 展厅。结构化记录使用 D1，封面和游戏文件使用 R2。发布、编辑、名片发布、数据查询必须用 Sites 提供的服务端用户身份做所有权校验；浏览器传来的作者 ID 不作为授权依据。名片继续确定性套模板，不调用付费 AI。
2. **作品与版本：** 保留 `works`、不可变的 `work_versions` 和已发布 `cards` 快照。素材使用带版本或内容标识的对象键，避免替换同一 URL 的文件而改变旧名片。上传成功和作品公开发布是两个状态；失败时保留草稿，不产生已发布记录。
3. **上传范围：** 第一版限定自包含 HTML 与 PNG/JPEG/WebP 封面，明确大小与类型限制；ZIP、多文件依赖、游戏后端另行实现。用户 HTML 不作为主站同源可信代码执行。至少使用强制 CSP sandbox 的独立游戏响应及不含 `allow-same-origin` 的 iframe；该响应直接打开时也必须保持隔离。此方式下 iframe 是 opaque origin，消息按准确 `event.source`、本次会话随机标识及 schema 校验，不能把它套入可信同源展厅的 origin 校验规则。主站写接口另做身份、Origin/CSRF 和对象所有权检查。
4. **采集接口：** `POST /api/play-sessions` 由服务端分配会话及接收时间；`POST /api/events` 接收小批量白名单事件。最少包括 `session_start`、首次游戏输入后的 `play_start`、游戏结束后的 `session_end`；可选记录游戏主动上报的完成结果。每个事件关联作品版本、会话和唯一事件 ID，数据库约束负责去重。客户端时间仅供参考，使用服务端 `received_at` 做接收统计；限制单批大小、频率和会话有效期。
5. **真实性边界：** 上述事件都是 **self-reported session/game events**。服务端签发会话、成功入库、检测到输入或停留时长，都不等于 **verified engagement**，也不能证明真人、认真试玩或无作弊。前端不得称为“有效游玩”或“真实玩家人数”。外链未接 SDK 时只记录作品页访问和出站点击，试玩仍显示 `—`。先不用这些事件兑换积分或推荐奖励。
6. **反馈与查询：** `POST /api/feedback` 返回持久化记录 ID；`GET /api/creator/analytics` 只查询当前作者作品，按时间和作品版本聚合。开始试玩按有 `play_start` 的不同会话计数，反馈按已入库记录计数；名片访问、作品页访问、出站点击分别统计。提交失败显示待发送/失败，不提前把页面计数当成已入库结果。

最小数据对象为 `works`、`work_versions`、`cards`、`play_sessions`、`events`、`feedback`。先用有索引的 D1 查询，不引入 Redis、ClickHouse 或模型推荐。日志不记录原始键盘输入、敏感 token 或完整游戏源码。

**验收证据。** 使用实际游戏事件验证入库收据；重发同一事件不增加计数；刷新和独立浏览器会话仍可查询；作者不能读取或修改别人的私有统计；未接入外链保持未知；上传失败不发布；修改生成草稿不改变已发布名片。部署仍沿用当前私有 Sites audience，不据“允许部署”推导开放匿名访问。

**当前阻碍。** 服务端输出、D1/R2 bindings、迁移、持久化接口和真实身份接入均未实现。现有 Python 静态预览不能验证云端持久化或 Sites 身份，需要单独的后端预览与部署后验收。私有访问范围可以支持授权用户的真实端到端测试，但不构成面向公众的玩家分发验证。现有成本试算只覆盖名片模块；这批采集、数据库和上传费用须另计。

执行时遵循 [Sites 技能](</Users/a1234/.codex/plugins/cache/openai-curated-remote/sites/1.1.6/skills/sites/SKILL.md>)、[持久化说明](</Users/a1234/.codex/plugins/cache/openai-curated-remote/sites/1.1.6/skills/sites/references/storage.md>) 和 [身份说明](</Users/a1234/.codex/plugins/cache/openai-curated-remote/sites/1.1.6/skills/sites/references/identity-and-secrets.md>)。本次仅准备方案，未创建资源、运行付费 API 或修改部署配置。
