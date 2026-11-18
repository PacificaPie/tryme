# F08 微信独立注册与登录：实现及验收边界

2026-11-18。独立分支 `feat/wechat-independent-auth`；接手并再次 fetch 后的主线为 `77be1fa3e1eff41220a428a51c2a3740c9b06ef3`。只读核对 production 当前 Worker 版本仍为 `e2bc3911-3631-4844-960e-12d4b602ecd1`。本分支没有部署、应用远端迁移、改变 Clerk 实例或启用微信。

## 已实现

- 邮箱 / Google 原登录保留。配置齐全时，微信入口与原表单同时显示；配置不全、表缺失或 `WECHAT_LOGIN_ENABLED` 不等于 `1` 时隐藏。生产配置文件没有改动，本地模板明确为 `0`。
- 首次微信身份：OAuth 回调 → 本标签页的注册确认 → 创建无邮箱 Clerk 用户 → 保存 `(appid, openid) → clerk_user_id` → 一次性短票据 → 完整 session → `/api/me` 再确认同一用户 → 返回原路径。无邮箱、电话或密码的伪造值；不跳过法律确认，不传 `legalAcceptedAt` 或 `skipLegalChecks`。
- 已映射的微信直接登录原 `clerk:<userId>`。登录不会改变作品、名片、评论的作者 ID。
- 绑定是独立的 `/api/account/wechat/*` 操作，必须从已准入账号发起，绑定前展示账号，要求近期验证和明确确认。公开登录回调不能转换为绑定请求。双方已有独立账号时返回冲突，不自动搬作品。
- 无邮箱准入要求有效 Clerk session、未封禁/锁定/停用的服务端资料，以及当前 AppID 下数据库可核实的微信映射。用户可修改 metadata、昵称、头像、请求 header 均不能代替映射。
- 业务 `authenticate()` 保留 Sites 邮箱边界；standalone 使用服务器内部 `AsyncLocalStorage` 传递已核实身份。没有“客户端设置已验证 header 即可无邮箱通过”的例外。邮箱返回可空，名字回退为“创作者”。

## 安全与失败恢复

微信域名和接口固定；HTTPS 精确 origin、同源 JSON + CSRF header、state/browser proof、阶段过期、数据库哈希存储、一次性消费均保留。Cookie 为 host-only、HttpOnly、Secure、SameSite=Lax；不跨域共享。票据有效期 60 秒，只在 POST JSON 中返回并留在内存，不进 URL、storage 或日志。OAuth 上游有 8 秒超时和响应体上限；开始请求按哈希后的来源窗口限流。

`ft_wechat_registrations` 保存随机且唯一的 Clerk `externalId` 预留。Clerk API 必须保证 externalId 唯一；若创建响应丢失或 D1 落映射失败，新扫码按同一预留恢复。查询还要求服务端 privateMetadata 中的注册标识一致。并发绑定不能占用已经预留的新身份；相同 UnionID 不参与合并。

预留记录不自动过期：不确定创建结果不能通过删记录重建用户。运维恢复应按预留 externalId 查询 Clerk；只补回经验证的原映射，不删除已有用户，不转移作品。账号被封禁时仍拒绝发票据。

MFA 账户不签发可能绕过第二因子的票据。前端也要求 ticket 结果 complete、session active、无 currentTask/tasks、用户一致；否则停在额外验证提示。**这不是完整微信 + MFA 挑战实现**，真实实例的 MFA/session task 与无邮箱恢复路径必须在启用前验证。没有解绑/删除微信接口；添加邮箱应走 Clerk 的验证流程，邮箱冲突不等于账号合并。

## 数据与协作范围

仅新增 `0020_wechat_independent_identities.sql`（4 张微信相关表）及 schema/journal。已上线迁移均未改动。主线目前到 0018；0019 为上传聊天正在开发的私有媒体迁移预留。当前 journal 使用下一个本地 idx；上传合并后需 rebase、按实际主线调整本分支 journal idx/尚未上线文件编号，再重新验证。不要改已上线迁移或提前把本分支应用到生产。

共享入口仅有：`server.ts` 的 User.email 可空类型；`site.js` 的条件账号设置链接。上传、名片快照、游戏隔离、Feed、生产变量均未改动。未修改其他聊天工作区。PR #1 只逐文件借用了 OAuth 防护和页面骨架，未整包合并；其邮箱前置流程已移除。

## 本轮验证

| 层级 | 实际结果 | 不证明什么 |
|---|---|---|
| 新/适配专项 | 55 项通过：微信服务、页面客户端、standalone 与业务准入 | 不是真实 Clerk/微信 |
| 全仓回归 | 619 项通过，含新增 39 项（微信 26、前端 9、业务边界 4）；主线基线 580 | 不是 619 条真实扫码 |
| 静态/类型检查 | `npm run check` 通过 | 不验证云端配置 |
| 构建 | `npm run build:standalone` 通过 | 未发布 |
| 本地 D1 | 全部迁移在独立本地库成功应用；旧数据迁移回归通过 | 未迁移线上数据 |
| 本地 workerd | config 返回 configured:false、wechat.enabled:false；start 返回 WECHAT_DISABLED | 没有配置可用的真实登录 |
| 实际浏览器 | Chrome 桌面与 390×844：注册成功回跳、功能关闭隐藏入口、提供商失败后可重试、无邮箱账号绑定、冲突和过期提示、MFA停止；中文浅色/英文深色 | SDK/API由本地 fixture 替代；非真机、非 Safari、非微信内置浏览器 |
| 正式站只读 | 版本核对、游客/私有 HTTP 边界及网络样本，见 S01 文档 | 未登入、上传、扫码或改配置 |

测试业务边界使用实际 HTTP handler、SQLite 迁移/SQL 与存储替身，证明无邮箱映射用户发布 HTML、读取游戏、创建试玩 session、评论，且旧作者的作品不可归档。还覆盖伪造 headers/metadata、取消、过期、并发首次注册、Clerk 已成功但响应丢失、落库失败恢复、绑定冲突、封禁、MFA、pending session、映射撤销、CSRF、晚到响应与账号切换。

复现：

```sh
npm run install:ci
npm run check
npm test
npm run build:standalone
node scripts/standalone.mjs migrate-local
node tests/fixtures/wechat-browser-server.mjs
```

UI fixture 位于 `http://127.0.0.1:4893/`，仅测试真实页面 JS/CSS；不产生二维码、不联系身份平台。截图：[手机注册（本地模拟）](evidence/wechat-signup-mobile-local.png)。

## 尚待真实环境验证的发布门槛

1. 隔离 Clerk development 实例：Required 字段允许无邮箱；验证 createUser、externalId 唯一、重复/超时恢复、ticket 兑换、active session 与 `/api/me`。检查 signup/terms/session task 配置，无绕过条款的选项。
2. 有效微信网站应用和批准回调；至少两个真实微信账号验证首次注册、已有映射登录、显式绑定、拒绝/取消、重复回调、两标签切账号、MFA/封禁与失去最后登录方式后的支持路径。
3. 手机普通浏览器/微信内置浏览器另测。当前只实现网站应用 `qrconnect/snsapi_login`，不实现公众号 H5 网页授权、小程序或它们的 AppID 复用。
4. 补充并审核隐私告知：AppID/OpenID/可选 UnionID、Clerk subject、映射、短期流程数据、持久恢复预留及删除请求如何处理；当前生产隐私页面未被本分支修改。运行日志不得记录 OAuth code、完整 callback query、provider token、AppSecret、Clerk ticket。
5. 主线迁移对齐、PR 评审、独立测试部署验收后，再安排生产迁移/灰度。开关回滚会阻止纯微信无邮箱会话继续进入业务；若曾启用，须先规划该类用户的恢复途径，不承诺关开关对其无影响。

具体需要 Pacifica / 孙补齐的资料统一放在 [S01 前置清单](china-dual-domain-plan-2026-11-18.md#集中前置清单)。密钥不要发聊天或提交到仓库。

## 本轮官方依据

微信官方文档的 web 工具读取失败后，直接 HTTPS GET（解压 gzip）读取到了正文；这是文档核查，不是后台批准或扫码测试。网站应用须先审核并开通登录；网站应用使用 OAuth authorization code，`snsapi_login`，回调域与审批配置一致，state 用于关联请求。不能把它当作 OIDC discovery。[微信网站登录指南](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html)

Clerk `createUser()` 受实例 Required 字段约束；本实现省略邮箱，不将任何邮箱自动标为已验证。externalId 在实例内唯一，恢复查询使用精确 externalId 筛选。[createUser](https://clerk.com/docs/reference/backend/user/create-user)、[getUserList](https://clerk.com/docs/reference/backend/user/get-user-list)
