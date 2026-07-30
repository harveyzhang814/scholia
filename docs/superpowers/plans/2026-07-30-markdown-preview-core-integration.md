# markdown-preview-core 接入 scholia 实施计划

**目标：** 把 `web/src/components/reader.tsx` 的渲染管线从自建的 `react-markdown@9` + 自实现 mermaid 组件，替换为 `@harveyzhang814/markdown-preview-core`（GitHub Packages 私有包），复用 agent-canvas 已验证过的核心渲染层，同时保留 scholia 特有的高亮/批注锚点（`injectAnchorMarks`）和 TOC（`toc.tsx`）机制不变。

**架构：** `<MarkdownPreview>` 替换 `<ReactMarkdown>` 作为 `reader.tsx` 里的渲染核心，`rehypeHighlight` 通过 `rehypePlugins` 透传槽位接入（不再直接依赖 `react-markdown`/`remark-gfm`），`img` 覆盖保留在 `components` 里；mermaid 代码块渲染完全交给包内置的 `pre` 拦截机制，scholia 自己的 `MermaidChart` 组件删除；`injectAnchorMarks`/`toc.tsx` 不改代码，只补测试覆盖证明迁移后仍然正确。全部改动已在 `.worktrees/chore-markdown-preview-core-spike` 里用真实 GitHub Packages 依赖验证过一遍（89/89 既有测试通过 + 2 个新增验证用例通过 + `tsc`/`build` 干净），本计划把那次 spike 的改动落成正式提交历史，并把当时只在 spike 里手写的验证补成永久测试文件。

**技术栈：** React 19, TypeScript, Vite 6, Vitest 2, `@harveyzhang814/markdown-preview-core@^0.1.0`（GitHub Packages）

**前置条件（已确认满足，无需再做）：**
- 本机全局 `~/.npmrc` 已配置 `//npm.pkg.github.com/:_authToken=<token>`。
- `@harveyzhang814/markdown-preview-core@0.1.0` 已发布在 GitHub Packages 上可直接安装。
- 执行前需要 `using-git-worktrees` 建一个新 worktree（分支建议 `feature/markdown-preview-core`，不要复用之前的 spike 分支 `chore/markdown-preview-core-spike`——那个分支的改动是探索性的，未遵循下面的逐任务提交历史）。

---

### Task 1: 依赖切换到 `@harveyzhang814/markdown-preview-core`

**文件：**
- 修改: `web/package.json`
- 新建: `web/.npmrc`

- [ ] **Step 1: 新建 `web/.npmrc`**

```
@harveyzhang814:registry=https://npm.pkg.github.com
```

- [ ] **Step 2: 修改 `web/package.json` 的 `dependencies`**

把：
```json
    "media-chrome": "^4.0.0",
    "mermaid": "^11.15.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-markdown": "^9.0.0",
    "react-router": "^7.0.0",
    "rehype-highlight": "^7.0.0",
    "remark-gfm": "^4.0.0",
    "zustand": "^5.0.0"
```
改成：
```json
    "@harveyzhang814/markdown-preview-core": "^0.1.0",
    "media-chrome": "^4.0.0",
    "mermaid": "^11.15.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router": "^7.0.0",
    "rehype-highlight": "^7.0.0",
    "zustand": "^5.0.0"
```

（`react-markdown`、`remark-gfm` 从直接依赖里移除——包内部自带并管理这两个版本；`mermaid` 保留，spike 里验证过保留它不会产生额外的重复模块问题。）

- [ ] **Step 3: 把 `react-markdown` 加回 `devDependencies`（仅供类型使用）**

在 `web/package.json` 的 `devDependencies` 里，`jsdom` 之后加一行：
```json
    "jsdom": "^25.0.0",
    "react-markdown": "^10.1.0",
```

- [ ] **Step 4: 安装依赖**

运行: `cd web && npm install`

预期: 无报错；`ls -la node_modules/@harveyzhang814/markdown-preview-core` 不是 `l` 开头的符号链接条目。

- [ ] **Step 5: 提交**

```bash
git add web/package.json web/package-lock.json web/.npmrc
git commit -m "chore(web): switch to @harveyzhang814/markdown-preview-core dependency"
```

---

### Task 2: `vite.config.ts` 加 `resolve.dedupe`

**文件：**
- 修改: `web/vite.config.ts`

- [ ] **Step 1: 修改 `resolve` 配置块**

把：
```ts
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
```
改成：
```ts
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
    dedupe: ['react', 'react-dom', 'mermaid']
  },
```

- [ ] **Step 2: 验证构建仍然干净**

运行: `cd web && npm run build`

预期: PASS（干净通过，只有既有的 chunk-size 警告噪音）

- [ ] **Step 3: 提交**

```bash
git add web/vite.config.ts
git commit -m "chore(web): dedupe react/react-dom/mermaid for markdown-preview-core"
```

---

### Task 3: `reader.tsx` 迁移到 `<MarkdownPreview>`，删除 `mermaid-chart.tsx`

**文件：**
- 修改: `web/src/components/reader.tsx`
- 删除: `web/src/components/mermaid-chart.tsx`
- 测试: `web/src/components/reader.test.tsx`（已存在，本任务只用它做回归验证，不改代码）

- [ ] **Step 1: 运行现有回归测试，确认迁移前是绿的（建立基线）**

运行: `cd web && npx vitest run src/components/reader.test.tsx`

预期: PASS（4 tests）

- [ ] **Step 2: 修改 `reader.tsx` 的 import 段**

把（第 1-7 行）：
```tsx
import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { MermaidChart } from './mermaid-chart';
import { ArticleMetaBar } from './article-meta-bar';
import { api, type Highlight, type Note } from '@/lib/api';
```
改成：
```tsx
import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { MarkdownPreview } from '@harveyzhang814/markdown-preview-core';
import type { Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { ArticleMetaBar } from './article-meta-bar';
import { api, type Highlight, type Note } from '@/lib/api';
```

- [ ] **Step 3: 删除 `mdComponents` 里的 mermaid `code` 覆盖分支**

把：
```tsx
  const mdComponents: Components = useMemo(() => ({
    code({ className, children, ...props }) {
      const lang = /language-(\w+)/.exec(className ?? '')?.[1];
      if (lang === 'mermaid') {
        return <MermaidChart code={String(children).trim()} />;
      }
      return <code className={className} {...props}>{children}</code>;
    },
    ...(isArticleTask ? {
```
改成：
```tsx
  const mdComponents: Components = useMemo(() => ({
    ...(isArticleTask ? {
```

（`img` 覆盖分支和闭合部分不变。）

- [ ] **Step 4: 把渲染 JSX 从 `<ReactMarkdown>` 换成 `<MarkdownPreview>`**

把：
```tsx
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={mdComponents}
        >
          {md}
        </ReactMarkdown>
```
改成：
```tsx
        <MarkdownPreview
          content={md}
          rehypePlugins={[rehypeHighlight]}
          components={mdComponents}
        />
```

- [ ] **Step 5: 删除 `mermaid-chart.tsx`**

运行: `rm web/src/components/mermaid-chart.tsx`

- [ ] **Step 6: typecheck**

运行: `cd web && npx tsc --noEmit`

预期: PASS（无残留 import、无 `Components` 类型不兼容——如果报 `Components` 类型不兼容，说明装到的不是真实 GitHub Packages 安装，检查 `node_modules/@harveyzhang814/markdown-preview-core` 是否为符号链接）

- [ ] **Step 7: 跑回归测试，确认迁移后依然是绿的**

运行: `cd web && npx vitest run src/components/reader.test.tsx`

预期: PASS（同样 4 tests，且断言内容不变——证明 `injectAnchorMarks` 在 `<MarkdownPreview>` 外层依然工作正常）

- [ ] **Step 8: 跑全量测试 + 构建**

运行: `cd web && npm test -- --run && npm run build`

预期: PASS（15 个测试文件、89 个用例；构建干净）

- [ ] **Step 9: 提交**

```bash
git add web/src/components/reader.tsx
git rm web/src/components/mermaid-chart.tsx
git commit -m "feat(web): render markdown via markdown-preview-core, drop homegrown mermaid component"
```

---

### Task 4: 补 TOC 标题下标对应的回归测试

**背景：** `toc.tsx` 的 `<Toc>` 组件按 DOM 顺序把 `extractToc()` 从原始 markdown 提取的 `items[i].id` 赋给第 i 个渲染出的 `h2`/`h3` 元素——这个"按下标对应"的机制之前完全没有测试覆盖，迁移后必须证明它仍然成立。

**文件：**
- 新建: `web/src/components/toc.test.tsx`

- [ ] **Step 1: 写测试**

```tsx
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { Reader } from './reader';
import { Toc, extractToc } from './toc';

beforeAll(() => {
  // jsdom has no IntersectionObserver implementation at all.
  globalThis.IntersectionObserver = class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
});

const content = `
# Title (not counted, only h2/h3)

## First Section

Some text.

### Nested subsection

More text.

## Second Section

Final paragraph.
`;

describe('Toc heading id assignment', () => {
  it('assigns ids to h2/h3 in the same order extractToc produced from raw markdown', () => {
    const items = extractToc(content);
    expect(items.map((i) => i.text)).toEqual(['First Section', 'Nested subsection', 'Second Section']);

    const { container } = render(
      <>
        <Reader content={content} />
        <Toc items={items} />
      </>
    );

    const headings = Array.from(container.querySelectorAll('article.prose-cn h2, article.prose-cn h3'));
    expect(headings.map((h) => h.textContent)).toEqual(['First Section', 'Nested subsection', 'Second Section']);
    expect(headings.map((h) => h.id)).toEqual(items.map((i) => i.id));

    const tocLinks = Array.from(container.querySelectorAll('nav a'));
    expect(tocLinks.map((a) => a.getAttribute('href'))).toEqual(headings.map((h) => `#${h.id}`));
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

运行: `cd web && npx vitest run src/components/toc.test.tsx`

预期: PASS（在 spike 里已验证过这个断言在 `<MarkdownPreview>` 下成立，这里是把它固化成永久测试）

- [ ] **Step 3: 提交**

```bash
git add web/src/components/toc.test.tsx
git commit -m "test(web): cover Toc heading-id assignment under markdown-preview-core"
```

---

### Task 5: 补 mermaid 派发 + CSS 变量安全网的回归测试

**背景：** `markdown-preview-core` 内部通过 `pre` 拦截 `language-mermaid` 代码块渲染成 `MermaidBlock`；`MermaidBlock` 内部 `mermaid.initialize()` 是同步调用、不在 try/catch 保护范围内——如果 `--md-mermaid-*` 这组 CSS 变量任何一个缺失（`getComputedStyle` 读到空字符串），会同步抛出 `Unsupported color format: ""` 并让整个组件树崩溃。这两点都需要固化成测试，防止以后有人不小心删掉 CSS 桥接变量却没人发现。

**文件：**
- 修改: `web/src/components/reader.test.tsx`

- [ ] **Step 1: 在文件顶部加 mermaid 测试内容常量和 `afterEach` 清理**

在现有 `import` 之后加：
```tsx
import { afterEach } from 'vitest';

const MERMAID_VARS = [
  '--md-mermaid-bg', '--md-mermaid-primary', '--md-mermaid-primary-text',
  '--md-mermaid-primary-border', '--md-mermaid-line', '--md-mermaid-secondary', '--md-mermaid-tertiary',
] as const;

afterEach(() => {
  for (const v of MERMAID_VARS) document.body.style.removeProperty(v);
});
```

- [ ] **Step 2: 写"CSS 变量缺失时会抛错"的特征测试**

在文件末尾加：
```tsx
describe('Reader mermaid rendering', () => {
  it('throws if --md-mermaid-* CSS variables are not set (regression guard for the CSS bridge)', () => {
    const content = '```mermaid\ngraph TD\n  A --> B\n```';
    expect(() => render(<Reader content={content} />)).toThrow(/color format/i);
  });

  it('renders mermaid code fences via MermaidBlock (not as plain code text) once the CSS bridge is present', () => {
    const values = ['transparent', '#2a2a2a', '#e5e5e5', '#4a4a4a', '#6a9fb5', '#333333', '#262626'];
    MERMAID_VARS.forEach((v, i) => document.body.style.setProperty(v, values[i]));

    const content = '```mermaid\ngraph TD\n  A --> B\n```';
    const { container } = render(<Reader content={content} />);
    expect(container.querySelector('code.language-mermaid')).toBeNull();
  });
});
```

- [ ] **Step 3: 运行测试确认两个用例都通过**

运行: `cd web && npx vitest run src/components/reader.test.tsx`

预期: PASS（6 tests：原有 4 个高亮/笔记锚点用例 + 新增 2 个 mermaid 用例）

- [ ] **Step 4: 提交**

```bash
git add web/src/components/reader.test.tsx
git commit -m "test(web): guard mermaid dispatch and --md-mermaid-* CSS variable requirement"
```

---

### Task 6: `globals.css` 加 `--md-mermaid-*` CSS 桥接变量

**背景：** 不导入包的 `markdown-preview-core/theme.css`（会和 `.prose-cn` 已有的 h1-h6/code/blockquote/table 颜色规则打层叠顺序的架，见交接文档第6节）。只需要给 mermaid 用到的这组变量赋值，指向 scholia 已有的 design token——用 `var(...)` 间接引用而不是写死十六进制值，这样只需要在 `:root` 定义一次，深色模式下 `--bg-elevated`/`--text-primary` 等底层 token 本身已经在 `@media (prefers-color-scheme: dark)` 里翻转过，不需要重复定义第二份。

**文件：**
- 修改: `web/src/styles/globals.css`

- [ ] **Step 1: 在 `:root` 块（第 9-26 行）后面加一个新的 `:root` 块**

在：
```css
  --status-ok:   #4A8A5A;
  --status-err:  #B05050;
  --status-busy: #C28A3D;
}
```
后面加：
```css

/* markdown-preview-core mermaid theme bridge — indirection through the
   tokens above means this only needs to be defined once; the dark-mode
   media query below already flips --bg-elevated/--text-primary/etc. */
:root {
  --md-mermaid-bg: transparent;
  --md-mermaid-primary: var(--bg-elevated);
  --md-mermaid-primary-text: var(--text-primary);
  --md-mermaid-primary-border: var(--border-strong);
  --md-mermaid-line: var(--accent-10);
  --md-mermaid-secondary: var(--accent-3);
  --md-mermaid-tertiary: var(--bg-canvas);
}
```

- [ ] **Step 2: 验证构建**

运行: `cd web && npm run build`

预期: PASS

- [ ] **Step 3: 提交**

```bash
git add web/src/styles/globals.css
git commit -m "style(web): bridge --md-mermaid-* tokens to existing design tokens"
```

---

### Task 7: 全量验证 + 人工浏览器检查提醒

**文件：** 无代码改动，仅验证。

- [ ] **Step 1: 全量测试**

运行: `cd web && npm test -- --run`

预期: PASS（17 个测试文件：原有 15 个 + 新增 `toc.test.tsx` 一个；`reader.test.tsx` 从 4 个用例增加到 6 个；共 91 + 2 = 93 个用例左右，以实际输出为准）

- [ ] **Step 2: typecheck + 构建**

运行: `cd web && npx tsc --noEmit && npm run build`

预期: PASS

- [ ] **Step 3: 确认依赖不是符号链接**

运行: `ls -la web/node_modules/@harveyzhang814/markdown-preview-core`

预期: 不是 `l` 开头的条目

- [ ] **Step 4: 人工浏览器检查（不是自动化测试能覆盖的部分）**

启动 dev server（`cd web && npm run dev`，同时需要 `scholia serve` 提供真实内容），打开一篇含 mermaid 代码块 + 多级标题 + 高亮/笔记的真实文章，确认：
- mermaid 图表颜色和 `.prose-cn` 其余内容的明暗主题一致（Task 6 的 CSS 桥接是否真的选对了颜色，这一步只有肉眼能确认）
- TOC 点击跳转到正确标题
- 高亮/笔记锚点位置正确
- 控制台没有报错

这一步涉及真实内容目录，需要和用户确认后再做，不在本计划的自动化步骤范围内。

- [ ] **Step 5: 无需提交**（本任务只做验证，Task 1-6 的提交已经是完整改动）
