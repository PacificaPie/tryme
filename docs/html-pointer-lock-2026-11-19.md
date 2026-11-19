# HTML 游戏鼠标锁定修复

状态：已通过 [PR #35](https://github.com/PacificaPie/tryme/pull/35) 合并并部署到正式站，线上 Chrome 鼠标交互已验证。修复基于 `main` 的 `ae09ad9`，合并提交为 `4cce34cf083bffec3e0b914cfbca469a4da846d3`。

## 问题与影响范围

线上作品「锻造大师」（作品 `8edf9e6d-1db1-4bee-8ce7-2572e2ab7f0d`，版本 `49c4c23e-ebe3-41c3-8d92-f027d3c72fa5`）使用 `requestPointerLock()` 隐藏系统光标，并通过 `movementX/movementY` 控制视角。游戏捕获并忽略请求失败，所以玩家看不到错误提示。

平台的游戏 iframe 和 `GAME_CSP` 响应均只允许 `allow-scripts`，缺少 `allow-pointer-lock`。这会普遍阻止依赖 Pointer Lock 的上传 HTML 和 GitHub 构建产物，包含作品页、历史版本及名片回跳后的同一试玩容器。版本更新的本地 HTML / GitHub 预览也受影响。仅使用 CSS `cursor: none` 的作品不属于这个问题。

## 修复

- `public/site.js`：正式试玩 iframe 加入 `allow-pointer-lock`。
- `public/versioning.js`：版本预览 iframe 加入相同权限。
- `lib/funtrack/rules.mjs`：游戏和构建预览共用的 CSP sandbox 同时加入该权限。两层策略必须都允许。

游戏仍需用户手势请求锁定，Esc 由浏览器解除。继续保持 opaque origin、禁止父页面/存储访问及原有网络限制。自动封面/视频捕获的隔离 iframe 不变。不修改任何已上传的游戏文件或版本数据；部署后重新打开试玩即可加载新的容器和响应策略。

浏览器规则：[MDN Pointer Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API)、[HTML sandbox 标准](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox)。

## 本地验证

运行 `node tests/integration/pointer-lock.mjs`，打开 `http://127.0.0.1:8799`。该诊断页从实际应用源码读取 iframe 权限，并复用 `GAME_CSP`、`gameDocument` 和 `localPreviewHTML`，无需登录或写入平台数据。

Chrome 实测结果：

| 场景 | 结果 |
| --- | --- |
| 原 iframe + 原 CSP | `SecurityError` |
| 只修改 iframe | `SecurityError` |
| 只修改 CSP | `SecurityError` |
| 同时修改两层 | 前台原生点击后 `LOCKED`，Esc 后 `UNLOCKED` |
| 本地版本预览 srcdoc | 前台原生点击后 `LOCKED`，Esc 后 `UNLOCKED` |

所有场景均显示父页面访问与 localStorage 访问被阻止。后台自动点击曾出现独立的 `WrongDocumentError`；切换到前台原生鼠标点击后成功，不应将后台自动化结果当成权限修复失败。

`npm run check`、`npm test` 和 `npm run build:standalone` 通过，685 项测试无失败。[PR CI](https://github.com/PacificaPie/tryme/actions/runs/44601837935) 通过。其他浏览器和触屏设备未验证。

## 正式发布与线上验收

2026-11-19 经用户明确授权合并、部署及线上验证：

- 发布前确认生产 `site.js`、`versioning.js`、`opening.js` 与主线一致，远端无待执行迁移。
- 使用显式 `wrangler.standalone.production.jsonc` 重新构建，dry-run 确认正式 Worker、D1、R2 和 `https://trymecard.com`，随后部署相同产物。既有远端 secrets 沿用，没有读取或替换密钥。未执行数据库迁移。
- 新生产版本：`80097e75-3e0c-4b60-ae44-6a51f2953a62`（100%）；此前版本：`68eaa7a2-deb1-4e91-9225-d11136fc3035`。
- 上线后 `site.js` 和 `versioning.js` 与修复源码逐字节一致，`opening.js` 保持原摘要。认证配置仍为 Clerk production；匿名请求游戏仍返回 401。
- 登录后新开「锻造大师」v1，iframe 的 sandbox 为 `allow-scripts allow-pointer-lock`。
- 前台原生点击「新的契约」及「点击画面继续」后，Chrome 显示 `trymecard.com – To show your cursor, press esc`，游戏的继续提示消失。
- 按 Esc，游戏重新出现「点击画面继续」暂停层；再次点击可以恢复。通过浏览器鼠标拖动输入，画面从正对铁砧转到地面/侧墙，确认相对鼠标输入能控制视角。
- 第二次 Esc 再次正常暂停，最终点击「退出试玩」回到作品封面，未修改游戏原文件、版本或发布数据。

本地截图保存在 `.preview/pointer-lock-production/mouse-look.jpg` 和 `escape-paused.jpg`。线上结论依据原生 Chrome 锁定提示、真实游戏视角变化和暂停/恢复行为；不是只根据 iframe 属性或后台点击结果推断。
