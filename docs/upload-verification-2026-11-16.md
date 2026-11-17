# 独立测试站上传验收

2026-11-16（America/New_York）。在用户已经登录的 Chrome 中，用真实 Clerk 账号从发布表单逐条执行。所有新作品均以“上传验收”命名；没有修改原 Sites 站点或迁移用户历史数据。

站点：https://funtrack-staging.zhayizha-pacificapie.workers.dev/site

## 实际完成

| 入口 | 测试材料 | 发布与试玩 | 作品 ID |
| --- | --- | --- | --- |
| 本地 HTML | 自有《隔窗有雨》，2,258,639 bytes；JPEG 封面 52,054 bytes | 发布成功，站内进入公寓 | `22e0b65f-c3c0-485c-97ac-9cd94443730e` |
| GitHub HTML | 同一文件的完整 SHA blob 和 raw 链接分别读取，使用 raw 结果发布 | 发布成功，站内进入公寓；全屏及退出全屏保持进度 | `17ca43da-4417-48a4-954e-d4510c7ab122` |
| 已有网站 | `https://react-snakegame.netlify.app/` | 发布成功，新窗口打开并 Start Game | `df511b69-6376-4fc2-9b7c-95b45723fcc2` |
| GitHub 仓库 | `https://github.com/yuss-raa/Snake-Game`，MIT，React/Vite 多文件项目 | 构建完成，产物预览与正式站内 Start Game 均通过 | `39b79acd-9ba3-4654-b966-d76b7624a3e9` |

本地与 GitHub HTML 的原文件 SHA-256：`bb9403bf8f3616e5662e5f15e6540d693d342fd476e18979786479c82b003fc5`。GitHub 固定提交：`0f15da7b9965af440a4e7bac348d30834c5667cf`，路径 `dist/index.html`。两种单 HTML 入口最终都保存为 `source=html`；当前数据库没有保留单 HTML 的 GitHub 来源元数据，不能仅凭数据库字段区分它们。仓库构建保留完整 provenance。

Snake 构建 `04771199-b713-4047-8268-c43c479ea514` 固定提交 `1f76427453c48f6f0a02d09a12e0469451c0d1e3`。15 个源码文件生成单 HTML 229,573 bytes，SHA-256 `47c025db71bd8c6aea689e2427a82b7f8351df6059ff295887c93b696528e48b`，约 13.3 秒。保留 MIT 与运行依赖许可证。

## 失败路径与本轮修复

- 本地 8 MiB + 1 byte 在选择时拦截，提示压缩资源；非 HTML 文本伪装为 `.html`，提交后返回完整 UTF-8 HTML 要求，表单保留。
- 将 GitHub 仓库误填到“已有网站”，明确提示改用 GitHub 导入或部署后的 GitHub Pages。
- 构建器停止后，单 HTML raw 链接仍读取成功。状态渲染只在仓库入口显示构建在线/离线；本地与外链隐藏该状态，HTML 直读始终提示无需构建器，避免轮询覆盖成误导信息。
- 固定 SHA HTML 首次导入遇到 GitHub 匿名 REST 配额限制。修复为直接从官方 raw 主机读取不可变提交，不再进行多余的 REST 查询；分支和标签仍解析并锁定 SHA。没有对失败请求回退到可变分支。
- 异常 GitHub JSON 结构现返回明确的上游响应错误，避免空值触发未分类的 500。
- 试玩增加等待画面、30 秒 ready 超时与重试入口。只有当前 iframe、opaque origin、正确 bridge 的 ready 消息能解除加载；失败不产生虚假试玩开始和时长。认证、CSP 和 `sandbox="allow-scripts"` 未放宽。
- Chrome 调试连接曾使 iframe 文档请求一直 pending。原生操作取消测试工具的调试连接后，同一请求立即完成并可玩；这是测试工具干扰，未据此修改登录或沙箱。

## 部署与边界

修复首次部署版本：`ae7d3628-9ccb-4270-88b1-11ba0bca93c0`；状态提示修正后最终代码部署：`f205d989-b973-4e00-b0d7-5c70358b475a`。197/197 单元测试、脚本/类型检查、独立 staging 构建与产物预检、`git diff --check` 通过。线上三个变更前端文件与本次构建产物的哈希一致。

网站、D1 与 R2 均在云端。此次仓库构建使用临时一次性本机 Docker runner：安装禁止 lifecycle scripts，build/package 断网，tmpfs 768 MiB、内存 1 GiB、2 CPU、PID 128。任务结束退出并清理容器。**这不等于常驻云构建已上线**。心跳超过 90 秒后，表单提前显示构建离线、8 MiB 本地 HTML 替代入口并禁用仓库构建。

真实私有仓库、所有框架及任意第三方项目没有穷举测试。仓库构建当前只支持符合项目要求的公开 Vite/npm 项目。正式域名、Clerk production 及原 Sites 数据迁移仍独立待办。

额外尝试验证 rain-between-rooms 不支持结构时，临时 runner 的后续 claim 网络请求两次失败并退出，没有领取或创建 rain 构建任务，停止重试。不能将这一步计为真实“不支持结构”验收；对应错误映射只有自动测试证据。它也说明临时本机 runner 尚不能作为稳定常驻服务。

原始证据位于忽略目录 `.preview/upload-verification/`，runner 报告为 `.preview/staging-snake-runner-validation.json`。验收截图包括 `local-game-native.png`、`github-html-fullscreen.png`、`repo-game-native.png`、`runner-offline.png`。

## 云端只读复核

2026-11-17 02:42:50 UTC 的 D1 快照为 5 个作品、6 个版本、1 个 ready 构建：原测试作品及其 v1/v2，加上本轮四个新作品各自的 v1。四件新作品归属同一当前 Clerk 用户，均 revision=1；来源、当前版本、构建归属等引用检查无异常。

下载并逐字节检查了 9 个关联 R2 对象。本地/GitHub HTML 都与原文件一致；两份封面一致；Snake 发布游戏与 ready 构建产物一致；外链记录只有 URL，没有假造游戏文件。基线旧作品的选定字段、v1/v2 记录与旧游戏文件哈希均未变化，没有意外新增作品。

详见 `.preview/upload-verification/README.md`、`report.json`（`passed: true`）与 `object-checks.json`。该复核针对关联对象，没有穷举全桶孤立对象。
