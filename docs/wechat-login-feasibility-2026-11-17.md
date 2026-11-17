# Funtrack 微信登录可行性

后续进展：已开始实现“网站扫码 + 首次邮箱验证 + 原账号绑定”，详见 [接入实现与启用条件](wechat-login-implementation-2026-11-17.md)。下面保留实施前的研究依据；它不代表已配置真实微信应用或已通过扫码验收。

核查日期：2026-11-17。仅做官方资料和本地代码的只读核查；没有注册微信应用、修改登录配置或上线微信登录。微信文档的网页检索器读取失败后，直接从 `developers.weixin.qq.com` 取得 HTTP 200 原文，证据暂存于忽略目录 `.preview/wechat-login/`。

## 结论

可以接入，但当前不是打开 Clerk 的一个现成开关。建议先做 **PC 网站微信登录 + 绑定已有 Funtrack 账号**，再决定微信内 H5 和纯微信新用户的注册体验。当前缺少微信应用与权限审核、自有域名，以及微信身份到现有账号的绑定代码。下面的接法是工程建议，尚未实测微信授权。

## 两种入口是不同能力

| 场景 | 已核实的官方能力 | 对 Funtrack 的含义 |
| --- | --- | --- |
| 电脑浏览器的网站 | 开放平台网站应用使用 `qrconnect`、`snsapi_login`。符合版本条件的桌面微信也可直接确认快速登录，仍可切回二维码。 | 登录按钮打开微信官方授权页即可；不必先做内嵌二维码组件。 |
| 微信内部打开的网页 | 服务号网页授权使用 `oauth2/authorize`，`snsapi_base` 获取身份，`snsapi_userinfo` 可取得用户授权的资料。 | 是另一套 AppID/权限/回调配置，不能用 PC 网站应用 AppID 替代。 |

来源：[网站登录指南](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html)、[服务号网页授权](https://developers.weixin.qq.com/doc/service/guide/h5/auth.html)。

## 申请和域名条件

- 网站登录需开放平台开发者账号、审核通过的网站应用及微信登录能力，获得 AppID/AppSecret；回调域必须匹配审核时的授权域。[网站登录指南](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html)
- 当前官网审核规范要求能看到应用功能、主体、协议、联系方式等资料；只露出一个登录界面不够。规范还涉及网站信息登记表、备案信息及主体一致性，也包含个人与港澳/海外主体的材料条款。因此不能笼统断言“个人绝对不能申请”或“所有海外主体都按同一备案路径”；Funtrack 的主体、类目及具体材料需要在实际申请前核准。[应用审核规范](https://developers.weixin.qq.com/doc/oplatform/Website_App/operation.html)
- 微信内 H5 网页授权主要面向已认证服务号，官方另列已认证政府、事业单位、媒体公众号例外。需配置完整的网页授权域名，不能把其他子域自动视作同一域。[网页授权条件](https://developers.weixin.qq.com/doc/service/guide/h5/auth.html)
- 不要把“网站应用业务域名”说明中的 PC 小程序拉起/分享限制误写成所有微信登录的要求；该能力与登录授权回调域不是同一设置。[业务域名说明](https://developers.weixin.qq.com/doc/oplatform/Website_App/guide/domain.html)
- Clerk 正式实例要求拥有域名、能配置 DNS，并准备自己的社交登录凭据。现有 `workers.dev` + Clerk dev 可以继续当前测试，但不能据此保证微信申请审核通过。[Clerk 正式上线](https://clerk.com/docs/guides/development/deployment/production)

本轮没有访问微信账号后台，所以没有确认我们的可选主体类别、实际审核材料或报价。不引用网上常见的固定认证费/年费数字作为本项目预算。

## Clerk 接法

截至核查日，Clerk 官方完整社交登录列表未包含 WeChat。Custom provider 文档要求 OIDC 兼容身份源；文档允许属性映射和 UserInfo 代理，并给出 Cloudflare Worker 示例，但这不证明微信的 OAuth2 接口可直接填进去使用。[支持列表](https://clerk.com/docs/js-frontend/guides/configure/auth-strategies/social-connections/overview)、[Custom provider](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/custom-provider)

可选路径：

1. **建议的最小接法：Worker 微信 OAuth 适配 + 已绑定 Clerk 用户的登录票据。** Worker 校验微信回调，查 D1 身份映射，调用 Clerk Backend `createSignInToken`，前端用 ticket 流程完成正常 Clerk 会话。票据为一次性；显式设短有效期，不沿用 API 的长默认值。必须处理未完成状态/会话任务，不能把拿到票据直接当成登录成功。[创建票据](https://clerk.com/docs/reference/backend/sign-in-tokens/create-sign-in-token)、[JavaScript ticket 流程](https://clerk.com/docs/js-frontend/guides/development/custom-flows/authentication/legacy/embedded-email-links)
2. **OIDC 桥接。** 自建或使用有明确微信能力的身份桥，将微信授权规范化后再连 Clerk。配置体验可更统一，但需要额外协议、服务及运维，当前规模不优先。仅 UserInfo 转字段是否足够，仍需实际验证授权端、令牌端兼容性，不能先承诺。

这两条都可以放在现有 Cloudflare 架构中评估，不需要为了 OAuth 单独买传统服务器。实际服务费用仍取决于所选微信主体/服务、Clerk 方案和云用量；本轮未确认新增收费。

### 当前代码有一个关键前提

`lib/funtrack/standalone-auth.mjs` 的 `verifiedProfile()` 必须取得已验证邮箱，否则返回 `EMAIL_VERIFICATION_REQUIRED`。微信标准用户资料没有提供邮箱字段，不能伪造一个邮箱来绕过该要求。[微信资料字段](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Authorized_Interface_Calling_UnionID.html)

因此第一版最稳妥的流程是：

```text
已有账号登录 → 在账号设置绑定微信 → 后续可用微信登录同一个账号
首次微信用户 → 完成一次现有邮箱验证/注册 → 绑定微信 → 继续使用
```

如果产品坚持纯微信免邮箱注册，需要单独迭代平台身份模型和 Clerk 必填项，补回找回账号、解绑及权限测试。Clerk 的 `createUser` 遵守实例必填项；该 API 默认把提供的邮箱标记为已验证，不能拿它给未验证的用户输入“补认证”。[createUser 文档](https://clerk.com/docs/reference/backend/user/create-user)

## 不丢作品的身份设计（建议，尚未实现）

- 保存 `(provider, appid, openid) → clerk_user_id → 稳定业务作者ID` 的唯一映射；若返回 UnionID，同时按所属开放平台账号保存。UnionID 用于同一开放平台账号下的多个应用互通，不能假设任何入口都必然返回它。[UnionID 说明](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Authorized_Interface_Calling_UnionID.html)
- 绑定必须同时证明“当前 Funtrack 会话”和“本次微信授权”，并发绑定使用唯一约束。已绑定别的账号时不能覆盖；不能按微信昵称、头像或客户端传来的邮箱合并。
- 保留现有作品/版本/名片的作者 ID；新增登录方式只指向旧作者。Clerk 的自动社交账号关联主要依赖邮箱，微信无邮箱时不能假设会自动归并。[Clerk account linking](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking)
- state 使用与浏览器绑定的随机值和短 TTL，回调只能消费一次；AppSecret、access token 留在 Worker；短时登录票据不要写日志、持久浏览器存储或外链；所有返回地址限站内。这里是实施要求，不代表本轮已经有这些保护。
- 开发环境升级为正式 Clerk 实例仍需要此前规划的跨实例账号映射。加入微信不能代替那次迁移。

## 现在可准备与后续验收

**可先准备：** 独立身份映射表设计、微信授权 start/callback 路由与失败状态、已有账号绑定入口、受控 ticket 完成页；用模拟微信响应测试 state、重放、绑定冲突、取消、超时和账号归属。真实凭据未就绪时不向测试者显示可点击却无法工作的登录入口。

**外部前提：** 确认申请主体/类目，准备自有域名与可审阅网站资料，创建并获批网站应用和微信登录；若要微信内无缝授权，再准备符合条件的服务号。AppSecret 应通过部署密钥配置，不能贴聊天或放前端。

**真实验收：** PC 扫码/桌面快速确认、取消及过期二维码、微信内路径（若纳入）、老账号绑定与再次登录、新用户一次邮箱验证、错误账号绑定冲突，以及登录前后的原作品、历史版本和旧名片归属。未取得上述外部条件前，不能宣布微信登录已跑通。
