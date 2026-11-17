# Staging 仓库构建验证

2026-11-16，美东时间。本记录覆盖 `https://funtrack-staging.zhayizha-pacificapie.workers.dev` 上的 GitHub 仓库构建。构建执行器为本机临时 Docker runner，站点负责队列、身份验证和 R2 产物托管。没有建立常驻云构建服务，也没有复用 Sites 或 Clerk 凭据。

## 多文件仓库成功构建

用户通过真实站点 UI 提交 `https://github.com/yuss-raa/Snake-Game`。构建任务 `04771199-b713-4047-8268-c43c479ea514` 固定提交为 `1f76427453c48f6f0a02d09a12e0469451c0d1e3`。

| 验证项 | 结果 |
| --- | --- |
| 源码 | 15 个文件，GitHub archive 42,553 字节 |
| 原始构建 | `vite build`，dist 4 个文件 / 223,207 字节 |
| 封装产物 | 229,573 字节 HTML |
| 产物 SHA-256 | `47c025db71bd8c6aea689e2427a82b7f8351df6059ff295887c93b696528e48b` |
| 耗时 | 共 13,273 ms；安装 6,000 ms，构建 3,433 ms，封装 2,070 ms |
| 许可 | 根 MIT LICENSE 与运行依赖 notice 保留在 HTML 中 |
| Runner | 一次任务后 exit 0，已确认没有该测试的构建容器残留 |

Runner 完成上传并收到服务端成功响应，任务为 `ready`。页面预览已实际点击 Start Game；作品发布及后续远端对象核验由整体上传验收记录汇总。该仓库未接入 Funtrack 的通关协议，不能把按键或游戏开始当成通关数据。

本地结果与之前相同提交的产物哈希一致。证据在忽略的 `.preview/staging-snake-runner-validation.json`，原始 metadata / HTML 位于 `.preview/builds/job-cIube2/`。这些文件仅含公开仓库内容和构建结果，不含 runner 凭据。

## 隔离及运行边界

固定镜像为 `node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee`。构建容器使用非 root 用户、只读 rootfs、只读源码与工具挂载、768 MiB 工作 tmpfs、128 MiB 临时 tmpfs、1 GiB 内存、2 CPU、128 PID 上限，任务最长 8 分钟。宿主凭据不进入容器。

先用 npm 锁定包和 `--ignore-scripts` 安装依赖，再断开唯一网络。现有构建器在执行仓库脚本前查询容器网络，发现任何网络仍连接就中止；本轮成功通过这一步，随后完成 build 与 packaging。构建期间实际观察到临时容器，任务结束后已确认清理。静态资源内联检查不等于任意 JavaScript 或所有框架的兼容性认证。

第一次新 secret 写入成功后的立即启动，曾遇短暂的 `BUILD_RUNNER_UNCONFIGURED`。后续只读 secret 名称检查与无效凭据返回 401 确认配置已传播；采用只在内存保留 token 的有界 heartbeat 等待后成功启动。没有为此修改鉴权、配置绑定或重新部署应用代码。

一次性 runner 退出并超过 90 秒后，真实页面已显示构建器离线及本地 HTML 替代入口；GitHub 单 HTML 直读仍能发起，不要求 runner 在线。此结果验证了离线状态呈现，不代表站点已经提供持续可用的仓库构建容量。

## 未完成：不支持结构的 UI 验收

计划通过 UI 提交用户的 `rain-between-rooms` 仓库，验证不支持结构时的错误呈现。但随后两次临时 runner 都在初始 heartbeat 成功后遇到网络请求失败：第一次记录 `Heartbeat: fetch failed` 与 claim 请求超时，重启后再次 `fetch failed`。两次均在领取任何任务前 exit 1；停止重试，没有扩大重连或常驻调度实现。

最终只读 D1 查询确认 `ft_build_jobs` 只有上述 Snake `ready` 记录，没有 rain 仓库任务；查询 `rows_written:0`。没有由 rain 这次尝试生成的构建产物，但这**不能代替**一次“不支持结构”错误路径验收。网页的离线状态属实；本机到站点的随后只读探测恢复为 `/api/auth/config` 200、无效 runner 凭据 401，未据此把整个构建器描述为稳定在线。

最后一个 runner 心跳为 `2026-11-17T03:09:03.408Z`，之后没有运行中的本轮 runner 或构建容器。秘密轮换最后发生于 `03:09:01Z`；应用的后续部署 `f205d989-b973-4e00-b0d7-5c70358b475a` 在 `03:09:17Z` 成为 100% 最新版本，秘密写入没有覆盖最终应用部署。后续构建仍需重新启用独立临时 runner，或完成常驻执行器的工程化。
