# 正文内嵌评论 第 1 期（统一锚点 + 点评论）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 选区评论和点评论共用一个锚点模型（原文 + 段内前后文 + 位置 + 所在 tab）和一个定位函数；新增右键菜单和 `c` 键两个入口；正文标记和右栏卡片位置都改用新定位结果。本期不写原文、不做内嵌卡片。

**Architecture:** 新增两个纯前端模块。`text-index.ts` 把 Markdown 正文 DOM 转成"带段落边界的纯文本 + 偏移↔节点映射"；`anchor.ts` 在这份索引上做捕获（偏移 → 锚点）和定位（锚点 → 偏移 + 档位）。`Reader` 是唯一调用它们的组件，把定位结果通过回调交给页面，右栏只读这份结果和正文里带 `data-note-id` 的元素。服务端只是多存几个字段。

**Tech Stack:** React 19 + TypeScript + Vitest/jsdom（前端），Koa + node:assert（后端），新依赖 `approx-string-match@^2.0.1`。

**Spec:** `docs/superpowers/specs/2026-10-22-inline-comments-design.md`（第 1.1、1.2、2、3.1 中的步骤 1/2/3/5、3.2 节）

**分支：** spec 所在的 `doc/inline-comments-spec` 先合入 `staging`（需用户同意）；本期在 `feature/inline-comments-p1`（从 `staging` 切出）上实施。

## Global Constraints

- 前后文最多 32 个字（`CONTEXT_LEN = 32`，按 JS 字符串长度计），**不跨段落级元素**；原文最多 200 字（`ANCHOR_MAX = 200`）。
- 段落级元素之间在文字索引里统一插入一个 `'\n'`，原有空白不计入。
- 原文和前后文从文字索引按偏移截取，不再使用 `selection.toString()`。
- 近似查找：每侧最多允许 `Math.floor(len * 0.25)` 个错误，只接受不跨段落的匹配；选区两侧配对的间距上限为 `anchor.length + 200`。
- 档位只有 `'exact'` 和 `'approximate'`；定位失败返回 `null`（即"未定位"）。
- `notes.json` 只做增量字段（`prefix` / `suffix` / `position` / `doc`），不迁移旧数据；旧评论（只有 `anchor`）按"取第一处出现"定位，与现有行为一致。
- Scholia 插入的界面元素统一带属性 `data-sc-ui`，文字索引跳过其整个子树；文字索引的根是只包住 `MarkdownPreview` 的 `<div data-sc-body>`，不含 frontmatter 信息栏。
- 右键：按住 Shift 时不拦截，显示浏览器原生菜单。快捷键 `c`：无修饰键，焦点在 `INPUT` / `TEXTAREA` / contentEditable 内时不触发。
- 本期不改写原文文件，不新增内嵌卡片，Mode A 左栏行为不变。

## Review Focus

1. **代码块里的锚点**：`rehype-highlight` 会把代码拆成很多 `<span>`。在代码块里选区或插点，捕获和定位要落在同一个块里，且不跨块。→ Task 3 测试 `pre/code spans form one block`。
2. **表格单元格**：前后文必须止于单元格边界，不能读到相邻单元格。→ Task 3 测试 `td is its own block`，Task 4 测试 `context stops at table cell boundary`。
3. **点在界面元素上的右键或光标**：右键点在点评论图标（`data-sc-ui`）上，或光标落在图标内部时，偏移应等于图标所在位置，不能抛错或返回 `null`。→ Task 3 测试 `boundary inside data-sc-ui maps to its position`。
4. **视频页 tab 切换**：没有 `doc` 字段的旧评论在两个 tab 都尝试定位（现有行为）；有 `doc` 的只在对应 tab 显示；切换 tab 时丢弃尚未保存的"待写评论"。→ Task 5 测试 `legacy note without doc locates in any doc`，Task 7 测试 `switching tab clears draft`。
5. **选区一端在正文外**：选区从信息栏拖进正文，或者落在评论卡片里，不应产生锚点。→ Task 6 测试 `selection starting outside body yields no draft`。

---

### Task 1: 验证"单击后是否留下可读取的光标"

**Files:** 无代码改动；结果写回 spec 的"未确认项汇总"表。

- [ ] **Step 1: 在 Chrome 中验证**

运行 `cd web && npm run dev`（后端 `scholia serve` 需在跑），打开任意文章，在正文中单击一个字的中间（不拖动），然后在 DevTools 控制台执行：

```js
const s = getSelection(); [s.type, s.isCollapsed, s.anchorNode?.nodeName, s.anchorOffset]
```

Expected：`["Caret", true, "#text", <点击处的偏移>]` 表示可用；`["None", …]` 或 `anchorNode` 为 `null` 表示不可用。

- [ ] **Step 2: 在 Safari 中重复 Step 1**（若无法自动化，请用户手动执行并回报结果）

- [ ] **Step 3: 记录结论**

在 spec "未确认项汇总"表的第一行写上实测结果和日期。若任一浏览器不可用：Task 6 中 `c` 键只在选区非空时触发（测试 `c with collapsed selection does nothing` 替换 `c with caret creates point draft`）。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-22-inline-comments-design.md
git commit -m "docs: record caret-after-click verification result"
```

---

### Task 2: 服务端接收新锚点字段

**Files:**
- Modify: `server/index.js:334-347`（`POST /tasks/:taskId/notes`）
- Modify: `web/src/lib/api.ts:157-164, 259-263`（`Note` 类型与 `addNote` 参数）
- Modify: `web/src/hooks/use-tasks.ts:77-84`（`useAddNote` 参数类型）
- Test: `tests/server.test.js`（Notes CRUD 区块之后）

**Interfaces:**
- Produces（`web/src/lib/api.ts`）：
  ```ts
  export type NoteDoc = 'summary' | 'article';
  export interface NoteAnchor { anchor: string; prefix?: string; suffix?: string; position?: number; doc?: NoteDoc }
  export interface Note extends NoteAnchor { id: string; mediaTimestamp?: number; body: string; createdAt: number; updatedAt: number }
  addNote(taskId, data: Partial<NoteAnchor> & { mediaTimestamp?: number; body: string })
  ```
- Produces（HTTP）：`POST /api/tasks/:taskId/notes` 接受可选字段 `prefix`、`suffix`（字符串，长度 ≤ 32）、`position`（非负整数）、`doc`（`'summary' | 'article'`），任一非法时返回 400 `{ error }`。合法字段原样存储；未提供的字段不写入。

- [ ] **Step 1: 写失败的测试**

```js
await test('notes: POST stores anchor context fields', async () => {
  const r = await req(port, 'POST', `/api/tasks/${taskId}/notes`,
    { anchor: '', prefix: '前文', suffix: '后文', position: 12, doc: 'article', body: 'point' });
  assert.equal(r.status, 201);
  assert.equal(r.body.prefix, '前文');
  assert.equal(r.body.suffix, '后文');
  assert.equal(r.body.position, 12);
  assert.equal(r.body.doc, 'article');
  await req(port, 'DELETE', `/api/tasks/${taskId}/notes/${r.body.id}`);
});

await test('notes: POST without new fields stores none of them', async () => {
  const r = await req(port, 'POST', `/api/tasks/${taskId}/notes`, { anchor: 'x', body: 'legacy' });
  assert.equal(r.status, 201);
  for (const k of ['prefix', 'suffix', 'position', 'doc']) assert.ok(!(k in r.body), k);
  await req(port, 'DELETE', `/api/tasks/${taskId}/notes/${r.body.id}`);
});

await test('notes: POST rejects invalid anchor fields', async () => {
  const bad = [
    { prefix: 'x'.repeat(33) }, { suffix: 5 }, { position: -1 }, { position: 1.5 }, { doc: 'other' },
  ];
  for (const extra of bad) {
    const r = await req(port, 'POST', `/api/tasks/${taskId}/notes`, { anchor: '', body: 'b', ...extra });
    assert.equal(r.status, 400, JSON.stringify(extra));
  }
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node tests/server.test.js`
Expected：新增的 3 个用例为 `✗`（字段未存储，或返回 201 而非 400）。

- [ ] **Step 3: 实现**

在 POST handler 中，校验放在 `getPaths` 之前；只在字段 `!== undefined` 时写入 note 对象。同步更新 `api.ts` 和 `use-tasks.ts` 的类型（`useAddNote` 的 `mutationFn` 参数改为 `Partial<NoteAnchor> & { mediaTimestamp?: number; body: string }`）。

- [ ] **Step 4: 运行测试，确认通过**

Run: `node tests/server.test.js && (cd web && npx tsc --noEmit -p .)`
Expected：全部 `✓`；tsc 无错误。

- [ ] **Step 5: Commit**

```bash
git add server/index.js tests/server.test.js web/src/lib/api.ts web/src/hooks/use-tasks.ts
git commit -m "feat(server): store prefix/suffix/position/doc on notes"
```

---

### Task 3: 文字索引 `text-index.ts`

**Files:**
- Create: `web/src/lib/text-index.ts`
- Test: `web/src/lib/text-index.test.ts`

**Interfaces:**
- Produces：
  ```ts
  export const UI_ATTR = 'data-sc-ui';
  export interface TextBlock { start: number; end: number; el: HTMLElement }  // [start, end) in text, excluding separator
  export interface TextIndex { root: HTMLElement; text: string; blocks: TextBlock[]; segments: { node: Text; start: number }[] }
  export function buildTextIndex(root: HTMLElement): TextIndex
  export function blockAt(index: TextIndex, offset: number): TextBlock | null   // offset 落在 [start, end] 内的块；end 处也算该块
  export function offsetToPoint(index: TextIndex, offset: number): { node: Text; offset: number } | null
  export function boundaryToOffset(index: TextIndex, container: Node, offset: number): number | null  // 不在 root 内返回 null
  export function rangeToOffsets(index: TextIndex, range: Range): { start: number; end: number } | null
  export function caretRangeAt(x: number, y: number): Range | null  // 包装 caretPositionFromPoint / caretRangeFromPoint，都不存在时返回 null
  ```

**规则（测试未能完全确定的部分）：**
- **段落级元素**：`BLOCK = P, H1–H6, LI, BLOCKQUOTE, PRE, TD, TH, DT, DD, FIGCAPTION`。一个文本节点的所属块是离它最近的 `BLOCK` 祖先；没有这样的祖先时，以 `root` 作为它的块。
- **跳过的内容**：带 `UI_ATTR` 的元素子树、`svg` 子树。父元素是 `ROOT/DIV/SECTION/UL/OL/LI/BLOCKQUOTE/TABLE/THEAD/TBODY/TFOOT/TR` 的纯空白文本节点也跳过（这些是块与块之间的格式空白）。
- **分隔符**：相邻两个被收录的文本节点所属块不同时，在它们之间插入一个 `'\n'`。
- **`boundaryToOffset` 的映射**：
  - 边界在收录的文本节点内：返回该节点的起点加上节点内偏移。
  - 边界在元素上，或者在被跳过的子树里：返回文档顺序上该边界之后第一个收录文本节点的起点；后面没有收录节点时，返回 `text.length`。

- [ ] **Step 1: 写失败的测试**（用 `document.createElement('div')` + `innerHTML` 构造 DOM）

```ts
it('joins blocks with a single \\n and skips inter-block whitespace', () => {
  root.innerHTML = '<p>甲乙</p>\n<ul>\n<li>丙</li>\n<li><p>丁</p></li>\n</ul>';
  const ix = buildTextIndex(root);
  expect(ix.text).toBe('甲乙\n丙\n丁');
  expect(ix.blocks.map((b) => [b.start, b.end])).toEqual([[0, 2], [3, 4], [5, 6]]);
});
it('inline elements stay in the same block', () => {
  root.innerHTML = '<p>a <strong>b</strong> <a>c</a></p>';
  expect(buildTextIndex(root).text).toBe('a b c');
});
it('pre/code spans form one block', () => {
  root.innerHTML = '<pre><code><span>const</span> x = <span>1</span></code></pre><p>y</p>';
  const ix = buildTextIndex(root);
  expect(ix.text).toBe('const x = 1\ny');
  expect(ix.blocks).toHaveLength(2);
});
it('td is its own block', () => {
  root.innerHTML = '<table><tbody><tr><td>左</td><td>右</td></tr></tbody></table>';
  expect(buildTextIndex(root).text).toBe('左\n右');
});
it('skips data-sc-ui subtrees and svg', () => {
  root.innerHTML = '<p>前<span data-sc-ui>图标</span>后</p><svg><text>t</text></svg>';
  expect(buildTextIndex(root).text).toBe('前后');
});
it('boundary inside data-sc-ui maps to its position', () => {
  root.innerHTML = '<p>前<span data-sc-ui>图标</span>后</p>';
  const ix = buildTextIndex(root);
  const icon = root.querySelector('[data-sc-ui]')!;
  expect(boundaryToOffset(ix, icon.firstChild!, 1)).toBe(1);
});
it('offsetToPoint and rangeToOffsets round-trip across a <strong>', () => {
  root.innerHTML = '<p>ab<strong>cd</strong>ef</p>';
  const ix = buildTextIndex(root);
  const s = offsetToPoint(ix, 1)!, e = offsetToPoint(ix, 5)!;
  const r = document.createRange(); r.setStart(s.node, s.offset); r.setEnd(e.node, e.offset);
  expect(rangeToOffsets(ix, r)).toEqual({ start: 1, end: 5 });
});
it('boundary outside root returns null', () => {
  const other = document.createTextNode('x');
  expect(boundaryToOffset(buildTextIndex(root), other, 0)).toBeNull();
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd web && npx vitest run src/lib/text-index.test.ts`
Expected：FAIL（模块不存在）。

- [ ] **Step 3: 实现 `text-index.ts`**（按上面的规则；用 `TreeWalker(SHOW_TEXT)` 配合 filter 跳过子树）

- [ ] **Step 4: 运行，确认通过**

Run: `cd web && npx vitest run src/lib/text-index.test.ts`
Expected：PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/text-index.ts web/src/lib/text-index.test.ts
git commit -m "feat(web): add block-aware text index over rendered markdown"
```

---

### Task 4: 锚点捕获与定位 `anchor.ts`

**Files:**
- Create: `web/src/lib/anchor.ts`
- Test: `web/src/lib/anchor.test.ts`
- Modify: `web/package.json`（`npm i approx-string-match@^2.0.1`，在 `web/` 下执行）

**Interfaces:**
- Consumes：Task 2 的 `NoteAnchor` / `NoteDoc`；Task 3 的 `TextIndex`、`blockAt`。
- Produces：
  ```ts
  export const CONTEXT_LEN = 32;
  export const ANCHOR_MAX = 200;
  export type AnchorKind = 'range' | 'point' | 'none';
  export type Grade = 'exact' | 'approximate';
  export interface Located { start: number; end: number; grade: Grade }   // 点：start === end
  export function anchorKind(a: Pick<NoteAnchor, 'anchor' | 'prefix' | 'suffix'>): AnchorKind
  export function captureAnchor(index: TextIndex, start: number, end: number, doc?: NoteDoc): NoteAnchor
  export function locateAnchor(index: TextIndex, a: NoteAnchor): Located | null
  ```

**`captureAnchor` 规则：**
1. 先去掉 `[start, end)` 两端的空白字符（包括分隔符 `'\n'`）。去完变成空、且原本不是一个点时，按点处理，点的位置取原始的 `start`。
2. 原文超过 `ANCHOR_MAX` 时截断，`end` 随之改为 `start + ANCHOR_MAX`。
3. `prefix` 从 `start` 往前取，最多 `CONTEXT_LEN` 个字，且不超过 `blockAt(start)` 那个块的起点。
4. `suffix` 从 `end` 往后取，最多 `CONTEXT_LEN` 个字，且不超过 `blockAt(end)` 那个块的终点。
5. `position = start`。`doc` 原样带上；未传时不写这个字段。

**`locateAnchor` 规则（实现 spec 第 1.2 节）：**
- **一侧"吻合"**：
  - 存的一侧非空：候选紧邻的同侧文字（只在候选所属块内截取）与它完全相等。
  - 存的一侧为空：只有候选在这一侧恰好是块边界才算吻合。
- **边界加分**：存的一侧长度小于 `CONTEXT_LEN`，说明当时这一侧碰到了块边界。如果候选从这一侧往外数满这个长度后恰好也到块边界（即前文起点是块起点，或后文终点是块终点），打分加 0.5；同侧吻合计 1 分。
- **旧评论**：没有 `prefix`、`suffix`、`position` 时，先把 `anchor` 里含换行的空白串（`/\s*\n\s*/g`）替换为单个 `'\n'`，再取第一处出现，档位为 `exact`；找不到时返回 `null`。
- **第 1 步：选区评论**：`anchor` 每个原样出现的位置都是候选。打分 = 吻合侧数（含边界加分），取最高分；分数相同时，取离 `position` 最近的。结果为 `exact`。
- **第 1 步：点评论**：候选点有两类，一是 `prefix` 原样出现处的终点，二是 `suffix` 原样出现处的起点。所有非空侧都吻合才命中，多处命中时取离 `position` 最近的。结果为 `exact`。
- **第 2 步：两侧分别近似查找**：
  - `prefix` 和 `suffix` 各自调用 `search(index.text, side, Math.floor(side.length * 0.25))`，丢弃跨块的匹配。按"误差最小，其次离 `position` 最近"挑出每侧的最佳匹配。
  - **配对**：后文的候选优先选与前文同块且在其之后的那个。同块、后文起点 ≥ 前文终点、且间距 ≤ `anchor.length + 200` 时，范围取 `[P.end, S.start]`；点评论在这种情况下取 `P.end`。
  - **单侧**：否则以误差更小的一侧为准（误差相同时选前文）。以前文为准时，范围是 `[P.end, min(P.end + anchor.length, 块终点)]`；以后文为准时，范围是 `[max(S.start - anchor.length, 块起点), S.start]`。
  - 结果为 `approximate`。
- **第 3 步：按位置兜底**：`position` 不超过 `text.length` 时，返回 `{ start: position, end: position, grade: 'approximate' }`。
- 以上都不满足时返回 `null`。

- [ ] **Step 1: 写失败的测试**（用 Task 3 的 `buildTextIndex` 构造索引；`ix(html)` 是测试内的辅助函数）

```ts
describe('anchorKind', () => {
  it('classifies', () => {
    expect(anchorKind({ anchor: 'a' })).toBe('range');
    expect(anchorKind({ anchor: '', prefix: 'p' })).toBe('point');
    expect(anchorKind({ anchor: '' })).toBe('none');
  });
});

describe('captureAnchor', () => {
  it('context stops at block boundary', () => {
    const i = ix('<p>第一段文字</p><p>第二段开头再往后</p>');
    const s = i.text.indexOf('开头');
    expect(captureAnchor(i, s, s + 2)).toEqual({ anchor: '开头', prefix: '第二段', suffix: '再往后', position: s });
  });
  it('context stops at table cell boundary', () => {
    const i = ix('<table><tbody><tr><td>左边</td><td>右边</td></tr></tbody></table>');
    expect(captureAnchor(i, 3, 4)).toMatchObject({ anchor: '右', prefix: '', suffix: '边' });
  });
  it('point at paragraph end has empty suffix', () => {
    const i = ix('<p>段尾</p><p>下一段</p>');
    expect(captureAnchor(i, 2, 2)).toEqual({ anchor: '', prefix: '段尾', suffix: '', position: 2 });
  });
  it('trims whitespace/separator and truncates to 200', () => {
    const long = 'x'.repeat(250);
    const i = ix(`<p>a</p><p>${long}</p>`);
    const a = captureAnchor(i, 1, i.text.length);
    expect(a.anchor).toBe('x'.repeat(200));
    expect(a.prefix).toBe('');
    expect(a.suffix).toBe('x'.repeat(32));
  });
  it('passes doc through', () => {
    expect(captureAnchor(ix('<p>ab</p>'), 0, 1, 'summary').doc).toBe('summary');
  });
});

describe('locateAnchor', () => {
  it('exact: picks the occurrence whose context matches', () => {
    const i = ix('<p>甲 重复句 乙</p><p>丙 重复句 丁</p>');
    const second = i.text.lastIndexOf('重复句');
    expect(locateAnchor(i, { anchor: '重复句', prefix: '丙 ', suffix: ' 丁', position: 0 }))
      .toEqual({ start: second, end: second + 3, grade: 'exact' });
  });
  it('exact: ties broken by position', () => {
    const i = ix('<p>重复</p><p>重复</p>');
    expect(locateAnchor(i, { anchor: '重复', prefix: '', suffix: '', position: 3 })!.start).toBe(3);
  });
  it('exact: adjacent paragraph edited still matches', () => {
    const before = captureAnchor(ix('<p>评论这句话。</p><p>旁边段落</p>'), 2, 5);
    expect(locateAnchor(ix('<p>评论这句话。</p><p>旁边段落被大改了</p>'), before)!.grade).toBe('exact');
  });
  it('approximate: anchor text edited, both sides fuzzy-found', () => {
    const i = ix('<p>前面这一段上下文很长很长 被改过的原文 后面这一段上下文也很长</p>');
    const r = locateAnchor(i, { anchor: '原来的原文', prefix: '前面这一段上下文很长很长 ', suffix: ' 后面这一段上下文也很长', position: 13 })!;
    expect(i.text.slice(r.start, r.end)).toBe('被改过的原文');
    expect(r.grade).toBe('approximate');
  });
  it('point: both sides exact', () => {
    const i = ix('<p>插入点之前|插入点之后</p>');
    expect(locateAnchor(i, { anchor: '', prefix: '插入点之前', suffix: '|插入点之后', position: 0 }))
      .toEqual({ start: 5, end: 5, grade: 'exact' });
  });
  it('point: one side exact, other changed → approximate', () => {
    const i = ix('<p>插入点之前改过的后文内容</p>');
    const r = locateAnchor(i, { anchor: '', prefix: '插入点之前', suffix: '原来的后文内容', position: 5 })!;
    expect(r).toMatchObject({ start: 5, end: 5, grade: 'approximate' });
  });
  it('fuzzy matches never cross blocks', () => {
    const i = ix('<p>上下文前</p><p>半上下文后半</p>');
    const r = locateAnchor(i, { anchor: '', prefix: '文前半上下', suffix: '', position: 99 });
    expect(r).toBeNull();
  });
  it('falls back to position', () => {
    const i = ix('<p>全部重写后的文字没有任何相似之处</p>');
    expect(locateAnchor(i, { anchor: 'abc', prefix: 'xyzxyz', suffix: 'qrsqrs', position: 4 }))
      .toEqual({ start: 4, end: 4, grade: 'approximate' });
  });
  it('legacy anchor: first occurrence, \\n\\n normalized', () => {
    const i = ix('<p>第一段</p><p>第二段</p>');
    expect(locateAnchor(i, { anchor: '第一段\n\n第二段' })).toEqual({ start: 0, end: 7, grade: 'exact' });
    expect(locateAnchor(i, { anchor: '不存在' })).toBeNull();
  });
});
```

（注：`fuzzy matches never cross blocks` 里，`position: 99` 大于 `text.length`，所以第 3 步也不会命中，结果为 `null`。）

- [ ] **Step 2: 运行，确认失败**

Run: `cd web && npx vitest run src/lib/anchor.test.ts`
Expected：FAIL（模块不存在）。

- [ ] **Step 3: 安装依赖并实现 `anchor.ts`**

Run: `cd web && npm i approx-string-match@^2.0.1`（默认导出 `search(text, pattern, maxErrors) => { start, end, errors }[]`）。

- [ ] **Step 4: 运行，确认通过**

Run: `cd web && npx vitest run src/lib/anchor.test.ts src/lib/text-index.test.ts`
Expected：PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/anchor.ts web/src/lib/anchor.test.ts web/package.json web/package-lock.json
git commit -m "feat(web): capture and locate anchors with in-block context"
```

---

### Task 5: `Reader` 改用文字索引注入标记与点评论图标

**Files:**
- Modify: `web/src/components/reader.tsx`（`ReaderProps`、`injectAnchorMarks`、高亮和评论两个注入 effect、`<article>` 结构）
- Modify: `web/src/styles/globals.css`（在 `mark.vdl-note-anchor` 样式旁新增 `.vdl-note-point`）
- Test: `web/src/components/reader.test.tsx`

**Interfaces:**
- Consumes：Task 3 的 `buildTextIndex`、`offsetToPoint`、`UI_ATTR`；Task 4 的 `locateAnchor`、`Located`。
- Produces（`ReaderProps` 的变化，其余 props 不变）：
  ```ts
  doc?: NoteDoc;                                   // 视频页传当前 tab；文章页不传
  notes?: (Pick<Note, 'id'> & NoteAnchor)[];
  onNotesLocated?: (located: Record<string, Located>) => void;  // 每次注入后调用；未定位的 id 不出现在结果里
  ```
- Produces（DOM 约定，Task 7 依赖）：
  - 选区评论：`mark.vdl-note-anchor[data-note-id]`，与现在相同。
  - 点评论：`span.vdl-note-point[data-sc-ui][data-note-id]`，里面放一个约 12px 的内联 SVG 气泡图标，不含任何文字。
  - 两者都挂上与现在相同的 `mouseenter`、`mouseleave`、`click` 回调，并参与 `is-linked` 联动。

**实现要点：**
- **正文结构**：`MarkdownPreview` 外面包一层 `<div data-sc-body ref={bodyRef}>`，所有索引都以 `bodyRef` 为根建立。`MarkdownPreview` 加上 `key={md}`（spec 第 3.2 节）。
- **标记注入函数**：`injectAnchorMarks` 改为接收偏移范围，签名为 `(root, items: { id, start, end }[], markClass, decorate)`。每处理一项前都重新 `buildTextIndex`，因为包标记会切分文本节点，但文字内容不变，偏移依然有效。
- **高亮**：每条高亮在 `index.text.indexOf(anchor)` 处转换成范围，行为与现在一致。
- **评论**：
  - `doc` 有值、且评论的 `doc` 有值但与之不同时，跳过这条评论。
  - 其余评论调用 `locateAnchor`：得到范围时画标记；得到的是点时插入图标。
  - 所有结果汇总后调用 `onNotesLocated`。
- **点评论图标样式**：颜色用 `var(--text-tertiary)`，`.is-linked` 时用 `var(--accent-9)`，`cursor: pointer`，加 `vertical-align` 让它与文字基线对齐。

- [ ] **Step 1: 写失败的测试**（新增到 `reader.test.tsx`；已有的 4 个高亮和评论用例保持不动，必须仍然通过）

```ts
describe('Reader unified anchors', () => {
  const content = '第一段有个观点在这里。\n\n第二段。';
  it('renders a point icon for a point note', () => {
    const notes = [{ id: 'p1', anchor: '', prefix: '有个观点', suffix: '在这里。', position: 7 }];
    const { container } = render(<Reader content={content} notes={notes} />);
    const icon = container.querySelector('span.vdl-note-point[data-note-id="p1"]');
    expect(icon).not.toBeNull();
    expect(icon!.hasAttribute('data-sc-ui')).toBe(true);
    expect(icon!.textContent).toBe('');
  });
  it('reports located results with grades', () => {
    const onNotesLocated = vi.fn();
    const notes = [
      { id: 'a', anchor: '观点' },
      { id: 'b', anchor: '找不到的文字' },
    ];
    render(<Reader content={content} notes={notes} onNotesLocated={onNotesLocated} />);
    const last = onNotesLocated.mock.calls.at(-1)![0];
    expect(last.a.grade).toBe('exact');
    expect(last.b).toBeUndefined();
  });
  it('skips notes whose doc differs from current doc', () => {
    const notes = [{ id: 'a', anchor: '观点', doc: 'summary' as const }];
    const { container } = render(<Reader content={content} doc="article" notes={notes} />);
    expect(container.querySelector('mark.vdl-note-anchor')).toBeNull();
  });
  it('legacy note without doc locates in any doc', () => {
    const { container } = render(<Reader content={content} doc="summary" notes={[{ id: 'a', anchor: '观点' }]} />);
    expect(container.querySelector('mark.vdl-note-anchor')).not.toBeNull();
  });
  it('marks a legacy cross-paragraph anchor', () => {
    const notes = [{ id: 'x', anchor: '在这里。\n\n第二段' }];
    const { container } = render(<Reader content={content} notes={notes} />);
    expect(container.querySelectorAll('mark.vdl-note-anchor[data-note-id="x"]').length).toBeGreaterThan(0);
  });
  it('frontmatter meta bar text is not matchable', () => {
    const { container } = render(<Reader content="正文" frontmatter={{ author: '作者名' }} notes={[{ id: 'm', anchor: '作者名' }]} />);
    expect(container.querySelector('mark.vdl-note-anchor')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd web && npx vitest run src/components/reader.test.tsx`
Expected：新用例 FAIL，已有用例 PASS。

- [ ] **Step 3: 实现**（按上面的实现要点）

- [ ] **Step 4: 运行，确认通过**

Run: `cd web && npx vitest run src/components/reader.test.tsx`
Expected：全部 PASS（含原有 4 个标记用例和 mermaid 用例）。

- [ ] **Step 5: Commit**

```bash
git add web/src/components/reader.tsx web/src/components/reader.test.tsx web/src/styles/globals.css
git commit -m "feat(web): inject note marks and point icons via text index"
```

---

### Task 6: 三个创建入口（选区气泡、右键菜单、`c` 键）

**Files:**
- Modify: `web/src/components/reader.tsx`（`handleNoteClick`、`handleContextMenu`、右键菜单的渲染、新增 keydown effect）
- Test: `web/src/components/reader.test.tsx`

**Interfaces:**
- Consumes：Task 3 的 `rangeToOffsets`、`caretRangeAt`；Task 4 的 `captureAnchor`。
- Produces：`ReaderProps` 中用 `onCommentDraft?: (a: NoteAnchor) => void` **取代** `onAnchorSelect`。三个入口都通过它产出锚点，产出前都要用 `captureAnchor(index, start, end, doc)` 生成锚点。

**行为：**
- **气泡里的评论按钮**：在 `mouseUp` 时，同时记下选区的 `rangeToOffsets` 结果。选区不在 `data-sc-body` 内（返回 `null`）时，不弹出气泡。点击按钮时调用 `onCommentDraft`。
- **右键**：
  - 按住 `e.shiftKey` 时直接返回，不拦截。
  - 目标在 `data-sc-body` 内：先 `preventDefault`，再确定范围。当前选区非空、且 `caretRangeAt(e.clientX, e.clientY)` 落在选区内时，用这个选区；否则用这个光标点，得到一个点。然后弹出菜单，菜单项是"在此处评论"，点在 `mark.vdl-hl` 上时再加一项"删除高亮"。
  - 目标不在正文内、但在高亮上：保持现有的只显示"删除高亮"的菜单。
  - 其他情况：不拦截。
- **`c` 键**：在 `document` 上监听 `keydown`。满足以下全部条件时，按当前选区（可以是收起的光标）调用 `onCommentDraft`，并 `preventDefault`：
  - `e.key === 'c'`，且没有按 meta、ctrl、alt
  - 焦点不在输入框、文本框或 contentEditable 里
  - 选区在正文内

- [ ] **Step 1: 写失败的测试**

```ts
describe('Reader comment entry points', () => {
  const content = '第一段有个观点在这里。';
  const bodyText = (c: HTMLElement) => c.querySelector('[data-sc-body] p')!.firstChild as Text;

  it('right-click shows 在此处评论 and yields a point draft', async () => {
    const onCommentDraft = vi.fn();
    const { container, getByText } = render(<Reader content={content} onCommentDraft={onCommentDraft} />);
    const t = bodyText(container);
    document.caretRangeFromPoint = () => { const r = document.createRange(); r.setStart(t, 4); r.collapse(true); return r; };
    fireEvent.contextMenu(t.parentElement!, { clientX: 10, clientY: 10 });
    fireEvent.click(getByText('在此处评论'));
    expect(onCommentDraft).toHaveBeenCalledWith({ anchor: '', prefix: '第一段有', suffix: '个观点在这里。', position: 4 });
  });
  it('shift+right-click is not intercepted', () => {
    const { container } = render(<Reader content={content} onCommentDraft={vi.fn()} />);
    const ev = createEvent.contextMenu(bodyText(container).parentElement!, { shiftKey: true });
    fireEvent(bodyText(container).parentElement!, ev);
    expect(ev.defaultPrevented).toBe(false);
  });
  it('c with caret creates point draft', () => {
    const onCommentDraft = vi.fn();
    const { container } = render(<Reader content={content} onCommentDraft={onCommentDraft} />);
    getSelection()!.collapse(bodyText(container), 4);
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(onCommentDraft).toHaveBeenCalledWith(expect.objectContaining({ anchor: '', position: 4 }));
  });
  it('c with a selection creates range draft', () => {
    const onCommentDraft = vi.fn();
    const { container } = render(<Reader content={content} onCommentDraft={onCommentDraft} />);
    getSelection()!.setBaseAndExtent(bodyText(container), 4, bodyText(container), 6);
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(onCommentDraft).toHaveBeenCalledWith(expect.objectContaining({ anchor: '个观' }));
  });
  it('c inside a textarea does nothing', () => {
    const onCommentDraft = vi.fn();
    const { container } = render(<><Reader content={content} onCommentDraft={onCommentDraft} /><textarea /></>);
    getSelection()!.collapse(bodyText(container), 4);
    fireEvent.keyDown(container.querySelector('textarea')!, { key: 'c' });
    expect(onCommentDraft).not.toHaveBeenCalled();
  });
  it('selection starting outside body yields no draft', () => {
    const onCommentDraft = vi.fn();
    const { container } = render(<Reader content={content} frontmatter={{ author: '作者' }} onCommentDraft={onCommentDraft} />);
    const meta = container.querySelector('article > :first-child')!;   // ArticleMetaBar 根元素，位于 data-sc-body 之外
    getSelection()!.setBaseAndExtent(meta, 0, bodyText(container), 3);
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(onCommentDraft).not.toHaveBeenCalled();
  });
});
```

（`afterEach` 中删除 `document.caretRangeFromPoint`，并调用 `getSelection()?.removeAllRanges()`。）

- [ ] **Step 2: 运行，确认失败**

Run: `cd web && npx vitest run src/components/reader.test.tsx`
Expected：新用例 FAIL。

- [ ] **Step 3: 实现**（行为见上；气泡按钮的 `title` 改为"评论"）

- [ ] **Step 4: 运行，确认通过**

Run: `cd web && npx vitest run src/components/reader.test.tsx`
Expected：PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/components/reader.tsx web/src/components/reader.test.tsx
git commit -m "feat(web): comment entry via bubble, context menu and c key"
```

---

### Task 7: 页面与右栏接入（待写评论、定位结果、近似提示）

**Files:**
- Modify: `web/src/routes/tasks.$id.tsx`（`pendingAnchor` 换成 `draft`，向 `Reader` 传 `doc`、`onCommentDraft`、`onNotesLocated`，向 `NotesPanel` 传 `located`）
- Modify: `web/src/components/notes-panel.tsx`（props、锚点标签、提交、定位、`NoteItem` 加近似提示；删除 `resolveAnchorY`）
- Test: `web/src/components/notes-panel.test.tsx`、新建 `web/src/routes/tasks.$id.test.tsx`（若路由级测试的搭建成本过高，可把 `switching tab clears draft` 改为对 `tasks.$id.tsx` 中抽出的 `useDraftForTab(tab)` 小 hook 做测试）

**Interfaces:**
- Consumes：Task 4 的 `Located`、`anchorKind`；Task 5 的 `onNotesLocated` 和 DOM 约定（`[data-note-id]`）；Task 6 的 `onCommentDraft`。
- Produces（`NotesPanelProps` 的变化）：
  ```ts
  pendingAnchor?: NoteAnchor | null;      // 取代原来的 string
  located?: Record<string, Located>;
  ```
  - `NoteItem` 新增 prop `approximate?: boolean`。

**行为：**
- **页面状态**：`tasks.$id.tsx` 持有 `draft: NoteAnchor | null` 和 `located: Record<string, Located>`。
  - `doc` 的取值：文章页为 `undefined`，视频页为当前的 `tab`。
  - 切换 `tab` 时清空 `draft`。
- **锚点标签**：选区评论显示 `锚点：{anchor 前 40 字}…`（与现在相同）；点评论显示 `插入点：…{prefix 最后 12 字}`；`prefix` 为空时改用 `插入点：{suffix 前 12 字}…`。
- **提交**：`addNote.mutate({ ...pendingAnchor, body, mediaTimestamp? })`；没有待写评论时只提交 `anchor: ''`，与现在一致。
- **右栏排布**：
  - 定位结果里有这条评论时：它的纵向位置取正文中第一个 `[data-note-id="<id>"]` 元素所在段落级祖先的 `top`（往上找祖先的规则与原 `resolveAnchorY` 相同），然后照旧交给 `computePositions` 排布。
  - 不在定位结果里的评论（包括无锚点的、未定位的），放进顶部普通列表。
  - 定位档位为 `approximate` 的卡片，在正文上方显示一行小字"原文已变化"，颜色用 `var(--text-tertiary)`。
- **Mode A 左栏**：左栏的 `NotesPanel` 不传 `located`，所以所有评论都会进入普通列表。现在这些评论按位置 0 叠在一起，改动后变成正常的列表排列，这一点要在 PR 描述中说明。

- [ ] **Step 1: 写失败的测试**

```ts
// notes-panel.test.tsx
it('NoteItem shows 原文已变化 when approximate', () => {
  const { getByText } = render(<NoteItem note={note} approximate onUpdate={() => {}} onDelete={() => {}}
    onHeightChange={() => {}} isLinked={false} onHover={() => {}} autoEdit={false} onAutoEditConsumed={() => {}} />);
  expect(getByText('原文已变化')).toBeInTheDocument();
});

// 测试内辅助 renderWithClient(ui)：用 new QueryClient({ defaultOptions: { queries: { retry: false } } }) 包一层 QueryClientProvider 再 render
// 默认用 vi.spyOn(api, 'listNotes').mockResolvedValue([])；用 vi.spyOn(api, 'addNote') 捕获请求
it('point draft shows 插入点 chip and submits context fields', async () => {
  const add = vi.spyOn(api, 'addNote').mockResolvedValue({} as Note);
  const pending = { anchor: '', prefix: '这是前文最后十二个字符号', suffix: '后文', position: 9 };
  const { getByText, getByPlaceholderText } = renderWithClient(
    <NotesPanel taskId="t" hasMedia={false} pendingAnchor={pending} onAnchorConsumed={() => {}} />);
  expect(getByText(/插入点：…这是前文最后十二个字符号/)).toBeInTheDocument();
  fireEvent.change(getByPlaceholderText('写下笔记…'), { target: { value: '想法' } });
  fireEvent.click(getByText('保存'));
  await waitFor(() => expect(add).toHaveBeenCalledWith('t', expect.objectContaining({ ...pending, body: '想法' })));
});

it('unlocated anchored notes render in the top list', async () => {
  vi.spyOn(api, 'listNotes').mockResolvedValue([{ ...note, id: 'u', anchor: '某段文字' }]);
  const { findByText, container } = renderWithClient(<NotesPanel taskId="t" hasMedia={false} located={{}} />);
  await findByText(note.body);
  expect(container.querySelector('[style*="position: absolute"]')).toBeNull();
});

// tasks.$id.test.tsx（或 useDraftForTab 的 hook 测试）
it('switching tab clears draft', () => { /* 设置 draft → 切换 tab → draft 为 null */ });
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd web && npx vitest run src/components/notes-panel.test.tsx src/routes`
Expected：新用例 FAIL。

- [ ] **Step 3: 实现**（行为见上；删除已不再使用的 `resolveAnchorY`）

- [ ] **Step 4: 运行全部前端测试并做类型检查**

Run: `cd web && npm test && npx tsc --noEmit -p .`
Expected：全部 PASS，没有类型错误（`onAnchorSelect` 的引用已全部替换）。

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/tasks.\$id.tsx web/src/components/notes-panel.tsx web/src/components/notes-panel.test.tsx web/src/routes
git commit -m "feat(web): wire unified anchors into task page and notes panel"
```

---

### Task 8: 整体验证与性能实测

**Files:** 仅当实测结论需要写回时，修改 spec 的"未确认项汇总"表。

- [ ] **Step 1: 全量测试与构建**

Run: `npm test && (cd web && npm test && npm run build)`
Expected：后端全部 `✓`，前端全部 PASS，`web/dist/` 构建成功。

- [ ] **Step 2: 在真实应用里走一遍**（`scholia serve --open`，或开发服务器）

按顺序检查：
1. 选区评论：通过气泡创建，卡片对齐到对应段落。
2. 点评论：右键"在此处评论"、单击后按 `c` 各创建一条，正文里出现图标，右栏卡片对齐。
3. 按住 Shift 右键，弹出的是原生菜单。
4. 在 Obsidian 里改动被评论的文字后刷新页面，卡片显示"原文已变化"。
5. 视频页切换总结和文章两个 tab，新评论只在自己所在的 tab 显示。

- [ ] **Step 3: 性能实测**

找出 `CONTENT_DIR` 下最大的 `.md` 文件（`find ~/knowledge/articles -name '*.md' -print0 | xargs -0 ls -S | head -1`），在其中创建约 30 条评论（可以直接往它的 `notes.json` 里写测试数据，测完删除），在 `Reader` 的注入 effect 前后用 `performance.now()` 计时（临时代码，不提交）。Expected：单次注入 < 100ms。把结论写进 spec 的"未确认项汇总"表。

- [ ] **Step 4: Commit**（如果修改了 spec）

```bash
git add docs/superpowers/specs/2026-10-22-inline-comments-design.md
git commit -m "docs: record phase-1 locate performance measurement"
```
