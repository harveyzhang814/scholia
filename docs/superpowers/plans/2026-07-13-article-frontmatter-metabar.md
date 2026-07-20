# 文章展示页 YAML 头部信息栏 实施计划

**目标：** 文章详情页解析 Markdown frontmatter 中的任意字段，剥离正文中的裸露 YAML 块，并在标题下方渲染一个信息栏（标量字段网格 + 数组字段独占一行的 chips）。

**架构：** 后端用 `js-yaml` 把 frontmatter 完整解析为对象、随 API 响应透传，并从正文中剥离；前端新增 `ArticleMetaBar` 组件消费该对象，插入文章详情页 tab bar 与正文之间，仅"文章" tab 显示。

**技术栈：** Node.js (CommonJS) + Koa（后端），React 19 + TypeScript + Vite（前端），`node:assert` 自定义测试运行器（后端），Vitest + Testing Library（前端）。

**对应设计文档：** `docs/superpowers/specs/2026-07-13-article-frontmatter-metabar-design.md`

---

### Task 1: 后端 — 解析任意 YAML frontmatter，从正文剥离

**文件：**
- 修改: `package.json`（根目录，新增依赖）
- 修改: `server/article-source.js`
- 测试: `tests/article-source.test.js`
- 测试: `tests/server.test.js`

- [ ] **Step 1: 安装 `js-yaml` 依赖**

```bash
npm install js-yaml
```

预期：根 `package.json` 的 `dependencies` 新增 `"js-yaml": "^5.x.x"`（实际版本以 npm 解析结果为准），`package-lock.json` 同步更新。

- [ ] **Step 2: 编写失败的测试**

在 `tests/article-source.test.js` 中，这是两个相邻的现有测试之间的空白处（在第一个测试的 `});` 之后、第二个测试的 `await test(...)` 之前）：

现状（原文已有，不要改动这两个测试本身）：

```js
  await test('getArticleContent returns null for missing slug', async () => {
    const md = await getArticleContent('article-nonexistent', contentDir);
    assert.equal(md, null);
  });

  await test('path traversal slug rejected by getArticleDirs', () => {
```

在这两个测试之间插入以下 4 个新测试（插入后，前后两个既有测试保持原样，只是中间多了这一段）：

```js
  await test('getArticleTask returns arbitrary frontmatter fields as meta.frontmatter', async () => {
    fs.writeFileSync(path.join(contentDir, 'rich.md'),
      '---\ntitle: Rich Doc\nauthor: Jane\nsource: arxiv.org\ntags:\n  - ai\n  - ml\n---\n\n# Rich');
    const t = await getArticleTask('article-rich', contentDir);
    assert.ok(t);
    assert.equal(t.meta.frontmatter.title, 'Rich Doc');
    assert.equal(t.meta.frontmatter.author, 'Jane');
    assert.equal(t.meta.frontmatter.source, 'arxiv.org');
    assert.deepEqual(t.meta.frontmatter.tags, ['ai', 'ml']);
    fs.rmSync(path.join(contentDir, 'rich.md'));
  });

  await test('getArticleTask returns empty frontmatter object when file has no frontmatter block', async () => {
    const t = await getArticleTask('article-deep-dive', contentDir);
    assert.ok(t);
    assert.deepEqual(t.meta.frontmatter, {});
  });

  await test('getArticleTask falls back to empty frontmatter on malformed YAML', async () => {
    fs.writeFileSync(path.join(contentDir, 'bad-yaml.md'),
      '---\ntitle: Bad\ntags: [ai, ml\n---\n\n# Bad');
    const t = await getArticleTask('article-bad-yaml', contentDir);
    assert.ok(t);
    assert.deepEqual(t.meta.frontmatter, {});
    assert.equal(t.meta.title, 'Bad Yaml');
    fs.rmSync(path.join(contentDir, 'bad-yaml.md'));
  });

  await test('getArticleContent strips the frontmatter block from the body', async () => {
    const md = await getArticleContent('article-intro', contentDir);
    assert.ok(!md.includes('---'));
    assert.ok(!md.includes('title:'));
    assert.ok(md.includes('# Hello'));
  });
```

在 `tests/server.test.js` 中，找到：

```js
  await test('GET /api/tasks/article-intro returns article task', async () => {
    const r = await req(port, 'GET', '/api/tasks/article-intro');
    assert.equal(r.status, 200);
    assert.equal(r.body.task_id, 'article-intro');
    assert.equal(r.body.meta.title, 'Intro');
  });
```

在其后插入：

```js
  await test('GET /api/tasks/article-intro includes parsed frontmatter', async () => {
    const r = await req(port, 'GET', '/api/tasks/article-intro');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.meta.frontmatter, { title: 'Intro' });
  });
```

- [ ] **Step 3: 运行测试确认失败**

运行: `node tests/article-source.test.js && node tests/server.test.js`
预期: `tests/article-source.test.js` 中新增的 4 个测试 FAIL（`t.meta.frontmatter` 当前是 `undefined`，访问 `.title` 会抛 `Cannot read properties of undefined`）；`tests/server.test.js` 中新增的 1 个测试 FAIL（`r.body.meta.frontmatter` 为 `undefined`，与 `{ title: 'Intro' }` 不 deepEqual）。

- [ ] **Step 4: 编写最小实现**

`server/article-source.js` 开头（第 1-22 行）当前是：

```js
'use strict';
const fs = require('fs');
const path = require('path');

function slugFromFilePath(filePath, contentDir) {
  return path.relative(contentDir, filePath).replace(/\.md$/i, '').replace(/[/\\]/g, '-');
}

function titleFromSlug(slug) {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { title: null, date: null, fetchDate: null };
  const fm = m[1];
  return {
    title: fm.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? null,
    date:  fm.match(/^date:\s*(.+)$/m)?.[1]?.trim() ?? null,
    fetchDate: fm.match(/^fetch_date:\s*(.+)$/m)?.[1]?.trim() ?? null,
  };
}
```

替换为：

```js
'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function slugFromFilePath(filePath, contentDir) {
  return path.relative(contentDir, filePath).replace(/\.md$/i, '').replace(/[/\\]/g, '-');
}

function titleFromSlug(slug) {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

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

将 `listArticles` 函数体中读取 frontmatter 的部分：

```js
    let title = null, date = null, fetchDate = null;
    try { const raw = await fs.promises.readFile(f, 'utf8'); ({ title, date, fetchDate } = parseFrontmatter(raw)); } catch {}
    const fallbackMs = stat ? stat.mtimeMs : Date.now();
    const parsedFetchDate = fetchDate ? Date.parse(fetchDate) : NaN;
```

替换为：

```js
    let frontmatter = {};
    try { const raw = await fs.promises.readFile(f, 'utf8'); ({ frontmatter } = parseFrontmatter(raw)); } catch {}
    const title = frontmatter.title;
    const date = frontmatter.date;
    const fetchDate = frontmatter.fetch_date;
    const fallbackMs = stat ? stat.mtimeMs : Date.now();
    const parsedFetchDate = fetchDate ? Date.parse(fetchDate) : NaN;
```

将 `getArticleTask` 函数体：

```js
  const stat = await fs.promises.stat(filePath).catch(() => null);
  let title = null, date = null;
  try { const raw = await fs.promises.readFile(filePath, 'utf8'); ({ title, date } = parseFrontmatter(raw)); } catch {}
  const ts = stat ? stat.mtime.toISOString() : new Date().toISOString();
  return { task_id: taskId, status: 'completed', meta: { title: title || titleFromSlug(slug), url: '', mode: 'media', ts, created_at: ts } };
```

替换为：

```js
  const stat = await fs.promises.stat(filePath).catch(() => null);
  let frontmatter = {};
  try { const raw = await fs.promises.readFile(filePath, 'utf8'); ({ frontmatter } = parseFrontmatter(raw)); } catch {}
  const ts = stat ? stat.mtime.toISOString() : new Date().toISOString();
  return { task_id: taskId, status: 'completed', meta: { title: frontmatter.title || titleFromSlug(slug), url: '', mode: 'media', ts, created_at: ts, frontmatter } };
```

将 `getArticleContent` 函数体：

```js
  try { return await fs.promises.readFile(filePath, 'utf8'); } catch { return null; }
```

替换为：

```js
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return parseFrontmatter(raw).body;
  } catch { return null; }
```

- [ ] **Step 5: 运行测试确认通过**

运行: `node tests/article-source.test.js && node tests/server.test.js`
预期: 全部 PASS（含新增的 5 个测试）。

- [ ] **Step 6: 提交**

```bash
git add package.json package-lock.json server/article-source.js tests/article-source.test.js tests/server.test.js
git commit -m "feat: parse arbitrary YAML frontmatter and strip it from article body"
```

---

### Task 2: 前端 — `Task` / `BackendTask` 类型透传 frontmatter

**文件：**
- 修改: `web/src/lib/api.ts`

- [ ] **Step 1: 扩展 `BackendTask.meta` 类型**

将：

```ts
interface BackendTask {
  task_id: string;
  status?: string;
  meta?: {
    url?: string; title?: string; uploader?: string; upload_date?: string; duration?: string;
    output_lang?: string; focus?: string; mode?: string;
    ts?: string; created_at?: string;
    transcript_done?: boolean; article_done?: boolean; summary_done?: boolean;
    download_status?: string;
  };
}
```

替换为：

```ts
interface BackendTask {
  task_id: string;
  status?: string;
  meta?: {
    url?: string; title?: string; uploader?: string; upload_date?: string; duration?: string;
    output_lang?: string; focus?: string; mode?: string;
    ts?: string; created_at?: string;
    transcript_done?: boolean; article_done?: boolean; summary_done?: boolean;
    download_status?: string;
    frontmatter?: Record<string, unknown>;
  };
}
```

- [ ] **Step 2: 扩展 `Task` 接口**

将：

```ts
export interface Task {
  id: string;
  url: string;
  title?: string;
  uploader?: string;
  upload_date?: string;
  duration_seconds?: number;
  mode: TaskMode;
  output_lang?: string;
  focus?: string;
  status: TaskStatus;
  progress?: number;
  current_step?: string;
  error_message?: string;
  created_at: number;
  updated_at: number;
  width?: number;
  height?: number;
  file_size?: number;
  bit_rate?: number;
}
```

替换为：

```ts
export interface Task {
  id: string;
  url: string;
  title?: string;
  uploader?: string;
  upload_date?: string;
  duration_seconds?: number;
  mode: TaskMode;
  output_lang?: string;
  focus?: string;
  status: TaskStatus;
  progress?: number;
  current_step?: string;
  error_message?: string;
  created_at: number;
  updated_at: number;
  width?: number;
  height?: number;
  file_size?: number;
  bit_rate?: number;
  frontmatter?: Record<string, unknown>;
}
```

- [ ] **Step 3: `normalizeTask` 透传 frontmatter**

将：

```ts
function normalizeTask(raw: BackendTask): Task {
  const m = raw.meta ?? {};
  return {
    id: raw.task_id,
    url: m.url ?? '',
    title: m.title,
    uploader: m.uploader,
    upload_date: m.upload_date || undefined,
    duration_seconds: m.duration ? parseInt(m.duration, 10) || undefined : undefined,
    mode: mapMode(m.mode),
    output_lang: m.output_lang,
    focus: m.focus ?? undefined,
    status: mapStatus(raw.status),
    created_at: parseDateStr(m.ts ?? m.created_at),
    updated_at: parseDateStr(m.ts ?? m.created_at),
  };
}
```

替换为：

```ts
function normalizeTask(raw: BackendTask): Task {
  const m = raw.meta ?? {};
  return {
    id: raw.task_id,
    url: m.url ?? '',
    title: m.title,
    uploader: m.uploader,
    upload_date: m.upload_date || undefined,
    duration_seconds: m.duration ? parseInt(m.duration, 10) || undefined : undefined,
    mode: mapMode(m.mode),
    output_lang: m.output_lang,
    focus: m.focus ?? undefined,
    status: mapStatus(raw.status),
    created_at: parseDateStr(m.ts ?? m.created_at),
    updated_at: parseDateStr(m.ts ?? m.created_at),
    frontmatter: m.frontmatter,
  };
}
```

- [ ] **Step 4: 类型检查确认通过**

运行: `cd web && npx tsc --noEmit`
预期: 无类型错误。这是纯类型透传改动（无分支逻辑），项目里 `api.ts` 目前也没有专门的单元测试文件（`web/src/lib/` 下同级只有 `time.test.ts` / `anchor-layout.test.ts`，都不覆盖 `api.ts`），故不为此新增测试文件；正确性由类型系统 + Task 1 已覆盖的后端契约测试 + Task 3/4 的组件与集成验证共同兜底。

- [ ] **Step 5: 提交**

```bash
git add web/src/lib/api.ts
git commit -m "feat: propagate parsed article frontmatter through Task type"
```

---

### Task 3: 前端 — 新增 `ArticleMetaBar` 组件

**文件：**
- 创建: `web/src/components/article-meta-bar.tsx`
- 创建: `web/src/components/article-meta-bar.test.tsx`

- [ ] **Step 1: 编写失败的测试**

创建 `web/src/components/article-meta-bar.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArticleMetaBar } from './article-meta-bar';

describe('ArticleMetaBar', () => {
  it('renders nothing when frontmatter is undefined', () => {
    const { container } = render(<ArticleMetaBar frontmatter={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when frontmatter only has title', () => {
    const { container } = render(<ArticleMetaBar frontmatter={{ title: 'Intro' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders scalar fields with humanized labels, excluding title', () => {
    render(<ArticleMetaBar frontmatter={{ title: 'Intro', fetch_date: '2024-03-15', author: 'Jane' }} />);
    expect(screen.queryByText('Title')).toBeNull();
    expect(screen.getByText('Fetch Date')).toBeInTheDocument();
    expect(screen.getByText('2024-03-15')).toBeInTheDocument();
    expect(screen.getByText('Author')).toBeInTheDocument();
    expect(screen.getByText('Jane')).toBeInTheDocument();
  });

  it('renders array fields as chips on their own row', () => {
    render(<ArticleMetaBar frontmatter={{ tags: ['ai', 'ml'] }} />);
    expect(screen.getByText('Tags')).toBeInTheDocument();
    expect(screen.getByText('ai')).toBeInTheDocument();
    expect(screen.getByText('ml')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行: `cd web && npx vitest run src/components/article-meta-bar.test.tsx`
预期: FAIL（`./article-meta-bar` 模块不存在）。

- [ ] **Step 3: 编写最小实现**

创建 `web/src/components/article-meta-bar.tsx`：

```tsx
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

- [ ] **Step 4: 运行测试确认通过**

运行: `cd web && npx vitest run src/components/article-meta-bar.test.tsx`
预期: 全部 PASS（4 个测试）。

- [ ] **Step 5: 提交**

```bash
git add web/src/components/article-meta-bar.tsx web/src/components/article-meta-bar.test.tsx
git commit -m "feat: add ArticleMetaBar component for rendering article frontmatter"
```

---

### Task 4: 前端 — 集成 `ArticleMetaBar` 到文章详情页

**文件：**
- 修改: `web/src/routes/tasks.$id.tsx`

- [ ] **Step 1: 引入组件**

将：

```tsx
import { Reader } from '@/components/reader';
import { Toc, extractToc } from '@/components/toc';
```

替换为：

```tsx
import { Reader } from '@/components/reader';
import { ArticleMetaBar } from '@/components/article-meta-bar';
import { Toc, extractToc } from '@/components/toc';
```

- [ ] **Step 2: 在 tab bar 与正文之间插入信息栏**

将：

```tsx
                <div className="flex items-center gap-3 py-3 text-xs">
                  <button onClick={onCopy} style={{ color: 'var(--text-tertiary)' }}
                          className="hover:text-[var(--text-secondary)] cursor-pointer">复制</button>
                  <button onClick={onReveal} style={{ color: 'var(--text-tertiary)' }}
                          className="hover:text-[var(--text-secondary)] cursor-pointer">显示文件</button>
                </div>
              </div>

              {/* Article + Notes row (B/C/E/F modes) */}
              <div className="flex-1 overflow-y-auto">
```

替换为：

```tsx
                <div className="flex items-center gap-3 py-3 text-xs">
                  <button onClick={onCopy} style={{ color: 'var(--text-tertiary)' }}
                          className="hover:text-[var(--text-secondary)] cursor-pointer">复制</button>
                  <button onClick={onReveal} style={{ color: 'var(--text-tertiary)' }}
                          className="hover:text-[var(--text-secondary)] cursor-pointer">显示文件</button>
                </div>
              </div>

              {tab === 'article' && <ArticleMetaBar frontmatter={task.frontmatter} />}

              {/* Article + Notes row (B/C/E/F modes) */}
              <div className="flex-1 overflow-y-auto">
```

- [ ] **Step 3: 类型检查 + 已有前端测试套件回归**

运行: `cd web && npx tsc --noEmit && npx vitest run`
预期: 类型检查无错误；全部既有测试（含 Task 3 新增的 `article-meta-bar.test.tsx`）PASS。此路由文件目前没有专门的路由级测试（`web/src/routes/` 下无 `*.test.*` 文件），集成正确性由类型检查 + 组件单测 + 下方手动验证共同覆盖。

- [ ] **Step 4: 手动验证**

运行: `cd web && npm run dev`（需要一个指向真实 work 目录的 `scholia serve`，或临时在测试 `contentDir` 下放一篇带自定义 frontmatter 字段的文章）。检查：

1. 打开一篇带 `tags` 等自定义字段的文章任务，"文章" tab 下标题正下方出现信息栏，标量字段网格排布、`tags` 以 chips 独占一行展示。
2. 切换到"总结" tab，信息栏消失。
3. 正文里不再出现裸露的 `---title: ...---` 文本块。
4. 打开一篇没有 frontmatter 的文章，不出现信息栏（无空白区域）。

- [ ] **Step 5: 提交**

```bash
git add web/src/routes/tasks.\$id.tsx
git commit -m "feat: render ArticleMetaBar on the article tab of the task detail page"
```

---

### Task 5: 全量回归验证

**文件：** 无代码改动，仅运行验证命令。

- [ ] **Step 1: 后端全量测试**

运行: `npm test`
预期: 全部 PASS（`tests/config.test.js`、`tests/video-source.test.js`、`tests/article-source.test.js`、`tests/server.test.js`、`tests/integration.test.js`）。

- [ ] **Step 2: 前端全量测试 + 构建**

运行: `cd web && npm test && npm run build`
预期: 全部测试 PASS；`npm run build`（`tsc --noEmit && vite build`）无错误，产出 `web/dist/`。

- [ ] **Step 3: 汇总确认**

对照设计文档「测试策略」章节逐项确认：任意字段解析 ✓、`getArticleContent` 剥离验证 ✓、非法 YAML 兜底 ✓、无 frontmatter 文件 ✓、前端组件渲染逻辑 ✓、手动端到端验证 ✓（Task 4 Step 4 已执行）。若有遗漏项，回退到对应 Task 补充。

（此任务无需 git commit——不产生代码变更，仅验证前四个 Task 的组合结果。）
