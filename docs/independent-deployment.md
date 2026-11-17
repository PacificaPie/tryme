# 独立 Cloudflare 部署准备

这个目标使用 Cloudflare Worker + D1 + R2，以及 Clerk 登录。访问者不需要 ChatGPT 账户。当前只准备代码和本地构建入口：尚未创建域名、Clerk 实例或独立云资源，也没有完成真实 Clerk 注册/登录、跨页面会话及公网部署验收。

默认 `npm run dev` / `npm run build` 仍是 Sites 目标。独立目标必须显式选择 `FUNTRACK_TARGET=standalone`，使用 `worker/standalone.ts`，关闭 Sites mock 登录与连接器预览。它不读取 `.openai/hosting.json`，也不会复制 Sites 的云资源描述。

## 文件与隔离

| 用途 | 路径 |
| --- | --- |
| 可本地构建的配置模板 | `wrangler.standalone.jsonc` |
| 独立前端与 Worker 产物 | `dist-standalone/client/`、`dist-standalone/server/` |
| 产物部署配置 | `dist-standalone/server/wrangler.json` |
| 独立本地 D1/R2 状态 | `.preview/standalone-state/` |
| 独立 Vite 缓存 | `node_modules/.vite-funtrack-standalone/` |
| 生产准备检查 | `scripts/standalone-deploy.mjs`，只检查和输出步骤，不部署 |

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

以后建立 Clerk 测试实例后，将测试 Publishable Key 写到本地配置的 `vars.CLERK_PUBLISHABLE_KEY`。Secret Key 放在本机未纳入版本控制的 `.dev.vars`，或通过安全方式供给进程环境；不要放进 `vars`、前端代码、命令行参数或聊天。配置的 `secrets.required` 仅允许加载列出的秘密名称。测试密钥只用于本地；远端测试实例必须明确设置 `CLERK_TEST_MODE=1`，本项目的正式发布检查会拒绝这种模式。

这些秘密加载规则遵循 [Cloudflare 的本地 Secret 配置](https://developers.cloudflare.com/workers/configuration/secrets/)。Vite 的配置路径与独立持久目录使用官方的 [`configPath` / `persistState`](https://developers.cloudflare.com/workers/vite-plugin/reference/api/) 选项。

## 准备真实生产配置

1. 确认独立 Cloudflare 账户、受控域名及域名所在 Zone。先确定唯一站点 origin，例如自己的 `https://play.<真实域名>`；不能有路径或末尾斜线。
2. 建立 Clerk 生产实例，在 Clerk 控制台完成其域名/DNS和应用设置，将登录与登出后返回地址设为同一站点。测试实例不等于生产实例。
3. 配置就绪后创建独立 D1、R2 和 Worker。本轮按“先准备”的范围，且尚无真实配置，因此没有执行云端创建或部署。不要借用 Sites 配置里的资源名称或 ID。
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

正式检查要求这条域名路由；仅填写 `APP_ORIGIN` 不会自动提供可访问地址。配置域名使用 Cloudflare [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) 的机制。没有域名时，继续使用本地预览；公网 `workers.dev` 测试及测试实例的完整登录验证应另行准备，不能作为本脚本通过的正式部署。

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

以上步骤在配置就绪后执行，本轮未运行。对已经有表但没有 `d1_migrations` 历史的数据库，不要直接 apply、伪造已执行记录或清空表；先核对 schema 和现有迁移来源，再制定受控 baseline。官方机制见 [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)。

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

这一步是云端秘密写入，本轮未执行。Wrangler 提示创建 Worker 时，使用配置中指定的独立 Worker 名称和目标账户。也可在目标 Worker 的控制台中设置同名 Secret。完成后从当前 shell 清除临时变量。

接下来执行 dry-run，检查产物与资源绑定：

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js deploy --dry-run --config dist-standalone/server/wrangler.json
```

配置和检查就绪后，执行不带 `--dry-run` 的同一命令完成发布。所有部署命令都指向独立产物，不能指向 Sites 的 `dist/server/wrangler.json`。本轮没有调用任何真实部署命令，也没有启用收费服务。

## Sites 数据不会自动迁移

独立 D1/R2 初始是空的。换前端地址、复制 HTML 文件或配置 Clerk 不会迁移 Sites 云数据。

保留数据需要单独制定导出、检查、复制和回退方案：D1 中的作品、版本、不可变 metadata、名片、互动和统计引用要一起核对；R2 的游戏与封面 key 必须维持对应关系；抽样比较原始文件 hash，再验证旧名片与历史版本仍可访问。迁移账也要与目标数据库实际 schema 对齐。

新身份是 `clerk:user_…`，与 Sites 用户 ID 不同。旧作品 owner 不能凭同名或同邮箱自动绑定；迁移需使用可核验的旧身份→新身份映射，保存旧 ID、目标 ID、归属依据和回滚记录。历史互动的 actor、作者显示名和统计归因需分别考虑，不能把所有旧记录都改成一个新用户。本轮没有执行任何 owner 重写或数据复制。

## 公开上线前仍未完成的验收

- 真实 Clerk 生产实例的注册、邮箱验证、登录、退出、刷新、会话过期，以及 iframe `/game` 和 `/media` 的会话链路。
- 真实域名和 DNS、D1/R2 权限与费用设置、备份/恢复，以及受保护请求遇到 Clerk 暂不可用时的体验。
- 上传、版本更新、回滚、封面、名片快照和统计在独立公网 origin 上的回归；本地验证不能代替这些检查。
- 公开前重新执行 `npm audit --omit=dev` 并评估实际调用路径。2026-11-16 的报告 `.preview/production-dependency-audit.json` 有 6 项，包括既有 Next.js critical 项；Vinext 替代执行层不等于已证明不可达。不要用一键 `audit fix` 代替兼容性评估。

GitHub 仓库构建仍需要单独运行受隔离的 build runner；Workers 本身不会安装 npm 依赖或替用户构建仓库。本轮没有创建常驻 builder。缺少 runner 时仍应显示离线状态，不能把准备好的部署入口描述为已可持续提供公开构建服务。
