# GitHub 仓库构建原型

发布页支持公开 GitHub 根仓库链接，固定默认分支的 commit SHA 后进入构建队列。完成后先预览，再发布为站内作品；作品版本保留仓库、SHA、产物哈希及构建元数据。原有独立 HTML 导入仍可用。

## 当前范围

- 根目录 npm 项目：Vite 5–7、package-lock.json v2/v3、build 脚本、LICENSE，默认输出 dist/index.html。
- 依赖只接受锁定的 npm 官方 registry 包；不支持 workspace、私有仓库、后端/SSR、环境变量或运行时网络接口。
- 源码可以是多文件。平台在真实构建后自动封装 HTML/JS/CSS/资源，适配现有 opaque-origin 游戏沙箱。静态资源校验不等于任意项目的运行兼容性保证，仍须预览。
- 下载 16 MiB、解压 64 MiB、5,000 项；最终 HTML 上限 8 MiB。单任务最长 8 分钟。

## 构建器

网站 Worker 负责鉴权、队列、日志和 R2 托管；本机 Docker 负责执行构建。不是常驻云构建服务。构建器离线时新导入会明确报错，已发布游戏仍由网站托管。

启动 `node scripts/build-runner.mjs`，提示出现后通过隐藏 stdin 输入 JSON：

```json
{"siteOrigin":"https://your-site.example","runnerToken":"runtime-secret-at-least-32-characters","siteAccessToken":"private-site-access-token","once":true}
```

`runnerToken` 必须与 Sites 运行环境的 `FUNTRACK_BUILD_RUNNER_TOKEN` 相同；私有站点需要 `siteAccessToken`。真实凭据只放内存，不写仓库或命令参数。`once:true` 处理一个任务后退出，省略则持续轮询。终止使用 Ctrl-C。

容器固定 Node 22 镜像摘要，以非 root 运行，宿主源码及工具只读挂载，工作区为 768 MiB tmpfs，限制内存/CPU/PID/时长。安装阶段关闭生命周期脚本；执行仓库 build 和封装前断开网络并检查。网站凭据不进入容器。根 LICENSE 及运行依赖许可保留在最终 HTML 中。

## 验证入口

- `npm run check`、`npm test`。
- `tests/integration/builds.mjs`：真实本地 D1/R2 的认证、租约、取消、不可变产物及幂等发布检查。种子步骤与 Worker 运行不要并行写同一 SQLite。
- `node scripts/repo-builder.mjs owner/repo FULL_COMMIT_SHA`：独立构建，产物和元数据写入忽略的 `.preview/builds/`。
- 真实样例为 `yuss-raa/Snake-Game`，来源细节见 `repository-build-reference.md`。它没有接入 Funtrack 通关协议，不能把操作事件当作通关。

后续将此构建器迁移到常驻隔离执行环境，再扩展框架和多资源托管。当前不涉及收费、Webhook 自动发布或作品版本回滚。
