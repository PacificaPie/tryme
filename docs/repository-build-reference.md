# 公开仓库构建：真实样例与来源核实

核实日期：2026-11-16。本文记录选型及源码审阅；除下述 resolver 网络读取外，不把“预期可构建”写成已完成部署。

## 首个样例

- 仓库：[yuss-raa/Snake-Game](https://github.com/yuss-raa/Snake-Game)
- 固定提交：[`1f76427453c48f6f0a02d09a12e0469451c0d1e3`](https://github.com/yuss-raa/Snake-Game/commit/1f76427453c48f6f0a02d09a12e0469451c0d1e3)
- 默认分支：`main`
- 作者提供的独立演示：[react-snakegame.netlify.app](https://react-snakegame.netlify.app/)。演示链接来自 README；不是 Funtrack 的构建或部署证据。
- 玩法：React 贪吃蛇，12 个关卡/难度，键盘与触摸控制、失败、重新开始。

这是已有的第三方多文件项目。主要文件包括 `src/main.jsx`、`src/App.jsx`、`src/snake.jsx`、`src/index.css`、`vite.config.js`、`tailwind.config.js`、`postcss.config.js`、`index.html` 和 `public/vite.svg`。`src/snake.jsx` 约 27.6 KB，包含实际游戏循环、碰撞与关卡逻辑；不是为了本轮测试临时制作的单文件假样例。

## 构建依据

已读取固定提交的 [package.json](https://github.com/yuss-raa/Snake-Game/blob/1f76427453c48f6f0a02d09a12e0469451c0d1e3/package.json)、[package-lock.json](https://github.com/yuss-raa/Snake-Game/blob/1f76427453c48f6f0a02d09a12e0469451c0d1e3/package-lock.json)、[Vite 配置](https://github.com/yuss-raa/Snake-Game/blob/1f76427453c48f6f0a02d09a12e0469451c0d1e3/vite.config.js)及两个 CSS 构建配置。

| 项目 | 已核实的值 |
| --- | --- |
| UI | React 19、React DOM 19、lucide-react |
| 构建 | Vite 7、React 插件 5、Tailwind 3、PostCSS、Autoprefixer |
| 锁文件 | npm package-lock v3，约 295 个 package entries（包括平台可选包） |
| build script | `vite build` |
| 构建入口 | 根目录 `index.html`，引用 `/src/main.jsx` |
| 默认输出 | 预期 `dist`；配置未改 `build.outDir`，实际文件清单以构建结果为准 |
| Node | 锁定 Vite 与 React 插件要求 `^20.19.0 || >=22.12.0` |

README 中的 Node 14 要求与锁定工具链不符，应以包的 engines 为准。锁文件中标为含安装脚本的条目有 esbuild 和 fsevents；依赖安装、构建脚本的执行约束由隔离 runner 决定，不能直接把任意仓库脚本放到网站请求处理进程中运行。

受控环境中的构建基线为锁文件安装后执行 `npm run build -- --base=./`。Vite 官方文档说明默认产出可静态部署的 `dist`，相对 base 会调整 JS、CSS 和 HTML 的资源路径：[静态部署](https://vite.dev/guide/static-deploy)、[相对 base](https://vite.dev/guide/build#relative-base)。预期产物包括 `index.html`、`assets/*` 与 `vite.svg`，不能在真正构建前填写体积、耗时或声称部署成功。

## 许可与归属

固定提交包含 [MIT LICENSE](https://github.com/yuss-raa/Snake-Game/blob/1f76427453c48f6f0a02d09a12e0469451c0d1e3/LICENSE)，原版权行为：

```text
Copyright (c) 2025 𝔜𝔲𝔰𝔯𝔞 ♪⁠♪☆
```

部署副本应保留完整 LICENSE（含版权、许可条件与免责声明），不能只展示一个 MIT 标签。发布来源记录应保留仓库、固定 SHA、原作者及许可文件。该作品是第三方导入验证样例，不应在产品介绍中冒充 Funtrack 或当前用户原创。依赖包许可也应随构建产物的许可证记录保留。

resolver 返回的 `license: {spdxId, name} | null` 只是 GitHub 的元数据摘要，既不是完整 notice，也不替任意仓库做授权判断。

## 运行兼容性与埋点边界

静态审阅了完整 `src/snake.jsx`、入口及样式：没有 fetch、WebSocket、外部资源 URL、localStorage、sessionStorage、cookie 或音频依赖，也不需要后端或 API 密钥。游戏只导入 React 与 lucide 的 Heart 图标，适合作为现有 opaque-origin iframe 的首个样例。此结论限于该固定提交的源码检查，不是对全部依赖或任意导入代码的安全认证。

- 游戏根据 `innerHeight - 250` 计算棋盘，460px iframe 中棋盘约 200px；需在浏览器检查实际可玩性和手机操作。
- `index.html` 带 `/vite.svg` favicon；构建时应正确处理部署 base，不能漏掉构建产物里的资源。
- 没有 Funtrack SDK 或完成事件。首次用户输入可由平台桥接记录，但不能据此自动知道游戏胜负、得分或通关。
- “支持多文件源代码构建”与“支持任意后端/SSR/多资源运行方式”是不同的范围。以最终 runner 和部署方案实际实现为准。

## 已完成的 resolver 验证

`lib/funtrack/github-repository.mjs` 仅解析仓库身份与默认分支的固定 SHA，不下载源码、不安装依赖、不构建、不发布。只接受 `https://github.com/owner/repo` 根链接，允许规范化尾斜杠和 `.git`；拒绝凭据、query、hash、tree/blob 路径、非官方主机、重定向和路径归一化绕过。

- 10 项模块测试通过：URL 边界、匿名请求、身份核对、私有/禁用/空仓库、响应大小、错误映射和超时。
- 对 `https://github.com/yuss-raa/Snake-Game.git/` 的真实调用成功，返回上述 SHA、`main` 和 MIT 元数据。
- 实际只请求 `api.github.com/repos/yuss-raa/Snake-Game` 及其 `/commits/main`，均为 `redirect: manual`、`credentials: omit`，无 Authorization。
- 每次请求 10 秒超时、响应最多 1 MiB；固定提交来自 GitHub SHA 响应，仓库大小为 0 KiB 本身不会被误判为空仓库。

构建、部署、浏览器试玩的成功与成本应另附实际执行记录；本文不会将该 resolver 网络通过等同于整条链路通过。
