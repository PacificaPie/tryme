# Google 登录验收与公开信息

2026-11-18。Google 登录连接已生效；下列公开页面仍为待审阅版本，尚未部署。

## 线上已观察到的结果

- 用户自行完成新凭据生成和 Clerk 填写/提交。正式 Clerk Google 连接显示 Enabled；只使用基础 openid、email、profile 权限。
- 正式站退出邮箱会话后，Feed 仍可匿名浏览；进入创作中心显示登录提示。
- 从创作中心进入正式登录页，已出现 Google 按钮；选择此前使用的邮箱账号并授权姓名、头像和邮箱后，成功返回 `/site#/studio/works`，页面显示登录身份。
- 该测试验证现有邮箱对应的 Google 登录链路和回跳；未独立核验 Clerk 账号合并记录，未用第二个新账号测试注册，也未覆盖会话到期或跨浏览器。
- Google Cloud 的 `tryme-card` 项目仍为 External / Testing，发布按钮禁用，提示补全品牌配置。首页已保存为 `https://trymecard.com`，隐私政策与服务条款 URL 仍为空。没有把连接 Enabled 记作 Google 应用已正式发布。

## 本次待审核页面

- `public/about.html`：介绍 TryMe Card、作品与名片流程，解释旧 Funtrack 名称和项目联系渠道。
- `public/privacy.html`：按现有 Clerk/Cloudflare 架构、业务表和权限说明登录数据、用户内容、互动记录、公开边界、服务提供方及数据请求方式。
- `public/terms.html`：账号规则、作品非独占必要授权、分享边界、禁止滥用、早期服务说明和投诉渠道。
- 首页与登录页均有公开入口；页面是独立静态 HTML，不要求登录或 JavaScript，无新增迁移或 API 权限修改。

请负责人审核：联系邮箱使用现有 OAuth 支持邮箱；政策承诺 Google 数据不用于广告、出售或通用模型训练；数据访问/删除请求由团队人工核实处理；作品保留用户权利，仅授予运行本平台所需的非独占使用权。未承诺不存在的固定删除周期、自助账号删除或付费服务。页面更新日期应与实际发布同步。

## 文案依据与限制

实现依据：`db/schema.ts`、`standalone-auth.mjs`、`server.ts`、`docs/analytics-contract.md`、公开 Feed/名片契约。归档、Feed 隐藏、名片软删除与真正删除分开说明；Cookie/本地草稿和服务商基础安全日志也分开说明。

官方配置依据：[Clerk Google 生产连接](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google)、[Google 受众和 Testing 基础身份权限例外](https://support.google.com/cloud/answer/15549945?hl=en)、[Google 品牌及公开链接要求](https://support.google.com/cloud/answer/15549049?hl=en)。这些链接说明配置要求，不代表 Google 已审核本项目。

## 验证与下一步

- `npm run check`、519 项自动化测试、`npm run build:standalone` 通过。
- 本地 Chrome 验证介绍→隐私→条款→Feed 的链接和正文；公开 Feed 与页脚共存。此预览使用本地 fixture，不是生产新增作品。
- 等待文案与此次发布批准；合并不自动部署。
- 上线后匿名核查 `/about`、`/privacy`、`/terms` 与首页/登录页链接，再将实际 URL 填入 Google 品牌及 Clerk 对应链接设置。用 `/about` 作为 OAuth 项目介绍首页。
- 按 Google 实际页面完成发布/所需验证，不通过审批或尚在审核时保持如实记录；只保留基础身份范围。
- 复测生产登录及回跳，再补新账号、跨浏览器和 P04 上传/作品/名片/云构建验收。

主站业务版本仍为 `a7209bc` / `1ed09db3-ee8e-46a1-903f-8c76bf69e220`。本次尚未重发 Worker，未更改 staging，也未存储 OAuth 密钥。
