# 视频播放器字幕大小优化 设计文档

## 概述

视频播放器悬浮字幕（CC 字幕层）当前字号固定为 15px，相对播放器实际尺寸偏小。本设计让字幕字号随播放器实际渲染宽度按比例连续缩放，并提供用户手动微调入口；同时把现有分散在控制栏上的"切换语言""CC 开关"整合为单个"字幕"按钮 + 弹出菜单，菜单内含语言选择、CC 开关、字号调节三块。

## 背景

- `web/src/components/cc-overlay.tsx` 渲染悬浮字幕文本，样式来自 `globals.css` 的 `.cc-overlay-text`，`font-size: 15px` 写死，不随播放器尺寸变化。
- `web/src/components/player.tsx` 控制栏当前有两个独立按钮：`hasMultipleTracks` 时的语言循环切换按钮、`showCc` 时的 CC 开关按钮（`.cc-btn`）。功能挤在同一行，随着新增字号调节会更拥挤。
- 无任何字幕字号相关的持久化状态。已有的持久化偏好范式是 `web/src/stores/ui-store.ts` 里的 `proseTheme`：状态存于 zustand store，读写时手动同步 `localStorage`（不用 zustand persist 中间件）。

## 用户故事

- 作为用户，在中等或大屏幕上打开视频任务时，播放器上的字幕应该清晰可读，不再显得过小。
- 作为用户，我可以点击播放器上的"字幕"按钮，打开菜单，看到字幕开关、语言选项、以及字号的 `A−` / `A+` 调节。
- 作为用户，我调整过的字号偏好在切换到其他视频任务甚至刷新页面后仍然保留。

## 架构设计

### 1. 比例缩放（CSS container query）

- 给 `player.tsx` 中播放器最外层容器（`bg-black` 那个 div）增加 `containerType: 'inline-size'`（inline style 或新增 CSS class），使其成为 container query 的度量对象。
- `globals.css` 中 `.cc-overlay-text` 的 `font-size` 改为：
  ```css
  font-size: calc(clamp(14px, 4.5cqw, 40px) * var(--cc-scale, 1));
  ```
  - `4.5cqw` 表示播放器实际渲染宽度的 4.5%，尺寸随播放器容器的真实像素宽度连续变化（覆盖模式 A 左栏、模式 F 剧场全宽等所有布局，而不是绑定浏览器视口宽度）。
  - `clamp(14px, …, 40px)` 兜底极端尺寸下的可读性上下限。
  - `--cc-scale` 是用户手动调节乘数，默认 `1`，由 `CcOverlay` 组件通过 inline style 设置在自身或父元素上。
- 现代浏览器（Chrome/Edge/Safari 最新版）原生支持 container query，无需 polyfill，无需 JS 端 ResizeObserver 测量宽度。

### 2. 手动调节状态（`ui-store.ts`）

新增字段：

```ts
subtitleScale: number;              // 默认 1.0，范围 [0.7, 1.6]，步进 0.1
setSubtitleScale: (updater: (prev: number) => number) => void;
```

- `setSubtitleScale` 内部对结果做 clamp 到 `[0.7, 1.6]`（并四舍五入到 1 位小数避免浮点误差），然后写入 `localStorage.setItem('subtitle-scale', String(value))` 并 `set({ subtitleScale: value })`。
- 初始化时从 `localStorage.getItem('subtitle-scale')` 读取（parseFloat，NaN 或越界则回退到 `1.0`），与 `proseTheme` 初始化写法一致。
- 作用范围**仅限**视频播放器悬浮字幕层（`CcOverlay`），不影响 `SubtitleList` 侧边栏面板的字幕列表文字大小（二者是不同组件，各自独立）。

### 3. 字幕按钮 + 弹出菜单（`subtitle-menu.tsx`，新文件）

新建 `web/src/components/subtitle-menu.tsx`，封装：

- **触发按钮**：复用现有 `.cc-btn` 视觉样式（含 `.on::before` 高亮圆点表示字幕开启状态），文案改为"字幕"，替换掉 `player.tsx` 控制栏里原来的语言循环按钮和 CC 按钮两个元素。
- **弹出菜单**：交互与定位参考 `prose-theme-picker.tsx`（点击外部关闭的 `mousedown` 监听 + `ref` 判断），但方向朝上展开（`bottom: 100%` 而不是 `top: 100%`），因为触发按钮位于播放器底部控制栏。
- **菜单内容**（自上而下）：
  1. **显示字幕**：开关行，对应现有 `ccEnabled` / `onToggleCc` props（从 `player.tsx` 透传下来，与现状 prop 结构一致）。
  2. **语言**：仅当 `tracks.length > 1` 时展示。列出全部轨道（不再是"循环切换单按钮"），当前 `activeLang` 高亮。直接从 `usePlayerStore` 读取 `tracks` / `activeLang` / `setActiveLang`（与 `Player` 组件读同一个全局 store，无需额外 props）。
  3. **字号**：一行 `A−` 按钮 / 当前百分比文本（如 `100%`）/ `A+` 按钮，读写 `useUiStore` 的 `subtitleScale` / `setSubtitleScale`；到达 0.7 或 1.6 上下限时对应按钮 `disabled`。
- `showCc` 为 `false` 时（例如模式 B/C 里 `audioOnly`/无 CC 的 `Player` 实例）整个按钮不渲染，与现状行为一致。

### 4. `player.tsx` 改动点

- 删除控制栏里 `hasMultipleTracks` 对应的语言循环 `<button>` 和 `showCc` 对应的 CC `<button>`（连带其内联逻辑 `cycleTrack`，若菜单内部自行处理选择则该函数可整体移除）。
- 在同一位置渲染 `<SubtitleMenu ccEnabled={ccEnabled} onToggleCc={onToggleCc} />`（仅 `showCc` 为真时）。
- 播放器最外层容器补充 `containerType: 'inline-size'`。

## 数据流

```
localStorage['subtitle-scale']
        │ (初始化读取)
        ▼
ui-store.subtitleScale ──(setSubtitleScale)──> SubtitleMenu 的 A−/A+ 按钮
        │
        ▼ (读取)
CcOverlay ──inline style --cc-scale──> .cc-overlay-text 最终字号
                                       = clamp(14px, 4.5cqw, 40px) * scale
```

语言切换与 CC 开关的数据流不变，只是触发它们的 UI 从"控制栏两个按钮"变成"字幕菜单里的两行"。

## 错误处理

- `localStorage` 中 `subtitle-scale` 值非法（非数字、超出范围）→ 初始化时回退到默认 `1.0`，与 `proseTheme` 目前对非法值缺乏防御的现状相比，这里额外做 clamp，避免脏数据导致字幕消失或过大。
- container query 在极旧浏览器不支持时，`cqw` 会被浏览器忽略导致 `clamp()` 里那一项失效——但 `clamp()` 的第一个参数（`14px`）会被当作有效值兜底，不会导致渲染崩溃，只是退化为固定 14px（可接受的降级）。

## 测试策略

- `ui-store.test.ts` 参照现有 `proseTheme` 测试补充 `subtitleScale` 用例：默认值、`setSubtitleScale` 更新、越界 clamp（0.7/1.6 边界）、持久化到 `localStorage`、从 `localStorage` 初始化。
- 手动验证（`cd web && npm run dev`）：
  - 分别在模式 A（左栏视频）、模式 F（剧场全宽）下，缩放浏览器窗口模拟小/中/大屏幕，确认字幕字号随播放器实际宽度连续变化，且不小于/超过 clamp 边界。
  - 点击"字幕"按钮打开菜单，验证开关、语言列表（多语言任务）、`A−`/`A+` 三块功能正常，且按钮在越界时正确 disable。
  - 刷新页面 / 切换到其他视频任务，确认字号偏好保留。
- `npm test`（web 目录）与 `cd web && npm run build`（tsc 检查）作为回归验证。

## 风险和缓解

- **风险**：菜单整合后原有"点击 CC 按钮直接开关"的单击路径变成"点击字幕按钮 → 菜单 → 点击开关"，多一步操作。
  **缓解**：这是用户本次明确要求的交互改动（"改成在播放器上有单独的字幕按钮，点击后有更多菜单"），视为预期取舍，不做退让式的"双模式"设计。
- **风险**：`cqw` 单位在部分浏览器/webview 内核版本可能不支持。
  **缓解**：见上文"错误处理"，有可接受的降级路径（固定 14px），不阻塞功能可用性。
