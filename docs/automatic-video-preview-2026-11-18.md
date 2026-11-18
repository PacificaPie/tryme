# 自动录制与 Feed 视频预览

用户在 11.18 明确要求推进上线，并选择“自动录制作品并生成预览”。本次从正式 main 单独开发，不包含 PR #10 的原型、Logo 或其他尚待验收改动。微信仍缺网站应用凭据与回调配置，未在本次启用。

## 使用流程

1. 发布托管 HTML 或 GitHub 构建产物后，作品立即可试玩，视频任务异步进入队列；无需上传短视频。
2. 云浏览器录制约 8 秒真实开场。仅在识别到一个明确、可见的“开始游戏 / Start / Play”按钮时点击一次；没有该按钮时保留开屏，不推测后续操作。
3. 发布成功页和「编辑作品信息」显示录制状态，可为已有作品手动生成、刷新或有限重试。录制失败或额度耗尽不影响原封面和试玩。
4. Feed 中桌面悬停 450ms 后静音预览；触屏和键盘使用独立预览按钮。关闭页签、离开画面或切换路由即停止，同一 Feed 只播放一个视频。减少动态效果/省流量模式不自动播放。
5. 游客可看公开作品的预览；进入游戏仍需登录。视频预览不产生试玩会话、事件或贡献积分，正常 Feed 展示统计维持原口径。

### 封面与视频同时保留

自动截图仍独立运行并保存为封面，手动上传封面仍优先。Feed 静止时显示封面，只在预览播放时覆盖视频，结束/离开后回到封面。生成视频不会删除或替换封面。

修复生成后的显示延迟：停留在 Feed 时，对缺少封面或预览的托管作品按原列表分页地址进行有限后台检查（15 秒间隔，每页最多 8 次），只填充新生成的媒体，不重排列表、不覆盖点赞/标题/已有封面，不请求私有生成接口。页面隐藏时暂停，离开或切换筛选时取消旧请求；返回缓存页面也会继续检查缺失媒体。超过检查次数后仍可使用刷新按钮。外链作品不自动截图，需要手动上传封面。

## 实现与边界

- 复用现有 Cloudflare Browser Run、Worker Cron、D1 与 R2；不调用视频生成模型、不新增外部视频处理服务。
- 960 × 600，H.264 MP4，无音轨，最大 2 MiB。录制器在可信父页将 CDP 的实际截图帧送入离屏 canvas / MediaRecorder，保存真实文件时长。实际帧率受作品、云浏览器与帧传输影响，不保证游戏录像级流畅度。
- 游戏运行在 opaque-origin、仅 allow-scripts 的 iframe，CSP、请求拦截与 Browser Run guardrails 同时禁止出网；没有 Clerk cookie、平台令牌、玩家 SDK 或游戏会话。只接收托管产物，不抓外部 URL。
- D1 任务绑定 work ID、version ID 与内容 SHA-256；每次录制前验证 R2 内容。更新版本后重新排队；任务结束前再次检查版本和租约。既有版本、metadata、封面与名片快照不修改。
- 每分钟最多领一个预览任务；同类任务串行、两分钟租约、每版本最多两次尝试。中断/失败必须显式重试；不无限重试。浏览器硬截止 30 秒，晚返回的 launch 也会关闭。
- 每次预留 90 秒浏览器预算（30 秒执行 + 60 秒 provider idle 回退），每日最多 10 次、每 UTC 月最多 100 次，即最多 2.5 预留小时。此上限独立于原自动封面上限，不能代替整个 Cloudflare 账号的账单上限。
- 视频读取支持 GET/HEAD/单段 Range，逐次检查当前版本、归档和 Feed 可见性，Cache-Control 为 no-store。旧 URL 不会展示后来版本，也不能绕过隐藏状态。归档/旧版本的 R2 结果保留，不自动删除历史对象。
- 迁移 `0015_automatic_video_previews.sql` 仅新增两个表和索引；由 `FUNTRACK_VIDEO_PREVIEW_ENABLED=1` 与 BROWSER 绑定启用。

## 验收记录

- 自动检查：536 项通过，包括队列故障不阻塞发布、所有权、CSRF/游客边界、版本竞态、隐藏/归档撤销、Range/HEAD、哈希校验、预算、有限重试、旧快照与试玩计数保持不变。
- 真实 Browser Run：Orbit 的按钮与游戏动态已录入 MP4，Chrome 实际播放通过；补测纯静态作品生成 7.934 秒 MP4（20,442 bytes），避免静态画面只生成单帧或无有效时长。
- 测试站版本 `6938383b-c01f-483b-9cb4-4ecf633977ce`：通过真实已登录页面上传 Orbit，自动排队并由 Cron 一次录制成功；MP4 为 7.945 秒 / 119,291 bytes，Feed 播放及结束后清除 src 通过，编辑页能查看 ready 状态。匿名视频 Range=206、HEAD=200；私有生成接口=401；作者隐藏作品后旧公开视频链接=404。该作品的试玩会话及事件保持 0。
- 正式站部署 ID、上线后的生成任务与验收记录跟进于 [Notion F02](https://app.notion.com/p/41ced61b626d8171b99bcae122959820)。本节记录测试站证据，不将测试站等同于正式站验收。
- Safari/iOS/微信内置浏览器尚需真机覆盖；统一 MP4 提高兼容性，播放失败仍回退封面。

## 发布与回退

先核对目标 Worker、D1/R2、迁移账、既有 Clerk secret 名称，构建对应配置并 dry-run；迁移先于应用发布。凭据保留在 Cloudflare，验收通过真实登录确认配置，不复制 secret 到本地或日志。

回退可部署前一 Worker 版本或关闭 `FUNTRACK_VIDEO_PREVIEW_ENABLED`；不回滚/删除已应用的追加迁移。停止视频后原封面、作品发布和试玩流程继续可用。

## 技术依据

- [Cloudflare Browser Run limits](https://developers.cloudflare.com/browser-run/limits/)
- [Chrome MediaRecorder](https://developer.chrome.com/blog/mediarecorder)
- [Cloudflare session recording](https://developers.cloudflare.com/browser-run/features/session-recording/) 记录 DOM 事件，不能录 Canvas/WebGL 像素；本功能使用实际截图帧，不使用该事件回放作为视频。
