# F09：评论配额、列表生命周期与预期账号边界

2026-11-18。本 PR 基于重新拉取的 `origin/main`：`77be1fa3e1eff41220a428a51c2a3740c9b06ef3`。独立工作区 `funtrack-reliability-2026-11-18`，分支 `fix/f09-reliability`。只读参考 Draft PR #10 的评论原子插入和讨论列表生命周期；没有合并其分支或提取 Logo、名片、数据页修改。

## 失败证据与修复

| 场景 | 主线/修复前观测 | 本 PR 行为 |
| --- | --- | --- |
| 已有 29 条，12 个不同 key 同时申请最后一个分钟配额 | 用 SQLite fixture 在旧 COUNT 返回处设置并发屏障，12 个请求全部 201，断言 `12 !== 1` | COUNT 条件放入 INSERT SELECT；只有 1 个 201、11 个 429，数据库总数 30 |
| 达到配额后重试原 key | 已有幂等行为保留，不能把重放当新配额 | 新增最后一条提交响应丢失、满额重放与相同 key 并发回复测试：只保存一条，重放 200；改内容仍 409 |
| 首次列表一直没有响应 | 没有列表 deadline、signal 或 dispose；3 个新增生命周期测试失败 | 12 秒截止、AbortSignal、离开/重挂载取消；独立请求标识阻止旧请求覆盖新视图 |
| A 页面在取 token 前已经切成 B | 真实 site API 函数的假传输测试未拒绝；服务端忽略预期账号 header | 客户端在获取 token 前后和读完响应后校验 Clerk 当前账号；服务端先核对 header 再进入业务 |
| A 的响应在账号变化后才完成 | 响应仍到达调用方；新增测试失败 | 私有响应完成前再次核对页面 owner 与 Clerk 账号；初次 `/api/me` 也核对返回身份 |
| 手机端 A 资料草稿、服务端身份变成 B 后保存 | 首次本地 UI 已返回 409，但资料编辑器将原因吞成一般重试提示 | 保留草稿，明确提示“登录账号已变化，请刷新页面后重试。”；没有写入资料 |

并发屏障必要：PR #10 原来的 `Promise.all` 测试在未修复主线上也能通过，Node 的异步 hash/同步 SQLite 时序没有稳定重现读后写窗口。本 PR 保留真实 SQL/事务，仅在旧配额读取之后等待其他请求，证明实际越额；修复后的原子 SQL 不经过该旧读取路径。

## 写入口梳理与边界

主站写操作均经 `public/site.js` 的 `api()`。`draftOwner` 是当前文档加载草稿的账号；切换账号后必须刷新整页才能加载另一账号，不把旧表单回调重新绑定给新账号。

| 入口组 | 既有约束 | 本次增加的共同约束 |
| --- | --- | --- |
| 资料、头像、关注 | 服务端身份、头像所有权、资料返回 ID 校验 | 预期账号 header；Clerk 与页面 owner 的请求前/响应后检查 |
| 点赞、评论、反馈 | 作者归属、评论版本、幂等/状态校验；评论已有 `expectedAuthorId` body | 同一 header guard；保留评论原有 body guard |
| 作品发布、编辑、版本/回滚、归档、Feed 设置 | 所有权、revision、幂等、上传校验 | JSON 和 FormData 共用 header，不改变内容 hash、文件或业务结构 |
| GitHub 导入、构建/取消、封面/预览任务 | 各服务的所有权与状态约束 | 路由分发前先校验账号；本地 fixture 的构建 transport 仍为 stub |
| 会话、事件、曝光；名片写入口 | 既有会话 token、CSRF、幂等和所有权 | 同一主站 API 边界；没有修改名片业务或承接名片 badcase |

`X-Funtrack-Expected-User` 不是身份来源。服务端使用已认证 `user.id` 比较，检查位于 authenticate/CSRF **之后**、业务分发/receipt lookup **之前**。旧客户端不带 header 时保持既有认证行为；空、超长、不匹配 header 返回 409。游客公共 GET 保持不带 credentials/Bearer/预期账号。公开分享和 build-worker 的既有独立认证路径不纳入此页面账号约束。

## 本轮验证

- `npm run check` 通过；`npm test` **595/595 通过**；`npm run build:standalone` 通过。均为本轮在独立工作区重新执行。
- Router fixture：真实 HTTP router、SQLite SQL/事务、内存对象存储；不是远端 D1 压测。账号错配用例覆盖资料/头像/关注/点赞/评论/作品写入口/导入/会话，并比较所有 SQLite 表无变化。鉴权、CSRF、所有权、legacy replay 正向回归仍通过。
- 浏览器：Chrome，真实 `site.html` / `site.js` / HTTP router，loopback fixture，合成 A/B 身份。桌面实测超时 → 草稿保留 → 重试恢复；另一次进入后立刻离开，服务端统计两次连接中止（超时一次、路由离开一次）。迟到结果不能覆盖的确定性断言在模块测试中完成。
- 手机布局：实际 viewport 390×844。A 的资料编辑 → fixture 身份切 B → 保存返回 409、profiles 表仍为空；刷新后 B 的评论输入为空，没有 A 草稿，正常发布显示 `Account B mobile comment`，数据库作者为 B。恢复默认 viewport。
- [手机账号拒绝截图](evidence/f09/mobile-account-rejected.jpg)、[手机评论成功截图](evidence/f09/mobile-comment-saved.jpg)、[本地服务端记录](evidence/f09/local-browser-state.json)。这些均为本地合成数据。

复现 UI：`node tests/fixtures/reliability-browser-server.mjs`，打开 `http://127.0.0.1:4896/`。该 fixture 仅绑定 loopback，控制接口 `/__fixture/control?hold=1` 挂起下一次根评论列表、`?release=1` 释放、`?account=a|b` 切换合成身份；`/__fixture/state` 读取记录。禁止作为部署入口。

## 审阅范围与未验证项

共享 `server.ts` 只改 `addComment` 及 `handleAPI` 身份检查；共享 `site.js` 只改 API 身份边界和 discussion 的挂载/释放。其他生产代码为 auth-client 的预期账号检查、规则函数、翻译和资料错误提示。无迁移、配置、依赖或生产身份变更。

这次 12 秒截止覆盖根评论列表和根列表翻页；回复展开、互动收件箱及其他页面的通用请求生命周期未在此 PR 扩展。其他表的限流原子化也未在本轮验证。账号 header 对旧版已打开的客户端不自动生效，需加载新前端。没有真实 Clerk 双账号/跨标签登录、远端 D1 并发或真机测试，不据此声称这些场景已验收。

本 PR 不部署；未更改正式站。按 `docs/collaboration-handoff.md`，由另一位合作者审阅后再合并，部署由负责人显式选择环境。
