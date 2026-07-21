# 首页列表卡片重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给首页视频卡（`TaskCard`）和文章卡（`ArticleCard`）加上顶部作者/标签胶囊行和底部标注计数（高亮数 · 笔记数），并把文章列表接口里被丢弃的 frontmatter 字段（`author`/`tags`/`source_url`）重新透传出来。

**Architecture:** 后端两个改动点（`server/index.js` 新增标注计数聚合、`server/article-source.js` 的 `listArticles()` 补充 frontmatter 字段透传），前端三个改动点（`api.ts` 类型扩展、新建 `Pill` 展示组件、`TaskCard`/`ArticleCard` 渲染新字段，`ArticleCard` 从 `_index.tsx` 内联组件拆成独立文件）。全部改动向后兼容——新字段都是可选的，缺失时对应 UI 分支不渲染。

**Tech Stack:** Koa + koa-router（后端，CommonJS，Node 内置 `node:test`/`assert` 风格的手写测试脚本，非框架）；React 19 + TypeScript + Vite（前端，Vitest + Testing Library）。

## Global Constraints

- 不使用 emoji 作为 UI 装饰（`DESIGN.md` 的 AI-slop 规避原则已明确排除 emoji-as-bullets）——所有新增文案用纯文字。
- 颜色/圆角/间距一律使用 `web/src/styles/globals.css` 里已有的 CSS 变量，不新增色板；胶囊沿用 `--bg-elevated`（中性）与 `--accent-3`/`--accent-11`（标签，与代码块背景/文字色复用同一对 token）。
- 计数展示遵循现有 `[a, b, c].filter(Boolean).join(' · ')` 的写法——每一项独立判断是否省略，不强行拼接一对空值。
- 本次范围明确不包含：视频"处理中"状态展示（`status`/`progress`/`current_step`）、`sourceUrl` 的可见文本展示（只做数据透传）。详见 `docs/superpowers/specs/2026-07-21-list-card-redesign-design.md`。
- 后端测试用 Node 内置 `assert/strict`，手写 `test(name, fn)` 计数器（见 `tests/server.test.js`、`tests/article-source.test.js`），不要引入新的测试框架。
- 前端测试用 Vitest + `@testing-library/react`，`vitest.config.ts` 已设置 `globals: true`，测试文件仍照现有约定显式 `import { describe, it, expect } from 'vitest'`（保持与 `article-meta-bar.test.tsx` 一致的风格，不依赖隐式全局）。
- 实施应在从 `staging`切出的 `feature/list-card-redesign` 分支上进行（本仓库 `staging` 禁止直接提交，规则见 `docs/reference/git-workflow.md`）。

---

### Task 1: 后端 — 列表接口新增标注计数（`highlightCount`/`noteCount`）

**Files:**
- Modify: `server/index.js:42-50`（`getPaths` 之后新增 `countAnnotations` 辅助函数）、`server/index.js:74-84`（`/tasks`、`/articles` 路由处理器）
- Test: `tests/server.test.js`

**Interfaces:**
- Consumes：已有的 `getPaths(taskId, workDir, contentDir)`（`server/index.js:42`，返回 `{ base, highlights, notes, ... }` 或 `null`）、`readJson(filePath, defaultVal)`（`server/index.js:20`）、`listVideos(workDir)`（`server/video-source.js`，返回数组，每项含 `id`）、`listArticles(contentDir)`（`server/article-source.js`，返回数组，每项含 `id`）。
- Produces：`countAnnotations(paths)` → `Promise<{ highlightCount: number, noteCount: number }>`，供 `/api/tasks`、`/api/articles` 两个路由内部使用；两个路由响应体的每一项新增 `highlightCount`、`noteCount` 字段（供 Task 3 的前端类型消费）。

- [ ] **Step 1: 在 `tests/server.test.js` 顶部 fixture 区新增标注数据和第二个"无标注"视频任务**

打开 `tests/server.test.js`，在第 41 行 `fs.writeFileSync(path.join(workDir, taskId, 'writing', 'article.md'), '# Article\n\nContent');` 之后插入：

```js
  fs.writeFileSync(path.join(workDir, taskId, 'highlights.json'), JSON.stringify([{ id: 'h1' }, { id: 'h2' }]));
  fs.writeFileSync(path.join(workDir, taskId, 'notes.json'), JSON.stringify([{ id: 'n1' }]));

  // Second video task with no annotation files — verifies the zero-fallback.
  // Older timestamp than `taskId` so it still sorts second (list is newest-first).
  const taskId2 = 'noannotations999';
  fs.mkdirSync(path.join(workDir, taskId2), { recursive: true });
  fs.writeFileSync(path.join(workDir, taskId2, 'meta.json'), JSON.stringify({
    id: taskId2, url: 'https://yt.com/v2', title: 'No Annotations Video',
    mode: 'media', ts: '2023-01-01T00:00:00.000Z',
  }));
```

在第 45 行（`fs.writeFileSync(path.join(contentDir, '2024', 'tips.md'), ...)`）之后插入（同一批 fixture 里，文章标注文件；用 `2024/tips` 而不是 `intro` 来预置高亮数据 — `intro` 会在本文件后面的 CRUD 测试里被 POST 一条高亮，如果这里预置了会让那条测试的"POST 后长度为 1"断言变成 2 而失败；`2024/tips` 后面只会被 POST 一条笔记（不同文件），预置高亮是安全的）：

```js
  // Pre-seed highlights for the "2024-tips" article, not "intro" — "intro" gets
  // highlights/notes POSTed to it later by the existing CRUD tests (further down
  // this file), and pre-seeding it here would make those tests' "starts at length 1
  // after POST" assertions fail (they'd see length 2 instead). "2024-tips" only gets
  // a *note* POSTed to it later (a different file), so seeding its highlights.json
  // here is safe.
  fs.mkdirSync(path.join(contentDir, '2024', 'tips'), { recursive: true });
  fs.writeFileSync(path.join(contentDir, '2024', 'tips', 'highlights.json'), JSON.stringify([{ id: 'ah1' }]));
```

**Files 里两处插入合并后，fixture 区（原第 33-45 行）变成：**

```js
  const taskId = 'abc123def456';
  fs.mkdirSync(path.join(workDir, taskId, 'writing'), { recursive: true });
  fs.mkdirSync(path.join(workDir, taskId, 'media'), { recursive: true });
  fs.mkdirSync(path.join(workDir, taskId, 'transcript'), { recursive: true });
  fs.writeFileSync(path.join(workDir, taskId, 'meta.json'), JSON.stringify({
    id: taskId, url: 'https://yt.com/v', title: 'Test Video', uploader: 'Chan',
    duration: '120', mode: 'media', ts: '2024-01-01T00:00:00.000Z',
  }));
  fs.writeFileSync(path.join(workDir, taskId, 'writing', 'article.md'), '# Article\n\nContent');
  fs.writeFileSync(path.join(workDir, taskId, 'highlights.json'), JSON.stringify([{ id: 'h1' }, { id: 'h2' }]));
  fs.writeFileSync(path.join(workDir, taskId, 'notes.json'), JSON.stringify([{ id: 'n1' }]));

  // Second video task with no annotation files — verifies the zero-fallback.
  // Older timestamp than `taskId` so it still sorts second (list is newest-first).
  const taskId2 = 'noannotations999';
  fs.mkdirSync(path.join(workDir, taskId2), { recursive: true });
  fs.writeFileSync(path.join(workDir, taskId2, 'meta.json'), JSON.stringify({
    id: taskId2, url: 'https://yt.com/v2', title: 'No Annotations Video',
    mode: 'media', ts: '2023-01-01T00:00:00.000Z',
  }));

  fs.writeFileSync(path.join(contentDir, 'intro.md'), '---\ntitle: Intro\n---\n\n# Hello');
  fs.mkdirSync(path.join(contentDir, '2024'), { recursive: true });
  fs.writeFileSync(path.join(contentDir, '2024', 'tips.md'), '---\ntitle: Tips\n---\n\n# Tips');
  // Pre-seed highlights for the "2024-tips" article, not "intro" — "intro" gets
  // highlights/notes POSTed to it later by the existing CRUD tests (further down
  // this file), and pre-seeding it here would make those tests' "starts at length 1
  // after POST" assertions fail (they'd see length 2 instead). "2024-tips" only gets
  // a *note* POSTed to it later (a different file), so seeding its highlights.json
  // here is safe.
  fs.mkdirSync(path.join(contentDir, '2024', 'tips'), { recursive: true });
  fs.writeFileSync(path.join(contentDir, '2024', 'tips', 'highlights.json'), JSON.stringify([{ id: 'ah1' }]));
```

Update 原有断言 `assert.equal(r.body.length, 1);`（第 71 行，'GET /api/tasks returns video list' 测试内）为 `assert.equal(r.body.length, 2);`——因为现在有两个视频任务了。

- [ ] **Step 2: 新增两条断言标注计数的测试**

在 `await test('GET /api/tasks returns video list', ...)`（更新后的 Step 1 断言）之后，`await test('GET /api/articles returns article list', ...)` 之前，插入：

```js
  await test('GET /api/tasks includes highlightCount and noteCount', async () => {
    const r = await req(port, 'GET', '/api/tasks');
    const withAnnotations = r.body.find((t) => t.id === taskId);
    assert.equal(withAnnotations.highlightCount, 2);
    assert.equal(withAnnotations.noteCount, 1);
    const withoutAnnotations = r.body.find((t) => t.id === taskId2);
    assert.equal(withoutAnnotations.highlightCount, 0);
    assert.equal(withoutAnnotations.noteCount, 0);
  });
```

在 `await test('GET /api/articles returns article list', ...)` 之后插入：

```js
  await test('GET /api/articles includes highlightCount and noteCount', async () => {
    const r = await req(port, 'GET', '/api/articles');
    const intro = r.body.find((a) => a.slug === 'intro');
    assert.equal(intro.highlightCount, 0);
    assert.equal(intro.noteCount, 0);
    const tips = r.body.find((a) => a.slug === '2024-tips');
    assert.equal(tips.highlightCount, 1);
    assert.equal(tips.noteCount, 0);
  });
```

- [ ] **Step 3: 运行测试，确认失败（字段还不存在）**

Run: `npm test`
Expected: FAIL — 新增的两个 `test()` 里 `assert.equal(withAnnotations.highlightCount, 2)` 等断言会因为 `highlightCount` 是 `undefined` 而报错；同时 `GET /api/tasks returns video list` 那条断言也会因为长度改成了 2 而在你还没修改前保持通过（这条本身不依赖新字段，是数量断言，先確認新加的两条计数测试确实失败）。

- [ ] **Step 4: 在 `server/index.js` 新增 `countAnnotations` 辅助函数**

在 `server/index.js:50` 的 `getPaths` 函数结束（`}` 之后，第 52 行 `function createApp` 之前）插入：

```js
async function countAnnotations(paths) {
  if (!paths) return { highlightCount: 0, noteCount: 0 };
  const [highlights, notes] = await Promise.all([
    readJson(paths.highlights, []),
    readJson(paths.notes, []),
  ]);
  return { highlightCount: highlights.length, noteCount: notes.length };
}
```

- [ ] **Step 5: 修改 `/api/tasks` 和 `/api/articles` 路由，合并标注计数**

把 `server/index.js:74-84` 的这两个路由处理器：

```js
  // List videos (same shape as VDL's /api/tasks for frontend compatibility)
  router.get('/tasks', async (ctx) => {
    if (!WORK_DIR) { ctx.body = []; return; }
    ctx.body = await listVideos(WORK_DIR);
  });

  // List articles
  router.get('/articles', async (ctx) => {
    if (!CONTENT_DIR) { ctx.body = []; return; }
    try { ctx.body = await listArticles(CONTENT_DIR); }
    catch (err) { ctx.status = 500; ctx.body = { error: err.message }; }
  });
```

替换为：

```js
  // List videos (same shape as VDL's /api/tasks for frontend compatibility)
  router.get('/tasks', async (ctx) => {
    if (!WORK_DIR) { ctx.body = []; return; }
    const tasks = await listVideos(WORK_DIR);
    ctx.body = await Promise.all(tasks.map(async (t) => {
      const paths = await getPaths(t.id, WORK_DIR, CONTENT_DIR);
      return { ...t, ...(await countAnnotations(paths)) };
    }));
  });

  // List articles
  router.get('/articles', async (ctx) => {
    if (!CONTENT_DIR) { ctx.body = []; return; }
    try {
      const articles = await listArticles(CONTENT_DIR);
      ctx.body = await Promise.all(articles.map(async (a) => {
        const paths = await getPaths(a.id, WORK_DIR, CONTENT_DIR);
        return { ...a, ...(await countAnnotations(paths)) };
      }));
    }
    catch (err) { ctx.status = 500; ctx.body = { error: err.message }; }
  });
```

- [ ] **Step 6: 运行测试，确认通过**

Run: `npm test`
Expected: PASS — 所有测试（含新增的 2 条和修改过长度断言的那条）都通过。

- [ ] **Step 7: Commit**

```bash
git add server/index.js tests/server.test.js
git commit -m "feat(server): add highlight/note counts to /api/tasks and /api/articles"
```

---

### Task 2: 后端 — 文章列表接口透传 `author`/`tags`/`sourceUrl`

**Files:**
- Modify: `server/article-source.js:58-70`（新增 `resolveSourceUrl` 辅助函数）、`server/article-source.js:95-110`（`listArticles` 函数体）
- Test: `tests/article-source.test.js`

**Interfaces:**
- Consumes：已有的 `parseFrontmatter(content)`（返回 `{ frontmatter, body }`，`frontmatter` 是任意 key-value 对象）、`readMetaJson(metaPath)`（返回 `meta.json` 解析后的对象或 `{}`）。
- Produces：`listArticles()` 返回数组每一项新增 `author?: string`、`tags?: string[]`、`sourceUrl?: string`（缺失时为 `undefined`，供 Task 3 的前端类型消费）。

- [ ] **Step 1: 在 `tests/article-source.test.js` 追加断言 author/tags/sourceUrl 透传的测试**

在文件末尾（第 205-210 行 `await test('listArticles skips dotfolders...')` 之后，`console.log` 之前）追加：

```js
  await test('listArticles includes author/tags/sourceUrl from frontmatter', async () => {
    fs.writeFileSync(path.join(contentDir, 'meta-rich.md'),
      '---\ntitle: Meta Rich\nauthor: Jane Doe\ntags:\n  - ai\n  - ml\nsource_url: https://example.com/meta-rich\n---\n\n# Body');
    const articles = await listArticles(contentDir);
    const entry = articles.find(a => a.slug === 'meta-rich');
    assert.ok(entry);
    assert.equal(entry.author, 'Jane Doe');
    assert.deepEqual(entry.tags, ['ai', 'ml']);
    assert.equal(entry.sourceUrl, 'https://example.com/meta-rich');
    fs.rmSync(path.join(contentDir, 'meta-rich.md'));
  });

  await test('listArticles leaves author/tags/sourceUrl undefined when frontmatter lacks them', async () => {
    const articles = await listArticles(contentDir);
    const dive = articles.find(a => a.slug === 'deep-dive');
    assert.ok(dive);
    assert.equal(dive.author, undefined);
    assert.equal(dive.tags, undefined);
    assert.equal(dive.sourceUrl, undefined);
  });

  await test('listArticles falls back to meta.json source_url when frontmatter omits it', async () => {
    // abc123's Translation file frontmatter only sets fetch_date — no source_url.
    // Its meta.json (written earlier in this file) has source_url: 'https://example.com'.
    const articles = await listArticles(contentDir);
    const entry = articles.find(a => a.slug === 'abc123');
    assert.ok(entry);
    assert.equal(entry.sourceUrl, 'https://example.com');
  });
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm test`
Expected: FAIL — 新增的三个断言里 `entry.author`/`entry.tags`/`entry.sourceUrl` 都是 `undefined`（第一个测试会失败在 `assert.equal(entry.author, 'Jane Doe')`），因为 `listArticles()` 还没有返回这些字段。

- [ ] **Step 3: 在 `server/article-source.js` 新增 `resolveSourceUrl` 辅助函数**

在 `server/article-source.js:70` 的 `resolveTitleAndDate` 函数结束（`}` 之后，第 72 行 `function isArticleId` 之前）插入：

```js
// source_url: frontmatter 优先，缺失时回退读 meta.json（与 resolveTitleAndDate 的
// "frontmatter 优先、meta.json 兜底"模式一致，但字段不同，单独一个小函数更清楚）。
async function resolveSourceUrl(frontmatter, metaPath) {
  if (frontmatter.source_url) return frontmatter.source_url;
  if (!metaPath) return undefined;
  const meta = await readMetaJson(metaPath);
  return meta.source_url;
}
```

- [ ] **Step 4: 修改 `listArticles()`，透传 author/tags/sourceUrl**

把 `server/article-source.js:95-110` 的 `listArticles` 函数：

```js
async function listArticles(contentDir) {
  let entries;
  try { entries = await findArticleEntries(contentDir); } catch { return []; }
  const articles = await Promise.all(entries.map(async (entry) => {
    const slug = slugFromPath(entry.slugPath, contentDir);
    const stat = await fs.promises.stat(entry.file).catch(() => null);
    let frontmatter = {};
    try { const raw = await fs.promises.readFile(entry.file, 'utf8'); ({ frontmatter } = parseFrontmatter(raw)); } catch {}
    const { title, date, fetchDate } = await resolveTitleAndDate(frontmatter, entry.metaPath);
    const fallbackMs = stat ? stat.mtimeMs : Date.now();
    const parsedFetchDate = fetchDate ? Date.parse(fetchDate) : NaN;
    const sortKey = Number.isNaN(parsedFetchDate) ? fallbackMs : parsedFetchDate;
    return { slug, id: `article-${slug}`, title: title || titleFromSlug(slug), date: date || undefined, updatedAt: fallbackMs, sortKey };
  }));
  return articles.sort((a, b) => b.sortKey - a.sortKey).map(({ sortKey, ...rest }) => rest);
}
```

替换为：

```js
async function listArticles(contentDir) {
  let entries;
  try { entries = await findArticleEntries(contentDir); } catch { return []; }
  const articles = await Promise.all(entries.map(async (entry) => {
    const slug = slugFromPath(entry.slugPath, contentDir);
    const stat = await fs.promises.stat(entry.file).catch(() => null);
    let frontmatter = {};
    try { const raw = await fs.promises.readFile(entry.file, 'utf8'); ({ frontmatter } = parseFrontmatter(raw)); } catch {}
    const { title, date, fetchDate } = await resolveTitleAndDate(frontmatter, entry.metaPath);
    const author = frontmatter.author;
    const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : undefined;
    const sourceUrl = await resolveSourceUrl(frontmatter, entry.metaPath);
    const fallbackMs = stat ? stat.mtimeMs : Date.now();
    const parsedFetchDate = fetchDate ? Date.parse(fetchDate) : NaN;
    const sortKey = Number.isNaN(parsedFetchDate) ? fallbackMs : parsedFetchDate;
    return {
      slug, id: `article-${slug}`, title: title || titleFromSlug(slug), date: date || undefined,
      author, tags, sourceUrl, updatedAt: fallbackMs, sortKey,
    };
  }));
  return articles.sort((a, b) => b.sortKey - a.sortKey).map(({ sortKey, ...rest }) => rest);
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `npm test`
Expected: PASS — 全部测试通过，包含新增的 3 条。

- [ ] **Step 6: Commit**

```bash
git add server/article-source.js tests/article-source.test.js
git commit -m "feat(server): surface author/tags/source_url from article frontmatter in listArticles"
```

---

### Task 3: 前端类型 — `web/src/lib/api.ts` 新增字段

**Files:**
- Modify: `web/src/lib/api.ts:26-47`（`Task` 接口）、`:60-65`（`BackendListTask` 接口）、`:100-119`（`normalizeListTask` 函数）、`:158-164`（`Article` 接口）

**Interfaces:**
- Consumes：Task 1/Task 2 后端新增返回的 `highlightCount`/`noteCount`（两个列表接口都有）、`author`/`tags`/`sourceUrl`（仅 `/api/articles`）。
- Produces：`Task.highlightCount?: number`、`Task.noteCount?: number`、`Article.author?: string`、`Article.tags?: string[]`、`Article.sourceUrl?: string`、`Article.highlightCount?: number`、`Article.noteCount?: number` —— Task 4（`TaskCard`）、Task 5（`ArticleCard`）直接读取这些字段。

这个任务是纯类型改动，没有对应的单元测试文件；用 `cd web && npm run build`（`tsc --noEmit && vite build`）做类型检查验证。

- [ ] **Step 1: 运行一次 build，确认当前基线通过**

Run: `cd web && npm run build`
Expected: 成功退出（`tsc --noEmit` 无报错，`vite build` 产出 `dist/`）——确认改动前基线是绿的。

- [ ] **Step 2: 修改 `Task` 接口，新增标注计数字段**

把 `web/src/lib/api.ts:26-47`：

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

替换为（只在末尾新增两行）：

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
  highlightCount?: number;
  noteCount?: number;
}
```

- [ ] **Step 3: 修改 `BackendListTask` 接口，新增同样两个字段**

把 `web/src/lib/api.ts:60-65`：

```ts
interface BackendListTask {
  id: string; url: string; title?: string; uploader?: string; upload_date?: string;
  duration?: string; mode?: string; output_lang?: string; focus?: string;
  created_at?: string; updated_at?: string;
  width?: number; height?: number; file_size?: number; bit_rate?: number;
}
```

替换为：

```ts
interface BackendListTask {
  id: string; url: string; title?: string; uploader?: string; upload_date?: string;
  duration?: string; mode?: string; output_lang?: string; focus?: string;
  created_at?: string; updated_at?: string;
  width?: number; height?: number; file_size?: number; bit_rate?: number;
  highlightCount?: number; noteCount?: number;
}
```

- [ ] **Step 4: 修改 `normalizeListTask`，透传两个字段**

把 `web/src/lib/api.ts:100-119`：

```ts
function normalizeListTask(t: BackendListTask): Task {
  return {
    id: t.id,
    url: t.url,
    title: t.title,
    uploader: t.uploader,
    upload_date: t.upload_date || undefined,
    duration_seconds: t.duration ? parseInt(t.duration, 10) || undefined : undefined,
    mode: mapMode(t.mode),
    output_lang: t.output_lang,
    focus: t.focus ?? undefined,
    status: 'done',
    created_at: parseDateStr(t.created_at),
    updated_at: parseDateStr(t.updated_at),
    width: t.width,
    height: t.height,
    file_size: t.file_size,
    bit_rate: t.bit_rate,
  };
}
```

替换为（新增最后两行）：

```ts
function normalizeListTask(t: BackendListTask): Task {
  return {
    id: t.id,
    url: t.url,
    title: t.title,
    uploader: t.uploader,
    upload_date: t.upload_date || undefined,
    duration_seconds: t.duration ? parseInt(t.duration, 10) || undefined : undefined,
    mode: mapMode(t.mode),
    output_lang: t.output_lang,
    focus: t.focus ?? undefined,
    status: 'done',
    created_at: parseDateStr(t.created_at),
    updated_at: parseDateStr(t.updated_at),
    width: t.width,
    height: t.height,
    file_size: t.file_size,
    bit_rate: t.bit_rate,
    highlightCount: t.highlightCount,
    noteCount: t.noteCount,
  };
}
```

- [ ] **Step 5: 修改 `Article` 接口，新增五个字段**

把 `web/src/lib/api.ts:158-164`：

```ts
export interface Article {
  id: string;
  slug: string;
  title: string;
  date?: string;
  updatedAt: number;
}
```

替换为：

```ts
export interface Article {
  id: string;
  slug: string;
  title: string;
  date?: string;
  updatedAt: number;
  author?: string;
  tags?: string[];
  sourceUrl?: string;
  highlightCount?: number;
  noteCount?: number;
}
```

（`api.listArticles()` 本身不需要改——它是 `request<Article[]>('/api/articles')` 直接把后端 JSON 当 `Article[]` 用，新增字段只要接口类型里声明了就会被 TS 认可，无需额外映射代码。）

- [ ] **Step 6: 运行 build，确认类型检查通过**

Run: `cd web && npm run build`
Expected: 成功退出，无 TS 报错。

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/api.ts
git commit -m "feat(web): add highlightCount/noteCount/author/tags/sourceUrl to Task and Article types"
```

---

### Task 4: 前端 — `Pill` 组件 + `TaskCard` 渲染作者胶囊和标注计数

**Files:**
- Create: `web/src/components/pill.tsx`
- Modify: `web/src/components/task-card.tsx`
- Test: `web/src/components/pill.test.tsx`, `web/src/components/task-card.test.tsx`（均新建）

**Interfaces:**
- Consumes：Task 3 的 `Task.uploader`（已有字段，只是没渲染）、`Task.highlightCount`/`Task.noteCount`（新字段）。
- Produces：`Pill({ children, variant, title }: { children: React.ReactNode; variant?: 'default' | 'tag' | 'more'; title?: string })` —— Task 5 的 `ArticleCard` 会复用这个组件（`variant='tag'`/`'more'`）。

- [ ] **Step 1: 写 `Pill` 组件的测试**

创建 `web/src/components/pill.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pill } from './pill';

describe('Pill', () => {
  it('renders children text', () => {
    render(<Pill>MIT OpenCourseWare</Pill>);
    expect(screen.getByText('MIT OpenCourseWare')).toBeInTheDocument();
  });

  it('applies the title attribute when provided', () => {
    render(<Pill title="rlhf, survey">+2</Pill>);
    expect(screen.getByText('+2')).toHaveAttribute('title', 'rlhf, survey');
  });

  it('defaults to the default variant styling', () => {
    render(<Pill>author</Pill>);
    expect(screen.getByText('author')).toHaveStyle({ background: 'var(--bg-elevated)' });
  });

  it('applies tag variant styling', () => {
    render(<Pill variant="tag">claude</Pill>);
    expect(screen.getByText('claude')).toHaveStyle({ background: 'var(--accent-3)' });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd web && npm test -- pill.test.tsx`
Expected: FAIL — `Cannot find module './pill'`（文件还不存在）。

- [ ] **Step 3: 创建 `web/src/components/pill.tsx`**

```tsx
import type { ReactNode } from 'react';

type PillVariant = 'default' | 'tag' | 'more';

const VARIANT_STYLES: Record<PillVariant, { background: string; color: string }> = {
  default: { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' },
  tag:     { background: 'var(--accent-3)',    color: 'var(--accent-11)' },
  more:    { background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' },
};

export function Pill({
  children,
  variant = 'default',
  title,
}: {
  children: ReactNode;
  variant?: PillVariant;
  title?: string;
}) {
  return (
    <span
      className="inline-flex items-center text-[11px] px-2 py-0.5 rounded whitespace-nowrap"
      style={VARIANT_STYLES[variant]}
      title={title}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd web && npm test -- pill.test.tsx`
Expected: PASS（4 tests）。

- [ ] **Step 5: 写 `TaskCard` 的新测试**

创建 `web/src/components/task-card.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { TaskCard } from './task-card';
import type { Task } from '@/lib/api';

const baseTask: Task = {
  id: 'abc',
  url: 'https://youtube.com/watch?v=x',
  title: 'Test Video',
  mode: 'media',
  duration_seconds: 932,
  status: 'done',
  created_at: Date.now(),
  updated_at: Date.now(),
};

function renderCard(task: Task) {
  return render(<MemoryRouter><TaskCard task={task} /></MemoryRouter>);
}

describe('TaskCard', () => {
  it('renders an author pill when uploader is present', () => {
    renderCard({ ...baseTask, uploader: 'MIT OpenCourseWare' });
    expect(screen.getByText('MIT OpenCourseWare')).toBeInTheDocument();
  });

  it('renders no author pill when uploader is absent', () => {
    const { container } = renderCard(baseTask);
    expect(container.querySelector('span[title], span.rounded')).toBeNull();
  });

  it('shows both counts when highlights and notes are present', () => {
    renderCard({ ...baseTask, highlightCount: 5, noteCount: 2 });
    expect(screen.getByText(/5 处高亮/)).toBeInTheDocument();
    expect(screen.getByText(/2 条笔记/)).toBeInTheDocument();
  });

  it('shows only highlight count when note count is zero', () => {
    renderCard({ ...baseTask, highlightCount: 1, noteCount: 0 });
    expect(screen.getByText(/1 处高亮/)).toBeInTheDocument();
    expect(screen.queryByText(/条笔记/)).toBeNull();
  });

  it('hides the annotation segment entirely when both counts are zero', () => {
    renderCard({ ...baseTask, highlightCount: 0, noteCount: 0 });
    expect(screen.queryByText(/处高亮/)).toBeNull();
    expect(screen.queryByText(/条笔记/)).toBeNull();
  });
});
```

- [ ] **Step 6: 运行测试，确认失败**

Run: `cd web && npm test -- task-card.test.tsx`
Expected: FAIL — 作者胶囊和标注计数相关断言失败（当前 `task-card.tsx` 还没有渲染这些）。

- [ ] **Step 7: 修改 `web/src/components/task-card.tsx`**

把整个文件：

```tsx
import { Link } from 'react-router';
import type { Task } from '@/lib/api';
import { formatDuration, formatRelativeTime } from '@/lib/time';

function formatResolution(width?: number, height?: number): string | null {
  if (!height) return null;
  if (height >= 2160) return '4K';
  if (height >= 1440) return '2K';
  if (height >= 1080) return '1080p';
  if (height >= 720)  return '720p';
  if (height >= 480)  return '480p';
  return `${width}×${height}`;
}

export function TaskCard({ task }: { task: Task }) {
  const isFailed   = task.status === 'failed';
  const duration   = task.duration_seconds ? formatDuration(task.duration_seconds) : null;
  const resolution = formatResolution(task.width, task.height);
  const meta = [task.mode, resolution, duration].filter(Boolean).join(' · ');

  return (
    <Link
      to={`/tasks/${task.id}`}
      className="flex flex-col rounded-xl border p-4 transition-colors"
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'var(--border-subtle)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-surface)')}
    >
      {/* Title */}
      <h2
        className="chinese text-[15px] font-medium mb-2 line-clamp-2"
        style={{ color: isFailed ? 'var(--text-secondary)' : 'var(--text-primary)' }}
      >
        {task.title || task.url}
      </h2>

      {/* URL */}
      <p className="text-xs mb-3 truncate" style={{ color: 'var(--text-tertiary)' }}>
        {task.url}
      </p>

      {/* Meta row — pinned to bottom */}
      {isFailed ? (
        <div className="mt-auto text-xs truncate" style={{ color: 'var(--status-err)' }}>
          {task.error_message || '处理失败'}
        </div>
      ) : (
        <div className="mt-auto flex items-center justify-between text-xs"
             style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
          <span>{meta}</span>
          <span>{task.upload_date ?? formatRelativeTime(task.updated_at)}</span>
        </div>
      )}
    </Link>
  );
}
```

替换为：

```tsx
import { Link } from 'react-router';
import type { Task } from '@/lib/api';
import { formatDuration, formatRelativeTime } from '@/lib/time';
import { Pill } from './pill';

function formatResolution(width?: number, height?: number): string | null {
  if (!height) return null;
  if (height >= 2160) return '4K';
  if (height >= 1440) return '2K';
  if (height >= 1080) return '1080p';
  if (height >= 720)  return '720p';
  if (height >= 480)  return '480p';
  return `${width}×${height}`;
}

export function TaskCard({ task }: { task: Task }) {
  const isFailed   = task.status === 'failed';
  const duration   = task.duration_seconds ? formatDuration(task.duration_seconds) : null;
  const resolution = formatResolution(task.width, task.height);
  const highlightLabel = task.highlightCount ? `${task.highlightCount} 处高亮` : null;
  const noteLabel = task.noteCount ? `${task.noteCount} 条笔记` : null;
  const meta = [task.mode, resolution, duration, highlightLabel, noteLabel].filter(Boolean).join(' · ');

  return (
    <Link
      to={`/tasks/${task.id}`}
      className="flex flex-col rounded-xl border p-4 transition-colors"
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'var(--border-subtle)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-surface)')}
    >
      {/* Author pill */}
      {task.uploader && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          <Pill>{task.uploader}</Pill>
        </div>
      )}

      {/* Title */}
      <h2
        className="chinese text-[15px] font-medium mb-2 line-clamp-2"
        style={{ color: isFailed ? 'var(--text-secondary)' : 'var(--text-primary)' }}
      >
        {task.title || task.url}
      </h2>

      {/* URL */}
      <p className="text-xs mb-3 truncate" style={{ color: 'var(--text-tertiary)' }}>
        {task.url}
      </p>

      {/* Meta row — pinned to bottom */}
      {isFailed ? (
        <div className="mt-auto text-xs truncate" style={{ color: 'var(--status-err)' }}>
          {task.error_message || '处理失败'}
        </div>
      ) : (
        <div className="mt-auto flex items-center justify-between text-xs"
             style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
          <span>{meta}</span>
          <span>{task.upload_date ?? formatRelativeTime(task.updated_at)}</span>
        </div>
      )}
    </Link>
  );
}
```

- [ ] **Step 8: 运行测试，确认通过**

Run: `cd web && npm test -- task-card.test.tsx pill.test.tsx`
Expected: PASS（9 tests：5 个 TaskCard + 4 个 Pill）。

- [ ] **Step 9: Commit**

```bash
git add web/src/components/pill.tsx web/src/components/pill.test.tsx web/src/components/task-card.tsx web/src/components/task-card.test.tsx
git commit -m "feat(web): render author pill and annotation counts on TaskCard"
```

---

### Task 5: 前端 — 拆出 `ArticleCard` 独立文件，渲染作者/标签胶囊（含折叠）和标注计数

**Files:**
- Create: `web/src/components/article-card.tsx`
- Modify: `web/src/routes/_index.tsx:1-9`（import 区）、`:156-174`（删除内联的 `ArticleCard` 定义）
- Test: `web/src/components/article-card.test.tsx`（新建）

**Interfaces:**
- Consumes：Task 3 的 `Article.author`/`Article.tags`/`Article.highlightCount`/`Article.noteCount`（新字段）；Task 4 的 `Pill`（`web/src/components/pill.tsx`，`variant='tag'`/`'more'`）。
- Produces：`ArticleCard({ article }: { article: Article })` —— `_index.tsx` 从 `@/components/article-card` 导入替代原来的内联定义，渲染行为（含 props 签名）与原内联组件一致，只是多了胶囊行和计数行。

- [ ] **Step 1: 写 `ArticleCard` 的测试**

创建 `web/src/components/article-card.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ArticleCard } from './article-card';
import type { Article } from '@/lib/api';

const baseArticle: Article = {
  id: 'article-intro',
  slug: 'intro',
  title: 'Test Article',
  updatedAt: Date.now(),
};

function renderCard(article: Article) {
  return render(<MemoryRouter><ArticleCard article={article} /></MemoryRouter>);
}

describe('ArticleCard', () => {
  it('renders no pill row when author and tags are both absent', () => {
    const { container } = renderCard(baseArticle);
    expect(container.querySelector('span[title], span.rounded')).toBeNull();
  });

  it('renders an author pill when author is present', () => {
    renderCard({ ...baseArticle, author: 'Anthropic' });
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
  });

  it('renders up to 3 tag pills without folding', () => {
    renderCard({ ...baseArticle, tags: ['rust', '生命周期', '教程'] });
    expect(screen.getByText('rust')).toBeInTheDocument();
    expect(screen.getByText('生命周期')).toBeInTheDocument();
    expect(screen.getByText('教程')).toBeInTheDocument();
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it('folds tags beyond 3 into a +N pill with the rest in its title attribute', () => {
    renderCard({ ...baseArticle, tags: ['attention', 'transformer', 'nlp', 'rlhf', 'survey'] });
    expect(screen.getByText('attention')).toBeInTheDocument();
    expect(screen.getByText('transformer')).toBeInTheDocument();
    expect(screen.getByText('nlp')).toBeInTheDocument();
    expect(screen.queryByText('rlhf')).toBeNull();
    const more = screen.getByText('+2');
    expect(more).toHaveAttribute('title', 'rlhf, survey');
  });

  it('shows both counts when highlights and notes are present', () => {
    renderCard({ ...baseArticle, highlightCount: 3, noteCount: 1 });
    expect(screen.getByText(/3 处高亮/)).toBeInTheDocument();
    expect(screen.getByText(/1 条笔记/)).toBeInTheDocument();
  });

  it('hides the annotation row entirely when both counts are zero', () => {
    renderCard({ ...baseArticle, highlightCount: 0, noteCount: 0 });
    expect(screen.queryByText(/处高亮/)).toBeNull();
    expect(screen.queryByText(/条笔记/)).toBeNull();
  });

  it('still renders title, date and slug like before', () => {
    renderCard({ ...baseArticle, date: '2026-03-22' });
    expect(screen.getByText('Test Article')).toBeInTheDocument();
    expect(screen.getByText('2026-03-22')).toBeInTheDocument();
    expect(screen.getByText('intro')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd web && npm test -- article-card.test.tsx`
Expected: FAIL — `Cannot find module './article-card'`（文件还不存在）。

- [ ] **Step 3: 创建 `web/src/components/article-card.tsx`**

```tsx
import { Link } from 'react-router';
import type { Article } from '@/lib/api';
import { Pill } from './pill';

const MAX_VISIBLE_TAGS = 3;

export function ArticleCard({ article }: { article: Article }) {
  const visibleTags = article.tags?.slice(0, MAX_VISIBLE_TAGS) ?? [];
  const hiddenTags = article.tags?.slice(MAX_VISIBLE_TAGS) ?? [];
  const hasPillRow = Boolean(article.author) || visibleTags.length > 0;

  const highlightLabel = article.highlightCount ? `${article.highlightCount} 处高亮` : null;
  const noteLabel = article.noteCount ? `${article.noteCount} 条笔记` : null;
  const annotationMeta = [highlightLabel, noteLabel].filter(Boolean).join(' · ');

  return (
    <Link
      to={`/tasks/${article.id}`}
      className="block rounded-xl border p-4 hover:opacity-80 transition-opacity"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
    >
      {hasPillRow && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {article.author && <Pill>{article.author}</Pill>}
          {visibleTags.map((tag) => (
            <Pill key={tag} variant="tag">{tag}</Pill>
          ))}
          {hiddenTags.length > 0 && (
            <Pill variant="more" title={hiddenTags.join(', ')}>+{hiddenTags.length}</Pill>
          )}
        </div>
      )}

      <div className="text-sm font-medium mb-1 line-clamp-2" style={{ color: 'var(--text-primary)' }}>
        {article.title}
      </div>
      {article.date && (
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{article.date}</div>
      )}
      <div className="text-xs mt-1 truncate" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
        {article.slug}
      </div>
      {annotationMeta && (
        <div className="text-xs mt-1.5" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
          {annotationMeta}
        </div>
      )}
    </Link>
  );
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd web && npm test -- article-card.test.tsx`
Expected: PASS（7 tests）。

- [ ] **Step 5: 从 `_index.tsx` 里删掉内联的 `ArticleCard`，改为导入新文件**

在 `web/src/routes/_index.tsx` 顶部 import 区（第 1-9 行）：

```tsx
import { useState, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTasks } from '@/hooks/use-tasks';
import { TaskCard } from '@/components/task-card';
import { SortSelect } from '@/components/sort-select';
import { api, type Article } from '@/lib/api';
import { sortTasks, sortArticles, type SortField } from '@/lib/sort';
import { useUiStore } from '@/stores/ui-store';
```

替换为（新增一行 import，`type Article` 仍需保留因为 `useArticles`/`filteredArticles` 等处还用到）：

```tsx
import { useState, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTasks } from '@/hooks/use-tasks';
import { TaskCard } from '@/components/task-card';
import { ArticleCard } from '@/components/article-card';
import { SortSelect } from '@/components/sort-select';
import { api, type Article } from '@/lib/api';
import { sortTasks, sortArticles, type SortField } from '@/lib/sort';
import { useUiStore } from '@/stores/ui-store';
```

然后删除文件末尾（第 156-174 行）内联的 `ArticleCard` 函数定义：

```tsx
function ArticleCard({ article }: { article: Article }) {
  return (
    <Link
      to={`/tasks/${article.id}`}
      className="block rounded-xl border p-4 hover:opacity-80 transition-opacity"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
    >
      <div className="text-sm font-medium mb-1 line-clamp-2" style={{ color: 'var(--text-primary)' }}>
        {article.title}
      </div>
      {article.date && (
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{article.date}</div>
      )}
      <div className="text-xs mt-1 truncate" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
        {article.slug}
      </div>
    </Link>
  );
}
```

（整段删除，文件结尾变成上一个函数 `Home` 的闭合 `}` 之后直接是 EOF。）

- [ ] **Step 6: 运行完整前端测试和 build，确认没有破坏首页**

Run: `cd web && npm test`
Expected: PASS（全部前端测试，含新增的 `pill.test.tsx`、`task-card.test.tsx`、`article-card.test.tsx`）。

Run: `cd web && npm run build`
Expected: 成功退出，无 TS 报错（尤其确认 `_index.tsx` 里 `ArticleCard` 的导入替换没有留下未使用的重复定义或类型不匹配）。

- [ ] **Step 7: Commit**

```bash
git add web/src/components/article-card.tsx web/src/components/article-card.test.tsx web/src/routes/_index.tsx
git commit -m "feat(web): extract ArticleCard with author/tag pills and annotation counts"
```

---

## 完成后的手动验证（非自动化，供最后抽查）

`cd web && npm run dev`，指向真实 `~/Vault/VL/work` 和 `~/Vault/Product/Reading`，对照 `.hskill/sync-design/html/drafts/home-web-design.html` 里展示的边界情况逐一检查：
- 有 uploader 的视频卡显示作者胶囊；无 uploader 的不显示。
- 有 frontmatter 的文章卡显示作者/标签胶囊；标签超过 3 个时折叠为 `+N`，鼠标悬停显示完整列表；纯手写笔记（无 frontmatter 扩展字段）退化成原来的样子。
- 有标注的任务/文章底部显示"N 处高亮 · M 条笔记"；某一项为 0 时只显示非零的那项；两项都为 0 时整段不显示。
- 失败态视频卡（如果有）展示不变。
