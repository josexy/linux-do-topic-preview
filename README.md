# Linux.do Topic Preview

一款支持 **Chrome、Edge、Firefox**（Manifest V3）的跨浏览器扩展。当鼠标移动到 `linux.do`（以及你自定义添加的其他 Discourse 论坛）的 Topic 标题上时，自动在标题旁浮现「预览」按钮；点击后直接在当前页面弹出可自由拖拽移动与 8 方向调整宽高的浮动窗口加载帖子内容，无需频繁打开新标签页。

## 核心功能

- **零侵入悬浮触发**：鼠标移至 Topic 标题时平滑浮现「预览」胶囊按钮，不改动论坛原有 DOM 结构，带有防闪烁移出延迟。
- **同源 iframe 原生体验**：完整保留论坛亮/暗主题、登录态、点赞、回复、代码块与折叠框等原生交互，并默认自动隐藏弹窗内冗余的顶部导航栏与侧边栏。
- **自由缩放与位置记忆**：支持拖拽标题栏移动、8 方向边缘/边角调整宽高、双击标题栏最大化/还原，并自动记住上次窗口尺寸。
- **快捷操作**：工具栏内置刷新、精简/完整视图实时切换、复制链接、新标签页打开、最大化及关闭按钮；支持点击遮罩或按 `Esc` 键（含 iframe 内聚焦）快速关闭。
- **支持自定义 Discourse 站点**：默认最小权限仅包含 `https://linux.do/*`，可在插件弹窗设置中按需授权添加其他 Discourse 论坛（如 `meta.discourse.org`）。

## 开发与构建

需要 Node.js 24+ 与 pnpm：

```bash
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run package
```

构建完成后会生成两个目标目录：
- `dist/chromium/` — 适用于 **Chrome** 与 **Edge**
- `dist/firefox/` — 适用于 **Firefox 128+**

运行 `pnpm run package` 后，还会在 `release/` 目录生成可直接分发的压缩包：
- `release/linux-do-preview-chromium-v*.zip`
- `release/linux-do-preview-firefox-v*.zip`

推送 `v*` 标签（例如 `git tag v1.0.0 && git push origin v1.0.0`）时，GitHub Actions 会自动执行类型检查、单元测试、打包并发布到 GitHub Releases。

## 开源协议

[MIT](./LICENSE)

## 安装与本地测试

### Chrome
1. 打开 `chrome://extensions/`
2. 打开右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**，选择 `dist/chromium`

### Edge
1. 打开 `edge://extensions/`
2. 打开左侧 **开发人员模式**
3. 点击 **加载解压缩的扩展**，选择 `dist/chromium`

### Firefox
1. 打开 `about:debugging#/runtime/this-firefox`
2. 点击 **临时载入附加组件...**
3. 选择 `dist/firefox/manifest.json`
