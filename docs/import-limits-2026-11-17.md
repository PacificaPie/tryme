# 导入限额与预构建 HTML（2026-11-17）

## 本次行为

- 最终 HTML：16 MiB（含来源声明、许可证和内联资源）；超过8 MiB显示非阻断加载提示。适用于本地上传、GitHub单文件、仓库产物及版本更新。封面仍为2 MiB，multipart envelope为19,005,440字节。
- 仓库：压缩64 MiB、解压256 MiB、单文件32 MiB、最多5,000路径项。总时限、执行并发、每人频率、隔离与访问控制保持原有设置。
- 依次识别Vite源码或现成HTML。Vite项目仍使用原build/lock/LICENSE验证，不被旧dist替代。非Vite仓库优先导入dist/index.html，没有时才取根index.html；存在但无效的dist不静默换页面。
- 预构建HTML与GitHub单文件共用独立资源兼容校验，继续使用原游戏CSP/sandbox；不执行项目脚本，不安装依赖。写入固定SHA来源注释，保留已有根LICENSE，不要求额外补授权文件。公开可读本身不代表可再分发许可。
- 错误区分压缩、解压、单文件、文件数量、损坏归档、最终HTML。提供可用的大小/路径；流式下载只知道下界时标“至少”。中间构建输出的通用限制不误称为最终HTML超限。前端只解析已知格式，支持中英切换。
- 仓库身份解析在 REST 和 Atom 均限流时，单次回退至 Git smart HTTP 引用发现；仍只匿名读取公开仓库，严格解析 HEAD 和默认分支的一致 SHA，保留每次 1 MiB／10 秒／禁止重定向边界。本地预构建导入也遵循取消与总时限。

## 验证

- 全量自动测试492/492；云执行层6/6；脚本/TypeScript检查、主站构建、两端dry-run通过。
- 独立本地workerd + D1/R2：10项真实HTTP验收通过，包括原始隔窗有雨上传、16MiB HTML＋2MiB封面、精确上限版本、超限一字节拒绝、版本/旧资源不变、重试与回滚。
- 真实仓库固定SHA：0f15da7b9965af440a4e7bac348d30834c5667cf。压缩34,200,107字节（32.62MiB），文件总量49,210,671字节（46.93MiB），58文件，最大文件16,851,596字节。
- 原始dist/index.html为2,258,639字节；仅加入来源注释后的预期产物2,258,770字节，SHA256为68fd02ac95f03a11baa7c7d56b8e2bbcca8add7235a75b90bfeaaf03b65b046e。
- 原先阻塞是32.62MiB压缩包超过16MiB；放宽后还需新增预构建路径，因为该仓库无Vite manifest/lock/root LICENSE，不能走旧源码构建流程。

## 部署

- 构建器Worker：2141bf46-2445-4e39-b629-b546049f7245；容器镜像sha256:1ccd66dd34f245b2ddc007fd8959f172a6ab64235ade7314ead6558b48a2c2d4。
- 主站Worker：a262ed01-ef0f-4f35-89b5-b4ccdd961e92。
- 无数据库迁移、无secret轮换。部署前无活动构建任务。
- 线上仓库导入完成：浏览器从根链接 `https://github.com/PacificaPie/rain-between-rooms.git` 发起，任务 `c19b5bf6-8dfe-4f4a-9f27-476ada1dd8de` 为 `ready`。D1 记录 `framework=prebuilt-html`、`sourcePath=dist/index.html`、`projectScriptsExecuted=false`；R2 产物字节数和 SHA256 与上面的独立验证完全一致。
- 已在登录浏览器打开该任务预览，进入公寓并点击电话，得到对应剧情反馈；没有浏览器 error/warn。验收停在可发布草稿，未重复发布已有作品。预览与导入页保留在浏览器；本地截图 `.preview/import-limits/rain-import-play.png`。
- 首次线上解析遇到 GitHub 匿名额度限制，第二次正常解析并完成导入；该错误与构建/归档大小错误已明确区分。
- Git 协议回退另有独立联网验证：仅模拟 REST 和 Atom 返回 429，第三路真实匿名 GET 返回 200，解析到同一仓库的 main 与相同固定 SHA。此为故障路径验证，不冒充线上全链路限流复现。证据 `.preview/rain-import-verify/git-fallback-live.json`。
