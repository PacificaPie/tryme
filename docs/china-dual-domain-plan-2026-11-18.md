# S01 双域名与国内部署准备

核查：2026-11-18。状态：架构与测量准备；没有第二域名、购买、备案提交、国内资源开通、生产身份改动或数据迁移。本方案根据当前代码推导，涉及实施选择的部分不是厂商承诺。

## 当前选择与可执行阶段

**先保留一份主数据和统一用户 ID。** 第二域名若只用于品牌入口，采用 HTTPS 308 到 `https://trymecard.com`，保留 path/query；不在重定向中附加会话 token。国内域名注册本身不会改变当前 Worker、D1、R2 或 Clerk 的运行地点，也不提供国内加速。

若国内真实测量达不到目标，再决定同服务双入口或国内部署；不要先建立两个独立可写数据库。阶段顺序：

1. 孙按下述测量模板收集大陆运营商网络结果，Pacifica完成 F08 隔离实例验证。
2. 确定主体、域名、备案接入商与数据区域；付费方案/条款单独确认。品牌重定向可以是第一种交付，保持所有登录在主域名完成。
3. 必须同时保留两个域名展示时，先做 development 双域名 PoC。显式 origin 白名单、登录回跳和 canonical 先完成，再加域名。不直接扩大当前生产 `APP_ORIGIN`。
4. 确需大陆托管时，从国内静态资源/CDN及受控公开媒体缓存试点，业务和身份仍有单一权威源；若认证或跨境 API 本身不达标，停止此试点并选定完整国内运行时方案，不宣传“已国内化”。

## 身份、数据、媒体与边界

| 项目 | 近期实施方案 | 完整国内托管时必须补的工作 |
|---|---|---|
| 主数据 | 一个 production D1 写入源，作品/版本/名片/评论 ID 不变 | Node 服务 + 选定数据库适配层；验证现有 SQLite SQL、事务、batch、唯一约束、幂等与迁移顺序。冻结写入后备份→导入→校验→切流，避免两边同时可写 |
| 身份 | 一个 Clerk 实例；业务 ID 保持 `clerk:<id>`，微信唯一映射共享同一主库 | 若 Clerk 国内链路不可用，需另立身份适配/迁移项目；保留旧 ID 别名及映射并双边验证，不靠邮箱文字、昵称或 UnionID自动合并。仅迁数据库不会消除 Clerk 依赖 |
| 对象存储 | R2 为权威副本；对象 key/版本/内容哈希稳定。新域名不复制桶 | 选定国内对象存储，校验字节哈希、MIME、Range、授权访问与删除语义；版本化复制清单、重试队列、缺失对账 |
| CDN | 静态站点文件可缓存；公开封面按公开 API 契约缓存。私有媒体、上传草稿、试玩 session、auth API 不共享缓存 | CDN 私有回源与鉴权方案验证；撤回/封禁/删除生成 tombstone 并清缓存。不得把整桶或游戏资源公开来换取速度 |
| 不可信作品 | 继续现有隔离 iframe/CSP，可信平台资产与作品内容分开 | 域名/存储迁移后回归 sandbox、cookie不可读、顶层导航与外部请求限制 |
| 名片 | 身份读当前个人资料；作品/版本/说明/封面保留快照 | 两入口读同一快照；同步不能把历史版本替换成 current；旧 `/c/<id>` 保持可用 |

Cloudflare China Network 是 Enterprise 的额外订阅，且不是所有 Cloudflare 产品都可用；不能把当前全球 Worker 配置当成已获得 D1/R2 大陆部署能力。[官方说明](https://developers.cloudflare.com/china-network/)

D1/R2 location hint 是资源创建时的放置提示，不是域名策略，也不是指定地区的绝对保证；本轮没有查询生产资源的物理位置。[D1 数据位置](https://developers.cloudflare.com/d1/configuration/data-location/)、[R2 数据位置](https://developers.cloudflare.com/r2/reference/data-location/)

## 双入口回调、cookie与canonical设计

当前 `standalone-auth.mjs` 只接受精确 `APP_ORIGIN`，Clerk authorizedParties 也是单值；公开名片 canonical 使用配置 origin。因此新增域名直接指向同一个 Worker 不足以完成双入口认证。本分支有意保留该约束。

未来独立双域名 PR 的配置契约：

- `APP_ORIGIN` 继续代表主站；增加**拟议** `ALLOWED_APP_ORIGINS` 精确 HTTPS 列表（不能通配、后缀匹配或反射 Host），每个请求按已批准入口选择身份配置。
- **拟议** `PUBLIC_SITE_ORIGIN=https://trymecard.com` 用于 canonical、分享与二维码；**拟议** `AUTH_PRIMARY_ORIGIN` 表示认证主域。这些变量尚未实现，不能现在加进部署就认为生效。
- 写请求 Origin 必须等于当前请求 origin，且二者都在白名单；保留 CSRF、session azp/authorizedParties 与服务器封禁校验。CDN/反向代理不能信任外部 `x-forwarded-*` 来扩展权限。
- OAuth state 服务端保存发起 origin、相对 returnTo、浏览器证明。直接回发起域名仅在该回调域获批时允许；AppID 按环境明确配置，不通过请求传入。
- 若只有主域回调获批，先把浏览器顶层导航到认证主域再创建 OAuth 事务。主域 host-only cookie不能在另一个顶级域名验证。跨回入口依赖经验证的 Clerk satellite，或后续单独设计 audience/origin/浏览器挑战绑定的一次性交接；不在 URL 搬运 session JWT、Clerk ticket 或长期 token。
- 所有 auth/pending/exchange/callback 响应 `private,no-store`、no-referrer；Cookie 无 `Domain`、Secure、HttpOnly、SameSite=Lax。两个无关顶级域名不能用一个 Domain cookie共享会话。[MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- Clerk satellite 在生产需要付费，登录仍依赖 primary；当前官方支持的框架范围及原生 JS 接入需要 PoC。不能把卫星域当国内独立认证；跨域同步链接应使用 SDK 构建，不拼接硬编码登录链接。[Clerk 双域名](https://clerk.com/docs/guides/dashboard/dns-domains/satellite-domains)

验收必须覆盖两域游客 Feed、登录回原入口、取消授权、登出同步/过期、跨标签换号、CSRF、错误回跳、私有资源缓存、同一版本与旧名片快照。退回方案是仅保留主域，第二域转主域；新增域名登录启用前验证退出和回跳不会形成循环。

## 最新官方要求核查

| 事项 | 本轮核实的要求/边界 | 项目还缺什么 |
|---|---|---|
| 微信网站应用 | 审核通过的网站应用及登录权限、AppID/AppSecret、批准回调域；网站 OAuth 与公众号 H5 是不同入口 | 实际后台状态和回调配置 |
| 应用审核资料 | 官方规范要求官网包含应用信息、用户协议、主体/版权、备案信息、联系方式等；部分服务类目涉及开发者资质认证，主体应一致或提供相应授权 | Pacifica/孙确认真实主体、类别、认证与材料；不推断“个人一定可以/不可以” |
| 大陆网站托管 | 接入商 ICP 备案、域名实名及主体匹配；必须核对有资质注册商与可备案后缀 | 选定主体/接入商后按其及当地管局要求核对，不能拿海外站新增 DNS 代替 |
| 数据出境 | 适用义务依主体、数据类别/敏感性、规模和业务必要性而异；特定手续豁免不等于告知、同意、影响评估等义务全部消失 | 清点 Clerk/微信标识、资料、IP/日志、作品与互动等流向和保留期，再确定适用路径 |

来源：[微信登录指南](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html)、[微信应用审核规范](https://developers.weixin.qq.com/doc/oplatform/Website_App/operation.html)、[工信部地方管局备案问答](https://jxca.miit.gov.cn/bsfw/bszn/cjwt/art/2020/art_869445de6a9f40e98732195df440f99d.html)、[腾讯云域名备案要求](https://cloud.tencent.com/document/product/243/18905)、[网信办2024规定](https://www.cac.gov.cn/2024-03/22/c_1712776611775634.htm)、[2025年10月政策问答](https://www.cac.gov.cn/2025-10/31/c_1763633376984070.htm)。微信两页使用直接 HTTPS GET 读取并解压正文；其余使用本轮 web 查询。未查询用户微信后台，也未提交申请。法律/备案适用范围仍由选定主体与接入商结合实际业务确认。

## 网络实测与大陆测量交接

2026-11-18 16:50 America/New_York，在本聊天执行主机上运行只读探测，每项 3 次，最多跟随 5 次 HTTPS 重定向；不携带登录 cookie、token，不保存 response body。测点地理位置及代理路径没有独立证明，**不是中国大陆实测**。这是一组连通性样本，不是 SLA 或性能统计。

| 目标 | 最终 HTTP | 总耗时范围（秒） | 含义 |
|---|---|---|---|
| 正式站 `/site` | 200×3 | 0.085–0.458 | 当前测点可取页面 |
| 游客 `/api/public/discover` | 200×3 | 0.188–0.294 | 匿名浏览接口可达 |
| `/api/me` 无凭据 | 401×3 | 0.059–0.220 | 私有边界仍拒绝匿名 |
| Clerk JS 6（重定向6.45.0） | 200×3 | 0.167–0.302 | SDK 文件可下载，不证明登录 |
| Clerk JWKS | 200×3 | 0.054–0.143 | 公钥端点可达 |
| Google 登录页 | 200×3 | 0.390–0.511 | 页面可达，不证明 OAuth 完成 |
| 微信开放平台首页 | 200×3 | 1.343–1.539 | 首页可达，不证明批准或扫码 |
| 微信 API 根路径 | 404×3 | 0.526–0.738 | 主机可响应；该路径不是 token API 验收 |

完整 DNS、时间与每次结果：[JSON证据](evidence/network-host-2026-11-18.json)。脚本仅用 Node/curl：

```sh
TRYME_PROBE_LABEL='测试城市-运营商-家庭宽带或移动网络-无代理' node scripts/probe-public-network.mjs > network-result.json
```

由孙安排至少两种大陆运营商、移动数据和家庭/校园网络，分别测试有无网络代理并如实标记；每个网络不同时间重复。另人工记录：Feed 首屏、Clerk JS加载、邮箱验证码到达耗时、Google可用性、微信完整授权、上传、游戏 iframe首帧、分享回跳及会话过期。不要上传含验证码、cookie、token、AppSecret 或完整 OAuth query 的 HAR；提交脱敏状态、耗时与错误码即可。验收目标由团队确认，建议先用成功率≥95%、Feed首屏≤3秒、游戏首帧≤5秒作为待讨论的试点目标，不能称已达到。

## 集中前置清单

| 需要谁补 | 资料/决定 | 交付方式 |
|---|---|---|
| Pacifica + 孙 | 实际运营主体、注册地区、申请类别、官网主体与域名所有人、备案/资质现状 | 脱敏状态与负责人；证件走平台后台 |
| Pacifica + 孙 | 微信网站应用是否审核通过、是否开通登录、批准回调域、可用测试人员；是否另需微信内 H5 | 非敏感配置清单；AppSecret直接进入测试环境secret存储 |
| Pacifica | 独立 Clerk development 实例与权限；Required email/password、MFA、session task、terms、恢复路径配置 | 在后台确认；secret不进聊天或Git |
| 孙 | 大陆测点城市、运营商、设备/浏览器、是否有代理、可配合测试时段 | 上述脱敏测量JSON与流程记录 |
| Pacifica + 孙 | 第二域名是品牌跳转、双入口，还是必须大陆托管；预算、接入商与数据区域 | 明确选择后再购买/开通，不自动承诺费用 |
| Pacifica | 隐私/条款适用主体、微信数据说明、跨境流向、保留与删除策略 | 发布前审核候选文本 |

真实密钥、条款接受和生产身份设置不在本轮操作范围内。资料未齐时，代码与本地契约可审阅，但 F08/S01 不能标为已上线。
