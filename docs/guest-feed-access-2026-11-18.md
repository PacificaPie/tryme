# 游客 Feed 与登录权限

2026-11-18（America/New_York），用户明确：未登录可刷 Feed；发布作品、发布名片和试玩必须登录。P08 因此提前实施，不再等待 P05/P07；其他页面原型与个人空间工作仍按原计划。

## 访问规则

| 操作 | 未登录 | 已登录 |
| --- | --- | --- |
| Feed、搜索、分类、排序、翻页 | 可用，只显示 listed 且未归档作品 | 保留原有发现与关注能力 |
| 查看现有公开名片链接 | 保持可读 | 保持可读 |
| 进入作品试玩、打开外链作品 | 提示登录，保留作品与来源筛选上下文 | 保留原有行为 |
| 发布作品、制作/发布名片、创作后台 | 提示登录 | 保留原有权限 |
| 关注、点赞、评论、会话和事件 | 需要登录 | 保留原有权限 |

## 实现边界

- 新增独立的 `GET/HEAD /api/public/discover` 与 `/api/public/works/:id/cover` allowlist；不开放现有 `/api/works`、`/api/discover`、`/game`、`/media` 或任何写接口。
- Feed DTO 只含展示字段和互动计数，不含作者账号 ID、外链试玩 URL、版本/构建产物信息、存储 key 或管理状态。公开请求不携带 Cookie/Bearer，也不依赖 Clerk 加载成功。
- 复用发现页的排序、筛选、分页和可见性规则；游客不允许 `mine`、`author`、`following`、`state` 参数。游客分页游标和已登录列表的 scope 分开校验。
- 封面逐次复核作品可见性；隐藏、归档后返回 404；响应 no-store。旧名片的固定快照语义不变。
- 游客不写曝光、试玩或互动事件，不生成虚构用户。身份头仍由 standalone 边界清除；所有私有接口继续服务端鉴权。
- 不涉及数据库迁移、资源创建或新密钥。

## 验证

- `npm run check`、519 项自动化测试、production 构建和 Worker deploy dry-run 通过。
- 新增真实 router/SQLite/standalone 边界测试：公开数据最小字段、过滤/排序/翻页、隐藏/归档、封面 GET/HEAD、私有参数与游标隔离、伪造身份头、私有接口和所有写请求保护。
- 前端回归覆盖游客分页、搜索、排序、关注提示、没有匿名曝光、认证服务故障时仍可浏览 Feed，以及受保护路由保留登录回跳。
- Chrome 本地 fixture 实测：3 个公开作品可见、1 个隐藏作品不出现；搜索有效；点击作品、创作中心和名片均进入登录提示，回跳包含目标页面。fixture 仅在本地，不使用生产数据或真实身份。
- 正式站邮箱登录已通过：用户完成验证码后，浏览器显示已登录账号并进入 Feed。此记录不代表 Google 登录或全部生产上传/云构建/名片流程已验收。

## 生产发布结果

用户已明确授权直接合并发布 [PR #5](https://github.com/PacificaPie/funtrack/pull/5)。发布提交为 `a7209bc6467fe831842876ce73121e24876e62b8`，主站 Worker 版本为 `1ed09db3-ee8e-46a1-903f-8c76bf69e220`（2026-11-18 01:30 America/New_York）；[该提交 main CI](https://github.com/PacificaPie/funtrack/actions/runs/44251685175) 通过。私有构建器和 D1 schema 均未变更，前一可用业务 Worker 版本 `b303650b-dc1e-4a77-b879-00c7cf9db0f2` 可作为兼容 schema 的代码回退目标。

发布后真实匿名 HTTP 检查：公开 Feed GET/HEAD 返回 200，禁止的私有查询参数返回 422；未登录作品列表、账号、游戏文件、作品发布、名片发布、试玩会话及伪造身份头均返回 401。`site.js` 和 `discovery.js` 的线上 SHA-256 与发布代码一致。正式站此时作品数为 0；本地有内容场景的 fixture 不代表生产已发布作品。检查记录保存在 Git 忽略目录 `.preview/guest-feed/production-smoke.json`。

首次发布和完整真人流程的剩余验收仍见 [首次发布记录](production-launch-2026-11-17.md)。

## Google 登录配置进展

2026-11-18 用户完成 OAuth 凭据设置后，正式 Clerk Google 连接已显示 Enabled。浏览器实测：退出邮箱会话 → 公开 Feed 可浏览 → 创作中心要求登录 → Google 账号选择/基础资料授权 → 正确返回 `/site#/studio/works` 并显示已登录身份。未读取或记录 Client Secret；邮箱验证码继续保留。

Google Cloud 项目 `tryme-card` 已切换为 External / In production。经用户批准，PR #7 的公开介绍、隐私政策及服务条款已发布，Google 与 Clerk 链接已配置。正式版复测退出→名片登录→Google→回到名片页通过；刷新保持身份，账号 ID 与此前邮箱登录一致。新账号、跨浏览器和会话到期验收仍保留。

当前主站版本已更新为 `cb160ac` / `28164db4-a65c-4f97-bc92-d59ce46c1796`；上面的 PR #5 记录保留其历史发布信息。具体版本、检查与边界见 [Google 登录验收与公开信息](google-oauth-acceptance-2026-11-18.md)。
