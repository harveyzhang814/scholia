# 正文内嵌评论 第 3 期（原文标记）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建评论成功后，在 Markdown 原文的锚点处写入不可见的注释标记（`<!-- sc:<id> -->`，选区再加 `<!-- /sc:<id> -->`）；渲染时把标记变成占位元素，定位函数优先按标记定位（第 0 步）；删除评论时同时删掉原文里的标记。标记丢失时退回第 1 期的文字定位。

**Architecture:** 前端算位置、后端只按指令写。前端用与渲染器同一套解析器（`unified` + `remark-parse` + `remark-gfm`）解析正文，建一份「源文件文字索引」，复用第 1 期的 `locateAnchor` 在上面定位；只有精确档才算出插入偏移，套行首规则后在本地插入并重新解析校验，通过才调用后端。后端校验正文哈希和偏移，自己生成编号和标记文本，原子写入，再把 `markerId` 写回评论。渲染侧用一个 remark 插件把标记转成带 `data-sc-ui` 的空 `span`，文字索引天然跳过它们。

**Tech Stack:** Koa + node:crypto（后端）；React 19 + TypeScript + unified/remark + Web Crypto（前端）。新增 web 直接依赖 `unified@^11.0.5`、`remark-parse@^11.0.0`、`remark-gfm@^4.0.1`（与 `markdown-preview-core` 当前使用的版本一致，已作为间接依赖存在）。

**Spec:** `docs/superpowers/specs/2026-10-22-inline-comments-design.md`（第 1.2 节第 0 步、第 5 节全部、第 6.1 节「源文件映射与插入」、第 6.3 节 marker 与删除、第 6.4 节）

**前置：** 第 1、2 期已合入 `staging`（`87bd861`）。本期在从 `staging` 切出的 `feature/inline-comments-p3` 上实施。

## Global Constraints

- 标记格式固定：点评论 `<!-- sc:<id> -->`；选区开头 `<!-- sc:<id> -->`、结尾 `<!-- /sc:<id> -->`。`<id>` 为 8 位小写十六进制，由服务端生成，同一文件内唯一。
- 识别正则固定：`/^<!--\s*(\/?)sc:([0-9a-f]{8})\s*-->$/`（单个 html 节点）；删除用全局正则 `<!--\s*\/?sc:<id>\s*-->`。
- 只有**精确档**定位才写标记；近似档、锚点落在 `code` / `inlineCode` / 非 sc 的 `html` 节点内、源文件片段与节点文字不能逐字对应时，都放弃写标记。
- 行首规则：结尾标记落在行首 → 改放到上一行行尾（换行符之前）；开头标记或点标记落在行首 → 往后挪一个字符。
- 插入后重新解析校验：每个标记必须是 `paragraph` / `heading` / `tableCell` 内（可嵌套在 `emphasis` / `strong` / `delete` / `link` 里）的行内 `html` 节点，且顶层块的数量和类型序列与插入前相同；不通过就放弃。
- 哈希：对「前端拿到的正文」取 UTF-8 的 SHA-256，转小写十六进制。文章的正文是去掉 frontmatter 后的部分，视频是整个文件，与 `GET /result/content` 返回一致。
- 偏移单位：JS 字符串下标（前后端都是同一份字符串，单位一致）。文章写入时偏移要加上 frontmatter 的长度。
- 原子写入：临时文件名唯一（`<file>.<randomUUID>.tmp`）再 `rename`。
- 先存评论、再写标记；写标记成功或失败都不提示用户。不回填旧评论，只给本次新建的评论写标记。
- 只有带锚点（选区或点）的评论写标记；无锚点评论不写。

## 关键决定（本计划细化，spec 未写死的部分；用户 2026-10-22 全部确认）

- **标记的开头和点写法相同**，渲染插件只区分「开」（`sc:`）和「闭」（`/sc:`）；是点还是选区由评论本身的类型（`anchorKind`）决定，不由标记决定。
- **写标记的触发点放在 `useAddNote` 的 `onSuccess`**：正文从 React Query 缓存里取（键 `['task', taskId, 'content', note.doc ?? 'article']`，文章页固定是 `'article'`），这样内嵌草稿卡片、右栏输入框两个提交入口都不用改。
- **同一条评论重复写标记返回 409**（`already marked`），防止重复插入。
- **复制按钮和目录（TOC）先去掉 sc 标记再用**，否则复制出的 Markdown 带注释、标题里的标记会进目录文字。
- **视频评论没有 `doc` 字段时不写标记**（第 1 期起新建的视频评论都有 `doc`，旧评论不回填）。

## Review Focus

1. **两条评论快速相继保存**：第二条拿着旧哈希会被 409，期望自动重新拉取正文、重算后成功写入，而不是放弃。→ Task 6 测试 `retries once after 409 with fresh content`。
2. **锚点在标题里**：标记插进标题行后，目录文字和复制出的 Markdown 不能出现 `<!-- sc:… -->`。→ Task 3 测试 `stripScMarkers removes all sc comments`、`toc ignores sc markers in headings`。
3. **行首**：段首、列表项开头、引用块开头、段内软换行后的行首，插入后段落结构不变。→ Task 5 测试 `line-start rules keep block structure`。
4. **标记被手工删掉一半**（只剩开头或只剩结尾）：定位仍是精确档，范围由 `anchor` 长度推出。→ Task 4 测试 `only open marker infers end from anchor length`、`only close marker infers start`。
5. **删除带标记的评论后，原文其他内容一字不差**（包括 frontmatter 和其他评论的标记）。→ Task 1 测试 `notes: DELETE removes only this note's markers`。

---

### Task 1: 后端写入与删除标记

**Files:**
- Create: `server/markers.js`
- Modify: `server/index.js`（新增 `POST /tasks/:taskId/notes/:noteId/marker`；`DELETE /tasks/:taskId/notes/:noteId` 清标记）
- Modify: `tests/server.test.js`
- Modify: `CLAUDE.md`（两处约定，见 Step 5）

**Interfaces:**
- Produces（`server/markers.js`，CommonJS）：
  ```js
  sha256Hex(text: string): string                         // UTF-8 SHA-256，小写 hex
  markerText(id: string, edge: 'start'|'end'|'point'): string   // start/point → `<!-- sc:${id} -->`，end → `<!-- /sc:${id} -->`
  validateInsertions(insertions: unknown, bodyLength: number): string | null   // 合法返回 null，否则返回错误信息
  //   合法 = 数组；每项 { offset: 0..bodyLength 的整数, edge: 'start'|'end'|'point' }；
  //   且恰好 [point] 一项，或恰好 start+end 各一项且 start.offset < end.offset
  applyInsertions(text: string, insertions: {offset:number, edge:string}[], id: string, base = 0): string
  //   按 offset 从大到小插入 markerText；base 加在每个 offset 上（文章的 frontmatter 长度）
  removeMarkers(text: string, id: string): string
  newMarkerId(text: string): string                       // crypto.randomBytes(4) hex，若 text 已含 `sc:${id}` 则重来
  writeFileAtomic(file: string, text: string): Promise<void>   // 唯一临时文件名 + rename
  ```
- Produces（HTTP）：`POST /api/tasks/:taskId/notes/:noteId/marker`，请求体 `{ baseHash: string, insertions: [{ offset, edge }] }`，成功 `200 { markerId, hash }`（`hash` 为写入后正文的哈希）。

**行为：**
- 定位文件：文章取 `resolveArticleFile(CONTENT_DIR, slug)`；视频取 `<WORK_DIR>/<taskId>/writing/<note.doc>.md`，评论没有 `doc` 时返回 400。
- 顺序：评论不存在 404 → 已有 `markerId` 返回 409 `{ error: 'already marked' }` → 读文件，文章用 `parseFrontmatter` 拆出正文（frontmatter 长度 = `raw.length - body.length`）→ 哈希不一致 409 `{ error: 'stale' }` → `validateInsertions` 不通过 400 → 生成编号、插入、`writeFileAtomic` → 评论写入 `markerId`（`writeJson`）→ 返回。
- 请求体里除 `baseHash`、`insertions` 外的字段一律忽略；标记文本只由 `markerText` 生成。
- 删除评论：评论有 `markerId` 时，按同样规则找到文件，`removeMarkers` 后内容有变化才写回；文件不存在则跳过。再删评论。没有 `markerId` 时不读、不写原文。

- [ ] **Step 1: 写失败的测试**（在 Notes 区块之后；文章用一个新 fixture `contentDir/marked.md`，内容 `'---\ntitle: M\n---\n\n第一段文字。\n\n第二段文字。\n'`；视频用已有 `taskId` 的 `writing/article.md`，另写一个 `writing/summary.md` 为 `'# S\n\n总结正文。\n'`）

```js
await test('marker: writes a point marker into an article, keeps frontmatter', async () => {
  // POST 一条评论 { anchor:'', prefix:'第一段', suffix:'文字。', position: 3, body:'p' }
  // body = GET /result/content 的文本；offset = body.indexOf('第一段') + 3
  // POST marker { baseHash: sha256Hex(body), insertions:[{ offset, edge:'point' }] } → 200，markerId 匹配 /^[0-9a-f]{8}$/
  // 文件内容 === '---\ntitle: M\n---\n\n第一段<!-- sc:ID -->文字。\n\n第二段文字。\n'
  // GET notes 里该评论 markerId === ID；返回的 hash === sha256Hex(新正文)
});
await test('marker: writes start/end markers into the video doc named by note.doc', async () => {
  // 评论 { anchor:'总结正文', doc:'summary', … }；insertions start/end 包住「总结正文」
  // writing/summary.md === '# S\n\n<!-- sc:ID -->总结正文<!-- /sc:ID -->。\n'；writing/article.md 不变
});
await test('marker: stale baseHash returns 409 and leaves the file untouched', async () => {});
await test('marker: invalid insertions return 400', async () => {
  // 逐个断言 400：offset 超过正文长度、-1、1.5；两个 point；只有 start；start.offset >= end.offset；edge:'x'；insertions 不是数组
});
await test('marker: marker text is generated by the server', async () => {
  // 请求体多带 { text: '<script>x</script>', id: 'deadbeef' } → 文件里只出现 /<!-- \/?sc:[0-9a-f]{8} -->/ 形式的新增内容，不含 script，编号不是 deadbeef（概率上）
});
await test('marker: a second write for the same note returns 409', async () => {});
await test('marker: video note without doc returns 400', async () => {});
await test('notes: DELETE removes only this note\'s markers', async () => {
  // 同一文章写入两条评论的标记 → 删除第一条 → 文件 === 只含第二条标记的版本，frontmatter 原样
});
await test('notes: DELETE of an unmarked note does not touch the source file', async () => {
  // 记下文件内容和 mtimeMs → 删一条没有 markerId 的评论 → 两者都不变
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `node tests/server.test.js`
Expected: 新用例 `✗`（404 或断言失败）。

- [ ] **Step 3: 实现 `server/markers.js` 和两个路由**（行为见上）

- [ ] **Step 4: 运行后端全部测试**

Run: `npm test`
Expected: 全部 `0 failed`。

- [ ] **Step 5: 改项目约定并提交**

`CLAUDE.md` 第 40 行和「Content formats → Articles」一条里「the article file itself is never moved, renamed, or modified」改为：

> the article file is never moved or renamed; Scholia only inserts and removes `<!-- sc:… -->` / `<!-- /sc:… -->` comment markers in it, nothing else.

视频部分补一句：`writing/{summary,article}.md` 同样只会被插入或删除 sc 标记。

```bash
git add server/markers.js server/index.js tests/server.test.js CLAUDE.md
git commit -m "feat(server): write and remove sc comment markers in source files"
```

---

### Task 2: 前端 API 与类型

**Files:**
- Modify: `web/src/lib/api.ts`

**Interfaces:**
- Produces：
  ```ts
  // NoteAnchor 新增
  markerId?: string;
  export type MarkerEdge = 'start' | 'end' | 'point';
  export interface MarkerInsertion { offset: number; edge: MarkerEdge }
  // api 新增
  addMarker: (taskId: string, noteId: string, data: { baseHash: string; insertions: MarkerInsertion[] }) =>
    Promise<{ markerId: string; hash: string }>;   // 走 request()，非 2xx 抛 Error('HTTP <status>: …')
  ```

- [ ] **Step 1: 加类型和 `addMarker`**（无单独测试，由 Task 6 的测试覆盖）

- [ ] **Step 2: 类型检查**

Run: `cd web && npx tsc --noEmit -p .`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/api.ts
git commit -m "feat(web): marker api and markerId on notes"
```

---

### Task 3: 渲染识别标记，目录和复制去掉标记

**Files:**
- Create: `web/src/lib/sc-marker.ts`
- Create: `web/src/lib/sc-marker.test.ts`
- Modify: `web/src/components/reader.tsx`（`MarkdownPreview` 传 `remarkPlugins`）
- Modify: `web/src/components/reader.test.tsx`
- Modify: `web/src/routes/tasks.$id.tsx`（`extractToc` 和复制按钮用去标记后的正文）
- Modify: `web/src/components/toc.test.tsx`

**Interfaces:**
- Produces：
  ```ts
  export const SC_MARKER_RE = /^<!--\s*(\/?)sc:([0-9a-f]{8})\s*-->$/;
  export function remarkScMarkers(): (tree: Root) => void;
  //   把匹配的 html 节点（行内或块级）替换为 { type: 'scMarker', data: { hName: 'span',
  //   hProperties: { dataScUi: '', dataScMarker: id, dataScEdge: 'open' | 'close' } }, children: [] }；
  //   其他 html 节点不动
  export function stripScMarkers(md: string): string;    // 全局去掉 <!--\s*\/?sc:[0-9a-f]{8}\s*-->
  ```
- `reader.tsx`：模块级常量 `const REMARK_PLUGINS = [remarkScMarkers];` 传给 `MarkdownPreview`（保持引用稳定）。

- [ ] **Step 1: 写失败的测试**

```ts
// sc-marker.test.ts
it('stripScMarkers removes all sc comments', () => {
  expect(stripScMarkers('a<!-- sc:3f9a2b1c -->b<!-- /sc:3f9a2b1c -->c<!-- other -->'))
    .toBe('abc<!-- other -->');
});

// reader.test.tsx
it('renders sc markers as hidden ui spans, not literal text', () => {
  const { container } = render(<Reader content={'hello <!-- sc:3f9a2b1c -->world<!-- /sc:3f9a2b1c -->'} />);
  const spans = container.querySelectorAll('span[data-sc-marker="3f9a2b1c"]');
  expect(spans).toHaveLength(2);
  expect(spans[0].getAttribute('data-sc-edge')).toBe('open');
  expect(spans[1].getAttribute('data-sc-edge')).toBe('close');
  expect(spans[0].hasAttribute('data-sc-ui')).toBe(true);
  expect(container.textContent).toBe('hello world');
});
it('leaves other html comments as before', () => {
  const { container } = render(<Reader content={'a <!-- note --> b'} />);
  expect(container.textContent).toContain('<!-- note -->');
});

// toc.test.tsx
it('toc ignores sc markers in headings', () => {
  expect(extractToc(stripScMarkers('## 标题<!-- sc:3f9a2b1c -->一'))[0].text).toBe('标题一');
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd web && npx vitest run src/lib/sc-marker.test.ts src/components/reader.test.tsx src/components/toc.test.tsx`
Expected: 新用例 FAIL。

- [ ] **Step 3: 实现**。插件用手写递归遍历 `children`（不新增 `unist-util-visit` 依赖）；替换为自定义节点类型后，`mdast-util-to-hast` 会按 `data.hName` / `hProperties` 生成空 `span`（原 session 已实测）。`tasks.$id.tsx`：`const toc = useMemo(() => extractToc(stripScMarkers(content)), [content]);`，复制按钮写入 `stripScMarkers(content)`。

- [ ] **Step 4: 前端全部测试**

Run: `cd web && npm test`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/sc-marker.ts web/src/lib/sc-marker.test.ts web/src/components/reader.tsx web/src/components/reader.test.tsx web/src/routes/tasks.\$id.tsx web/src/components/toc.test.tsx
git commit -m "feat(web): render sc markers as ui spans, strip them from toc and copy"
```

---

### Task 4: 定位第 0 步（按标记定位）

**Files:**
- Modify: `web/src/lib/text-index.ts`
- Modify: `web/src/lib/anchor.ts`
- Modify: `web/src/lib/anchor.test.ts`
- Modify: `web/src/components/reader.tsx`
- Modify: `web/src/components/reader.test.tsx`

**Interfaces:**
- Consumes: Task 3 的占位 `span[data-sc-marker][data-sc-edge]`。
- Produces：
  ```ts
  // text-index.ts
  export interface PlainIndex { text: string; blocks: { start: number; end: number }[] }   // TextIndex 结构上满足它
  export type MarkerMap = Map<string, { open?: number; close?: number }>;
  export function markerOffsets(index: TextIndex): MarkerMap;
  //   遍历 index.root 下的 span[data-sc-marker]，每个编号、每种端点只取文档顺序第一处，
  //   偏移用 boundaryToOffset(index, span.parentNode, span 在父节点中的下标)
  // anchor.ts：captureAnchor / locateAnchor / blockAt 的 index 参数放宽为 PlainIndex（行为不变）
  export function locateAnchor(index: PlainIndex, a: NoteAnchor, markers?: MarkerMap): Located | null;
  ```

**行为（第 0 步，在旧评论分支和第 1 步之前）：** `a.markerId` 存在且 `markers` 里有该编号时：
- 点评论（`anchorKind(a) === 'point'`）：取 `open ?? close`，返回 `{ start: p, end: p, grade: 'exact' }`。
- 选区评论：有 `open` 和 `close` 且 `open < close` → `{ open, close }`；只有 `open` → `end = min(open + anchor.length, text.length)`；只有 `close` → `start = max(close - anchor.length, 0)`。档位都是 `'exact'`。
- 其余情况继续走原来的步骤。
- `Reader` 的评论注入 effect 里先 `markerOffsets(index)`，再逐条 `locateAnchor(index, note, markers)`。

- [ ] **Step 1: 写失败的测试**

```ts
// anchor.test.ts（DOM 用 innerHTML 搭，span 带 data-sc-ui / data-sc-marker / data-sc-edge）
it('marker pair wins over text', () => {
  // <p>甲乙<span …marker=aaaaaaaa edge=open></span>丙丁<span …edge=close></span>戊</p>
  // note { anchor:'完全不同的旧文字', prefix:'x', suffix:'y', position:0, markerId:'aaaaaaaa' } → { start:2, end:4, grade:'exact' }
});
it('point marker locates a point note', () => {});
it('only open marker infers end from anchor length', () => {});
it('only close marker infers start', () => {});
it('first occurrence wins for duplicated marker ids', () => {});
it('unknown markerId falls back to text', () => {
  // markerId 在文中不存在 → 结果与不带 markerId 时相同
});

// reader.test.tsx
it('locates a note by its markers after the text changed', () => {
  const content = '前面<!-- sc:aaaaaaaa -->改过的原文<!-- /sc:aaaaaaaa -->后面';
  const notes = [{ id: 'm', anchor: '旧原文', prefix: '前面', suffix: '后面', position: 2, markerId: 'aaaaaaaa' }];
  const onNotesLocated = vi.fn();
  const { container } = render(<Reader content={content} notes={notes} onNotesLocated={onNotesLocated} />);
  expect(container.querySelector('mark.vdl-note-anchor')!.textContent).toBe('改过的原文');
  expect(onNotesLocated).toHaveBeenLastCalledWith({ m: { start: 2, end: 7, grade: 'exact' } });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd web && npx vitest run src/lib/anchor.test.ts src/components/reader.test.tsx`
Expected: 新用例 FAIL。

- [ ] **Step 3: 实现**（行为见上）

- [ ] **Step 4: 前端全部测试 + 类型检查**

Run: `cd web && npm test && npx tsc --noEmit -p .`
Expected: 全部 PASS（第 1、2 期的定位用例不变）。

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/text-index.ts web/src/lib/anchor.ts web/src/lib/anchor.test.ts web/src/components/reader.tsx web/src/components/reader.test.tsx
git commit -m "feat(web): locate notes by sc markers first"
```

---

### Task 5: 源文件索引与插入位置计算

**Files:**
- Create: `web/src/lib/source-anchor.ts`
- Create: `web/src/lib/source-anchor.test.ts`
- Create: `web/src/lib/sha256.ts`
- Create: `web/src/lib/sha256.test.ts`
- Modify: `web/package.json`（`npm i unified@^11.0.5 remark-parse@^11.0.0 remark-gfm@^4.0.1`，在 `web/` 下执行）

**Interfaces:**
- Consumes: Task 4 的 `PlainIndex`、`locateAnchor`；Task 2 的 `MarkerInsertion`；Task 3 的 `SC_MARKER_RE`。
- Produces：
  ```ts
  // sha256.ts
  export function sha256Hex(text: string): Promise<string>;   // crypto.subtle.digest('SHA-256', UTF-8)，小写 hex
  // source-anchor.ts
  export interface SourceSegment { start: number; text: string; srcStart: number; insertable: boolean }
  export interface SourceIndex extends PlainIndex { segments: SourceSegment[] }
  export function buildSourceIndex(md: string): SourceIndex;
  export function planMarkerInsertions(md: string, note: NoteAnchor): MarkerInsertion[] | null;
  export function applyLineStartRule(md: string, offset: number, edge: MarkerEdge): number;   // 步骤 4
  export function checkReparse(before: string, after: string, markerCount: number): boolean; // 步骤 5
  ```

**`buildSourceIndex` 规则**（要让它的 `text` 与浏览器里的文字索引一致，定位结果才可信）：
- 解析器：`unified().use(remarkParse).use(remarkGfm).parse(md)`。
- 块：`paragraph`、`heading`、`tableCell`、`code`（代码块）各是一个块；块之间插一个 `'\n'`，与第 1 期的文字索引规则相同。`listItem`、`blockquote` 本身不是块，它们里面的段落才是。
- 文字来源：`text`、`inlineCode`、`code` 的 `value`；不匹配 `SC_MARKER_RE` 的 `html` 节点按 `value` 计入（浏览器里它们显示成字面文字）；匹配的 sc 标记不计入；`break`、`image` 不计文字。
- `insertable`：只有 `text` 节点、且 `md.slice(node.position.start.offset, node.position.end.offset) === node.value` 时为 `true`；`srcStart` 为节点源文件起点。

**`planMarkerInsertions` 步骤：**
1. 无锚点（`anchorKind === 'none'`）→ `null`。
2. `locateAnchor(buildSourceIndex(md), note)`；不是 `'exact'` → `null`。
3. 把文字偏移换成源文件偏移：开头/点取「包含该偏移、且偏移 < 段尾」的段，结尾取「偏移 > 段首、且偏移 ≤ 段尾」的段；该段必须 `insertable`，否则 `null`。源偏移 = `srcStart + (offset - start)`。
4. 行首规则（见 Global Constraints）；「行首」= 偏移为 0 或 `md[offset-1] === '\n'`。
5. 用占位编号 `00000000` 在本地插入（顺序与后端 `applyInsertions` 相同），重新解析校验（见 Global Constraints）；不通过 → `null`。
6. 返回 `[{ offset, edge: 'point' }]` 或 `[{ offset: s, edge: 'start' }, { offset: e, edge: 'end' }]`，偏移是**插入前** `md` 里的位置。

- [ ] **Step 1: 写失败的测试**

```ts
// sha256.test.ts（文件首行 `// @vitest-environment node`，避免 jsdom 缺 crypto.subtle）
import { createHash } from 'node:crypto';
it('hashes utf-8 text the same way as the server', async () => {
  expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(await sha256Hex('中文\n正文')).toBe(createHash('sha256').update('中文\n正文', 'utf8').digest('hex'));
});

// source-anchor.test.ts
const range = (md: string, anchor: string) => ({ anchor, ...ctx(md, anchor) });  // 测试内辅助：按 md 里 anchor 第一处算 prefix/suffix/position（不跨块，32 字）
it('source index text matches the rendered text index', () => {
  // md = '# 标题\n\n第一段 **加粗** 和 [链接](u)。\n\n- 项一\n- 项二\n\n| a | b |\n|---|---|\n| 格 | x |'
  // buildSourceIndex(md).text === buildTextIndex(<Reader content={md}> 渲染出的 [data-sc-body]).text
});
it('point inside a paragraph', () => {
  // md='第一段文字。' note=点在「第一段」之后 → [{ offset: 3, edge: 'point' }]
});
it('range across bold keeps markers inline', () => {
  // md='前 **粗体字** 后' anchor='粗体字' → start/end 偏移分别落在 ** 之内
});
it('applyLineStartRule', () => {
  expect(applyLineStartRule('甲乙\n丙丁', 3, 'end')).toBe(2);     // 结尾在行首 → 上一行行尾
  expect(applyLineStartRule('甲乙\n丙丁', 3, 'start')).toBe(4);   // 开头在行首 → 后挪一字
  expect(applyLineStartRule('甲乙', 0, 'point')).toBe(1);
  expect(applyLineStartRule('甲乙\n丙丁', 1, 'start')).toBe(1);   // 不在行首不动
});
it('line-start rules keep block structure', () => {
  // 每种情况结果非 null，且按结果插入后 checkReparse 为 true：
  // 段首：'段首文字' 选 '段首' → [{offset:1,'start'},{offset:2,'end'}]
  // 列表项开头：'- 项目文字' 选 '项目' → start 偏移为 2（在 '- ' 之后，本来就不在行首）
  // 引用块开头：'> 引用文字' 选 '引用' → start 偏移为 2
  // 段内软换行：'第一行\n第二行文字' 选 '第二行' → start 偏移为 md.indexOf('第二行') + 1
});
it('aborts inside inline code and code blocks', () => {
  // 'a `code here` b' 选 'code' → null；'```\nx = 1\n```' 选 'x' → null
});
it('aborts on escaped text', () => {
  // 'a \\*b\\* c' 选 '*b*' → null（节点 value 与源片段不能逐字对应）
});
it('aborts when only an approximate match exists', () => {
  // 原文已改：anchor 不再原样出现 → null
});
it('checkReparse rejects a marker that becomes a block', () => {
  expect(checkReparse('甲\n\n乙', '甲\n\n<!-- sc:00000000 -->\n\n乙', 1)).toBe(false);   // 顶层块序列变了
  expect(checkReparse('甲乙', '<!-- sc:00000000 -->甲乙', 1)).toBe(false);                 // 行首标记成了 html 块
  expect(checkReparse('甲乙', '甲<!-- sc:00000000 -->乙', 1)).toBe(true);
  expect(checkReparse('**甲乙**', '**甲<!-- sc:00000000 -->乙**', 1)).toBe(true);          // 嵌在 strong 里也算行内
});
it('anchorless note → null', () => {});
```


- [ ] **Step 2: 运行，确认失败**

Run: `cd web && npx vitest run src/lib/source-anchor.test.ts src/lib/sha256.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**（规则与步骤见上）

- [ ] **Step 4: 运行，确认通过**

Run: `cd web && npx vitest run src/lib/source-anchor.test.ts src/lib/sha256.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/source-anchor.ts web/src/lib/source-anchor.test.ts web/src/lib/sha256.ts web/src/lib/sha256.test.ts web/package.json web/package-lock.json
git commit -m "feat(web): plan sc marker insertions on the markdown source"
```

---

### Task 6: 保存评论后写标记

**Files:**
- Create: `web/src/lib/marker-write.ts`
- Create: `web/src/lib/marker-write.test.ts`
- Modify: `web/src/hooks/use-tasks.ts`（`useAddNote` 的 `onSuccess`）

**Interfaces:**
- Consumes: Task 2 的 `api.addMarker`；Task 5 的 `planMarkerInsertions`、`sha256Hex`；`api.getContent`。
- Produces：
  ```ts
  export async function writeMarker(taskId: string, note: Note, md: string): Promise<boolean>;
  //   true = 写入成功；任何失败都返回 false，不抛错
  ```

**行为：**
- `planMarkerInsertions(md, note)` 为 `null` → `false`，不发请求。
- 发 `api.addMarker(taskId, note.id, { baseHash: await sha256Hex(md), insertions })`。
- 错误信息以 `HTTP 409: {"error":"stale"}` 开头时：`api.getContent(taskId, note.doc ?? 'article')` 拉新正文，重算插入位置和哈希，再试**一次**；仍失败返回 `false`。其他错误直接 `false`。
- `useAddNote` 的 `onSuccess(note)`：除原有的刷新评论外，若 `anchorKind(note) !== 'none'`，且（文章页，或视频评论带 `doc`），从缓存 `['task', taskId, 'content', note.doc ?? 'article']` 取正文，`void writeMarker(...).then((ok) => { if (ok) { 让该正文缓存和评论缓存失效 } })`。视频页判断：`taskId` 不以 `article-` 开头且 `note.doc` 为空 → 跳过。

- [ ] **Step 1: 写失败的测试**（`vi.spyOn(api, 'addMarker')` / `vi.spyOn(api, 'getContent')`）

```ts
const note = { id: 'n', anchor: '', prefix: '第一段', suffix: '文字。', position: 3, body: 'b', createdAt: 0, updatedAt: 0 };
it('writes a marker for an exact anchor', async () => {
  const add = vi.spyOn(api, 'addMarker').mockResolvedValue({ markerId: 'aaaaaaaa', hash: 'h' });
  expect(await writeMarker('article-x', note, '第一段文字。')).toBe(true);
  expect(add).toHaveBeenCalledWith('article-x', 'n', { baseHash: await sha256Hex('第一段文字。'), insertions: [{ offset: 3, edge: 'point' }] });
});
it('skips when there is no exact source position', async () => {
  const add = vi.spyOn(api, 'addMarker');
  expect(await writeMarker('article-x', note, '完全不同的内容')).toBe(false);
  expect(add).not.toHaveBeenCalled();
});
it('retries once after 409 with fresh content', async () => {
  const add = vi.spyOn(api, 'addMarker')
    .mockRejectedValueOnce(new Error('HTTP 409: {"error":"stale"}'))
    .mockResolvedValueOnce({ markerId: 'aaaaaaaa', hash: 'h' });
  vi.spyOn(api, 'getContent').mockResolvedValue('前言。\n\n第一段文字。');
  expect(await writeMarker('article-x', note, '第一段文字。')).toBe(true);
  expect(add).toHaveBeenLastCalledWith('article-x', 'n', expect.objectContaining({ insertions: [{ offset: 7, edge: 'point' }] }));
});
it('gives up after a second failure', async () => {});
it('other errors give up without retry', async () => {
  // HTTP 400 → false，addMarker 只被调用一次，getContent 未被调用
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd web && npx vitest run src/lib/marker-write.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `writeMarker` 并接入 `useAddNote`**

- [ ] **Step 4: 前端全部测试 + 构建**

Run: `cd web && npm test && npm run build`
Expected: 全部 PASS，构建成功。

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/marker-write.ts web/src/lib/marker-write.test.ts web/src/hooks/use-tasks.ts
git commit -m "feat(web): write source markers after a note is saved"
```

---

### Task 7: 整体验证与手动验收

**Files:** 仅 spec「未确认项汇总」表（写回 Obsidian 实测结论）。

- [ ] **Step 1: 全量测试与构建**

Run: `npm test && (cd web && npm test && npm run build)`
Expected: 后端全部 `0 failed`，前端全部 PASS，构建成功。

- [ ] **Step 2: 真实应用里走一遍**（用临时目录里的文章和视频副本，不碰真实数据）

1. 文章页新建一条选区评论、一条点评论：原文文件里出现对应的 `<!-- sc:… -->`（选区还有 `<!-- /sc:… -->`），页面上看不到标记文字，评论仍精确定位。
2. 在锚点所在段首、列表项、引用块、标题里各建一条：原文的段落结构不变（用编辑器或 `diff` 看），目录文字、复制出的内容不含标记。
3. 在行内代码里建一条点评论：原文不被改动，评论按文字定位。
4. 用编辑器改掉被评论的文字（保留标记）后刷新：卡片仍精确定位，不显示「原文已变化」。删掉标记后刷新：退回文字定位。
5. 删除一条带标记的评论：原文里只少了它的标记，其他字节不变。
6. 视频页在「总结」tab 建评论：标记写进 `writing/summary.md`，`article.md` 不变。

- [ ] **Step 3: Obsidian 并发编辑（需用户配合）**

在 Obsidian 里打开同一篇文章、处于编辑状态时，在 Scholia 里新建一条评论，观察 Obsidian 对外部修改的提示和合并行为。本机做不了时向用户要结果。把结论写进 spec「未确认项汇总」的「Obsidian 对外部修改的合并行为」一行。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-22-inline-comments-design.md
git commit -m "docs: record obsidian external-edit behavior for sc markers"
```
