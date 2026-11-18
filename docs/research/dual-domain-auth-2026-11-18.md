# 双域名、国内访问与并列登录：决策草案

核查日期：2026-11-18。本文是架构判断和实施顺序，不代表已购买国内域名、已开通微信、已启用双域名或已迁移数据。Logo/流程原型继续本地验收，不上线。

## 当前结论

1. 邮箱、微信和 Google 应当是并列登录入口。新微信身份可独立注册，邮箱可选；账号关联是用户之后主动做的动作。此前“微信先绑已验证邮箱”的草稿不再作为产品目标。
2. 两个域名可以共用一套业务数据与文件。域名不是数据库分区键，多一个网址不要求存储翻倍。
3. 国内注册的域名不等于国内托管，也不保证国内访问更快。只有决定使用内地节点、数据库或对象存储时，才会产生相应迁移与跨区同步问题。
4. 当前站点不支持直接加第二条 DNS 就完整运营：认证有精确 origin 校验，分享链接也依赖主域名。更改必须保留严格白名单。

## 审核以外的微信卡点

| 项目 | 当前证据 | 下一步 |
|---|---|---|
| 与 Clerk 对接 | 自定义社交连接要求 OIDC；当前微信草稿采用服务端 OAuth + 一次性 Clerk 票据 | 验证无邮箱用户、完整 session、MFA / session tasks；不要把 OAuth 当成现成 OIDC |
| 新用户无需邮箱 | `standalone-auth.mjs` 要求 verified email；业务 `rules.mjs` 要求 id 与 email；旧微信草稿 `activeEmail()` 同样如此 | 账号主体与登录身份分层，email 可空；凭可信微信身份准入，不可无条件跳过认证 |
| 整合 | 对 `90c73dc` 与旧草稿 `9943952` 的无工作区合并预演仍有 journal/auth/site.js 三处冲突 | 隔离分支重整，微信未应用迁移用下一编号，不改已应用迁移 |
| 真实链路 | 尚未真实扫码验证；没有确认可用的真实 AppID/Secret；国内网络未测 | 合法取得凭据后在测试环境测二维码、取消、超时、并发、重放、封禁和回跳 |
| 手机场景 | 旧草稿只有网站扫码 `qrconnect/snsapi_login` | 微信内 H5 另配网页授权；不能以电脑扫码成功代替手机验收 |

Clerk `createUser()` 的参数虽允许省略 email，但官方明确要求满足实例的 Required 字段设置。因此还不能仅凭 API 形状断言当前生产实例支持纯微信账号。先用独立开发实例做最小验证；不伪造邮箱，不把未验证邮箱自动标记为 verified。若保留 Clerk 的方案可行，现有账号和作品 ownerId 可以保持；若不行，再评估认证适配层，避免为了登录入口重写业务。

## 现有存储与代码边界

当前生产配置文件 `wrangler.standalone.production.jsonc` 指向 Worker + 单一 production D1 + 单一 production R2，Clerk production 管会话。D1 存作品、版本、名片、互动、统计和任务；R2 存 HTML/构建产物、封面等对象。没有读取生产用户数据，也没有查询当前库/桶的精确物理位置。

- `lib/funtrack/standalone-auth.mjs` 校验 request origin 必须等于 `APP_ORIGIN`，`authorizedParties` 也仅该 origin。新的域名直接绑定后，受保护 API 会遇到403。
- `lib/funtrack/public-sharing.mjs` 用配置 origin 生成公开名片 canonical URL。新增域名要确定分享、二维码、SEO canonical 和登录返回的策略，不要把登录地址与分享主域名绑成同一个概念。
- 旧微信草稿用 host-only Cookie、同源写请求和相对 returnTo。两个独立顶级域名不能直接共享该 Cookie；不得通过放宽到任意 origin 或在 URL 放长期 token 解决。
- Worker 的 D1/R2 binding 是 Cloudflare 的运行时接口。迁到普通国内 Node 服务时，要适配数据库和对象存储接口，不能认为换 DNS 就能带过去。当前对象服务已有注入边界，但仍需核查 SQL、事务、batch 和存储语义。

## 三种运营方式

| 方式 | 账号与存储 | 收益与代价 |
|---|---|---|
| 新域名跳转现站 | 同一个登录入口、同一 D1/R2 | 最小改动，保留品牌入口；不解决现站国内链路 |
| 两个域名展示同一服务 | 共享业务用户、同一 D1/R2；每个域名分别建立会话 | 存储不翻倍；需要 origin、回调、Cookie/SSO、分享与统计适配；网络路径基本未变 |
| 国内与海外分别部署 | 需要明确账号权威源、业务写入权威源、文件主副本、区域策略 | 可改善国内体验；增加运行时适配、复制延迟、恢复和删除同步成本，不建议现在直接做双写两套库 |

Clerk 提供 satellite domain 方案，但生产需付费，跨域登录仍经 primary domain。我们的原生 JS 接入要按 SDK 实际支持做验证；它不是国内独立认证节点。如果主域名或 Clerk 依赖在国内访问不稳，增加卫星域名并不能自动消除这个依赖。

Cloudflare China Network 是 Enterprise 的单独订阅，且不是所有产品都可用；现有 Cloudflare 托管不代表开通了内地网络。D1/R2 的 location hint 是创建资源时的部署选项；域名后缀不会改变数据位置，R2 hint 也不是地域保证。

## 建议顺序与数据策略

1. **现在**：按并列登录目标修订微信流程；在测试环境验证“微信验证 → 无邮箱用户 → session → 发布/试玩”全链路。现有生产账号和 ID 保持兼容。
2. **加域名前**：明确新域名只是品牌入口，还是国内体验入口。让孙从国内真实网络分别测 Feed、Clerk/邮件、上传、作品加载、分享与登录回跳，再选择部署位置。
3. **短期双域名**：优先同一份数据、一个写入权威源。严格列出允许访问与回跳的两个 origin；统一账号映射，日志带入口域名，UV 按统一用户口径统计。同内容选定 canonical，公开分享链接和回跳地址分开配置。
4. **确需国内节点时**：先验证国内前端/媒体缓存 + 单一业务写入源能否达标。媒体按不可变版本和对象 key 复制，数据库只保存稳定标识，不把海外绝对 URL 到处写死。鉴权资源仍经权限检查，不把私有作品或试玩资源整体公开来换取 CDN 加速。
5. **只有确需区域隔离时**：再设计独立数据区、用户归属、公开作品同步、异步事件与失败重试。明确一个对象在哪边可写；删除、归档、撤回、封禁必须在副本和缓存同步，不能只同步新增。

新增账号表/身份映射时，以稳定业务用户 ID 对应多种已验证身份；保留现有作品、名片、评论 ownerId 的兼容映射。补邮箱和关联已有邮箱账号是不同动作；冲突时双边验证，不能靠邮箱文本相同直接迁移作品。

内地托管涉及接入商的ICP备案要求；跨境传输个人信息需要按实际主体、数据类型与规模确认适用义务。没有“必须把所有数据放内地”或“体量小就完全无需处理”的默认结论。本轮不代用户选定法律主体或数据区域。

## 验收出口

- 纯微信新用户无邮箱也能进入、发布、试玩；可选补邮箱且不改变作品归属。
- 邮箱/微信关联同一账号后看到同一组作品；未授权的账号不能被自动合并。
- 两个域名的游客 Feed 正常；登录回跳返回发起入口；退出与过期行为清晰。
- 同一作品两个入口看到相同版本；历史名片链接可用；文件无多余复制，统计不因跨域重复计人。
- 国内实测报告覆盖认证与数据链路，不仅测首页或 DNS。

## 官方来源（本轮核查）

- [Clerk 自定义连接 / OIDC](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/custom-provider)
- [Clerk createUser：实例必填字段约束](https://clerk.com/docs/reference/backend/user/create-user)
- [Clerk 跨域会话：主域依赖与付费要求](https://clerk.com/docs/guides/dashboard/dns-domains/satellite-domains)
- [MDN Cookie 域范围](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- [Cloudflare China Network](https://developers.cloudflare.com/china-network/)
- [D1 数据位置](https://developers.cloudflare.com/d1/configuration/data-location/)、[R2 数据位置](https://developers.cloudflare.com/r2/reference/data-location/)
- [腾讯云ICP备案场景](https://cloud.tencent.com/document/api/243/19630)
- [国家网信办数据出境规则](https://www.cac.gov.cn/2024-03/22/c_1712776611775634.htm)、[2025年10月政策问答](https://www.cac.gov.cn/2025-10/31/c_1763633376984070.htm)

微信官方页面本轮无法读取；未把旧文档、模拟测试或本地样例宣称为当前微信后台已配置/审核/扫码通过。本文架构建议是结合仓库实际约束的判断，不是云服务商对本项目的可用性承诺。
