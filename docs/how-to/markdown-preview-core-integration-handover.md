# markdown-preview-core 接入交接指南（面向 scholia）

**背景：** agent-canvas 已完成 `markdown-preview-core` 的完整接入（`MarkdownPanel.tsx` 读模式渲染），经历了两个阶段——先用本地 `file:` 依赖跑通集成，随后迁移到 GitHub Packages 私有包分发。这份文档把两个阶段踩过的坑和最终结论整理给 scholia，供其评估是否接入、以及接入时怎么避开 agent-canvas 已经交过的学费。

**必读文档（均在 agent-canvas 仓库内，非 scholia 本仓库，路径相对 `~/Projects/agent-canvas`）：**

- `docs/superpowers/specs/2026-07-28-markdown-preview-core-agent-canvas-integration-design.md` — 原始集成设计，含集成边界表、`WikiLink` 插件签名、CSS 桥接映射的完整代码
- `docs/superpowers/specs/2026-07-29-markdown-preview-core-github-packages-migration-design.md` — `file:` → GitHub Packages 迁移设计，含三个 `file:` 依赖的具体问题和迁移步骤
- `markdown-preview-core` 仓库（`~/Projects/markdown-preview-core`）`docs/INTEGRATION.md` — 包本身的接入指南（本文不复述其内容，只讲 agent-canvas 作为第一个宿主踩出来的经验）

---

## 1. 依赖接入方式：直接用 GitHub Packages，跳过 `file:` 阶段

agent-canvas 最初用 `"markdown-preview-core": "file:../markdown-preview-core"` 起步（sibling 目录相对路径），后来迁移成 `"@harveyzhang814/markdown-preview-core": "^0.1.0"`（GitHub Packages 私有包）。**结论：scholia 直接从 GitHub Packages 起步，不需要重走 `file:` 阶段**——包本身已经发布，`file:` 只在 agent-canvas 当初包还没独立发布时是必经过渡。

`file:` 依赖实测暴露的三个问题（迁移设计文档已验证，不是理论推测）：

1. **重复模块**：`file:` 会建符号链接而不是拷贝，Node 模块解析从目标包的真实路径出发找它自己 `node_modules` 里的依赖（比如 mermaid），和消费方主 `node_modules` 里的版本各自独立，需要手动在构建配置里加 `resolve.dedupe` 才能避免状态不同步 / `Invalid hook call`。
2. **`prepare` 脚本不递归装 devDependencies**：`file:` 安装会触发目标包的 `prepare`（`tsup` 编译），但不会自动帮消费方装目标包自己的 `devDependencies`。全新机器上必须先手动进目标包目录 `npm install` 一次。
3. **单机耦合**：依赖只在两个仓库同时存在于同一台机器、且相对路径深度正确的环境才能装成功，换机器/换 worktree 都要跟着改路径。

GitHub Packages 分发天然不产生这三个问题（真实 npm 安装是扁平结构，`prepare` 只在作者发布时跑一次、编译产物直接打进 tarball）。**唯一代价**：日常改动流程从"改完直接生效"变成要走版本号：

```
改 markdown-preview-core 代码
  → cd markdown-preview-core && npm version patch/minor && npm publish
  → cd <消费方项目> && npm install @harveyzhang814/markdown-preview-core@latest
```

联调期嫌麻烦可以临时切回 `file:` 在本机调试，验证完切回真实版本号再提交。

**scholia 需要的前置步骤（一次性，人工完成，不能代为操作）：**

1. 确认 `@harveyzhang814/markdown-preview-core` 私有包在 GitHub Packages 上可访问（agent-canvas 已发布过 `0.1.0`，直接装即可，不需要重新发布）。
2. 生成/复用一个有 `read:packages` 权限的 GitHub PAT，配置进 scholia 开发机的全局 `~/.npmrc`：`//npm.pkg.github.com/:_authToken=<token>`（这是每台要装依赖的机器都要单独配一次的东西，不进仓库）。
3. scholia `web/` 子项目根新增（提交进 git）：
   ```
   @harveyzhang814:registry=https://npm.pkg.github.com
   ```
   只声明 scope 到 registry 的映射，不含 token，可以安全提交。

---

## 2. 集成边界划分：核心渲染进包，数据/交互留 host

agent-canvas 按"机制 vs 数据"原则划分了职责，这个边界对 scholia 同样适用（`markdown-preview-core` 目前只有核心渲染层 + 一个 `links` 插件，`editor`/`toc`/`annotate` 插件都不存在）：

| 能力 | 归属 | 理由 |
|---|---|---|
| 基础渲染（GFM、mermaid 代码块检测与渲染） | 包核心层 | 通用，无宿主耦合 |
| 语法解析类插件（如 wikilink） | 包（`markdown-preview-core/links`） | 纯语法机制，不依赖存储 |
| 交互状态机（如 wikilink 的 loading/resolved/unresolved） | 包 | 只需要 host 传 `resolve`/`onNavigate` 回调，机制本身不用知道数据在哪 |
| 实际数据解析（文件系统查找、API 调用） | host | 天然绑定各自项目的存储/网络层 |
| 导航/路由 | host | 天然绑定各自的状态管理 |
| 主题桥接 CSS | host | 每个宿主的 design system 不同 |

**对 scholia 的关键推论（风险提示）：** scholia 的 `reader.tsx` 里 `injectAnchorMarks()` 是**渲染完成后对已生成的 DOM 树做后处理**（在 `react-markdown` 输出的真实 `HTMLElement` 上查找文本节点、插入 `<mark>` 标签实现高亮/批注锚点），这不是"传个 remark 插件"或"传个 components 覆盖"能表达的机制——它依赖能拿到渲染后的容器 DOM 节点直接操作，而不是介入渲染管线内部。

`markdown-preview-core` 目前**没有** `annotate` 插件（agent-canvas 集成设计文档里明确列为非目标，尚未实现），也没有暴露"渲染完成后回调 + 容器 ref"这类扩展点。这意味着：

- 如果换成 `<MarkdownPreview>`，scholia 现在这套高亮/批注机制大概率仍然可以工作——因为它是对渲染结果 DOM 的外部操作，不关心 DOM 是谁生成的，只要 `<MarkdownPreview>` 允许拿到一个可查询的容器 ref（用外层 `<div ref={...}>` 包住组件即可，不需要包本身提供 ref 透传）。
- 但**不能假设**这一点没有实测就直接迁移——`injectAnchorMarks` 依赖的具体 DOM 结构（文本节点切分方式、`<mark>` 插入点相对哪些标签合法）如果和 `markdown-preview-core` 内部 `react-markdown` 渲染出的结构有细微差异（比如自定义 `components` 覆盖改变了某些标签的嵌套层级），高亮定位可能出现偏移或失败。这是 scholia 特有的、agent-canvas 集成经验完全没覆盖到的风险点，接入前必须用真实高亮/批注数据走一遍端到端验证，不能照抄 agent-canvas 的验证清单就认为够了。

---

## 3. React 版本不匹配：先解决再谈接入

`markdown-preview-core@0.1.0` 的 `peerDependencies` 是 `"react": "^18.2.0 || ^19.0.0"`，`dependencies` 里锁定 `"react-markdown": "^10.1.0"`。scholia `web/` 当前是 `react-markdown: ^9.0.0`。

这不是"装的时候可能报个 peer dep warning"级别的小事——`react-markdown` v9 → v10 之间 API 有 breaking change（`urlTransform`/`components` 的类型签名等），**scholia 不能只换 `markdown-preview-core` 的版本了事，必须先确认自己 `reader.tsx` 里直接使用 `react-markdown`（`remark-gfm`、`rehype-highlight`、`components` 覆盖）的部分能否兼容 v10**，或者干脆把 `react-markdown`/`remark-gfm` 这两个直接依赖也一起交给 `markdown-preview-core` 内部管理（不再在 scholia 自己的 `package.json` 里显式声明版本，避免双份 `react-markdown` 共存）。

React 本身（19.0.0）和包的 peer range 兼容，不是问题；`react-markdown` 版本落差才是接入前必须先解决的阻塞项。

---

## 4. React 重复模块问题：无论哪种依赖方式都要做去重

`file:` 阶段这是必然踩的坑（符号链接导致 Node 从包的真实路径解析到它自己 `node_modules/react`），GitHub Packages 分发下这个问题大概率自然消失（扁平安装，不是符号链接），但**"大概率"不是证据**——agent-canvas 迁移到 GitHub Packages 后仍然保留了 `resolve.dedupe: ['react', 'react-dom', 'mermaid']`，直到用测试实测确认多余才会考虑清理（目前尚未清理）。

**建议 scholia 直接照做**：在 `web/vite.config.ts` 加

```ts
resolve: {
  dedupe: ['react', 'react-dom', 'mermaid'],
}
```

如果用 vitest，`vitest.config.ts`（或 vite config 里的 `test` 块）同样加，且如果测试里 mock 了 `mermaid`（scholia 的 `mermaid-chart.tsx` 大概率有类似 mock），要确认 dedupe 生效——agent-canvas 曾经因为漏了 `mermaid` 的 dedupe，导致 `vi.mock('mermaid', ...)` 只拦截了两份物理模块实例中的一份，mermaid 渲染测试悄悄跑了真实的 `mermaid.initialize()` 而不是 mock。

---

## 5. 验证方法：像素级视觉对比 + 真实进程渲染

agent-canvas 的验证不是只跑单测/typecheck，而是额外做了两轮针对渲染结果本身的验证，**建议 scholia 照搬这个验证强度，不要只用单测覆盖**：

1. **迁移前后完整对比**：在集成前的 commit 上单独开一个 worktree，用同一份覆盖标题/加粗斜体删除线/引用/有序无序列表/GFM 任务列表/GFM 表格/代码块/外部链接/mermaid 流程图（scholia 还要加：高亮/批注锚点场景）的测试文档，在真实渲染进程里对旧实现和新实现（`markdown-preview-core`）各截图对比，逐张比对像素差异。agent-canvas 的结论是"像素级一致，零渲染/交互差异"——但这是针对 wikilink+mermaid 场景验证出来的结论，**不能直接套用到 scholia 的高亮/批注场景**，需要重新走一遍。
2. **真实渲染环境的 Invalid hook call / 控制台报错检查**：不是 jsdom 单测能覆盖的（jsdom 不会暴露"两份 React 实例"这种运行时问题），必须用真实浏览器/真实进程渲染一次，切换应用明暗主题（如果 scholia 有主题切换）确认没有报错。
3. **依赖装完之后确认不是符号链接**：`ls -la node_modules/@harveyzhang814/markdown-preview-core`，确认不是 `l` 开头的 symlink 条目（GitHub Packages 走真实 npm 安装应该天然满足，但装完应该实测确认一次，不假设）。

---

## 6. 快速结论（给 scholia 决策用）

- **依赖方式**：直接接 GitHub Packages，不用重走 `file:` 阶段。
- **接入前的硬阻塞项**：`react-markdown` v9 → v10 版本落差必须先解决，这比"要不要接入"这个问题本身更紧急，需要先验证。
- **接入范围**：只能替换核心渲染（GFM + mermaid），wikilink 之外的插件（含 scholia 需要的高亮/批注）包目前都没有，`injectAnchorMarks` 这类 DOM 后处理机制理论上可以在 `<MarkdownPreview>` 外层继续工作，但必须实测，不能假设。
- **必做的工程动作**：`resolve.dedupe` 加 `react`/`react-dom`/`mermaid`；接入后做像素级视觉对比 + 真实渲染环境报错检查，而不是只跑单测。
