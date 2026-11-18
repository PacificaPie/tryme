# Google 登录验收与公开信息

2026-11-18。用户已审核并明确授权本次直接合并上线。PR #7 已合并部署，公开信息页面生效；Google Cloud 已切换为 External / In production，正式登录复测通过。

## 线上已观察到的结果

- 用户自行完成新凭据生成和 Clerk 填写/提交。正式 Clerk Google 连接显示 Enabled；只使用基础 openid、email、profile 权限。
- 正式站退出邮箱会话后，Feed 仍可匿名浏览；进入创作中心显示登录提示。
- 从创作中心进入正式登录页，已出现 Google 按钮；选择此前使用的邮箱账号并授权姓名、头像和邮箱后，成功返回 `/site#/studio/works`，页面显示登录身份。
- Google 正式发布后再次退出并从名片入口登录，成功返回 `/site#/cards`；刷新后身份保持。个人主页 URL 的账号 ID 与之前邮箱登录记录一致，支持同一账号关联；未单独读取 Clerk 合并审计记录。未用第二个新账号测试注册，也未覆盖会话到期或跨浏览器。
- Google Cloud 的 `tryme-card` 项目已显示 External / 正式版（In production）。保存品牌链接后发布按钮可用，已确认并完成发布；没有新增敏感范围、徽标或额外域名，也未提交独立品牌名称/徽标验证。
- OAuth 首页 `https://trymecard.com/about`、隐私政策 `/privacy`、服务条款 `/terms` 已保存。Clerk Legal 已保存相同政策链接，并启用新注册时的明确条款确认；已有账号登录复测没有被阻塞。新账号同意流程仍需真实新用户验收。

## 本次已发布页面

- `public/about.html`：介绍 TryMe Card、作品与名片流程，解释旧 Funtrack 名称和项目联系渠道。
- `public/privacy.html`：按现有 Clerk/Cloudflare 架构、业务表和权限说明登录数据、用户内容、互动记录、公开边界、服务提供方及数据请求方式。
- `public/terms.html`：账号规则、作品非独占必要授权、分享边界、禁止滥用、早期服务说明和投诉渠道。
- 首页与登录页均有公开入口；页面是独立静态 HTML，不要求登录或 JavaScript，无新增迁移或 API 权限修改。

用户已批准以下文案：联系邮箱使用现有 OAuth 支持邮箱；政策承诺 Google 数据不用于广告、出售或通用模型训练；数据访问/删除请求由团队人工核实处理；作品保留用户权利，仅授予运行本平台所需的非独占使用权。未承诺不存在的固定删除周期、自助账号删除或付费服务。页面更新日期与实际发布同为 2026-11-18。

## 文案依据与限制

实现依据：`db/schema.ts`、`standalone-auth.mjs`、`server.ts`、`docs/analytics-contract.md`、公开 Feed/名片契约。归档、Feed 隐藏、名片软删除与真正删除分开说明；Cookie/本地草稿和服务商基础安全日志也分开说明。

官方配置依据：[Clerk Google 生产连接](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google)、[Google 受众和 Testing 基础身份权限例外](https://support.google.com/cloud/answer/15549945?hl=en)、[Google 品牌及公开链接要求](https://support.google.com/cloud/answer/15549049?hl=en)。这些链接说明配置要求，不代表 Google 已审核本项目。

## 验证与下一步

- `npm run check`、519 项自动化测试、`npm run build:standalone` 通过。
- 本地 Chrome 验证介绍→隐私→条款→Feed 的链接和正文；公开 Feed 与页脚共存。此预览使用本地 fixture，不是生产新增作品。
- 实际 production build 和离线 preflight 通过；PR #7 CI 与精确发布提交的 main CI 均成功。
- 线上匿名 `/about`、`/privacy`、`/terms`、`/site`、`/auth/sign-in`、`/legal.css` 均 200，内容 SHA-256 与发布源码一致。公开 Feed 200，账号和私有作品列表仍 401。记录：`.preview/google-oauth/production-smoke.json`。
- 正式版 Google 登录、退出、刷新及名片回跳已复测；P04 继续新账号/注册条款确认、跨浏览器、会话到期及上传/作品/名片/云构建验收。

## 发布版本与回退

- [PR #7](https://github.com/PacificaPie/funtrack/pull/7) 合并提交：`cb160aca704a0620c1e83197fbdc28460ba65adc`。
- 主站 `funtrack-production`：`28164db4-a65c-4f97-bc92-d59ce46c1796`。
- [main CI 44255375274](https://github.com/PacificaPie/funtrack/actions/runs/44255375274)：成功；519 项测试及构建通过。
- 构建器仍为 `a553bbf8-20b7-4156-b01e-4725bd656f95`，没有数据库迁移或 staging 发布。
- 前一业务版本 `1ed09db3-ee8e-46a1-903f-8c76bf69e220` 可用于代码回退，但会移除此次公开政策页面；应保持已公开的政策 URL 可访问。Google/Clerk 配置独立于 Worker，代码回退不会自动回退这些设置。
- 部署和预检日志在 `/tmp/tryme-oauth-release-*.log`；OAuth 密钥未进入聊天、Git 或记录。
