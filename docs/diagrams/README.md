# 架构图源与导出

基线和边界见 [系统架构](../system-architecture-2026-11-19.md)。三段 Mermaid 与对应 `.mmd` 必须同步；SVG 为可缩放导出。`architecture-viewer.html` 内含三图，可离线切换查看，不依赖外部 CDN。

本次使用 Mermaid CLI 12.2.0；无需加入应用依赖。单图重渲染示例：

```sh
npx --yes --package @mermaid-js/mermaid-cli@12.2.0 mmdc -i docs/diagrams/system-overview.mmd -o docs/diagrams/system-overview.svg -c docs/diagrams/render-config.json --no-font-embed
```

更新发布时序/数据关系时分别替换文件名。HTML 预览嵌入同一组 SVG；同步替换对应 section 中的 SVG，并将根 SVG 的 `my-svg` ID 及内部 CSS 引用替换为对应文件名以避免冲突。Notion 内保留原生 Mermaid，并附同一批导出文件。
