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

**现状核实：** scholia 目前 `web/` 下没有任何 `.npmrc`，`package-lock.json` 里也没有 `markdown-preview-core` 的残留条目——是干净的起点，不用担心历史上手动改过依赖路径又没清理干净的情况。

**scholia 特有的连锁影响（agent-canvas 经验完全没覆盖到）：根 `package.json` 的 `postinstall` 会级联触发 `web/` 的依赖安装。** scholia 根目录 `postinstall` 脚本是 `cd web && npm install && npm run build`——任何触发 npm 生命周期钩子的场景（全新 `git clone` 后的 `npm install`、`npm link`、甚至 `npm run release:local` 内部的 `npm pack && npm install -g ...` 全局安装）都会自动级联进 `web/npm install`。一旦 `web/package.json` 加了 `@harveyzhang814:registry` 的 scope 映射，这些场景全部需要执行环境的全局 `~/.npmrc` 配置好 GitHub PAT，否则会在 `web/npm install` 这一步直接失败——不是"只有本地联调依赖时才用得上"。对比 agent-canvas：它是 Electron 桌面应用，`postinstall` 只跑 `electron-rebuild -f -w node-pty`，不递归装子项目依赖，没有这种级联结构，所以 agent-canvas 的迁移经验里完全不会暴露这个问题。**scholia 接入前应该先确认清楚：团队里谁会在什么环境下跑 `npm install`/`npm run release:local`（包括未来可能补的 CI），这些环境是不是都能拿到 GitHub PAT**——目前 scholia 没有 `.github/workflows`，暂时不涉及 CI 鉴权，但如果以后补上 CI，这一步会成为新的前置依赖。

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

**核实结论（已对照 `reader.tsx` 和包源码确认，非推测）：** `injectAnchorMarks` 只依赖 `articleRef.current` 这个容器引用做 `TreeWalker` 遍历，`<MarkdownPreview>` 内部多包一层 `<div className="mpc-root">` 不影响它工作，`reader.test.tsx` 现有的 4 个高亮/笔记锚点用例（含跨 `<strong>` 场景）应该不改代码就能直接通过，可以作为迁移前后的回归基线。

**本文档遗漏的第三个 DOM 后处理机制：scholia 已有的 TOC（`toc.tsx`）**——不是假设，是已实现且在用的功能，`markdown-preview-core` 自己的 `PRD.md` 也明确把"TOC"列为 scholia 的已知需求之一（和"批注高亮叠层"并列，`ARCHITECTURE.md` 里规划中的 `markdown-preview-core/toc` 插件正是想做同一件事：`extractToc(markdown)` 纯函数 + 内置 `IntersectionObserver` 滚动高亮的 `<Toc>`，和 scholia 自己 `toc.tsx` 里的 `extractToc`/`IntersectionObserver` 实现几乎同名同构，只是这个插件"规划中，尚未实现"）。scholia 现状（`web/src/components/toc.tsx` + `routes/tasks.$id.tsx:33,192`）：

1. `extractToc(markdown)` 对**原始 markdown 文本**做正则解析，按行匹配 `##`/`###` 提取标题列表 `items[]`。
2. `<Toc>` 组件对**渲染后的 DOM** 执行 `document.querySelector('article.prose-cn')` 拿到容器（`Reader` 的 `<article className="prose-cn">` 就是这个选择器的目标），`querySelectorAll('h2, h3')` 取出所有标题元素，**按数组下标把 `items[i].id` 赋给第 i 个 DOM 标题元素**，再用 `IntersectionObserver` 做滚动高亮。

这个"按下标对应"的假设意味着：只要渲染出的 `h2`/`h3` 数量和顺序与原始 markdown 正则提取的顺序一致（两边都基于 `remark-gfm`，通常成立），迁移到 `<MarkdownPreview>` 应该不受影响；但和 `injectAnchorMarks` 一样，这是**只有实测才能确认、不能假设**的风险点。

**已实测确认（spike worktree 里补的一次性测试，非推测）：** 用一份包含 `#`/`##`/`###` 混合标题的文档，同时渲染 `<Reader>` + `<Toc items={extractToc(content)}>`（复刻 `tasks.$id.tsx` 里两者作为兄弟节点的真实用法），断言渲染出的 `h2`/`h3` 顺序、数量、`id` 都和 `extractToc` 从原始 markdown 提取的顺序完全对应，`<Toc>` 里 `<nav>` 的 `href="#id"` 也精确对应到同一批标题——**测试通过，按下标对应的假设在 `<MarkdownPreview>` 下成立**。过程中还发现 `toc.tsx` 用到的 `IntersectionObserver` 在 jsdom 里完全没有实现（和 `notes-panel.test.tsx` 已经在 mock 的 `ResizeObserver` 是同一类 jsdom 缺口），需要同样加一个空实现的 mock 才能让测试跑起来——这也印证了"`toc.tsx` 目前没有单测文件"确实是真实盲区，而不是"凑巧一直没出问题"。

**另一个 scholia 特有的机制差异（已用代码核对，非推测）：** 包内部对 mermaid 代码块的拦截点是 `pre`（`MarkdownPreview.tsx` 的 `defaultComponents.pre`，检测 `language-mermaid` 后渲染 `MermaidBlock`），而 scholia 当前 `reader.tsx` 的 `mdComponents.code` 覆盖是另一套机制：检测 `language-mermaid` 后手动渲染自己的 `MermaidChart` 组件。两者不会互相冲突（scholia 传的 `components` 只覆盖了 `code`/`img`，不会覆盖包内置的 `pre`），但意味着接入后：

- `reader.tsx` 里 `code` 组件覆盖中检测 `language-mermaid` 并渲染 `<MermaidChart>` 的那段分支必须删除，否则 mermaid 代码块会同时被两套逻辑处理，出现重复渲染或行为冲突。
- `web/src/components/mermaid-chart.tsx` 整个文件不再有消费方，应该删除，改用包内置的 `MermaidBlock`（`<MarkdownPreview>` 内部自动处理，不需要显式引入）。
- **删除时要小心 `noUnusedLocals`/`noUnusedParameters`**：`web/tsconfig.json` 开了这两个严格选项，删掉 `mermaid-chart.tsx` 后如果忘记同步移除 `reader.tsx` 里 `import { MermaidChart } from './mermaid-chart'`，`npm run build`（跑 `tsc`）会直接报错而不是静默通过——这是一个具体的构建门槛，不是泛泛的"记得清理引用"。

**已实测确认 `pre` 拦截本身没问题，但发现一个比"CSS 颜色不对"更严重的连带风险：** 用同一份 spike 测试渲染一个含 ` ```mermaid ` 代码块的文档，断言 DOM 里不出现未处理的 `<code class="language-mermaid">` 原始文本——**测试通过，`pre` 拦截机制本身工作正常**。但第一次跑测试时（没有预先设置任何 `--md-mermaid-*` CSS 变量）直接抛出未捕获异常：`Unsupported color format: ""`，来自 `MermaidBlock` 内部 `mermaid.initialize({ themeVariables: { ... } })` 这一步——`MermaidBlock` 的 `useEffect` 只在 `.catch()` 里包住了 `mermaid.render()`，**没有包住紧跟着同步调用的 `mermaid.initialize()`**，一旦 `--md-mermaid-*` 读到空字符串（变量完全没定义时 `getComputedStyle` 就是返回空串），`mermaid.initialize()` 会同步抛错，逃出 `.catch()` 链，导致组件树直接崩溃（不是"渲染出来但颜色不对"这种优雅降级，是整个 mermaid 代码块所在的渲染树跟着报错）。补上第6节要求的 `--md-mermaid-*` 变量（哪怕只是随手给的合法颜色值）之后，异常消失，mermaid 正常走完渲染流程。**这把第6节"CSS 桥接"从"影响视觉观感的优化项"提升为"不做就可能让含 mermaid 的文章整页崩溃的阻塞项"**——接入前必须先把 `--md-mermaid-*` 七个变量写完整再上线，不能先上线渲染逻辑、CSS 后补。

---

## 3. React 版本不匹配：先解决再谈接入

`markdown-preview-core@0.1.0` 的 `peerDependencies` 是 `"react": "^18.2.0 || ^19.0.0"`，`dependencies` 里锁定 `"react-markdown": "^10.1.0"`。scholia `web/` 当前是 `react-markdown: ^9.0.0`。

这不是"装的时候可能报个 peer dep warning"级别的小事——`react-markdown` v9 → v10 之间 API 有 breaking change（`urlTransform`/`components` 的类型签名等），**scholia 不能只换 `markdown-preview-core` 的版本了事，必须先确认自己 `reader.tsx` 里直接使用 `react-markdown`（`remark-gfm`、`rehype-highlight`、`components` 覆盖）的部分能否兼容 v10**，或者干脆把 `react-markdown`/`remark-gfm` 这两个直接依赖也一起交给 `markdown-preview-core` 内部管理（不再在 scholia 自己的 `package.json` 里显式声明版本，避免双份 `react-markdown` 共存）。

React 本身（19.0.0）和包的 peer range 兼容，不是问题；`react-markdown` 版本落差才是接入前必须先解决的阻塞项。

**scholia 代码实测补充：** 全仓库搜索确认，直接 `import ... from 'react-markdown'` 的只有 `reader.tsx` 一处，且用法很薄（只覆盖 `components.code`/`components.img`，不涉及 `disallowedElements`/`unwrapDisallowed` 等 v9→v10 之间有变动的高阶 API）。这意味着"把 `react-markdown`/`remark-gfm` 完全交给 `markdown-preview-core` 内部管理、scholia 自己不再声明版本"这条路径实际风险很小，可以直接采用，不需要先做一轮兼容性排查。唯一要处理的尾巴：包的 `index.ts` 只导出 `MarkdownPreview`/`MermaidBlock`，**不重新导出 `Components` 类型**——`reader.tsx` 里 `const mdComponents: Components = ...` 的类型标注来源会断掉，需要要么把 `react-markdown` 保留为 devDependency（仅供类型使用，版本对齐包锁定的 `^10.1.0`），要么去掉这行显式类型标注、让 TS 结构化推断（`img`/`code` 覆盖对象不依赖这个类型标注也能通过 typecheck）。

**已实测确认（spike worktree 里分别验证过 `file:` 和真实安装两种情况）：** `file:` 模式下即使按上面的办法把 `react-markdown` 保留为 devDependency，`tsc --noEmit` 依然报错——`mdComponents: Components` 赋值给 `<MarkdownPreview components={...}>` 时类型不兼容，根因是 `markdown-preview-core` 自己的 `devDependencies`（`@types/react@^18.3.0`、`react@^18.3.0`，只给它自己测试用）在 `file:` 符号链接下会被一起带进来，和 scholia 自己的 `@types/react@^19.0.0` 是两份不同的类型声明，TS 判定跨包的 `Components`（内部引用了 `React.Context` 等泛型）结构不兼容。**换成真实 GitHub Packages 安装后，这个类型错误完全消失，`tsc --noEmit` 干净通过，不需要任何类型断言或 workaround**——原因是真实 npm 安装不会把一个依赖的 `devDependencies` 装进消费方（`@types/react`/`react` 这两个只在 `markdown-preview-core` 的 `devDependencies` 里，永远不会出现在 scholia 的 `node_modules` 里），所以本节和上一节说的"版本落差""类型断层"这两个风险，**只在联调期临时用 `file:` 时才会出现，真正接入用的 GitHub Packages 路径不受影响**——但这点之前只是推理，现在已经用两种真实安装方式对照验证过。

---

## 4. React 重复模块问题：无论哪种依赖方式都要做去重

`file:` 阶段这是必然踩的坑（符号链接导致 Node 从包的真实路径解析到它自己 `node_modules/react`），GitHub Packages 分发下这个问题大概率自然消失（扁平安装，不是符号链接），但**"大概率"不是证据**——agent-canvas 迁移到 GitHub Packages 后仍然保留了 `resolve.dedupe: ['react', 'react-dom', 'mermaid']`，直到用测试实测确认多余才会考虑清理（目前尚未清理）。

**scholia 已实测验证（在 `.worktrees/chore-markdown-preview-core-spike` 里分别用 `file:` 和真实 GitHub Packages 装过一遍，非推测）：**

- **`file:` 模式下问题真实存在，且比想象中难缠**：`file:` 装完后，`node_modules/mermaid`（scholia 自己的，11.15.0）和 `node_modules/@harveyzhang814/markdown-preview-core/node_modules/mermaid`（包自己的，11.16.0）同时存在于磁盘上，React 同理（19.2.7 vs 18.3.1）。更麻烦的是：`resolve.dedupe` + `ssr.noExternal` + `vitest` 的 `test.server.deps.inline` + 手动硬 `resolve.alias` 全部加上，依然无法让 `npm test`（vitest）通过——4 个 `reader.test.tsx` 用例全部报 `A React Element from an older version of React was rendered`。追下去发现根因是 `markdown-preview-core` 的 `dist/index.mjs` 里 `import ... from "react"` 是裸 specifier，vitest 对 externalize 的包走 Node 原生 ESM 解析（不是 Vite 的 bundler 解析），不吃 `resolve.dedupe`/`alias` 这些 Vite/Rollup 级别的配置——**但 `vite build`（真实浏览器打包路径）用同一份 `resolve.dedupe` 配置完全干净，没有报错**，说明问题只出在 vitest 的 SSR 外部化机制上，不是 dedupe 机制本身失效。
- **真实 GitHub Packages 安装下，这个问题完全不存在**：`ls -la node_modules/@harveyzhang814/markdown-preview-core` 确认不是符号链接，`node_modules/@harveyzhang814/markdown-preview-core/node_modules` 是空的（0 个条目）——没有嵌套 `node_modules`，全仓库只有一份 `react`（19.2.7）。**`npm test` 15 个文件 89 个用例全部通过，包括之前在 `file:` 模式下必炸的 4 个 `reader.test.tsx` 用例**，不需要任何 `ssr.noExternal`/`deps.inline`/手动 alias 之类的额外配置。
- **顺手验证了"dedupe 是否还需要"**：真实安装下临时删掉 `resolve.dedupe` 配置，`npm test`/`npm run build` 依然全部通过——说明目前这个配置是个没有实际效果的安全网（和 agent-canvas 的结论一致：暂不清理，等以后有专门的清理动作再说，不在这次顺手删）。

**建议 scholia 直接照做**：在 `web/vite.config.ts` 加

```ts
resolve: {
  dedupe: ['react', 'react-dom', 'mermaid'],
}
```

如果用 vitest，`vitest.config.ts`（或 vite config 里的 `test` 块）同样加。

**scholia 现状核实（非推测）：目前没有任何 `vi.mock('mermaid', ...)`，`reader.test.tsx` 也未覆盖 mermaid 渲染路径**——这是 scholia 现有测试的盲区，不是"确认已有 mock 是否还生效"的问题。接入时应该新增一个 mermaid 渲染测试（或至少一次真实浏览器验证），而不是假设这条防护网已经存在。agent-canvas 当初漏 `mermaid` dedupe 时的教训仍然值得记住——`vi.mock('mermaid', ...)` 只拦截了两份物理模块实例中的一份，mermaid 渲染测试悄悄跑了真实的 `mermaid.initialize()` 而不是 mock——以后 scholia 如果真的加了 mermaid mock，同样要检查 dedupe 是否生效。

---

## 5. 验证方法：像素级视觉对比 + 真实进程渲染

agent-canvas 的验证不是只跑单测/typecheck，而是额外做了两轮针对渲染结果本身的验证，**建议 scholia 照搬这个验证强度，不要只用单测覆盖**：

1. **迁移前后完整对比**：在集成前的 commit 上单独开一个 worktree，用同一份覆盖标题/加粗斜体删除线/引用/有序无序列表/GFM 任务列表/GFM 表格/代码块/外部链接/mermaid 流程图（scholia 还要加：高亮/批注锚点场景、**多级 `##`/`###` 标题的 TOC 场景**）的测试文档，在真实渲染进程里对旧实现和新实现（`markdown-preview-core`）各截图对比，逐张比对像素差异。agent-canvas 的结论是"像素级一致，零渲染/交互差异"——但这是针对 wikilink+mermaid 场景验证出来的结论，**不能直接套用到 scholia 的高亮/批注/TOC 场景**，需要重新走一遍。TOC 这一项光看像素截图不够——`toc.tsx` 的标题 id 是按 DOM 顺序下标对应赋值的（见第2节），必须实际点击每个 TOC 项确认跳转到了对应的标题，而不是只确认列表看起来正常。
2. **真实渲染环境的 Invalid hook call / 控制台报错检查**：不是 jsdom 单测能覆盖的（jsdom 不会暴露"两份 React 实例"这种运行时问题），必须用真实浏览器/真实进程渲染一次，切换应用明暗主题（如果 scholia 有主题切换）确认没有报错。
3. **依赖装完之后确认不是符号链接**：`ls -la node_modules/@harveyzhang814/markdown-preview-core`，确认不是 `l` 开头的 symlink 条目（GitHub Packages 走真实 npm 安装应该天然满足，但装完应该实测确认一次，不假设）。

**scholia 当前基线（已实测，接入后单测/构建结果应该对照这个数字，而不是笼统地看"是否变红"）：** `cd web && npm test -- --run` 目前是 **15 个测试文件、89 个用例全部通过**；`npm run build`（`tsc` + `vite build`）当前干净通过（只有和这次改动无关的既有 chunk-size 警告，属于正常噪音，不是新问题）。

---

## 6. 主题桥接：与 scholia 现有 `prose-cn` 存在层叠冲突，不是简单新增

包的 `theme.css` 只覆盖颜色（不含排版间距），选择器是 `.mpc-root h1..h6/code/blockquote/table/th/td`。**scholia 实测核对：`web/src/styles/globals.css` 里的 `.prose-cn` 对完全相同的一组选择器已经有完整的颜色 + 排版规则**，且两边规则特异性相同（都是「一个 class + 一个元素」），最终生效的一方取决于两份样式表谁后加载——这是一个真实的层叠冲突，不是"写一份薄桥接 CSS 补充变量映射"就能规避的。

**建议 scholia 不要 `import 'markdown-preview-core/theme.css'`**（跳过包 `INTEGRATION.md` 第4节第1步默认深色主题这一步），只在自己的 `themes.css`/`globals.css` 里直接给 `--md-*`、`--md-mermaid-*` 这两组变量赋值，指向 `prose-cn` 已经在用的 token（如 `--text-primary`、`--accent-9` 等）。这样 `.mpc-root` 的规则读到的颜色本来就和 `prose-cn` 一致，不需要依赖谁先加载谁后加载。`--md-mermaid-*` 这组变量必须写进 scholia 现有的两处 `@media (prefers-color-scheme: dark)` 块（`globals.css:28`、`themes.css:49`）里，否则暗色模式下 mermaid 图表会用包的默认硬编码深色值，和其余内容的暗色调不一致。

**这不只是"颜色不对"的视觉问题——已实测确认，`--md-mermaid-*` 缺失会让 mermaid 直接崩溃（见第2节）：** `MermaidBlock` 内部 `mermaid.initialize()` 是同步调用，不在 try/catch 保护范围内，`--md-mermaid-*` 任何一个变量缺失（`getComputedStyle` 读到空字符串）都会让 `mermaid.initialize()` 抛出 `Unsupported color format: ""` 并让整个组件树报错。**这七个变量必须在 mermaid 相关代码上线前就配置完整，不能"先接入渲染逻辑、CSS 细节后续再补"——序列反了会直接导致含 mermaid 代码块的文章整篇渲染失败。**

**mermaid 主题切换机制的差异（已核实为无害）：** 包的 `MermaidBlock` 靠监听 `document.body.dataset.theme` 的 `MutationObserver` 触发重渲染；scholia 全仓库没有任何地方设置 `data-theme`，明暗色完全靠 `prefers-color-scheme` 媒体查询驱动，现在自己的 `mermaid-chart.tsx` 也只在挂载时读一次 `matchMedia`、不监听系统主题运行时切换。结论：迁移后"运行时切换明暗色时 mermaid 图表跟着重新着色"这个能力和现在一样缺失，是现状持平、不是回归，可以不处理。

---

## 7. 快速结论（给 scholia 决策用）

**已在 `.worktrees/chore-markdown-preview-core-spike`（`chore/markdown-preview-core-spike` 分支）跑通一次端到端 spike，用的是真实 GitHub Packages 依赖（不是 `file:`）：** `reader.tsx` 迁移到 `<MarkdownPreview>`、删掉 `mermaid-chart.tsx`、加 `resolve.dedupe`、`tsc --noEmit` 全部干净通过；scholia 原有 15 个测试文件 89 个用例（含 `reader.test.tsx` 的高亮/笔记锚点用例）全部原样通过；额外补的 TOC 下标对应 + mermaid `pre` 拦截验证用例也全部通过；`npm run build` 干净。**没有发现结构性阻塞项**，第2/6节里标注"必须实测"的两个风险点（TOC、mermaid）都已经拿到确定性结论，不再是"理论上应该没问题"。

- **依赖方式**：直接接 GitHub Packages，不用重走 `file:` 阶段；但要注意 scholia 根 `package.json` 的 `postinstall` 会级联触发 `web/npm install`（`npm install`/`npm link`/`npm run release:local` 都会经过这条路径），接入后这些场景全部需要执行机器配好 GitHub PAT，影响范围比"开发机装一次依赖"更广（见第1节）。
- **React 版本/类型问题只在 `file:` 阶段出现，真实安装下不存在**：spike 里用 `file:` 时 `tsc`/`vitest` 都因为两份 `react`/`@types/react` 报错，换成真实 GitHub Packages 安装后这些错误全部消失，不需要任何类型断言或 workaround（见第3、4节）。如果联调期图方便临时切回 `file:`，遇到这类报错不要当成新 bug 去修，这是 `file:` 本身的已知限制。
- **接入范围**：只能替换核心渲染（GFM + mermaid），wikilink 之外的插件（含 scholia 需要的高亮/批注、TOC）包目前都没有——这不是猜测，包自己的 `PRD.md` 明确把"TOC"和"批注高亮叠层"列为 scholia 的已知需求，`ARCHITECTURE.md` 也把两者列在"规划中，未实现"。`injectAnchorMarks`（高亮/批注锚点）和 `toc.tsx`（TOC + 滚动高亮）这两套 DOM 后处理机制**已实测确认**都能在 `<MarkdownPreview>` 外层正常工作（见第2节）。
- **必删的代码**：`reader.tsx` 里检测 `language-mermaid` 并渲染自家 `MermaidChart` 的 `code` 覆盖分支，以及 `web/src/components/mermaid-chart.tsx` 整个文件——包内部改用 `pre` 拦截 mermaid，两套逻辑并存会冲突（见第2节）。
- **CSS 桥接是阻塞项，不是优化项**：`--md-mermaid-*` 七个变量缺失会让 `mermaid.initialize()` 同步抛错、直接崩掉含 mermaid 代码块的渲染树（已实测复现），必须在含 mermaid 内容上线前配置完整；同时不要 `import 'markdown-preview-core/theme.css'`，直接把变量映射到 scholia 现有 `prose-cn` token，避免和 `.prose-cn` 已有的同选择器规则打层叠顺序的架（见第6节）。
- **必做的工程动作**：`resolve.dedupe` 加 `react`/`react-dom`/`mermaid`——真实安装下这个配置目前是空跑（删掉也不影响 spike 里的测试/构建），但按 agent-canvas 的先例先保留，等以后有专门的清理动作再决定要不要去掉；接入后建议再做一次像素级视觉对比 + 真实渲染环境报错检查，机制层面的正确性已经有自动化测试覆盖，视觉细节仍然值得肉眼过一遍。
- **影响范围小**：`Reader` 和 `Toc` 全仓库都只在 `routes/tasks.$id.tsx` 一处被组合使用（`Toc` 的 `containerSelector` 默认值 `article.prose-cn` 就是 `Reader` 渲染的那个 `<article>`），改动可以聚焦在 `reader.tsx`、`toc.tsx`（不改代码，仅补单测）、`mermaid-chart.tsx`（删除）、`web/package.json`、`web/vite.config.ts`、主题 CSS 这几处，不需要大范围排查。
