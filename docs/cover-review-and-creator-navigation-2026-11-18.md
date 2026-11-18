# 封面确认、Feed 比例与创作入口

## 本轮行为

所有外链、HTML、GitHub HTML/构建作品在未提供封面时异步生成候选。候选只有作者可看，必须点「使用这张」才成为公开封面；支持普通重截、等待更久再截、手动上传。已有封面在生成/重截时保留。版本、修订号或候选变更使旧确认失效；保存新 metadata，不改旧名片快照。

迁移 0016 新增 ft_cover_review_jobs/attempts；FUNTRACK_COVER_REVIEW_ENABLED=1 时停止旧 hosted auto-cover 自动应用，改用统一确认服务。旧 API/表保留供旧客户端读取，不删除已有封面。视频任务独立，仍约 8 秒、可预览，不改变试玩统计。

每版本最多 3 次截图，每次预留 100 秒浏览器预算（35 秒工作与关闭/空闲缓冲）；UTC 日上限 1,000 秒、月上限 27,000 秒，仅覆盖此任务队列。达到上限排队，UI 停止自动轮询并保留刷新/上传。候选最多 2 MiB，历史已应用封面保持可读。

## 外链截图与安全边界

Cloudflare Browser Run 会话无用户登录态、无平台凭据，不自动点击或填写页面。provider guardrails 禁止浏览器直接 HTTP(S) 出网，页面请求通过 Worker 公开网络 GET 代理：仅公开 HTTPS 域名/443，拒绝凭据 URL、IP 字面量、私有或混合 DNS、非公开重定向；不透传 Cookie、Authorization、Set-Cookie。仅保留渲染必需的 Accept/RSC 路由头。关闭 Worker、共享 Worker、WebSocket、WebTransport、WebRTC 和服务 Worker 路径；不使用私网 service bindings。

资源请求上限 160、最多 24 个域名，每响应最多 4 MiB、合计 40 MiB，流式限制与总超时取消；导航重定向最多 5 跳。DNS 预检和 Cloudflare 公开网络限制共同防护，预检本身不宣称 DNS 绑定锁定。登录页、验证码、反自动化或不兼容页面可失败，由作者手动上传，不绕过保护。

等待 DOM、字体、首屏图片、开屏遮罩消失、布局连续稳定后截图；默认至少 5 秒，延后模式至少 10 秒。不会强制删除遮罩、跳过动画或冻结页面。识别常见错误页，不把客户端异常当候选成功。动态图不需要完全停止。

## Feed 和入口

真实图片的卡片框使用图片天然比例，瀑布流继续按最短列排布；相同比例素材自然更整齐。不用随机高度制造白边，也不裁掉标题。未有封面的外链也会有限刷新，确认后补图。

导航保留 Feed，创作中心/我的名片在头像菜单；「＋」提供上传作品和制作名片。登录门槛与回跳沿用既有行为。

数据页沿用主站主题。顺序为筛选 → 4 项核心指标 → 趋势 → 作品比较 → 参与详情；观察、更多统计和口径折叠。外链显示 UV/PV/跳转/评论，不提供不适用的试玩曲线；混合范围同时显示试玩与跳转，缺失不补 0。采纳昨天草稿的指标适配，不整合其他未请求的 PR #10 改动。

## 验证（发布前）

- Bingo 真实 Cloudflare 浏览器、全新会话：等待开屏后获取完整 Hero，1200×750 JPEG，约 69 KiB；最终代码一次观测等待 11.5 秒。证据在 `.preview/external-cover/bingo-hero.jpg` 与响应头。
- 本地真实 router/SQLite/R2 模拟绑定：候选不改变公开封面；确认、重截、旧封面保留、并发/重复确认、手动编辑竞争、所有权、预算与失效候选测试。
- 本地真实 UI：候选预览 → 使用 → 延后重截；外链指标切换；390px 页面无横向溢出。Feed 框与图片比例误差小于 0.001。
- 云端全流程与发布结果将在实际完成后补充。上述本地身份不代表生产认证验收。

## 后续讨论（本轮不开发）

- Hold：作品详情多截图（Steam 式媒体区）。先讨论截图数量、来源、排序、封面关系与手机加载。
- 《隔窗有雨》演示录制：按钮实际为「走進公寓 ↗」，当前白名单未命中。建议确定性脚本进入公寓、查看信箱/密码轮、返回；避免猜测操作和剧透。当前未实现演示脚本，不将静态首屏误报为玩法演示。

参考：[Browser Run guardrails](https://developers.cloudflare.com/browser-run/features/guardrails/)。
# Production acceptance

PR #14 merged as `6a040569271c7d758bd4c3c8cc1c0e23bd1d7c75`; migration 0016 applied. Worker version `a5d875f3-6ca5-481d-8f82-9dd29b13c345` deployed to trymecard.com.

- Public Feed visually verified with natural cover ratios and the new + menu.
- Real production Orbit HTML capture reached the private candidate stage, displaying use / retake / wait longer / upload controls. It was deliberately left for confirmation; the existing public cover remains in use.
- At the user's explicit request, applied the cloud-verified Bingo Hero JPEG (69,496 bytes, 1200×750; readiness after ~8.1 seconds) to existing work `7cdc2587-38d4-452a-81a7-e18389b818aa` using operator D1/R2 access, not an impersonated owner session. The new immutable metadata was written with revision/current metadata/current version guards; revision moved from 1 to 2. Readback preserved author `clerk:user_3MI1u6XqSwIt2vD7s6nWCFj2Gxo` and version `59af94b6-c62c-476c-9270-6c90d3a4a294`. The audit actor is `operator:pacifica:codex-user-approved-bingo-cover`. Prior metadata and saved cards remain intact. Production Feed shows the completed Hero.
