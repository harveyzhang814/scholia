# 文章展示页 YAML 头部信息栏 设计文档

## 概述

文章详情页（`web/src/routes/tasks.$id.tsx`）目前直接把 Markdown 原文（含 `---title...---` frontmatter 代码块）交给 `react-markdown` 渲染，YAML 头部会以字面文本/分割线形式出现在正文里。本设计让后端把 frontmatter 完整解析为任意 key-value 对象、从正文中剥离，前端新增一个网格信息栏组件，展示解析出的全部字段（数组字段以 chips 形式渲染），标签自动人性化格式。

## 背景

- `server/article-source.js:13-22` 的 `parseFrontmatter()` 是纯正则实现，只认 `title` / `date` / `fetch_date` 三个写死的字段，未使用任何 YAML 解析库。
- `getArticleTask()`（`server/article-source.js:69-78`）只把解析出的 `title` 透传进 API 响应的 `meta.title`；`date` / `fetch_date` 目前只在 `listArticles()`（用于首页列表排序）内部使用，不会到达详情页。
- `getArticleContent()`（`server/article-source.js:80-85`）原样返回整份文件内容（含 frontmatter 块），`tasks.$id.tsx:164-170` 里的 `<Reader content={content} .../>` 直接渲染这份原始内容 —— frontmatter 块目前会被 `react-markdown` 解释成文本/水平线，混在文章正文最前面。
- 根 `package.json` 目前没有任何 YAML 解析依赖（`dependencies` 只有 `koa` / `koa-bodyparser` / `koa-router`）。
- 前端已有可复用的"元信息行"视觉范式：`task-card.tsx:45-56` 的 meta row（`var(--font-mono)` 等宽字体、`var(--text-tertiary)` 灰色文字、` · ` 分隔），但那是给视频任务用的固定字段，不适合任意 key 的场景，本设计的信息栏改用网格布局单独设计。

## 用户故事

- 作为用户打开一篇文章任务，如果这篇 Markdown 文件带 YAML frontmatter（无论里面写了什么字段：`author`、`tags`、`source`……），标题下方会出现一个信息栏，把这些字段整齐地列出来。
- 作为用户，如果某个字段是数组（比如 `tags: [ai, ml]`），我会看到它们被渲染成一个个独立的小标签块，而不是一坨逗号拼接的文本。
- 作为用户，文章正文里不会再看到裸露的 `---title: ...---` 代码块——它已经被转换成上面的信息栏了。
- 作为用户，如果这篇文章根本没有 frontmatter，页面不会出现空的信息栏。

## 架构设计

### 1. 后端：完整解析 frontmatter（`server/article-source.js`）

- 新增依赖 `js-yaml`（写入根 `package.json` 的 `dependencies`）。原因：字段不再是白名单里的三个，需要通用 YAML 解析，正则方案无法处理嵌套/多类型值。
- 重写 `parseFrontmatter(content)`：
  ```js
  const yaml = require('js-yaml');

  function parseFrontmatter(content) {
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!m) return { frontmatter: {}, body: content };
    let frontmatter = {};
    try {
      const parsed = yaml.load(m[1]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) frontmatter = parsed;
    } catch { /* 解析失败按无 frontmatter 处理 */ }
    return { frontmatter, body: content.slice(m[0].length) };
  }
  ```
  - 返回值改为 `{ frontmatter, body }`：`frontmatter` 是任意 key-value 对象（保留 YAML 声明顺序，`js-yaml` 用普通 JS 对象承载，天然保序）；`body` 是去掉 frontmatter 块之后的正文。
  - YAML 解析异常（比如缩进错误）或顶层不是对象（比如写成了纯列表）时，`frontmatter` 回退为 `{}`，`body` 仍然是剥离了 `---...---` 定界符之后的内容——不让解析失败影响正文可读性。
- `listArticles()`（第 53-67 行）调用点同步改为解构 `frontmatter`：`title` 取 `frontmatter.title`，`fetchDate` 取 `frontmatter.fetch_date`，其余逻辑（排序、slug 兜底标题）不变。
- `getArticleTask()`（第 69-78 行）：
  - `title` 取 `frontmatter.title || titleFromSlug(slug)`（不变）。
  - 新增：`meta.frontmatter = frontmatter`（整份对象透传，前端决定怎么展示/是否排除 `title`）。
- `getArticleContent()`（第 80-85 行）：改为返回 `parseFrontmatter(raw).body`，即剥离了 frontmatter 块的正文，而不是整份原始文件。

### 2. 前端类型与数据流（`web/src/lib/api.ts`）

- `BackendTask.meta`（第 66-76 行）新增可选字段 `frontmatter?: Record<string, unknown>`。
- `Task` 接口（第 26-46 行）新增可选字段 `frontmatter?: Record<string, unknown>`。
- `normalizeTask()`（第 119-135 行）新增一行：`frontmatter: m.frontmatter,`。
- 非文章任务（视频）的 `meta.frontmatter` 始终是 `undefined`，前端组件按"字段不存在则不渲染"处理，视频任务页面无感知。

### 3. 前端组件：`ArticleMetaBar`（新文件 `web/src/components/article-meta-bar.tsx`）

数组字段（如 `tags`）值可能很长/很多，塞进 `minmax(180px, 1fr)` 的网格列会挤爆或被截断，所以布局拆成两段：**标量字段走网格**（可多列并排，字段多则自动换行），**数组字段各自独占一整行**（标签在上、chips 在下，与标量字段保持一致的上下结构，只是宽度占满整行）。渲染顺序固定为「先全部标量字段，再全部数组字段」，与 frontmatter 里两类字段的原始声明顺序无关——用 `partition` 按值类型重新分组，而不是按 `Object.entries` 的原始 key 顺序直接渲染。

```tsx
import type { Task } from '@/lib/api';

function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ArticleMetaBar({ frontmatter }: { frontmatter?: Record<string, unknown> }) {
  const entries = Object.entries(frontmatter ?? {}).filter(([k]) => k !== 'title');
  if (entries.length === 0) return null;

  const scalarEntries = entries.filter(([, v]) => !Array.isArray(v));
  const arrayEntries = entries.filter(([, v]) => Array.isArray(v)) as [string, unknown[]][];

  return (
    <div className="px-12 py-3 text-xs border-b" style={{ borderColor: 'var(--border-subtle)' }}>
      {scalarEntries.length > 0 && (
        <div
          className="grid gap-x-6 gap-y-2"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}
        >
          {scalarEntries.map(([key, value]) => (
            <div key={key} className="min-w-0">
              <div className="mb-0.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', opacity: 0.7 }}>
                {humanizeKey(key)}
              </div>
              <div style={{ color: 'var(--text-secondary)' }}>{String(value)}</div>
            </div>
          ))}
        </div>
      )}

      {arrayEntries.map(([key, value]) => (
        <div key={key} className="mt-2">
          <div className="mb-0.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', opacity: 0.7 }}>
            {humanizeKey(key)}
          </div>
          <div className="flex flex-wrap gap-1">
            {value.map((item, i) => (
              <span
                key={i}
                className="px-1.5 py-0.5 rounded"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
              >
                {String(item)}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- 标量字段网格：`grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))`，字段数少时自然靠左排布，字段多时自动换行、多列（如 `date`/`author`/`source` 并排）。
- 数组字段独占一行：标签在上、chips 在下（与标量字段结构一致），chips 用 `flex-wrap` 随内容占满整行宽度换行到多行——避免长 tags 列表挤压标量字段的列宽，也避免单个 chip 被网格列宽截断。
- 标签人性化：`humanizeKey` 把 `fetch_date` 转成 `Fetch Date`（下划线转空格 + 每个单词首字母大写）。
- 数组值（如 `tags`）渲染成一组 `<span>` chips（沿用 `var(--bg-elevated)` 背景色，与卡片 hover 态背景色复用，视觉上是"次级容器"语义）；非数组值（字符串/数字/布尔）直接渲染为文本，用 `String(value)` 转换，覆盖布尔/数字场景。
- 排除 `title` 字段：已经是页面 H1（`tasks.$id.tsx:74`），不在信息栏里重复。
- `frontmatter` 为空对象（或只有 `title`）时返回 `null`，不渲染任何 DOM，视频任务、无 frontmatter 的文章都不会出现空信息栏。
- 不处理 `object`（嵌套对象）类型的字段值——`String(value)` 会得到 `[object Object]`，属于已知限制，见「风险和缓解」。

### 4. `tasks.$id.tsx` 改动点

- 引入 `import { ArticleMetaBar } from '@/components/article-meta-bar';`。
- 在 tab bar（第 137-158 行）和文章内容区（第 160-183 行）之间插入：
  ```tsx
  {tab === 'article' && <ArticleMetaBar frontmatter={task.frontmatter} />}
  ```
  - 只在"文章" tab（`tab === 'article'`）下显示，"总结" tab 不显示——信息栏对应的是文章原文的元信息，不属于摘要视图。
  - 视频任务 `task.frontmatter` 始终为 `undefined`，组件内部空值判断已覆盖，无需额外的 `mediaKind` 判断。

## 数据流

```
Markdown 文件（含 ---frontmatter---）
        │ fs.readFile
        ▼
parseFrontmatter(raw) → { frontmatter, body }
        │                      │
        │ (getArticleTask)     │ (getArticleContent)
        ▼                      ▼
meta.frontmatter        剥离 frontmatter 后的正文
   （API 响应）                │
        │                      ▼
        ▼                 useContent(id, 'article') → <Reader content={body} />
normalizeTask() → task.frontmatter
        │
        ▼
<ArticleMetaBar frontmatter={task.frontmatter} />
   → 网格渲染 key-value，数组值转 chips
```

## 错误处理

- YAML 解析失败（缩进错误、非法语法）→ `frontmatter` 回退为 `{}`，`body` 仍然剥离了定界符包裹的原始文本块（即使内容不是合法 YAML，也不会让它出现在正文里）。信息栏因为 `entries.length === 0` 不渲染，等同于"当作没有 frontmatter"。
- frontmatter 顶层不是对象（例如整块被写成一个 YAML 列表）→ 同样回退为 `{}`，不尝试展示无意义的数组条目。
- 字段值是 `null` / `undefined` → `String(value)` 得到 `"null"` / `"undefined"` 字面量，属已知边界情况，不做特殊剔除（YAML 里显式写 `key: null`本身少见，不值得为此增加过滤逻辑）。
- 现有 `listArticles()` 在 `parseFrontmatter` 里 `try/catch` 包裹读文件（第 60 行）的容错逻辑不变；新的解析失败被 `parseFrontmatter` 内部吞掉，不会向上抛出导致整个列表接口报错。

## 测试策略

- `tests/article-source.test.js` 新增用例：
  - 任意字段解析：写一个带 `author: Jane` `tags: [ai, ml]` 的测试文件，断言 `getArticleTask` 返回的 `meta.frontmatter` 包含这些字段且类型正确（`tags` 是数组）。
  - `getArticleContent` 剥离验证：断言返回内容不包含 `---`/`title:` 等 frontmatter 字面量，只有正文（如 `# Hello`）。
  - 非法 YAML 兜底：写一个缩进错误的 frontmatter 块，断言 `getArticleTask` 不抛异常，`meta.frontmatter` 为 `{}`，`title` 仍正确回退到 `titleFromSlug(slug)`。
  - 无 frontmatter 文件（已有 `deep-dive.md` 用例）：断言 `meta.frontmatter` 为 `{}`。
- 前端：`web` 目录新增 `article-meta-bar.test.tsx`（沿用项目现有前端测试写法），覆盖：空 frontmatter 返回 `null`、`title` 字段被排除、数组字段渲染为多个 chip 元素、下划线字段名转人性化标签。
- 手动验证（`cd web && npm run dev`，指向一个带自定义 frontmatter 字段的 vault 文章）：确认信息栏出现在标题下方、正文之上，字段网格排布合理，`tags` 等数组字段显示为 chips，正文里不再出现裸露的 `---` 块；切到"总结" tab 时信息栏消失；一篇无 frontmatter 的文章不显示信息栏。
- `npm test`（根目录）与 `cd web && npm run build`（tsc 类型检查）作为回归验证。

## 风险和缓解

- **风险**：`getArticleContent()` 返回值语义变化（从"原始文件全文"变成"剥离 frontmatter 后的正文"），如果有其他调用方依赖原始全文（比如"复制"功能 `onCopy`，`tasks.$id.tsx:57-60`，用的是 `content` state 也就是这个返回值）。
  **缓解**：这是本设计的预期行为——用户点"复制"时应该拿到干净正文而不是带 YAML 头的文本，属于此次改动顺带修的体验问题，不是遗留兼容负担。搜索确认目前唯一消费 `getArticleContent` 结果的路径就是 `useContent` → `<Reader>` / `onCopy`，没有其他隐藏依赖原始 frontmatter 文本的调用方。
- **风险**：嵌套对象类型的字段值（如 `key: {a: 1, b: 2}`）渲染成 `[object Object]`，观感差。
  **缓解**：明确列为已知限制而非阻塞项——真实场景里 frontmatter 字段绝大多数是标量或简单数组（title/date/author/tags/source），嵌套对象极少见；后续如果实际遇到再扩展 `ArticleMetaBar` 的渲染分支，不在本次范围内预先设计。
- **风险**：新增 `js-yaml` 依赖增加了后端 bundle（虽然是纯 Node 端，不影响前端 bundle size）。
  **缓解**：`js-yaml` 是零依赖、体积小（~30KB）、维护良好的成熟库，是 Node 生态解析 YAML 的事实标准，风险可接受。
