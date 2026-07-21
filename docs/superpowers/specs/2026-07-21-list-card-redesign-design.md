# 首页列表卡片重设计（顶部胶囊行 + 标注计数）

## 概述

首页视频/文章卡片（`web/src/components/task-card.tsx`、`web/src/routes/_index.tsx` 里的 `ArticleCard`）目前信息很薄：视频卡只有标题/URL/mode·分辨率·时长/日期；文章卡只有标题/日期/slug。本设计给两种卡片顶部加一行"作者 + 标签"胶囊，底部 meta 行追加标注计数（高亮数 · 笔记数），并把文章列表接口里被丢弃的 frontmatter 字段（`author`/`tags`/`source_url`）重新透传出来。

## 背景与现状确认

- `server/video-source.js` 的 `listVideos()` 已经把 `uploader` 透传到 `Task.uploader`（`web/src/lib/api.ts:105`），只是 `task-card.tsx` 没有渲染它——这部分零后端成本，纯前端改动。
- `server/article-source.js` 的 `parseFrontmatter()` 用 `js-yaml` 完整解析 frontmatter 为任意 key-value 对象（该能力已在 `2026-07-13-article-frontmatter-metabar-design.md` 中为详情页实现），但 `listArticles()`（首页列表用）第 95-110 行只从解析结果里挑了 `title`/`date` 两个字段塞进返回对象，其余字段（如 `author`/`tags`/`source_url`）被丢弃，不会到达前端列表。
- 高亮/笔记数据（`highlights.json`/`notes.json`）目前只在任务详情页通过 `/api/tasks/:id/highlights`、`/api/tasks/:id/notes` 按需加载（`use-tasks.ts` 的 `useHighlights`/`useNotes`），列表接口完全不涉及，需要新增聚合计数。
- **原计划里的"处理中任务进度条"已从本次范围移除**：`server/video-source.js` 的 `listVideos()`/`getVideoTask()` 把 `status` 硬编码为 `'completed'`，Scholia 本身不跑视频处理流程，只读展示外部工具（vdl CLI）已生成好的 `meta.json` 目录。真实 `meta.json` 里虽然有 `download_status`/`transcript_done`/`article_done`/`summary_done` 字段，但抽查 8 个真实任务全部是 `*_done: true`，且 `download_status` 在全部完成的任务上仍显示 `"pending"`，字段本身不可靠、也观察不到真实的"进行中"样本，不值得为一个几乎不会触发的状态新增 UI。
- 失败态展示（`task-card.tsx` 第 46-49 行的 `isFailed` 分支）保持不变，不在本次改动范围——它读取的 `status`/`error_message` 只在详情接口有值，列表接口不返回，这是既有行为，本次不处理。

## 用户故事

- 作为用户浏览首页视频列表，我能在卡片顶部直接看到视频作者，不用点进详情页。
- 作为用户浏览首页文章列表，如果文章 frontmatter 里写了 `author`/`tags`/`source_url`，卡片顶部会显示作者胶囊和最多 3 个标签胶囊（多余的折叠成 `+N`，鼠标悬停可看到完整列表）。
- 作为用户，卡片底部能看到这个任务/文章已经有多少条高亮和笔记，不用点进去才知道有没有标注过。
- 作为用户，如果某个字段缺失（没有作者、没有标签、没有任何标注），对应的胶囊或计数段不出现，卡片不会有空白占位或报错。

## 架构设计

### 1. 后端：视频列表接口

`server/video-source.js` 的 `listVideos()` 不需要改动（`uploader` 已透传）。新增标注计数：

- 新增一个共享工具函数（放在 `server/index.js` 或抽成 `server/annotation-counts.js`，与现有 highlights/notes 的读取逻辑复用同一套路径解析，见 `getPaths()`）：
  ```js
  async function countAnnotations(paths) {
    const highlights = await readJson(paths.highlightsFile, []);
    const notes = await readJson(paths.notesFile, []);
    return { highlightCount: highlights.length, noteCount: notes.length };
  }
  ```
- `router.get('/tasks', ...)` 和 `router.get('/articles', ...)` 在返回列表前，对每一项并发调用 `getPaths(id, WORK_DIR, CONTENT_DIR)` + `countAnnotations()`，把 `highlightCount`/`noteCount` 合并进每个列表项。
- 用 `Promise.all` 并发处理列表里的每一项，避免 N 个任务顺序读文件拖慢列表接口。
- 读取失败（目录不存在、JSON 损坏）时复用现有 `readJson` 的 catch-ENOENT-return-default 逻辑，`highlightCount`/`noteCount` 兜底为 `0`，不抛错。

### 2. 后端：文章列表接口

`server/article-source.js` 的 `listArticles()`（第 95-110 行）：
- 解构 frontmatter 时，除了现有的 `title`/`date`/`fetchDate`，新增取出 `author`、`tags`、`source_url`：
  ```js
  const author = frontmatter.author;
  const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : undefined;
  const sourceUrl = frontmatter.source_url;
  ```
- 双语阅读条目（有 `meta.json` 的目录）如果 frontmatter 没有 `source_url`，回退读 `meta.json` 的 `source_url` 字段（复用现有 `resolveTitleAndDate` 里"frontmatter 优先、meta.json 兜底"的模式，可以扩展该函数或新增一个并列的小函数）。
- 返回对象新增 `author`/`tags`/`sourceUrl` 三个可选字段（缺失就是 `undefined`，不强行给默认值）。

### 3. 前端类型（`web/src/lib/api.ts`）

- `Task` 接口新增：`highlightCount?: number; noteCount?: number;`
- `Article` 接口新增：`author?: string; tags?: string[]; sourceUrl?: string; highlightCount?: number; noteCount?: number;`
- `normalizeListTask()` 补上 `highlightCount`/`noteCount` 透传。
- `BackendListTask` 类型同步加上这两个字段。

### 4. 前端组件：`task-card.tsx`

- 顶部新增胶囊行：仅当 `task.uploader` 存在时渲染 `👤 {uploader}` 胶囊，视频卡没有标签概念，不涉及折叠逻辑。
- 底部 meta 行：在现有 `meta = [mode, resolution, duration].filter(Boolean).join(' · ')` 之后，追加标注计数段——仅当 `highlightCount > 0 || noteCount > 0` 时拼接 `🔖{highlightCount} · 📝{noteCount}`（两者都为 0 时不显示这一段，不显示"🔖0 · 📝0"这种噪音信息）。
- 失败态分支不动。

### 5. 前端组件：`ArticleCard`（`_index.tsx` 内联组件，本次改动量足以拆成独立文件 `web/src/components/article-card.tsx`，与 `task-card.tsx` 并列）

- 顶部胶囊行：`author` 存在则渲染作者胶囊；`tags` 存在则最多渲染前 3 个标签胶囊，第 4 个开始折叠成 `+N` 胶囊，`title` 属性放完整标签列表（`tags.slice(3).join(', ')`），纯 CSS `title` 悬浮提示，不引入额外的 tooltip 组件。
- 原有 `slug` 展示行为不变，本轮不新增 `sourceUrl` 的文本展示——数据透传到位即可，`slug` 行继续承担"来源标识"的展示职责，避免与新胶囊行信息重复。`sourceUrl` 字段留给后续需求（如"点击跳转原文"）使用。
- 底部新增 meta 行，展示标注计数（同 `task-card.tsx` 的规则：都为 0 不显示）。

### 6. 胶囊/折叠组件复用

- 作者胶囊、标签胶囊、`+N` 折叠胶囊的样式可以抽成一个小的展示型组件（如 `web/src/components/pill.tsx`），供 `task-card.tsx` 和 `article-card.tsx` 共用，避免重复内联样式。是否抽取以实现阶段代码量判断为准（如果两处加起来不到 10 行重复，直接内联即可，不强制抽取）。

## 数据流

```
highlights.json / notes.json（任务或文章标注目录）
        │ readJson
        ▼
countAnnotations(paths) → { highlightCount, noteCount }
        │
        ├─ router.get('/tasks')   → 合并进 listVideos() 的每一项
        └─ router.get('/articles')→ 合并进 listArticles() 的每一项
        │
        ▼
Task.highlightCount / Article.highlightCount（前端类型）
        │
        ▼
<TaskCard> / <ArticleCard> 底部 meta 行渲染 "🔖N · 📝M"（N/M 都为 0 时不渲染）


文章 frontmatter（YAML）
        │ parseFrontmatter（已有，js-yaml）
        ▼
{ author, tags, source_url, ... } ⊂ frontmatter
        │
        ▼
listArticles() 新增解构 → Article.author / .tags / .sourceUrl
        │
        ▼
<ArticleCard> 顶部胶囊行渲染作者 + 最多 3 个标签
```

## 边界情况

- 视频无 `uploader` → 顶部胶囊行不渲染（不留空 div）。
- 文章无 `author`/`tags`/`sourceUrl`（纯手写笔记、无 frontmatter 扩展字段）→ 卡片退化成当前样子（标题 + 日期 + slug），顶部胶囊行整体不渲染。
- 标注计数为 0（新建但还没标注过的任务/文章）→ 计数段不渲染，避免"🔖0 · 📝0"这种无意义噪音。
- `tags` 超过 3 个 → 前 3 个正常显示，第 4 个起折叠为 `+N`，`title` 属性提供完整列表（无障碍/低成本方案，不引入新的 tooltip 交互组件）。
- 高亮/笔记文件不存在或 JSON 损坏 → 复用现有 `readJson` 的 catch 逻辑，计数兜底为 0，不影响列表接口整体响应。
- 已废弃范围：视频"处理中"状态展示——现有数据模型和真实样本都不支持，本设计不新增任何 `status`/`progress`/`current_step` 相关 UI 或接口字段。

## 测试策略

- `tests/server.test.js`：新增用例验证 `/api/tasks`、`/api/articles` 响应里包含 `highlightCount`/`noteCount`，且数值与预先写入的 `highlights.json`/`notes.json` 长度一致；无标注文件时兜底为 0。
- `tests/article-source.test.js`：新增用例验证 `listArticles()` 在 frontmatter 含 `author`/`tags`/`source_url` 时正确透传这三个字段；不含时对应字段为 `undefined`。
- 前端：`task-card.test.tsx`（新建，如果尚不存在）覆盖：`uploader` 存在/缺失两种渲染分支；`highlightCount`/`noteCount` 都为 0 时不渲染计数段，非 0 时渲染正确文案。
- 前端：`article-card.test.tsx`（新建）覆盖：标签折叠逻辑（0/1/3/5 个标签的渲染结果，5 个时验证显示"+2"且第 4-5 个标签出现在 `title` 属性里）；`author`/`tags`/`sourceUrl` 全部缺失时胶囊行不渲染。
- 手动验证（`cd web && npm run dev`，指向真实 `~/Vault/VL/work` 和 `~/Vault/Product/Reading`）：确认视频卡显示作者、文章卡显示作者+标签（含折叠）、两种卡片都在有标注的任务上显示正确计数、无标注的任务不显示计数段。
- `npm test`（根目录）+ `cd web && npm test` + `cd web && npm run build`（tsc 类型检查）作为回归验证。

## 风险和缓解

- **风险**：列表接口新增"每项都读 2 个 JSON 文件"的 I/O，如果任务/文章数量很大（几百个），并发读取可能拖慢首页加载。
  **缓解**：用 `Promise.all` 并发读取而非顺序 await；`highlights.json`/`notes.json` 文件通常很小（KB 级），单次 `fs.readFile` 开销很低；如果未来实测有性能问题，可以再加缓存层，本次不预先设计缓存机制（YAGNI）。
- **风险**：`tags` 折叠的 `+N` 依赖 `title` 属性做悬浮提示，移动端/触屏无 hover，看不到完整标签列表。
  **缓解**：这是已知的可访问性妥协，非本次改动引入的新问题（项目其他地方也没有触屏专门优化）；如果后续需要触屏可点击展开，作为独立需求再讨论，不在本次范围内解决。
- **风险**：`sourceUrl` 本轮只做数据透传、不展示，容易被后续实现者误以为"漏做了"。
  **缓解**：本文档明确记录"故意不展示"及原因（避免与 slug 行重复），实现计划里对应任务会引用这条说明。
