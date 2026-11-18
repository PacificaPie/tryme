# 低成本 AI 玩法录制：候选方案

核查日期：2026-11-18。用户希望展示真实玩法、费用可控。本次仅研究；未开通新付费服务、未调用模型，也未验证模型在实际游戏中的成功率。

建议先保留现有 Cloudflare 隔离浏览器和 MP4 录制，只增加一次性的动作探索：作者可补一句玩法提示，AI 找到 3–5 个动作，保存成功脚本，再在干净会话重放录制不超过 8 秒。去掉模型思考等待，按内容版本复用；固定脚本能处理的作品无需模型调用。

## 已核查的选择

| 方案 | 官方成本或能力 | 判断 |
| --- | --- | --- |
| 现有 Cloudflare + 轻量模型规划 | Workers Paid 包含 10 浏览器小时/月，超额 $0.09/小时；并发另有计量。原生 session recording 为 rrweb，不涵盖 Canvas/WebGL，继续使用已验证的像素帧 MP4 路径 | 改动和新增基础设施最少；仍需实测动作规划准确率 |
| Browser Use Cloud | 无月费，浏览器 $0.06/小时，按分钟计费且至少一分钟；直连 $0.20/GB，住宅代理 $5/GB。BU 4.0 Mini 输入 $0.20/M token、输出 $1/M token；V4 支持 MP4 | 可作为少量样例的对照，关闭不必要的代理，不能把官网任务中位数当作游戏固定成本 |
| Browserbase + Stagehand | Developer $20/月含 100 小时，超额 $0.12/小时，模型另计；支持真实 MP4 导出 | 现阶段迁移收益有限，DOM 操作便于复用，但 Canvas 仍需视觉定位 |

来源：[Cloudflare 价格](https://developers.cloudflare.com/browser-run/pricing/)、[录制限制](https://developers.cloudflare.com/browser-run/features/session-recording/)、[Browser Use 价格](https://browser-use.com/pricing)、[Browser Use 录像](https://docs.browser-use.com/cloud/browser/live-preview.md)、[Browserbase 价格](https://www.browserbase.com/pricing)、[录像下载](https://docs.browserbase.com/platform/browser/observability/recording-downloads)、[Stagehand 动作复用](https://docs.stagehand.dev/v4/basics/act.md)。

## 条件估算与试验范围

以 Browser Use Mini 为例：总输入 10k–30k、输出 1k–3k token（包含图片和重复上下文），浏览器 60 秒、10MB 直连流量，不重试，约 $0.006–0.012/作品。模型 $0.003–0.009 + 浏览器 $0.001 + 流量约 $0.002。这不是实测报价，不含存储/播放/现有套餐；探索更久、使用代理或反复失败都会增加费用。

建议下一轮只拿三种作品验证：普通 DOM 网页游戏、Canvas 游戏、带开屏动画的个人网站。每作品版本最多一次探索，限制动作数、输入大小、时间和费用；先设 $0.02 的试验预算目标，实际执行必须按供应商计量确定可强制限制的项。不能承诺所有游戏都能在该费用内生成好视频。

AI 只输出受限页面动作，执行器继续沿用网络隔离与超时；不允许任意代码、外部提交、登录、付款或通关。失败保留原封面和现有预览，不把静态或未完成片段报为玩法演示。
