# TryMe 正式域名上线执行计划

日期：2026-11-17（America/New_York）。按 11.17 会议和用户确认的顺序，先完成正式域名里程碑，再完善产品功能。

最新进展：用户明确授权本次直接合并并上线；PR #3 已合并，正式站已发布。实际版本与已验证范围见 [正式发布记录](production-launch-2026-11-17.md)。P01–P03 已完成，P04 正在进行真人流程验收。

2026-11-18：真实邮箱登录已验证。用户进一步明确“游客刷 Feed，发布作品/名片/试玩需登录”，P08 已按本次明确授权合并 PR #5 并发布；线上匿名 HTTP/权限/hash 检查通过。Google 登录已开始接入，等待用户完成新凭据设置；实现、版本与验证边界见 [游客 Feed 权限记录](guest-feed-access-2026-11-18.md)。其余原型和个人空间工作继续保留。

## 第一里程碑：正式域名上的现有产品可用

| 顺序 | 工作 | 验收标准 | 当前状态 |
| --- | --- | --- | --- |
| P01 | 确定并取得域名 | 具体域名、注册商、费用和管理账号明确 | 已完成：用户购买 `trymecard.com`，Cloudflare 状态 Active；到期日 2027-11-17，自动续费开启，当前续费价 $11.17/年 |
| P02 | 整合发布基线 | 保留作者主页/导入增强和 main 评论修复，检查、测试、构建通过 | 已完成：PR #3 合并至 `458561f`，main CI 通过，该版本已发布 production |
| P03 | 配置域名与登录 | HTTPS、站点 origin、Clerk 生产实例、回调与资源绑定一致 | 已完成：正式站、私有构建器、独立资源、Clerk production 与域名已接通 |
| P04 | 验收正式域名 | 新旧账号方案、上传、作品、版本、名片分享、登录回跳通过 | 进行中：HTTP/认证边界/浏览器登录表单通过；真实邮箱登录与后续流程待验收 |

### P02 的变更范围

以 `main` 的 `d32050a` 为基线，合入 `feat/creator-home-following-avatars` 的 `d608ff5`：

- 保留作者主页、关注、头像、实时资料投影、名片做同款与 16 MiB / 预构建 HTML 导入。
- 保留评论的作品版本、精确上下文定位、幂等重试与页面预期账号校验。
- 评论列表、回复、创作者互动页和定位上下文同时显示实时姓名/头像与历史版本。
- 合并迁移元数据，保留已存在的 `0013_creator_profiles_and_follows.sql` 和 `0014_comment_version_context.sql` 原文；没有重写旧迁移，也未引入微信登录草稿。
- 新增两项交叉回归：实时资料更新不改写评论版本/历史记录；头像与评论版本/定位焦点共同保留。

### 已验证的范围

- `npm run check`：通过。
- `npm test`：512 / 512 通过。
- `node scripts/standalone.mjs build --config wrangler.standalone.staging.jsonc`：通过。
- Wrangler 对 `dist-standalone/server/wrangler.json` 的 `deploy --dry-run`：通过；未实际发布。
- `d1 migrations list DB --remote --config wrangler.standalone.staging.jsonc`：无待应用迁移；未对 staging 执行迁移或数据写操作。
- Chrome + 本地真实前端/router/SQLite fixture：可在当前 v2 作品定位第六条 v1 回复，版本标签、目标焦点保留；点击评论作者可进入作者主页。
- 本地身份和对象存储为 fixture，不代表真实 Clerk 注册/登录或线上写入验收。
- [PR #3](https://github.com/PacificaPie/funtrack/pull/3) 已按用户本次明确授权合并，发布提交 `458561f` 的 [main CI](https://github.com/PacificaPie/funtrack/actions/runs/44233187784) 全部通过。

### 发布前 staging 核对（历史）

准备阶段读取的 staging 部署版本为 `a262ed01-ef0f-4f35-89b5-b4ccdd961e92`；其前端与作者主页分支匹配，`discussion.js` 缺少 main 的 context / expectedAuthorId 逻辑。本轮正式 production 已部署整合版本；staging 未更新。以下是独立更新 staging 时的步骤，不表示本轮已执行。

1. 按协作约定完成另一位合作者审阅，再合并 PR；发布前重新确认 main 与 staging 的实际版本，避免覆盖新部署。
2. 确认显式 staging 配置、已有密钥绑定、D1 迁移账及备份，不把本地产物误当生产产物。
3. 从合并后的版本重新构建并预检，部署明确的 staging 产物；保持现有 D1/R2/构建器绑定。
4. 读取线上资产及受保护接口状态，确认评论修复与作者功能共存；真实写入验收只使用明确的测试作品。
5. 记录实际部署版本、验证结果和前一版本。代码回退仅在 schema 兼容并确认目标后执行，不删除数据或回退已应用迁移。

## 域名、身份与数据处理

准备阶段的线上资源是 staging + Clerk development；本轮已建立独立 production。正式域名、Clerk production 与 production 资源是相互关联但不同的步骤，不直接把 staging 配置改名当作正式上线。

1. 注册商确认具体域名与费用后，完成域名取得和 Cloudflare Zone 验证。
2. 选定唯一站点 origin，按官方 Custom Domain 配置 HTTPS 和 Worker 路由。
3. 核实 Clerk production 实例状态，配置对应 DNS、登录/退出路径、OAuth 与应用 origin；秘密通过安全配置渠道提供，不进入源码、PR 或聊天。
4. 按 `independent-deployment.md` 确认独立 production 资源。保留 staging 的旧数据和访问路径；需要复制的 D1/R2 内容、身份映射、范围、校验与回退需先形成具体方案，不直接改写 owner。
5. 对确定要保留的作品/版本/名片核对引用和文件 hash；新 Clerk 实例的用户不会自动复制，不能把同名或同邮箱视为归属证明。
6. 用正式域名验证真实登录、上传、旧内容访问、名片/二维码和回跳，再进入功能阶段。

用户已完成域名购买。Cloudflare CLI 与网页均已登录；实际扣款以用户账单为准，不在仓库保存注册人联系方式或付款资料。

### P03 已完成的生产准备

- 正式 origin：`https://trymecard.com`。主站配置为 `wrangler.standalone.production.jsonc`；私有构建器配置为 `cloud-builder/wrangler.production.jsonc`。生产 Worker 与构建器分别为 `funtrack-production` 和 `funtrack-builder-production`，不使用 staging 绑定。
- Clerk production 实例：`ins_3MGNuVSO1Wsq2JmBzyUnucNUTcD`。用户确认首版仅用邮箱验证码，Google 登录后补；生产实例实际查询确认 Google `enabled:false`，邮箱注册和登录均使用 `email_code`，注册必须验证邮箱。
- Clerk 的 Frontend API、Account Portal、邮件 3 条记录均已在 Cloudflare 以 DNS only CNAME 配置，控制台显示全部 Verified。Clerk 状态已确认 DNS、SSL、mail 均 complete，两个认证域名的 TLS 校验通过；这不替代真实邮箱注册/登录验收。
- 登录/注册路径为 `/auth/sign-in.html`，首页及退出后路径为 `/site`。生产 secret 的本地副本存于 Git 忽略、权限 0600 的 `.env.clerk-production.local`，并已通过 stdin 设置到生产 Worker；真实 Clerk Backend API 已接受该密钥，配置时生产用户计数为 0。未将服务端密钥写入源码或 PR。
- 独立 D1 `funtrack-production`（`106c5ea7-2c17-44ea-93f5-5383168365c0`）原有 `0000`–`0006`。先导出到忽略目录 `.preview/production-launch/before-launch.sql`，核对 SQL 后应用 `0007`–`0014`；复查无待应用迁移。迁移前作品、作品版本、名片、资料、评论、事件六张表均为 0 条。
- 独立 R2 `funtrack-production` 已创建。旧 staging D1/R2、用户与内容仍按原环境保留；实际复制前需明确范围、身份映射与校验方式。生产新身份不会自动拥有测试站旧作品。
- 生产配置预检、正式产物构建、产物预检、主站 deploy dry-run、构建器镜像构建与 deploy dry-run 全部通过。配置/认证/构建相关 45 项测试通过。

### 正式发布顺序

1. 按用户本次明确授权直接合并 PR #3，并确认正式 Clerk 证书可用。
2. 从已合并提交重新构建生产产物。安全设置主站 `CLERK_SECRET_KEY`；首次设置可创建无域名路由的主站 Worker，作为私有构建器回调目标。
3. 部署独立私有构建器；生成独立生产 runner token，通过 stdin 配置到主站和构建器，不复用或轮换 staging token。
4. 对生产产物再次预检后发布主站，绑定 `trymecard.com` Custom Domain。记录 Worker/构建器版本与容器镜像。
5. 正式域名验证首页、邮箱注册/登录/退出/回跳、上传、版本、名片及云构建。真实邮箱验证码步骤由账号持有人完成；不创建虚构的生产身份冒充真人验收。

生产主站与构建器均已发布，版本和检查结果见正式发布记录。没有复制旧业务数据、改写 owner 或迁移旧账号；旧测试站按用户确认继续保留。生产发布成功不等于所有真人流程验收完成。

## 第二里程碑：完善网页功能

依次推进 P05 原型和权限边界、P06 默认卡/短开屏、P07 个人空间、P08 游客 Feed、P09 名片与作品混排/分类、P10 上传后更新名片、P11 图片与二维码分享、P12 网站数据口径。

- 默认卡/源码依赖王的交付；设计和内容准备可与域名工作并行。
- 名片不展示头像的决定只约束默认卡样式，不删除账号头像。
- 匿名浏览公开 Feed 已确定；匿名试玩需明确范围后实施。
- 旧名片作品版本快照不随新上传自动变更。

P13 由王、孙以真实作品完成使用测试，Pacifica 修复阻塞；P14 记录最终部署与文档。App/小程序、手机沉浸式 Feed、AI 视频/翻译、付费、高级推荐与源码下载继续未排期。

## 来源

- [Notion 执行清单](https://app.notion.com/p/41ced61b626d81268cdae374a46b64df)
- [11.17 会议](https://zcnba9ghasnz.feishu.cn/minutes/obcna25n95hm7v452wv6g77g)
- [协作与 PR 流程](collaboration-handoff.md)
- [独立部署与数据迁移边界](independent-deployment.md)
- [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Clerk production 部署](https://clerk.com/docs/guides/development/deployment/production)

此文件记录计划与已观察到的结果；正式站部署已完成，真人全流程验收仍在 P04 跟踪。
