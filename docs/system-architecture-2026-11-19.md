# TryMe · 当前系统架构

基线：2026-11-19 应用发布提交 `838b149`，已包含 #29/#30/#34，保留 #33/#35。生产版本、证据与待办见 [项目现状](project-status-2026-11-19.md)。以下画的是当前独立 Cloudflare 站点；未合并的微信和 AI 实验不属于生产依赖。

## 1. 系统总览

```mermaid
flowchart LR
  Web[浏览器：公开浏览 / 登录后创作与互动
HTML CSS JS / Three.js / 隔离试玩 iframe]
  Clerk[Clerk production
邮箱 / Google]
  subgraph App[主站 Cloudflare Worker]
    Gate[身份验证与路由
公开白名单 / CSRF / 预期账号]
    Core[业务服务与所有权
作品 / 版本 / 名片 / 资料 / 消息 / 引导]
    Media[媒体服务
私有草稿 / 捕获 / 预算与租约]
    Gate --> Core
    Gate --> Media
  end
  subgraph Data[独立生产存储]
    D1[(D1
业务记录 / 快照 / 事件 / 任务
互动触发器与通知)]
    R2[(R2
HTML / 封面 / MP4
私有草稿与永久副本)]
  end
  subgraph Build[私有仓库构建链路]
    Builder[构建 Worker
Durable Object]
    Container[独立 Container
固定工具链 / build 禁网]
    Repo[公开 GitHub / npm
准备阶段白名单下载]
    Builder --> Container --> Repo
  end
  Browser[Browser Run
托管 HTML 隔离捕获 / 外链受控截图]
  External[公开 HTTPS 网站
地址与重定向检查 / 受控 GET]
  Cron[Cron
过期草稿清理 / 既有媒体任务]
  Web -->|请求| Gate
  Web -->|登录与会话| Clerk
  Gate -.服务端验会话.-> Clerk
  Core --> D1
  Core --> R2
  Media --> D1
  Media --> R2
  Core -->|service binding；回传校验 HTML| Builder
  Media -->|截图 / 静音 MP4| Browser
  Browser -->|仅外链截图受控出网| External
  Cron --> Media
```

**读取与权限。** 游客只读公开发现、指定名片及允许的媒体；游戏文件、私有草稿、发布、事件与后台 API 仍鉴权。公开页面不创建匿名试玩会话或匿名互动事件。预期账号 header 只是与已认证身份比较，不能充当身份来源；旧客户端未携带 header 的兼容行为仍保留。

**构建与捕获分开。** 构建器只经私有 service binding 访问，由 Durable Object 调度容器，产物经主站验证；截图/录像使用 Browser Run，不执行 npm 构建。托管 HTML 捕获禁止外网；外链截图经受控 GET/资源代理和地址检查，不携带用户登录会话。不能再概括为“所有截图都禁止外网”或“外链不截图”。

**不虚增统计。** 捕获读取原始 HTML，不建立玩家会话；Feed 视频预览不等于试玩。现在的录制是固定规则/已验证内容脚本，不是生产 AI agent。

## 2. 首次发布的私有到公开流程

```mermaid
sequenceDiagram
  actor Author as 登录作者
  participant Web as 上传界面
  participant API as 主站 API
  participant Build as 私有构建器
  participant Store as D1 / R2
  participant Browser as Browser Run
  Author->>Web: 选择 HTML / GitHub / 外链
  opt GitHub 仓库任务（单文件直读可跳过）
    Web->>API: 导入公开仓库
    API->>Build: 提取成品 HTML 或受限云构建
    Build-->>API: 校验后的 HTML 产物
  end
  Web->>API: 创建作者私有发布草稿
  API->>Store: 保存内容指纹、owner、24h 期限
  Web->>API: 请求候选封面 / 支持的视频
  API->>Store: 预留预算与租约
  API->>Browser: 托管 HTML 捕获；或外链截图
  Browser-->>API: JPEG / 静音 MP4 ≤8 秒
  API->>Store: 私有候选媒体与状态
  API-->>Web: 仅本人可读的候选
  Author->>Web: 确认候选 / 手动封面 / 明确跳过
  Author->>Web: 正式发布
  Web->>API: 草稿 ID + 选择 + 原来源
  API->>API: 账号 / 所有权 / 指纹 / 选择 / 幂等校验
  API->>Store: 永久媒体副本 + 作品 / 版本 / metadata
  API-->>Web: 发布成功；进入 Feed
  Web-->>Author: 加入或更新名片；显式保存新卡
```

此图是首次发布；已有作品的版本更新、补封面和重录仍有各自入口。候选失败可以重试、手动上传封面或明确跳过，不能默认替作者确认。外链无自动视频。已经选用的视频不再次排队生成；Cron 清理过期草稿时不删除已发布副本。D1 与 R2 不是一个跨存储事务，依靠幂等、归属校验与清理处理失败。

## 3. 数据权威源与名片快照

```mermaid
flowchart LR
  Profile[ft_profiles：当前姓名 / 简介 / 身份 / 网址 / 头像]
  Work[ft_works：稳定作品 ID 与当前指针]
  Version[ft_work_versions：不可变作品版本]
  Meta[ft_work_metadata：不可变说明 / 封面修订]
  Card[ft_cards：设计与选片 snapshot_json]
  View[名片读取结果]
  New[新卡 ID / 新快照]
  Event[play_sessions / events：真实收到的事件]
  Social[评论 / 回复 / 点赞 / 关注]
  Notice[ft_notifications：来源事件与收件人]
  Draft[ft_publish_drafts + captures：私有媒体状态]
  Onboard[ft_onboarding：账号偏好]
  Work --> Version
  Work --> Meta
  Card -->|固定 versionId| Version
  Card -->|固定 metadataId / 可选 coverMetadataId| Meta
  Card --> View
  Profile -->|按 card.author_id 实时投影| View
  Card -->|继续制作 / 更新封面；显式另存| New
  Version --> Event
  Work --> Social
  Social -->|D1 触发器| Notice
  Draft -.确认发布后.-> Work
  Onboard -.仅偏好，不授予权限.-> Profile
```

这是逻辑引用图，不声称所有箭头都是数据库外键。**作品与名片不是全部字段都实时，也不是全部字段都冻结。** 作品 ID 稳定，旧版本与 metadata 保留；名片设计、签名、选片、作品版本及封面引用固定。个人身份通过 `ft_cards.author_id → ft_profiles.id` 实时投影。显式更新封面生成新卡，`coverMetadataId` 只选图片，不悄悄更新原说明；旧卡链接和 JSON 不变。做同款不复制原作者身份或作品。

评论保存发表时页面版本，历史未知不回填；它不是试玩证明。通知由互动表触发器产生，按收件人读取/已读，不给自己发提醒、不回填旧事件。新用户直接浏览 Feed，邀请的关闭按账号保存在当前浏览器，不要求服务端写入；创作者昵称及既有偏好/完成状态仍由服务端保存，不改变权限。

## 技术与代码入口

| 范围 | 当前实现 / 主要文件 |
| --- | --- |
| 产品页面 | `public/site.*`、`discovery.js`、`onboarding.js`、`opening.js`；HTML/CSS/ES modules，Three.js 模板；不是整站 React 重写 |
| 框架/部署 | TypeScript、Vite、vinext；`worker/standalone.ts`、`standalone-auth.mjs`、`wrangler.standalone.production.jsonc` |
| 发布与媒体 | `publish-draft-service.mjs`、`media-budget.mjs`、`auto-cover-*`、`external-cover-*`、`video-preview-*` |
| 身份、作品与名片 | `server.ts`、`rules.mjs`、`card-identity.mjs`、`card-cover-service.mjs`、`public-sharing.mjs`、`public/card-export.js` |
| 通知与引导 | `notification-service.mjs`、`onboarding-service.mjs`、`public/notification-state.js`；迁移 `0021` / `0022` |
| 存储 | Cloudflare D1（SQLite）、R2；`db/schema.ts`、`drizzle/`，迁移只追加 |
| 仓库构建 | `cloud-builder/`、`build-service.ts`、`scripts/repo-builder.mjs`；Container、Durable Object、私有 binding |
| CI | `.github/workflows/ci.yml`：检查、Node 测试、本地目标构建；不自动迁移或部署 |

`lib/funtrack/` 下的文件在表中省略公共前缀。生产和 staging 使用独立 Worker、D1、R2、Clerk 实例与配置；旧测试账号/作品没有因此自动迁入生产。当前没有 Postgres、Redis、ClickHouse、Kafka、MCP Server、生产微信认证或生产 AI 探索服务。

## 可维护文件

本页三段 Mermaid 是权威图源，独立 `.mmd` 和渲染 SVG 放在 [diagrams/](diagrams/README.md)；[离线三图查看器](diagrams/architecture-viewer.html) 可切换查看。更新图时先核对 Worker 入口、公开权限、草稿发布服务、card identity 与新迁移，再同步 Notion。历史发布记录保留当时结果，不在旧日期下覆盖成新版本。
