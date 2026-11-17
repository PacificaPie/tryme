# GitHub 仓库构建原型

**2026-11-16 更新：独立 staging 已采用 Cloudflare 云构建，部署与验收见 [云构建说明](./cloud-builder-deployment-2026-11-16.md)。** 下文 Docker runner 为保留的本地模式和历史验收方式；当前 staging 为 `FUNTRACK_BUILD_MODE=cloud`，不要按本地方式轮换它的 token 或启动通用领取 runner。

发布页支持公开 GitHub 根仓库链接，固定默认分支的 commit SHA 后进入构建队列。完成后先预览，再发布为站内作品；作品版本保留仓库、SHA、产物哈希及构建元数据。原有独立 HTML 导入仍可用。

## 当前范围

- 根目录 npm 项目：Vite 5–7、package-lock.json v2/v3、build 脚本、LICENSE，默认输出 dist/index.html。
- 依赖只接受锁定的 npm 官方 registry 包；不支持 workspace、私有仓库、后端/SSR、环境变量或运行时网络接口。
- 源码可以是多文件。平台在真实构建后自动封装 HTML/JS/CSS/资源，适配现有 opaque-origin 游戏沙箱。静态资源校验不等于任意项目的运行兼容性保证，仍须预览。
- 下载 16 MiB、解压 64 MiB、5,000 项；最终 HTML 上限 8 MiB。单任务最长 8 分钟。

## 本地模式构建器

网站 Worker 负责鉴权、队列、日志和 R2 托管；本机 Docker 负责执行构建。不是常驻云构建服务。构建器离线时新导入会明确报错，已发布游戏仍由网站托管。

启动 `node scripts/build-runner.mjs`，提示出现后通过隐藏 stdin 输入 JSON：

```json
{"siteOrigin":"https://your-site.example","runnerToken":"runtime-secret-at-least-32-characters","siteAccessToken":"private-site-access-token","once":true}
```

`runnerToken` 必须与**所选站点**运行环境的 `FUNTRACK_BUILD_RUNNER_TOKEN` 相同；这是构建器专用秘密，与 Clerk 登录密钥不同。仅 Sites 私有站点需要 `siteAccessToken`。真实凭据只放内存，不写仓库、日志或命令参数。`once:true` 处理一个任务（成功或失败）后退出；无任务时会等待，测试结束若未提交任务应使用 Ctrl-C 停止。省略 `once` 会持续轮询，临时验收不使用该模式。

### 独立 staging 的历史本地验收方式

当前临时测试站点的 exact origin 是 `https://funtrack-staging.zhayizha-pacificapie.workers.dev`。为这个 Worker 单独生成至少 32 字节的随机秘密，通过 stdin 写入 Cloudflare Secret `FUNTRACK_BUILD_RUNNER_TOKEN`；所有 Wrangler 命令明确指定 `--config wrangler.standalone.staging.jsonc`。不要读取、复制或覆盖 Sites 的 runner token，也不要把 Clerk token 当 runner token。秘密写入成功后，边缘运行时可能有短暂传播延迟；先确认新凭据的 heartbeat 成功，再让用户提交仓库。

将同一个新秘密通过隐藏 stdin 传给 `scripts/build-runner.mjs`，其 JSON 只包含 `siteOrigin`、`runnerToken`、独立 UUID `workerId` 和 `once:true`，**省略 `siteAccessToken`**。独立 Worker 的 `/api/build-worker/*` 使用专用 Bearer 鉴权；普通作者创建任务、预览和发布仍须 Clerk 登录。Runner 不监听端口，凭据请求仅发送给指定 origin，重定向不会带着凭据继续。

本轮使用的临时控制器只在内存中生成秘密，经 Wrangler 和 runner 的 stdin 分别传递。Runner 子进程环境只保留 Docker CLI 所需的本机基础环境，不继承 Sites、Cloudflare 或 Clerk 凭据。临时控制器在忽略的 `.preview/` 下，不作为常驻服务或部署产物。

`once` 退出后不再发送心跳；最近一次心跳超过 90 秒，网页会显示构建器离线。刚退出的短暂窗口不保证还能接受新任务，页面提交时服务端会再次检查。已生成和发布的作品留在 R2，不依赖 runner 继续运行。完整 HTML 上传及 GitHub 单 HTML 直读也不依赖它。

容器固定 Node 22 镜像摘要，以非 root 运行，宿主源码及工具只读挂载，工作区为 768 MiB tmpfs，限制内存/CPU/PID/时长。安装阶段关闭生命周期脚本；执行仓库 build 和封装前断开网络并检查。网站凭据不进入容器。根 LICENSE 及运行依赖许可保留在最终 HTML 中。

## 验证入口

- `npm run check`、`npm test`。
- `tests/integration/builds.mjs`：真实本地 D1/R2 的认证、租约、取消、不可变产物及幂等发布检查。种子步骤与 Worker 运行不要并行写同一 SQLite。
- `node scripts/repo-builder.mjs owner/repo FULL_COMMIT_SHA`：独立构建，产物和元数据写入忽略的 `.preview/builds/`。
- 真实样例为 `yuss-raa/Snake-Game`，来源细节见 `repository-build-reference.md`。它没有接入 Funtrack 通关协议，不能把操作事件当作通关。

云迁移已完成，扩展框架和多资源托管仍未完成。构建完成只生成可预览产物，发布或更新作品仍由作者在页面完成；它不会通过 Webhook 自动发布。早先本地 staging 实测见 [仓库验证记录](./staging-repository-validation-2026-11-16.md)。
