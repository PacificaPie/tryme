# TryMe 正式域名上线执行计划

日期：2026-11-17（America/New_York）。按 11.17 会议和用户确认的顺序，先完成正式域名里程碑，再完善产品功能。

## 第一里程碑：正式域名上的现有产品可用

| 顺序 | 工作 | 验收标准 | 当前状态 |
| --- | --- | --- | --- |
| P01 | 确定并取得域名 | 具体域名、注册商、费用和管理账号明确 | Cloudflare 结算页显示 `trymecard.com` 注册一年 $11.17，另计适用税费；默认自动续费 $11.17/年。待用户补充注册人信息并付款，未购买 |
| P02 | 整合发布基线 | 保留作者主页/导入增强和 main 评论修复，检查、测试、构建通过 | 本分支已整合，见下方验证；待 PR 审阅与合并 |
| P03 | 配置域名与登录 | HTTPS、站点 origin、Clerk 生产实例、回调与资源绑定一致 | 依赖域名和认证配置；没有用占位生产配置发布 |
| P04 | 验收正式域名 | 新旧账号方案、上传、作品、版本、名片分享、登录回跳通过 | 待 P03；本地验收不替代正式域名验收 |

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
- `d1 migrations list DB --remote --config wrangler.standalone.staging.jsonc`：无待应用迁移；本轮没有执行远端数据库写操作。
- Chrome + 本地真实前端/router/SQLite fixture：可在当前 v2 作品定位第六条 v1 回复，版本标签、目标焦点保留；点击评论作者可进入作者主页。
- 本地身份和对象存储为 fixture，不代表真实 Clerk 注册/登录或线上写入验收。
- [PR #3](https://github.com/PacificaPie/funtrack/pull/3) 的整合提交 `586e732` 已通过[远端 CI](https://github.com/PacificaPie/funtrack/actions/runs/44230561784)：检查、自动化测试与独立部署构建全部成功。PR 尚待协作者审阅和合并。

### 发布前现状与步骤

本次读取的 staging 部署版本为 `a262ed01-ef0f-4f35-89b5-b4ccdd961e92`；线上前端 `discussion.js`、`creator-home.js`、`import-status.js` 与作者主页分支匹配，`discussion.js` 缺少 main 的 context / expectedAuthorId 逻辑。不要仅凭 PR #2 已合并就宣称线上已有全部修复。

1. 按协作约定完成另一位合作者审阅，再合并 PR；发布前重新确认 main 与 staging 的实际版本，避免覆盖新部署。
2. 确认显式 staging 配置、已有密钥绑定、D1 迁移账及备份，不把本地产物误当生产产物。
3. 从合并后的版本重新构建并预检，部署明确的 staging 产物；保持现有 D1/R2/构建器绑定。
4. 读取线上资产及受保护接口状态，确认评论修复与作者功能共存；真实写入验收只使用明确的测试作品。
5. 记录实际部署版本、验证结果和前一版本。代码回退仅在 schema 兼容并确认目标后执行，不删除数据或回退已应用迁移。

## 域名、身份与数据处理

现有线上资源是 staging + Clerk development。正式域名、Clerk production 与 production 资源是相互关联但不同的步骤，不直接把 staging 配置改名当作正式上线。

1. 注册商确认具体域名与费用后，完成域名取得和 Cloudflare Zone 验证。
2. 选定唯一站点 origin，按官方 Custom Domain 配置 HTTPS 和 Worker 路由。
3. 核实 Clerk production 实例状态，配置对应 DNS、登录/退出路径、OAuth 与应用 origin；秘密通过安全配置渠道提供，不进入源码、PR 或聊天。
4. 按 `independent-deployment.md` 确认独立 production 资源。保留 staging 的旧数据和访问路径；需要复制的 D1/R2 内容、身份映射、范围、校验与回退需先形成具体方案，不直接改写 owner。
5. 对确定要保留的作品/版本/名片核对引用和文件 hash；新 Clerk 实例的用户不会自动复制，不能把同名或同邮箱视为归属证明。
6. 用正式域名验证真实登录、上传、旧内容访问、名片/二维码和回跳，再进入功能阶段。

域名购买、生产账号/密钥设置和实际数据迁移尚未完成。Cloudflare CLI 与网页均已登录，域名结算页已交给用户填写注册人信息、核对自动续费并付款；最终金额与注册结果以付款页面及确认信息为准。

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

此文件记录计划与已观察到的结果；不表示域名已购、正式站已部署或真人全流程验收已完成。
