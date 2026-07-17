# 文章标注数据与文章文件同目录存放 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把文章的 `notes.json`/`highlights.json` 从 `<work-dir>/article-<slug>/` 迁移到 `content-dir` 内、与文章 `.md` 文件同级的同名子目录，文章文件本身的位置/内容不变。

**Architecture:** `server/paths.js` 新增纯函数 `getArticleAnnotationDirs(articleFilePath)`，从"已解析出的文章文件绝对路径"算出其同级标注目录；`server/article-source.js` 导出已有的 `resolveArticleFile(contentDir, slug)` 供外部复用；`server/index.js` 的 `getPaths` 改为异步，文章分支用 `resolveArticleFile` 找到真实文件后再算标注目录，找不到就返回 `null`（统一当 404 处理），7 个 highlights/notes 路由改为单次 `getPaths` 调用完成"存在性检查 + 路径解析"。视频分支的存储行为完全不变。

**Tech Stack:** Node.js (CommonJS)，无新增依赖，测试用项目自带的 `node:assert/strict` 脚本式测试（`npm test`）。

## Global Constraints

- 不引入任何新的 npm 依赖。
- 标注文件写入必须继续走现有的原子写模式（先写 `.tmp` 再 `fs.rename`，`writeJson` 不变）。
- 复用/创建标注目录时，绝不遍历、删除或修改该目录下 `notes.json`/`highlights.json` 之外的任何文件。
- 不写自动迁移逻辑（已在 spec 中确认当前环境无真实数据需要迁移）。
- 视频（非文章）任务的存储路径与行为必须保持完全不变，所有现有视频相关测试须原样通过。
- 每个任务完成后运行 `npm test`（仓库根目录）确认全绿再提交。

---

### Task 1: `server/paths.js` 新增 `getArticleAnnotationDirs`

**Files:**
- Modify: `server/paths.js`
- Test: `tests/article-source.test.js`

**Interfaces:**
- Produces: `getArticleAnnotationDirs(articleFilePath: string): { base: string, notes: string, highlights: string }` — 纯函数，输入文章文件绝对路径，输出其同级标注目录三件套（与 `getVideoDirs` 返回形状一致）。
- 本任务不删除 `getArticleDirs`（Task 4 再删），当前测试套件行为不受影响。

- [ ] **Step 1: 写失败测试**

在 `tests/article-source.test.js` 第 102 行（`getArticleContent returns null for missing slug` 测试结束）之后、第 104 行（`path traversal slug rejected by getArticleDirs` 测试开始）之前插入：

```js
  await test('getArticleAnnotationDirs computes sibling directory next to the article file', () => {
    const { getArticleAnnotationDirs } = require('../server/paths');
    const dirs = getArticleAnnotationDirs(path.join(contentDir, '2024', 'tips.md'));
    assert.equal(dirs.base, path.join(contentDir, '2024', 'tips'));
    assert.equal(dirs.notes, path.join(contentDir, '2024', 'tips', 'notes.json'));
    assert.equal(dirs.highlights, path.join(contentDir, '2024', 'tips', 'highlights.json'));
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/article-source.test.js`
Expected: FAIL，报错类似 `getArticleAnnotationDirs is not a function`（因为 `../server/paths` 还没导出它）。

- [ ] **Step 3: 实现最小改动**

在 `server/paths.js` 的 `getArticleDirs` 函数定义之后（第 35 行 `}` 之后）新增：

```js
function getArticleAnnotationDirs(articleFilePath) {
  const { dir, name } = path.parse(articleFilePath);
  const base = path.join(dir, name);
  return {
    base,
    notes:      path.join(base, 'notes.json'),
    highlights: path.join(base, 'highlights.json'),
  };
}
```

并把文件末尾的 `module.exports` 改为：

```js
module.exports = { expandPath, getVideoDirs, getArticleDirs, getArticleAnnotationDirs };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/article-source.test.js`
Expected: PASS，全部用例通过（包括新增的这条）。

- [ ] **Step 5: 提交**

```bash
git add server/paths.js tests/article-source.test.js
git commit -m "feat: add getArticleAnnotationDirs path helper"
```

---

### Task 2: `server/article-source.js` 导出 `resolveArticleFile`

**Files:**
- Modify: `server/article-source.js`
- Test: `tests/article-source.test.js`

**Interfaces:**
- Consumes: 无新依赖（`resolveArticleFile` 已在文件内部实现，第 43-47 行）。
- Produces: `resolveArticleFile(contentDir: string, slug: string): Promise<string|null>` — 现在对外可用，找到返回文章文件绝对路径，找不到（含路径穿越式的假 slug）返回 `null`，从不抛异常。

- [ ] **Step 1: 写失败测试**

在 `tests/article-source.test.js` 中，紧接着 Task 1 新增的测试之后插入：

```js
  await test('resolveArticleFile resolves nested slug to its file path', async () => {
    const { resolveArticleFile } = require('../server/article-source');
    const filePath = await resolveArticleFile(contentDir, '2024-tips');
    assert.equal(filePath, path.join(contentDir, '2024', 'tips.md'));
  });

  await test('resolveArticleFile returns null for unmatched or path-traversal-like slugs', async () => {
    const { resolveArticleFile } = require('../server/article-source');
    assert.equal(await resolveArticleFile(contentDir, 'nonexistent'), null);
    assert.equal(await resolveArticleFile(contentDir, '../evil'), null);
    assert.equal(await resolveArticleFile(contentDir, 'foo/bar'), null);
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/article-source.test.js`
Expected: FAIL，报错类似 `resolveArticleFile is not a function`（尚未导出）。

- [ ] **Step 3: 实现最小改动**

在 `server/article-source.js` 文件末尾的 `module.exports`（第 87 行）改为：

```js
module.exports = { isArticleId, slugFromId, listArticles, articleFileExists, getArticleTask, getArticleContent, resolveArticleFile };
```

（函数本体第 43-47 行不需要改动，只是加入导出列表。）

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/article-source.test.js`
Expected: PASS，全部用例通过。

- [ ] **Step 5: 提交**

```bash
git add server/article-source.js tests/article-source.test.js
git commit -m "feat: export resolveArticleFile from article-source"
```

---

### Task 3: `server/index.js` 异步化 `getPaths`，路由改为同目录存储

**Files:**
- Modify: `server/index.js`
- Test: `tests/server.test.js`

**Interfaces:**
- Consumes: `getArticleAnnotationDirs`（Task 1，来自 `./paths`）、`resolveArticleFile`（Task 2，来自 `./article-source`）。
- Produces: `getPaths(taskId, workDir, contentDir): Promise<{base,notes,highlights}|null>` —— 文章分支用 `resolveArticleFile` 解析真实文件后调用 `getArticleAnnotationDirs`；找不到文件返回 `null`。视频分支复用现有 `assertItemExists` 做存在性检查，通过后调用 `getVideoDirs`，检查不过返回 `null`。调用方统一按 `null` → 404 处理，不再需要额外调用 `assertItemExists`。

- [ ] **Step 1: 写失败测试**

在 `tests/server.test.js` 第 43 行 `fs.writeFileSync(path.join(contentDir, 'intro.md'), ...)` 之后插入嵌套文章 fixture：

```js
  fs.writeFileSync(path.join(contentDir, 'intro.md'), '---\ntitle: Intro\n---\n\n# Hello');
  fs.mkdirSync(path.join(contentDir, '2024'), { recursive: true });
  fs.writeFileSync(path.join(contentDir, '2024', 'tips.md'), '---\ntitle: Tips\n---\n\n# Tips');
```

把第 180-188 行的 `article highlights CRUD` 测试整体替换为（新增物理位置断言）：

```js
  // Article highlights
  await test('article highlights CRUD, co-located with the article file', async () => {
    const r = await req(port, 'POST', '/api/tasks/article-intro/highlights', { anchor: 'h-1', color: 'green' });
    assert.equal(r.status, 201);
    assert.ok(fs.existsSync(path.join(contentDir, 'intro', 'highlights.json')));
    assert.ok(!fs.existsSync(path.join(workDir, 'article-intro', 'highlights.json')));
    const r2 = await req(port, 'GET', '/api/tasks/article-intro/highlights');
    assert.equal(r2.body.length, 1);
    await req(port, 'DELETE', `/api/tasks/article-intro/highlights/${r.body.id}`);
    const r3 = await req(port, 'GET', '/api/tasks/article-intro/highlights');
    assert.deepEqual(r3.body, []);
  });

  // Article notes
  let articleNoteId;
  await test('article notes: POST creates note co-located with the article file', async () => {
    const r = await req(port, 'POST', '/api/tasks/article-intro/notes', { anchor: 'p-1', body: 'Article note' });
    assert.equal(r.status, 201);
    assert.ok(r.body.id);
    articleNoteId = r.body.id;
    assert.ok(fs.existsSync(path.join(contentDir, 'intro', 'notes.json')));
    assert.ok(!fs.existsSync(path.join(workDir, 'article-intro', 'notes.json')));
  });

  await test('article notes: PATCH updates note', async () => {
    const r = await req(port, 'PATCH', `/api/tasks/article-intro/notes/${articleNoteId}`, { body: 'Updated article note' });
    assert.equal(r.status, 200);
    assert.equal(r.body.body, 'Updated article note');
  });

  await test('article notes: DELETE removes note', async () => {
    const r = await req(port, 'DELETE', `/api/tasks/article-intro/notes/${articleNoteId}`);
    assert.equal(r.status, 204);
    const r2 = await req(port, 'GET', '/api/tasks/article-intro/notes');
    assert.deepEqual(r2.body, []);
  });

  await test('article notes: nested article gets its own sibling dir, not the root one', async () => {
    const r = await req(port, 'POST', '/api/tasks/article-2024-tips/notes', { anchor: 'p-1', body: 'Nested note' });
    assert.equal(r.status, 201);
    assert.ok(fs.existsSync(path.join(contentDir, '2024', 'tips', 'notes.json')));
    assert.ok(!fs.existsSync(path.join(contentDir, 'tips', 'notes.json')));
  });

  await test('article notes: the article .md file itself is untouched', async () => {
    const content = fs.readFileSync(path.join(contentDir, 'intro.md'), 'utf8');
    assert.ok(content.includes('# Hello'));
  });

  await test('article notes: 404 for a nonexistent article', async () => {
    const r = await req(port, 'GET', '/api/tasks/article-nonexistent/notes');
    assert.equal(r.status, 404);
  });
```

（这段整体替换原来第 179-188 行的 `// Article highlights` 注释和其后的单个测试块；`// 401 without token` 及其后内容保持不变，紧跟在新增测试块之后。）

- [ ] **Step 2: 运行测试确认失败**

Run: `node tests/server.test.js`
Expected: FAIL——新增的 `fs.existsSync(path.join(contentDir, 'intro', 'highlights.json'))` 等物理位置断言会失败（当前代码仍把文件写在 `workDir/article-intro/` 下）。

- [ ] **Step 3: 实现最小改动**

`server/index.js` 第 9-11 行导入语句改为：

```js
const { getVideoDirs, getArticleAnnotationDirs } = require('./paths');
const { listVideos, getVideoTask, getVideoMediaInfo, getVideoSubtitles, getVideoContent } = require('./video-source');
const { isArticleId, slugFromId, listArticles, articleFileExists, getArticleTask, getArticleContent, resolveArticleFile } = require('./article-source');
```

第 36-38 行的 `getPaths` 改为：

```js
async function getPaths(taskId, workDir, contentDir) {
  if (isArticleId(taskId)) {
    const filePath = await resolveArticleFile(contentDir, slugFromId(taskId));
    if (!filePath) return null;
    return getArticleAnnotationDirs(filePath);
  }
  if (!await assertItemExists(taskId, workDir, contentDir)) return null;
  return getVideoDirs(workDir, taskId);
}
```

第 172-251 行的 7 个 highlights/notes 路由，逐个替换为：

```js
  // Highlights
  router.get('/tasks/:taskId/highlights', async (ctx) => {
    const { taskId } = ctx.params;
    const paths = await getPaths(taskId, WORK_DIR, CONTENT_DIR);
    if (!paths) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    ctx.body = await readJson(paths.highlights, []);
  });

  router.post('/tasks/:taskId/highlights', async (ctx) => {
    const { taskId } = ctx.params;
    const { anchor = '', color = 'yellow' } = ctx.request.body || {};
    if (!anchor || typeof anchor !== 'string' || !anchor.trim()) { ctx.status = 400; ctx.body = { error: 'anchor required' }; return; }
    if (!['yellow', 'green', 'red', 'blue'].includes(color)) { ctx.status = 400; ctx.body = { error: 'invalid color' }; return; }
    const paths = await getPaths(taskId, WORK_DIR, CONTENT_DIR);
    if (!paths) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    await fs.promises.mkdir(paths.base, { recursive: true });
    const hls = await readJson(paths.highlights, []);
    const hl = { id: crypto.randomUUID(), anchor: anchor.trim(), color, createdAt: Date.now() };
    hls.unshift(hl);
    await writeJson(paths.highlights, hls);
    ctx.status = 201; ctx.body = hl;
  });

  router.delete('/tasks/:taskId/highlights/:hlId', async (ctx) => {
    const { taskId, hlId } = ctx.params;
    const paths = await getPaths(taskId, WORK_DIR, CONTENT_DIR);
    if (!paths) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    const hls = await readJson(paths.highlights, []);
    const filtered = hls.filter((h) => h.id !== hlId);
    if (filtered.length === hls.length) { ctx.status = 404; ctx.body = { error: 'highlight not found' }; return; }
    await writeJson(paths.highlights, filtered);
    ctx.status = 204;
  });

  // Notes
  router.get('/tasks/:taskId/notes', async (ctx) => {
    const { taskId } = ctx.params;
    const paths = await getPaths(taskId, WORK_DIR, CONTENT_DIR);
    if (!paths) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    ctx.body = await readJson(paths.notes, []);
  });

  router.post('/tasks/:taskId/notes', async (ctx) => {
    const { taskId } = ctx.params;
    const { anchor = '', mediaTimestamp, body } = ctx.request.body || {};
    if (!body || typeof body !== 'string' || !body.trim()) { ctx.status = 400; ctx.body = { error: 'body required' }; return; }
    const paths = await getPaths(taskId, WORK_DIR, CONTENT_DIR);
    if (!paths) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    await fs.promises.mkdir(paths.base, { recursive: true });
    const ns = await readJson(paths.notes, []);
    const now = Date.now();
    const note = { id: crypto.randomUUID(), anchor: anchor || '', ...(mediaTimestamp != null ? { mediaTimestamp: Number(mediaTimestamp) } : {}), body: body.trim(), createdAt: now, updatedAt: now };
    ns.unshift(note);
    await writeJson(paths.notes, ns);
    ctx.status = 201; ctx.body = note;
  });

  router.patch('/tasks/:taskId/notes/:noteId', async (ctx) => {
    const { taskId, noteId } = ctx.params;
    const { body } = ctx.request.body || {};
    if (!body || typeof body !== 'string' || !body.trim()) { ctx.status = 400; ctx.body = { error: 'body required' }; return; }
    const paths = await getPaths(taskId, WORK_DIR, CONTENT_DIR);
    if (!paths) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    const ns = await readJson(paths.notes, []);
    const idx = ns.findIndex((n) => n.id === noteId);
    if (idx === -1) { ctx.status = 404; ctx.body = { error: 'note not found' }; return; }
    ns[idx] = { ...ns[idx], body: body.trim(), updatedAt: Date.now() };
    await writeJson(paths.notes, ns);
    ctx.body = ns[idx];
  });

  router.delete('/tasks/:taskId/notes/:noteId', async (ctx) => {
    const { taskId, noteId } = ctx.params;
    const paths = await getPaths(taskId, WORK_DIR, CONTENT_DIR);
    if (!paths) { ctx.status = 404; ctx.body = { error: 'not found' }; return; }
    const ns = await readJson(paths.notes, []);
    const filtered = ns.filter((n) => n.id !== noteId);
    if (filtered.length === ns.length) { ctx.status = 404; ctx.body = { error: 'note not found' }; return; }
    await writeJson(paths.notes, filtered);
    ctx.status = 204;
  });
```

（`assertItemExists` 函数本体、`/tasks/:taskId/steps` 路由第 138-142 行不改动，`assertItemExists` 仍被 `/steps` 路由直接调用，也被新 `getPaths` 内部的视频分支调用。）

- [ ] **Step 4: 运行测试确认通过**

Run: `node tests/server.test.js`
Expected: PASS，全部用例通过（包括新增的物理位置、嵌套目录、404、文件未被改动等断言）。

- [ ] **Step 5: 运行完整测试套件**

Run: `npm test`
Expected: 全部通过，无回归（视频 notes/highlights 用例、`article-source`/`config`/`video-source`/`integration` 测试均应保持绿色）。

- [ ] **Step 6: 提交**

```bash
git add server/index.js tests/server.test.js
git commit -m "feat: co-locate article annotations with the article file in content-dir"
```

---

### Task 4: 清理不再使用的 `getArticleDirs`

**Files:**
- Modify: `server/paths.js`
- Modify: `tests/article-source.test.js`

**Interfaces:**
- 无新增接口；移除 Task 1-3 完成后已经死掉的旧路径（`getArticleDirs`）。

- [ ] **Step 1: 删除旧测试**

从 `tests/article-source.test.js` 中删除以下块（原第 104-108 行，`getArticleAnnotationDirs`/`resolveArticleFile` 相关新测试已在 Task 1、Task 2 覆盖了同等的安全性保证）：

```js
  await test('path traversal slug rejected by getArticleDirs', () => {
    const { getArticleDirs } = require('../server/paths');
    assert.throws(() => getArticleDirs('/some/dir', '../evil'), /Invalid article slug/);
    assert.throws(() => getArticleDirs('/some/dir', 'foo/bar'), /Invalid article slug/);
  });
```

- [ ] **Step 2: 运行测试确认仍然通过**

Run: `node tests/article-source.test.js`
Expected: PASS（删除的是一个独立测试块，不影响其他用例）。

- [ ] **Step 3: 删除死代码**

在 `server/paths.js` 中删除 `getArticleDirs` 函数整体定义：

```js
function getArticleDirs(workDir, slug) {
  if (!slug || typeof slug !== 'string') throw new Error('slug required');
  if (/[/\\]/.test(slug) || slug.includes('..')) throw new Error(`Invalid article slug: ${slug}`);
  const base = path.join(workDir, `article-${slug}`);
  return {
    base,
    notes:      path.join(base, 'notes.json'),
    highlights: path.join(base, 'highlights.json'),
  };
}
```

并把 `module.exports` 改回：

```js
module.exports = { expandPath, getVideoDirs, getArticleAnnotationDirs };
```

确认 `server/index.js` 中已无 `getArticleDirs` 引用（Task 3 已经把导入改成了 `getArticleAnnotationDirs`）。

- [ ] **Step 4: 运行完整测试套件**

Run: `npm test`
Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add server/paths.js tests/article-source.test.js
git commit -m "chore: remove unused getArticleDirs"
```

---

### Task 5: 更新 `CLAUDE.md` 文档

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- 无代码接口；仅同步文档描述与 Task 1-4 实现后的实际行为。

- [ ] **Step 1: 更新 Backend 一节**

把 `CLAUDE.md` 中这一行（当前内容，第 36 行左右）：

```
- `server/paths.js` — pure path helpers. Videos: `<workDir>/<taskId>/` (highlights/notes co-located). Articles: `<workDir>/article-<slug>/` — annotations live under the same `workDir` as videos, not under the article vault (`contentDir`).
```

替换为：

```
- `server/paths.js` — pure path helpers. Videos: `<workDir>/<taskId>/` (highlights/notes co-located). Articles: annotations live inside `contentDir`, in a sibling directory named after the article file (`2024/react-tips.md` → `2024/react-tips/{notes.json,highlights.json}`) — the article file itself is never moved, renamed, or modified.
```

- [ ] **Step 2: 更新 Content formats 一节**

把这一行（当前内容，第 48 行左右）：

```
- **Articles** — Any Markdown directory (`contentDir`, read-only). Slugs derived from relative path (`2024/react-tips.md` → `article-2024-react-tips`). Annotations stored in `<workDir>/article-<slug>/{highlights.json,notes.json}` — same `workDir` as videos, kept separate from `contentDir` so the source vault is never written to.
```

替换为：

```
- **Articles** — Any Markdown directory (`contentDir`). Slugs derived from relative path (`2024/react-tips.md` → `article-2024-react-tips`). Annotations are co-located with the source file: a same-named sibling directory inside `contentDir` (`2024/react-tips/{highlights.json,notes.json}`). Scholia only ever creates/reads/writes those two file names inside that directory — everything else there (e.g. an existing Obsidian attachment folder of the same name) is left untouched.
```

- [ ] **Step 3: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for co-located article annotations"
```
