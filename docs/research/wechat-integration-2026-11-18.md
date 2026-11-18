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

## 首版账号流程

已有用户先用邮箱或 Google 登录，在账号设置点“绑定微信”；完成近期再验证和微信授权后，页面同时显示将关联的 TryMe 账号并明确确认。绑定后微信登录回到同一个 userId，作品、名片和评论不搬家。

新微信身份先完成现有邮箱验证/注册再绑定。微信资料没有可靠邮箱；不生成假邮箱、不自动标为已验证、不按昵称合并。`(appid, openid)` 唯一映射；UnionID 只有在适用的同一开放平台关系下才可用，不能自行跨应用推测身份。

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
