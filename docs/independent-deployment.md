# 独立 Cloudflare 部署

这个目标使用 Cloudflare Worker + D1 + R2，以及 Clerk 登录。访问者不需要 ChatGPT 账户。2026-11-16 已发布 `workers.dev` 临时公网测试站，使用独立 staging D1/R2 和 Clerk development 实例，公开配置在 `wrangler.standalone.staging.jsonc`。实际资源、验收与限制见 [本次部署记录](./cloud-deployment-2026-11-16.md)。正式域名与 Clerk production 实例尚未配置。

默认 `npm run dev` / `npm run build` 仍是 Sites 目标。独立目标必须显式选择 `FUNTRACK_TARGET=standalone`，使用 `worker/standalone.ts`，关闭 Sites mock 登录与连接器预览。它不读取 `.openai/hosting.json`，也不会复制 Sites 的云资源描述。

## 文件与隔离

| 用途 | 路径 |
| --- | --- |
| 可本地构建的配置模板 | `wrangler.standalone.jsonc` |
| 临时公网测试配置 | `wrangler.standalone.staging.jsonc` |
| 独立前端与 Worker 产物 | `dist-standalone/client/`、`dist-standalone/server/` |
| 产物部署配置 | `dist-standalone/server/wrangler.json` |
| 独立本地 D1/R2 状态 | `.preview/standalone-state/` |
| 独立 Vite 缓存 | `node_modules/.vite-funtrack-standalone/` |
| 产物准备检查 | `scripts/standalone-deploy.mjs`，默认 production，staging 须显式 `--mode staging`；只检查，不部署 |

模板的全零 D1 ID 仅用于本地模拟，不是一个生产数据库。模板没有公网路由，且 `workers_dev:false`；它不能直接作为可访问的正式站点发布。

三个 Vite 环境分别输出到独立目录。当前 vinext 的 build-id 写入器有固定 `dist/server` 路径，独立目标替换了这一写入器。构建脚本还会恢复 Cloudflare 插件自动写入的 `.wrangler/deploy/config.json`，避免改变 Sites 工具的默认目标。后续命令仍须显式 `--config`；不要在同一工作副本并行构建两个目标。

## 现在可以做的本地操作

安装依赖由项目现有流程处理；本轮不需要重复安装。使用 Node.js 22.13 或更新版本：

```sh
npm run build:standalone
node scripts/standalone.mjs migrate-local
npm run dev:standalone
```

独立预览只监听 `http://127.0.0.1:8787`，不会停止现有 8766 预览。`migrate-local` 是显式的本地数据库操作，只接受本地配置，固定 `--local` 和独立持久目录，不支持 `--remote`。

没有 Clerk 配置时，静态页面和 `/api/auth/config` 可打开；配置返回 `configured:false`，受保护 API 返回 `503 AUTH_NOT_CONFIGURED`。这不是一个模拟登录账户，也不会接受浏览器伪造的 `oai-authenticated-*` 头。

本地使用 Clerk 测试实例时，将测试 Publishable Key 写到本地配置的 `vars.CLERK_PUBLISHABLE_KEY`。Secret Key 放在本机未纳入版本控制的 `.dev.vars`，或通过安全方式供给进程环境；不要放进 `vars`、前端代码、命令行参数或聊天。配置的 `secrets.required` 仅允许加载列出的秘密名称。远端测试实例必须明确设置 `CLERK_TEST_MODE=1`；下面的 staging 检查接受这种模式，正式发布检查仍拒绝它。

这些秘密加载规则遵循 [Cloudflare 的本地 Secret 配置](https://developers.cloudflare.com/workers/configuration/secrets/)。Vite 的配置路径与独立持久目录使用官方的 [`configPath` / `persistState`](https://developers.cloudflare.com/workers/vite-plugin/reference/api/) 选项。

## 临时公网测试：staging

测试站地址：`https://funtrack-staging.zhayizha-pacificapie.workers.dev/site`，已完成 Worker 发布。配置中的公开资源如下：

| 资源 | staging 配置 |
| --- | --- |
| Worker / R2 bucket | `funtrack-staging` |
| D1 database | `funtrack-staging`，ID `69196d4d-4dac-4cf4-b2b2-a04a7f22f078` |
| Clerk application | `app_3MDOOvzzTsVju7zWvc0C1rRU9og` |
| Clerk development instance | `ins_3MDOOs6bu4DAkAP7qGOSVbYazA1` |

staging 要求 `workers_dev:true`、`preview_urls:false`、无额外自定义路由；`APP_ORIGIN` 必须精确匹配 Worker 名称和账户子域，不接受路径、尾斜线或另一个站点。仅接受 `CLERK_TEST_MODE:"1"`、`pk_test` 与私下提供的 `sk_test`，并复用 Worker 的密钥解析器检查合法 Base64 和实例类型。DB/R2/Worker 名称都必须有独立 `staging` 段。预检拒绝已知的 production D1 ID，即使将它的名称改成 staging；若存在 `wrangler.standalone.production.jsonc`，还会排除其中的 D1 ID 和 R2 名称。

Clerk 的 development 实例适合公开预览，但不是正式生产实例；其用户数和迁移限制参见 [Clerk 环境说明](https://clerk.com/docs/guides/development/managing-environments)。暂不将测试账号、统计或作品当成正式数据。已在实际地址用 Clerk 保留测试邮箱完成验证码注册、会话刷新和游戏 iframe 验收；真实邮箱投递与 Google OAuth 仍需测试者使用自己的账号确认。

通过隐藏输入或 CI 秘密存储给当前进程提供 `CLERK_SECRET_KEY`，然后执行以下步骤。检查不读取 `.env` 文件，也不输出秘密；密钥有效性最终由真实 Clerk 请求验证。

```sh
node scripts/standalone.mjs validate --mode staging --config wrangler.standalone.staging.jsonc
node scripts/standalone.mjs build --config wrangler.standalone.staging.jsonc
node scripts/standalone-deploy.mjs --mode staging
```

同一 `dist-standalone` 目录每次只代表最近构建的独立配置；产物检查会重新核对其资源、origin 和密钥模式。不能跳过重新构建而部署先前的 local/production 产物。

迁移采用下一节的 Wrangler 流程，将 `--config` 改为 `wrangler.standalone.staging.jsonc`，先 `list` 核对迁移账。将 secret 通过 stdin 写入对应 Worker 后，执行 dry-run 与发布：

```sh
printf '%s' "$CLERK_SECRET_KEY" | node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js secret put CLERK_SECRET_KEY --config wrangler.standalone.staging.jsonc
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js deploy --dry-run --config dist-standalone/server/wrangler.json
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js deploy --config dist-standalone/server/wrangler.json
```

不要启用 shell 的 `set -x`；命令完成后清除当前 shell 的临时秘密变量。这里的脚本不会自动创建资源、执行迁移或发布；上述 Wrangler 命令才执行对应云端操作。

## 准备真实生产配置

1. 确认独立 Cloudflare 账户、受控域名及域名所在 Zone。先确定唯一站点 origin，例如自己的 `https://play.<真实域名>`；不能有路径或末尾斜线。
2. 建立 Clerk 生产实例，在 Clerk 控制台完成其域名/DNS和应用设置，将登录与登出后返回地址设为同一站点。测试实例不等于生产实例。
3. 配置就绪后使用独立 production D1、R2 和 Worker。production 与 staging 均不得借用 Sites 资源，也不能互用各自的数据库或 bucket。当前已单独创建 production D1，尚不代表正式环境已可发布。
4. 复制模板为根目录下的 `wrangler.standalone.production.jsonc`，填写真实 Worker 名称、D1 名称与 ID、R2 名称，以及 `vars.APP_ORIGIN` 和生产 `vars.CLERK_PUBLISHABLE_KEY`。Secret Key 不写入这个文件。
5. 增加与 `APP_ORIGIN` 完全匹配的 Custom Domain 路由，例如以下结构中的占位符必须替换成实际受控域名：

```json
{
  "workers_dev": false,
  "preview_urls": false,
  "routes": [
    { "pattern": "play.<真实域名>", "custom_domain": true }
  ]
}
```

正式检查要求这条域名路由；仅填写 `APP_ORIGIN` 不会自动提供可访问地址。配置域名使用 Cloudflare [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) 的机制。没有域名时可使用上面的 staging 流程；它通过的是测试环境检查，不等于正式生产部署。

公开配置可以存入仓库；真正的 Secret Key、Cloudflare API Token、`.dev.vars*` 等必须留在安全的本地或 CI 秘密存储中。不要将秘密发到聊天中。`CLERK_PUBLISHABLE_KEY` 是公开配置，`CLERK_SECRET_KEY` 是服务端秘密，两者用途不同。

## D1 迁移的执行者与历史表

继续用现有 `npm run db:generate` 生成 `drizzle/000N_*.sql`。独立配置的 `migrations_dir` 指向 `drizzle`，Wrangler 可以发现其中顶层 SQL；`--> statement-breakpoint` 是 SQL 注释。不要再用 Wrangler 生成第二套同名 schema 迁移。

`drizzle/meta/_journal.json` 是代码生成历史，Wrangler 的 `d1_migrations` 是目标数据库中已执行迁移的记录，两者不是同一张账。独立的新空 D1 由 **Wrangler migrations** 执行和记账，不同时交给 Sites 的迁移器或另一套 Drizzle migrator 重放。

后续实际操作时，先审阅 SQL、Cloudflare 账户和目标名称，再列出远端待执行项：

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 migrations list DB --remote --config wrangler.standalone.production.jsonc
```

目标确实是新建、独立的 D1 时，执行迁移：

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --remote --config wrangler.standalone.production.jsonc
```

以上步骤针对所选配置执行，以目标数据库的迁移账为准。对已经有表但没有 `d1_migrations` 历史的数据库，不要直接 apply、伪造已执行记录或清空表；先核对 schema 和现有迁移来源，再制定受控 baseline。官方机制见 [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)。

## 秘密配置、构建与发布检查

通过本机隐藏输入或 CI 秘密存储，将生产 `CLERK_SECRET_KEY` 提供给当前进程。预检只在内存中验证其格式，不显示、保存或发送值；它复用 Worker 的公开配置解析器，允许合法的 Base64 padding。离线通过不能证明密钥有效、两把密钥属于同一实例或 DNS 已生效。

```sh
node scripts/standalone.mjs validate --config wrangler.standalone.production.jsonc
node scripts/standalone.mjs build --config wrangler.standalone.production.jsonc
node scripts/standalone-deploy.mjs
```

模板状态下 `validate` 拒绝发布是预期行为。检查会拒绝本地占位数据库、缺失配置、测试模式/密钥、没有对应域名路由，以及将秘密写进公开 `vars`。

使用目标账户，通过 **stdin** 将秘密交给 Wrangler；以下命令不把值放在参数中，也不显示值：

```sh
printf '%s' "$CLERK_SECRET_KEY" | node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js secret put CLERK_SECRET_KEY --config wrangler.standalone.production.jsonc
```

这一步是云端秘密写入。Wrangler 提示创建 Worker 时，使用配置中指定的独立 Worker 名称和目标账户。也可在目标 Worker 的控制台中设置同名 Secret。完成后从当前 shell 清除临时变量。

接下来执行 dry-run，检查产物与资源绑定：

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js deploy --dry-run --config dist-standalone/server/wrangler.json
```

配置和检查就绪后，执行不带 `--dry-run` 的同一命令完成发布。所有部署命令都指向独立产物，不能指向 Sites 的 `dist/server/wrangler.json`。Cloudflare 与 Clerk 的实际额度和费用由对应账户管理；配置预检不验证账单设置。

## Sites 数据不会自动迁移

独立 D1/R2 初始是空的。换前端地址、复制 HTML 文件或配置 Clerk 不会迁移 Sites 云数据。

保留数据需要单独制定导出、检查、复制和回退方案：D1 中的作品、版本、不可变 metadata、名片、互动和统计引用要一起核对；R2 的游戏与封面 key 必须维持对应关系；抽样比较原始文件 hash，再验证旧名片与历史版本仍可访问。迁移账也要与目标数据库实际 schema 对齐。

新身份是 `clerk:user_…`，与 Sites 用户 ID 不同。旧作品 owner 不能凭同名或同邮箱自动绑定；迁移需使用可核验的旧身份→新身份映射，保存旧 ID、目标 ID、归属依据和回滚记录。历史互动的 actor、作者显示名和统计归因需分别考虑，不能把所有旧记录都改成一个新用户。本轮没有执行任何 owner 重写或数据复制。

## 正式生产上线前仍未完成的验收

- 真实 Clerk 生产实例的注册、邮箱验证、登录、退出、刷新、会话过期，以及 iframe `/game` 和 `/media` 的会话链路。
- 真实域名和 DNS、正式资源的权限与备份/恢复，以及受保护请求遇到 Clerk 暂不可用时的体验。R2 已由用户开通，staging 的 D1/R2 已真实读写验证。
- 上传、版本更新、回滚、封面、名片快照和统计已在 staging 公网 origin 验收；切换 production 密钥和域名后仍需复核对应流程。
- 本轮定向修补后，生产依赖 audit 为 0，全量依赖无 high/critical，仍有 9 项构建/开发工具及未调用 OG 链路告警。正式发布前按新代码重新审计实际调用路径；不要用一键 `audit fix` 代替兼容性评估。

GitHub 仓库构建已在独立 staging 接入 Cloudflare Containers：私有 Worker 调度每任务容器，完成后回收，不再需要本机 runner。网站 Worker 本身仍不执行 npm；真实仓库的导入、构建、预览、发布与试玩已通过，详情见 [云构建部署与验收](./cloud-builder-deployment-2026-11-16.md)。当前仅支持符合约束的公开 Vite 项目，正式域名和 Clerk production 验收仍属独立后续工作。
