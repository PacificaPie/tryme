# TryMe 正式域名发布记录

日期：2026-11-17（America/New_York）。用户明确授权本次直接合并 PR #3 并上线；首版使用邮箱验证码，Google 登录后补。旧测试站账号和内容保留在原站。

正式站已发布：[https://trymecard.com](https://trymecard.com)。部署检查和真人流程验收分别记录。

## 发布版本与资源

| 项目 | 实际值 |
| --- | --- |
| 合并 PR | [#3](https://github.com/PacificaPie/funtrack/pull/3) |
| 发布代码 | `458561f34280ba7af37478b1590ec635487d2f7e` |
| main CI | [44233187784：通过](https://github.com/PacificaPie/funtrack/actions/runs/44233187784) |
| 主站 Worker / 版本 | `funtrack-production` / `b303650b-dc1e-4a77-b879-00c7cf9db0f2` |
| 私有构建器 / 版本 | `funtrack-builder-production` / `a553bbf8-20b7-4156-b01e-4725bd656f95` |
| 容器应用 | `a034f8e4-f08b-445a-9545-d160e69ffb3c` |
| 容器镜像 SHA-256 | `1ccd66dd34f245b2ddc007fd8959f172a6ab64235ade7314ead6558b48a2c2d4` |
| 容器设置 | `standard-1`，最多 2 实例，`scheduling_policy=default` |
| D1 | `funtrack-production` / `106c5ea7-2c17-44ea-93f5-5383168365c0` |
| R2 | `funtrack-production` |
| Clerk production | `ins_3MGNuVSO1Wsq2JmBzyUnucNUTcD` |

主站绑定 `trymecard.com` Custom Domain。构建器无公开路由、workers.dev 或 preview URL，仅通过 service binding 连接主站。两个 Worker 使用独立 production runner secret，未复用或轮换 staging secret；服务端密钥不进入源码、命令参数或发布记录。

## 已完成的检查

- [x] 域名由用户购买；Cloudflare 状态 Active，自动续费开启，到期日 2027-11-17。
- [x] Clerk 的 5 条 DNS only CNAME 完成验证；Frontend API、Account Portal、邮件和 SSL 均验证完成。
- [x] 生产登录使用 `email_code`，注册必须验证邮箱；生产 Google 登录关闭。登录/注册路径为 `/auth/sign-in.html`，首页和退出后路径为 `/site`。
- [x] 生产密钥通过真实 Backend API 校验；配置时用户计数为 0。
- [x] D1 先导出备份，再补齐 `0007`–`0014`；复查无待应用迁移。迁移前作品、版本、名片、资料、评论和事件均为 0。
- [x] 512 项自动化测试、main CI 通过；生产配置新增后的 45 项相关测试通过。正式构建、预检、主站与构建器 dry-run 通过。
- [x] `/` 正常跳转到应用；`/site` 返回 200；浏览器可从首页进入邮箱登录表单，没有 Google 入口。
- [x] `/api/auth/config` 返回 `provider:clerk`、`configured:true`、`environment:production`；不返回服务端 secret。
- [x] 未登录 `/api/me`、`/api/works` 返回 401；伪造 Sites 身份头的 `/api/me` 仍返回 401。
- [x] 线上 `discussion.js`、`creator-home.js`、`import-status.js` 的 SHA-256 与发布代码一致。
- [x] 生产 runner 凭据调用 `POST /api/build-worker/queued` 返回 200，队列为空；这不等于真实容器构建验收。
- [x] 旧 staging `/site` 仍为 HTTPS 200；本次未发布 staging、复制旧内容或改写 owner。

## 仍待真实账号验收

- [x] 2026-11-18 用户完成真实邮箱验证码登录；浏览器确认正式站显示已登录账号并进入 Feed。
- [ ] 登录后的 HTML / GitHub / 外部链接入口、上传、作品预览/发布/试玩、版本与名片分享。
- [ ] 真实生产云构建、自动封面和跨浏览器访问。
- [x] 2026-11-18 退出邮箱会话后，以 Google 登录并正确回到创作中心；游客 Feed 和创作中心登录提示实测通过。
- [ ] 刷新、跨浏览器、新 Google 账号及会话过期行为。

正式站的新身份不会自动拥有测试站作品。旧账号和作品继续在 staging 使用；若要迁入 production，需要核实旧身份与新身份映射并单独校验内容。未把“正式域名已发布”记作所有真人流程已通过。

网页仍沿用 Funtrack 品牌，Clerk 应用显示名为 Funtrack Staging；实例和密钥实际为 production。显示名称统一纳入后续页面整理。

用户已进一步确认游客可浏览 Feed、试玩与创作必须登录；对应变更和 Google 接入缺口见 [权限调整记录](guest-feed-access-2026-11-18.md)。

## 发布工具与回退

主站使用根项目锁定的 Wrangler 4.92.0，构建器使用 `cloud-builder` 锁定的 4.163.0。构建器 Wrangler 会拒绝主站产物中的 `legacy_env` 字段；本次此尝试在上传前终止，随后用根项目版本成功发布。不要为绕过提示手改产物或直接升级整套工具链。

首次生产业务发布前的 Worker 版本仅为 secret 初始化时的占位 Worker，不是可用的业务回退版本。后续发布需记录前一可用版本，确认 schema 兼容后才回滚代码；不删除数据、清空 R2 或撤销已应用迁移。staging 保持独立。

本地校验产物在 Git 忽略目录 `.preview/production-launch/`：`before-launch.sql`、`http-smoke.json`、`runner-smoke.json`。含业务数据的备份不得提交到 Git 或 Notion。

## 关联计划

- [本轮执行计划](tryme-launch-plan-2026-11-17.md)
- [Notion 执行清单](https://app.notion.com/p/41ced61b626d81268cdae374a46b64df)
- [旧 staging 记录](cloud-deployment-2026-11-16.md)
