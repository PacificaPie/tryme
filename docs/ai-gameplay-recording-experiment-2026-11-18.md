# 有边界的玩法录制实验（2026-11-18）

范围：从 `origin/main` 的 `77be1fa3e1eff41220a428a51c2a3740c9b06ef3` 独立克隆；分支 `experiment/bounded-ai-recording-2026-11-18`。本轮只增加离线实验模块、样例、测试和 npm 命令。没有改动 `server.ts`、`site.js`、迁移、生产 capture/preview-interaction、上传流程、名片快照或登录契约；未部署。

## 已实现

严格 JSON 动作契约、按内容 SHA-256 审核的操作范围、实际鼠标/触控/方向键执行、受限 mock 逐步探索、持久化尝试记录、干净会话重放、≤8 秒 MP4、质量判断、预算预留与计量日志、失败保留既有预览/封面。探索后的模型思考等待不进入录像。复用键包括内容、审核范围、实验协议和 viewport；一个本地账本内的失败尝试也不能自动再次探索。

入口与限制：[实验 README](../experiments/ai-recording/README.md)。`npm run experiment:recording` 不读取密钥、不调用付费/免费模型 API、不创建服务账号。真实 provider 仍被 `PAID_PROVIDER_DISABLED` 拒绝；费用日志的模拟验证不能替代真实供应商计量。

## 本地结果

最终批次为本地 Chrome + 合成样例，含 960×600 桌面和 390×844 手机触控仿真，共 **16 条评测**：

| 样本 | 固定 Start-only | mock 探索后干净重放 | 缓存再重放 |
| --- | --- | --- | --- |
| DOM 灯光游戏 | 2/2 回退：尚未完成玩法 | 2/2 达到样例目标 | 2/2 成功，0 次 planner 响应 |
| Canvas 光点游戏 | 2/2 回退：尚未完成玩法 | 2/2 达到样例目标 | 2/2 成功，0 次 planner 响应 |
| 仅开屏动效的网站 | 2/2 标记为开屏动效 | 2/2 标记为开屏动效 | 不保存为成功玩法脚本 |

所有 **16 个 MP4 已重新解码**，每个检查 0.16、1.4、3.6、7 秒四帧；已查看六组 mock 视频的解码拼图，能看到两类游戏从开始、一次操作到目标状态的真实变化。片长 **7.551–7.553 秒**，文件 **29,126–153,836 bytes**。4 个成功 mock 流程都用了 3 个动作；缓存仍以干净上下文重新验证目标。全批次 24 次本地 mock 响应、**0 次真实模型调用，新增模型／云浏览器费用 $0**。

这些数字只描述本轮合成样例，不是模型成功率，也不是线上用户作品通过率。[逐条结果](evidence/ai-recording-2026-11-18/results.json)、[MP4 解码检查](evidence/ai-recording-2026-11-18/decode-checks.json)、[实际解码画面](evidence/ai-recording-2026-11-18/decoded-contact-sheet.png)。完整 MP4 和可播放评审页保存在本工作区忽略目录 `.preview/ai-recording-final/review.html`。

验证：新增契约/预算/缓存测试 **11/11**；整个仓库 **591/591** 测试；**7 组**真实本地浏览器边界检查；`npm run check`、`npm run build:standalone` 均通过。构建仅产生本地输出，出现现有动态导入分块提示，未部署到测试站或正式站。

## 边界测试与发现

浏览器检查覆盖：表单/登录/隐藏/遮挡控件拒绝；HTTP、图片、Beacon、表单、弹窗、WebSocket、WebRTC、WebTransport 与父页面访问阻断；游戏 JS 篡改查询函数不能改写隔离世界检查；导航终止会话；模型超时保留尝试记录；代码注入返回回退；按键只能到审核 Canvas。独立本地 HTTP 接收端收到 0 请求；这不是对所有恶意 HTML 或云浏览器的安全证明。

本地测试发现 `setContent` 中的 `srcdoc` 未执行预期的 `evaluateOnNewDocument` 传输禁用。在实验中保留原初始化，并把不可变禁用函数放到作品脚本之前，增加嵌套 frame 终止和本地 WebRTC 非代理 UDP 禁用参数。**未改生产路径；Cloudflare 上是否同样存在该行为尚未测试，接入实验前应由 capture 维护者单独复核。**

手机仿真还发现可信录制容器缺少 viewport 导致整体缩小；实验容器已补 viewport。Canvas 画面变化按审核画布区域计算，避免小区域交互被整屏均值漏掉。没有降低为“有动画即成功”：开屏网站仍单独回退，玩法还必须满足人工编写的样例目标。

## 真实模型小额试验提案（尚未批准、尚未执行）

建议第一轮仅用 **Google Gemini Developer API / `gemini-3.5-flash-lite` + 本地隔离 Chrome**，不买云浏览器、不变更现有套餐、不充值或订阅。它支持图片输入与结构化输出；当前标准价为每百万输入 token **$0.30**、输出（含思考）**$2.50**。原先常见的 2.5 Flash-Lite 对新项目存在可用性限制，因此不把它作为本轮新项目默认选项。[模型能力](https://aistudio.google.com/docs/models/gemini-3.5-flash-lite)、[官方价格](https://aistudio.google.com/docs/pricing#gemini-3.5-flash-lite)、[2.5 可用性说明](https://aistudio.google.com/docs/models/gemini-2.5-flash-lite)。

具体接口使用 `POST https://generativelanguage.googleapis.com/v1beta/interactions`，固定 `Api-Revision: 2026-05-20`、模型名称和 `store:false`；每轮为独立请求，发送截图、目标摘要、先前受限动作，不使用服务端会话/工具/grounding。设置 JSON schema、`thinking_level:minimal` 和 `max_output_tokens:1024`，截断/非 JSON 一律失败。官方说明该输出上限包含思考 token；`countTokens` 在调用前检查整个候选输入，超过 4,096 token 则不发生成请求。返回 usage 必须计入输入、输出与思考，缺失时保留全部预留额度并停止。[结构化输出](https://aistudio.google.com/docs/structured-output)、[token 计数](https://aistudio.google.com/docs/tokens)、[思考与硬上限](https://aistudio.google.com/docs/thinking#token-limits)。这些接口已查文档，未做真实连通性或计费验证。

| 项目 | 拟批准范围 |
| --- | --- |
| 样本 | 仅仓库内 3 个合成样例；每样例 1 次探索，先用桌面 viewport |
| 次数 | 每样例最多 5 次生成，合计最多 15 次；无重试、无换模型 |
| 单次限额 | 输入≤4,096 token；输出含思考≤1,024 token；仍受本地字节/动作/时间限制 |
| 保守 token 预留 | 单次 $0.0037888；单样例 $0.018944；三样例 $0.056832 |
| 请求批准的总消费上限 | **$0.10 USD**（只是本实验 API 使用额度，不授权充值、订阅或付款操作） |
| 浏览器/存储 | 本地 Chrome 与本地文件，新增云浏览器费 $0 |
| 送往供应商的数据 | 最多 15 张合成样例截图、受限目标标签/位置、动作摘要、固定指令；不会送真实作品、用户资料、源代码、登录态、密钥或生产数据 |
| 账号前置 | 用户已有且允许此实验使用的 Google API 项目；凭据通过安全的本地配置渠道提供，不能粘贴聊天 |

价格计算是上限预留模型，尚非账单；供应商调用失败/取消可能仍产生 token 费用，预留不会释放。先检查模型可用性、付费项目属性与当前价格，再锁定共享批次账本。若供应商无法确认上述输出硬上限/完整 usage，或需要新充值/条款/账号身份变更，则停止付费部分并报告，不自动扩大范围。第一条真实调用就记录供应商 usage 与成本，异常时停止剩余批次。

Google 文档区分免费与付费层数据使用；本方案按付费层价格估算，不因“免费额度”而默认获准向新供应商发送数据，也不声称 `store:false` 等同零保留。仅合成样例离开本机，服务方政策仍适用。[价格与数据使用说明](https://aistudio.google.com/docs/pricing)。

当前 Cloudflare 官方价格仍显示 Workers Paid 含 10 浏览器小时/月，超额 $0.09/小时，并有并发计量。该费用与套餐余额没有纳入这轮本地实验；未来云接入需另行测量。[Cloudflare 价格](https://developers.cloudflare.com/browser-run/pricing/)。Browser Use/Browserbase 没有开通或调用。

## 上线门槛与仍缺的证据

此次 mock 验证只证明执行/隔离/录制/回退链路可以运行。真实模型能否看懂未见游戏、3–5 动作能否表达玩法、实际 token/延迟/成本、随机游戏重放稳定性、Canvas 语义与恶意内容边界均没有获得验证。之后先批准上述小额合成样例试验，再扩到明确获准的真实作品和人工盲评；成功率、单位成本、错误回退以及云端隔离通过审查后，才讨论生产接入。
