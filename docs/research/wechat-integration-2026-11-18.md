# F08 · 微信接入复核与推进顺序

核查日期：2026-11-18。结论：可复用 PR #1 的账号绑定思路，但它不能直接合并到现在的主线，更不能仅在 Clerk 增加一个按钮就完成微信登录。今晚没有改真实认证配置或应用审批。

## 当前证据

- 正式域名、邮箱/Google 登录、公开介绍和政策页面已具备；这不等于微信平台已批准应用。
- [PR #1](https://github.com/PacificaPie/funtrack/pull/1) 草稿分支 `feat/wechat-email-login` 当前检查点 `9943952`；重新运行 `tests/wechat-auth.test.mjs`、`tests/wechat-frontend.test.mjs`，**28/28 通过**。这些是本地模拟边界，不是真实微信授权。
- 用 `git merge-tree --write-tree 79bda58 9943952` 做无工作区改动的合并预演：`drizzle/meta/_journal.json`、`lib/funtrack/standalone-auth.mjs`、`public/site.js` 存在冲突。
- 微信草稿使用 `0013_wechat_identities.sql`，主线已有 0013 作者资料和 0014 评论版本迁移。集成时把**尚未应用的微信迁移**改为下一可用编号（当前候选 0015），不能改写已应用迁移。

## 平台边界

| 场景 | 需要的入口 | 和现有账号的关系 |
|---|---|---|
| 电脑上的网站扫码 | 微信开放平台网站应用，`qrconnect` / `snsapi_login` | 扫码后显式关联到一个 Clerk 用户 |
| 微信内打开 H5 | 公众号网页授权及对应权限/回调域 | 不是网站应用 AppID 的直接复用 |
| 小程序 | 小程序登录及其应用配置 | 本次不扩展到小程序 |

网站登录官方要求回调域与获批配置一致，并建议用 state 防止跨站请求。公众号 H5 网页授权通常面向已认证服务号，官方还列有政府/事业单位/媒体等适用例外；申请主体、地区、认证材料和权限应以实际后台为准。本次没有臆造固定认证费用，也没有断言所有个人主体都一定可申请或一定不可申请。

Clerk 的自定义社交连接要求 **OIDC**。微信网站 OAuth 2.0 不是可直接当成 OIDC discovery 的接口。仅代理用户资料并不能证明兼容；现有草稿走服务端账号映射 + Clerk 一次性登录票据路线，需要维护明确的安全边界。

来源：[微信网站登录](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html)、[网站应用审核](https://developers.weixin.qq.com/doc/oplatform/Website_App/operation.html)、[公众号 H5 网页授权](https://developers.weixin.qq.com/doc/service/guide/h5/auth.html)、[Clerk 自定义 OIDC 提供商](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/custom-provider)。

## 旧草稿账号流程（已被后续产品反馈取代）

已有用户先用邮箱或 Google 登录，在账号设置点“绑定微信”；完成近期再验证和微信授权后，页面同时显示将关联的 TryMe 账号并明确确认。绑定后微信登录回到同一个 userId，作品、名片和评论不搬家。

旧草稿要求新微信身份先完成现有邮箱验证/注册再绑定；该前置要求已被用户否定，不作为目标流程。微信资料没有可靠邮箱；不生成假邮箱、不自动标为已验证、不按昵称合并。`(appid, openid)` 唯一映射；UnionID 只有在适用的同一开放平台关系下才可用，不能自行跨应用推测身份。

草稿已有：短期 state / 浏览器证明 / 一次性完成凭据，数据库哈希存储；HttpOnly/Secure/SameSite=Lax Cookie；已有用户绑定需近期再验证；账号切换/身份冲突防护；60 秒 Clerk 登录票据；MFA 或 session tasks 回退现有登录；未配置时隐藏入口。仍需在最新主线复验，而非把旧测试结论直接视为 production 结论。

## 下一步按顺序做

1. **Pacifica + 孙**核实申请主体、地区、网站应用审批、微信登录权限和实际回调域；后端候选回调 `https://trymecard.com/api/auth/wechat/callback`，以最终批准配置为准。
2. **Pacifica**在隔离分支处理以上 3 处冲突与迁移编号，保留 production Clerk 的新权限逻辑、游客 Feed 和旧数据；功能开关维持关闭。
3. 将 AppID/Secret 直接配置到正确的测试环境秘密存储，避免提交源码或聊天。先本地/测试环境验证，不在没有审批、凭据时展示一个无效登录按钮。
4. 回归 state 重放、错浏览器、双标签页切账号、绑定冲突、取消授权、超时、邮箱未验证、MFA、票据过期和旧名片归属。
5. 使用两位真实账号测试桌面扫码和已有账号绑定。国内网络单独测试 Clerk、邮件、Google、静态资源和 API；微信登录可用不能替代国内可访问性结论。
6. 待用户验收和明确发布安排，再单独迁移与灰度启用；H5 微信内授权后续另立切片。

## 尚未完成

实际应用主体/审批材料/权限、正式 AppID 和 Secret、分支整合、真实扫码、国内网络、MFA 及新用户真实验证均未完成。`#/wechat` 是可点击的绑定交互示意，未产生任何真实关联。F08 保留后续功能，不因本次探索被标记为已上线。


## 产品反馈：微信与邮箱并列（11.18 后续）

用户明确指出邮箱与微信应当并列。目标：微信授权成功即可独立注册或登录；邮箱为可选补充。已有邮箱账号可主动关联微信，关联需验证双方身份，不根据昵称、头像或不可信邮箱自动归并。若双方已各有作品，提示账号冲突并另行确认迁移，不静默转移归属。

当前代码有三个邮箱前置点：微信草稿 `activeEmail()`；主线 `standalone-auth.mjs` 的 `verifiedProfile()`；业务边界 `rules.mjs` 的 `authenticate()` 同时要求 id 与 email。需要跨层调整，不能只删登录页提示或直接放过所有无邮箱用户。

执行顺序：
1. 在独立开发实例验证 Clerk 无邮箱用户的创建、完整 session、冻结/封禁、session tasks 与 MFA 行为。官方 `createUser()` 明确受实例 Required 字段约束；有 `externalId` 并不证明当前 production 配置允许无邮箱身份。不得伪造邮箱或将未验证邮箱标记为 verified。
2. 确定账号主体与身份映射：可信微信 OAuth 结果 `(appid, openid)` 唯一对应一个业务用户；UnionID 仅作有依据的跨应用关联线索。映射写入必须幂等，处理并发首次注册和外部账号创建成功但数据库写入失败的补偿，不能重复创建用户。
3. 修改身份准入：已验证邮箱，或服务端可核实的有效微信身份，均可进入业务；邮箱可空。保留会话验证、封禁、MFA、CSRF/state、一次性票据和近期验证。昵称回退用平台显示名，不再必须拆邮箱。现有 ownerId、作品、名片和评论归属保持兼容。
4. 分开“登录/注册”与“关联已有账号”；补邮箱要验证码，遇到已占用邮箱进入显式关联流程，不能借补资料接管其他账号。删除最后一个可用登录方式须有替代恢复路径。
5. 测试无邮箱用户发布/试玩/评论、两个入口登录同一账号、关联冲突、双标签页切号、取消授权、重复回调、MFA和被封禁账号。真实扫码与国内链路验收另做。

本次已改可点击原型 `#/wechat` 为并列入口与新微信用户直接进入流程，并更新执行方案；**尚未改动正式认证实现或 Clerk production 设置**。旧分支的28项测试只证明旧流程，不能作为新注册流程已完成的证据。

来源：[Clerk createUser](https://clerk.com/docs/reference/backend/user/create-user)、[短期登录票据](https://clerk.com/docs/reference/backend/sign-in-tokens/create-sign-in-token)、[自定义连接要求 OIDC](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/custom-provider)。微信官方文档本轮读取失败，接口边界沿用仓库既有复核和实际草稿代码，不宣称已完成官方后台或真实扫码复验。
