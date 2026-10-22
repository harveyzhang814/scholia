# 正文内嵌评论 第 2 期（内嵌卡片视图）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 评论以横向长卡片的形式插在锚点所在段落下方，可单卡或全部收起/展开；正文开头有"未定位评论"区；"内嵌 / 右栏"两种视图可切换，默认内嵌，选择存在浏览器本地。两种视图共用一个"外壳 + 条目"结构的卡片组件。

**Architecture:** `Reader` 在第 1 期的注入流程末尾多做一步：按定位结果为每个段落级元素插入一个带 `data-sc-ui` 的空容器（槽位），再用 React portal 把页面给的卡片渲染进去。`Reader` 不认识卡片，只通过 `renderInline(ids)` 回调要内容。卡片组件 `NoteCard` 取代右栏的 `NoteItem`，用 `variant` 区分内嵌和右栏。收起状态、待写评论、视图选择都由页面持有。

**Tech Stack:** React 19（`createPortal`）+ TypeScript + Zustand + Vitest/jsdom。无新依赖，无后端改动。

**Spec:** `docs/superpowers/specs/2026-10-22-inline-comments-design.md`（第 2.1 节内嵌视图部分、第 3.1 节步骤 4、第 3.3、3.4、4 节）

**前置：** 第 1 期（`feature/inline-comments-p1`，已验收）必须先合入 `staging`；本期在从 `staging` 切出的 `feature/inline-comments-p2` 上实施。本计划引用的现有代码都以第 1 期合入后的状态为准。

## Global Constraints

- 视图状态：`commentView: 'inline' | 'sidebar'`，存 `localStorage` 键 `comment-view`，缺失或非法值时为 `'inline'`。
- 槽位的段落级祖先集合固定为 `P / H1–H6 / LI / BLOCKQUOTE / PRE / TABLE`（与文字索引的 `BLOCK` 不同，不含 `TD/TH/DT/DD/FIGCAPTION`）。规则：从锚点终点所在块元素起往上找第一个属于该集合的元素；`LI` 放在其内部末尾，其他放在元素之后；一直找到正文根都没有时，放在正文根末尾。
- 槽位元素：`<div data-sc-ui data-sc-slot="<序号>">`。同一个段落级元素的多条评论共用一个槽位，按 `start` 升序；待写评论按自己的 `start` 混排。
- 收起状态只在页面内存里，打开页面时全部展开，不持久化。
- 界面文案固定：`内嵌` / `右栏`（视图切换）、`全部收起` / `全部展开`、`未定位评论（n）`、`添加评论`、`原文已变化`、`插入点`、`编辑` / `删除`、`保存`。
- 第 1 期的锚点捕获、定位、标记注入、右栏排布逻辑不改；高亮仍按"第一处出现"。
- 不改 `notes.json` 结构，不加条目列表字段；条目只在前端由 `note.body` 转换而来。
- 本期不改后端、不写原文。

## 关键决定（本计划细化，spec 未写死的部分）

- **右栏卡片的样子不变**：`variant="sidebar"` 的渲染与现在的 `NoteItem` 一致（时间点、"原文已变化"、正文、悬停时显示编辑/删除），另加近似时的原文快照。收起箭头、类型图标、锚点摘录、创建时间只在内嵌卡片上出现。右栏不支持收起。
- **Mode A 在内嵌视图下打开评论入口**：第 1 期在 Mode A 不传 `onCommentDraft`，原因是草稿会进到看不见的右栏。内嵌视图下草稿卡片就在正文里，所以 Mode A + 内嵌视图恢复三个入口；Mode A + 右栏视图维持第 1 期的行为。
- **内嵌视图不渲染右栏**：`notes-col` 整个不渲染，正文列按现有 flex 规则占满这块宽度（Mode E 的 72ch 上限仍在）。
- **未定位区放在 `Reader` 之上**（在信息栏之前），只在内嵌视图出现，总是渲染（n 为 0 时也在，保证"添加评论"可用）。
- **"全部收起 / 全部展开"** 放在 tab 栏右侧"复制"按钮之前，仅内嵌视图且有评论时出现。只要有任一张卡片是展开的，按钮就显示"全部收起"。
- **点击正文标记或图标**：内嵌视图切换那张卡片的收起状态；右栏视图保持第 1 期的"聚焦并编辑"。

## Review Focus

1. **保存或删除一条评论时，另一张卡片正在编辑**：评论列表刷新后注入流程会重跑，如果槽位元素被重建，portal 里的卡片会重新挂载，编辑中的文字丢失。期望：同一个段落的槽位元素复用，卡片状态保留。→ Task 3 测试 `reuses slot elements when notes change`。
2. **在卡片里选文字、右键或按 `c`**：卡片在正文 DOM 内部，不能被当成正文产生评论锚点。→ Task 3 测试 `range inside a slot maps to null`、`c inside a card does nothing`。
3. **正文内容变化（切 tab、文件被改）**：旧槽位必须清掉，不能留下重复或悬空的卡片。→ Task 3 测试 `content change leaves one slot per block`。
4. **评论列表刷新后收起状态**：收起的卡片在刷新后仍然收起。→ Task 4 测试 `collapsed state survives notes refetch`。
5. **嵌套结构里的槽位**：列表项里有嵌套列表、表格在列表项里、引用块里的段落。→ Task 3 测试 `slot placement in nested structures`。

---

### Task 1: 视图状态与切换开关

**Files:**
- Modify: `web/src/stores/ui-store.ts`
- Create: `web/src/components/comment-view-toggle.tsx`
- Test: `web/src/components/comment-view-toggle.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // ui-store.ts
  export type CommentView = 'inline' | 'sidebar';
  export function readCommentView(): CommentView;          // 读 localStorage 'comment-view'，非法值→'inline'
  // UiState 新增
  commentView: CommentView;
  setCommentView: (v: CommentView) => void;               // 写 localStorage 再 set
  // comment-view-toggle.tsx
  export function CommentViewToggle(): JSX.Element;        // 两个按钮"内嵌""右栏"，当前项 aria-pressed="true"
  ```

- [ ] **Step 1: 写失败的测试**

```ts
// comment-view-toggle.test.tsx
beforeEach(() => { localStorage.clear(); useUiStore.setState({ commentView: readCommentView() }); });

it('defaults to inline when nothing is stored', () => {
  expect(readCommentView()).toBe('inline');
});
it('reads a stored sidebar view and ignores junk', () => {
  localStorage.setItem('comment-view', 'sidebar');
  expect(readCommentView()).toBe('sidebar');
  localStorage.setItem('comment-view', 'weird');
  expect(readCommentView()).toBe('inline');
});
it('clicking 右栏 switches and persists', () => {
  const { getByText } = render(<CommentViewToggle />);
  expect(getByText('内嵌')).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(getByText('右栏'));
  expect(useUiStore.getState().commentView).toBe('sidebar');
  expect(localStorage.getItem('comment-view')).toBe('sidebar');
  expect(getByText('右栏')).toHaveAttribute('aria-pressed', 'true');
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd web && npx vitest run src/components/comment-view-toggle.test.tsx`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**。store 写法照 `proseTheme`；按钮样式照 `ProseThemePicker` 的头部按钮（`text-sm px-2 py-1 rounded`，未选中用 `var(--text-tertiary)`，选中用 `var(--text-primary)`）。

- [ ] **Step 4: 运行，确认通过**

Run: `cd web && npx vitest run src/components/comment-view-toggle.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/stores/ui-store.ts web/src/components/comment-view-toggle.tsx web/src/components/comment-view-toggle.test.tsx
git commit -m "feat(web): comment view state with inline/sidebar toggle"
```

---

### Task 2: 卡片组件（外壳 + 条目），取代 `NoteItem`

**Files:**
- Create: `web/src/components/note-card.tsx`
- Create: `web/src/components/note-card.test.tsx`
- Modify: `web/src/components/notes-panel.tsx`（两处 `NoteItem` 换成 `<li><NoteCard variant="sidebar" …/></li>`，删除 `NoteItem`）
- Modify: `web/src/components/notes-panel.test.tsx`（`NoteItem` 的两个用例迁到 `note-card.test.tsx`，见 Step 1）
- Modify: `web/src/styles/globals.css`（新增 `.sc-note-card` 样式）

**Interfaces:**
- Consumes: `anchorKind`（`@/lib/anchor`），`formatDuration`、`formatRelativeTime`（`@/lib/time`）。
- Produces:
  ```ts
  export type CardVariant = 'inline' | 'sidebar';
  export interface NoteEntryData { id: string; kind: 'body'; text: string }
  export function noteEntries(note: Note): NoteEntryData[];   // 目前恒为 [{ id: note.id, kind: 'body', text: note.body }]

  export interface NoteCardProps {
    note: Note;
    variant: CardVariant;
    approximate?: boolean;
    collapsed?: boolean;                 // 仅 inline 生效
    onToggleCollapsed?: () => void;      // 仅 inline
    isLinked: boolean;
    onHover: (id: string | null) => void;
    onUpdate: (body: string) => void;
    onDelete: () => void;
    onHeightChange?: (id: string, h: number) => void;   // 右栏排布用
    autoEdit?: boolean;                  // 右栏"点标记聚焦编辑"
    onAutoEditConsumed?: () => void;
  }
  export function NoteCard(props: NoteCardProps): JSX.Element;
  export function anchorLabel(a: NoteAnchor): string;   // 从 notes-panel.tsx 原样搬来并导出，NotesPanel 改为导入它
  // 根元素：<div class="sc-note-card" data-note-card={note.id} data-variant={variant}>
  ```

**行为：**
- **外壳**负责：头部、近似快照、编辑状态、悬停联动、高度上报（`ResizeObserver`，有 `onHeightChange` 时才挂）、`autoEdit`；**条目**组件 `NoteEntry` 只负责显示或编辑一条文字。以后加回复、AI 回答只往 `noteEntries` 里加，要支持 Markdown 只改 `NoteEntry`。
- **内嵌头部**（一行，从左到右）：收起箭头按钮（`aria-label` 为 `收起` 或 `展开`，文字 `▾` / `▸`）、类型图标（选区用 `❝`，点评论用 `‸`，无锚点不显示）、锚点摘录（选区：`anchor` 第一行，超过 40 字截断加 `…`；点评论：`插入点`）、时间点 `@ mm:ss`（有 `mediaTimestamp` 时）、`原文已变化`（近似时）、`formatRelativeTime(createdAt)`、`编辑`、`删除`。
- **右栏**：与现在的 `NoteItem` 渲染一致（悬停才显示编辑/删除；`isLinked` 时滚动到可见并加底色，编辑中不加底色）。
- **近似快照**（两种 variant 都有，收起时不显示）：`prefix` + 加粗的 `anchor` + `suffix`；点评论在中间显示 `‸`。没有 `prefix/suffix` 的旧评论不显示快照。
- **收起**（仅 inline）：只渲染头部这一行。
- **编辑**：⌘↵ 或失焦保存，Esc 放弃，规则与现在的 `NoteItem` 相同。
- 内嵌卡片 `isLinked` 时加底色但**不**滚动。

- [ ] **Step 1: 写失败的测试**（前两个是从 `notes-panel.test.tsx` 迁来的，迁移后在原文件删除）

```ts
// note-card.test.tsx（beforeEach 里照原文件 mock ResizeObserver 和 scrollIntoView）
const base: Note = { id: 'n1', anchor: '', body: '一条笔记', createdAt: Date.now(), updatedAt: Date.now() };
const noop = () => {};

it('suppresses isLinked background highlight when editing is active', () => {
  const { container } = render(<NoteCard variant="sidebar" note={{ ...base, anchor: 'a' }} isLinked autoEdit
    onAutoEditConsumed={noop} onHover={noop} onUpdate={noop} onDelete={noop} />);
  expect(container.querySelector('[data-note-card]')!.getAttribute('style') ?? '').not.toContain('var(--accent-3)');
  expect(container.querySelector('textarea')).toBeTruthy();
});
it('NoteCard shows 原文已变化 when approximate', () => {
  const { getByText } = render(<NoteCard variant="sidebar" note={base} approximate isLinked={false}
    onHover={noop} onUpdate={noop} onDelete={noop} />);
  expect(getByText('原文已变化')).toBeInTheDocument();
});
it('noteEntries turns the body into one entry', () => {
  expect(noteEntries(base)).toEqual([{ id: 'n1', kind: 'body', text: '一条笔记' }]);
});
it('inline header shows excerpt, time point and actions', () => {
  const n = { ...base, anchor: '第一行原文\n第二行', mediaTimestamp: 65 };
  const { getByText } = render(<NoteCard variant="inline" note={n} isLinked={false} onHover={noop} onUpdate={noop} onDelete={noop} />);
  expect(getByText('第一行原文')).toBeInTheDocument();
  expect(getByText('@ 1:05')).toBeInTheDocument();
  expect(getByText('编辑')).toBeInTheDocument();
});
it('inline point card says 插入点', () => {
  const { getByText } = render(<NoteCard variant="inline" note={{ ...base, prefix: '前文', suffix: '后文' }}
    isLinked={false} onHover={noop} onUpdate={noop} onDelete={noop} />);
  expect(getByText('插入点')).toBeInTheDocument();
});
it('collapsed inline card shows only the header', () => {
  const toggle = vi.fn();
  const { queryByText, getByLabelText } = render(<NoteCard variant="inline" note={base} collapsed onToggleCollapsed={toggle}
    isLinked={false} onHover={noop} onUpdate={noop} onDelete={noop} />);
  expect(queryByText('一条笔记')).toBeNull();
  fireEvent.click(getByLabelText('展开'));
  expect(toggle).toHaveBeenCalled();
});
it('approximate card shows the snapshot', () => {
  const n = { ...base, anchor: '旧原文', prefix: '前文', suffix: '后文' };
  const { container } = render(<NoteCard variant="inline" note={n} approximate isLinked={false}
    onHover={noop} onUpdate={noop} onDelete={noop} />);
  expect(container.textContent).toContain('前文旧原文后文');
});
it('cmd+enter saves an edit, escape discards it', () => {
  const update = vi.fn();
  const { getByText, container } = render(<NoteCard variant="inline" note={base} isLinked={false}
    onHover={noop} onUpdate={update} onDelete={noop} />);
  fireEvent.click(getByText('编辑'));
  const ta = container.querySelector('textarea')!;
  fireEvent.change(ta, { target: { value: '改过' } });
  fireEvent.keyDown(ta, { key: 'Enter', metaKey: true });
  expect(update).toHaveBeenCalledWith('改过');
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd web && npx vitest run src/components/note-card.test.tsx`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `NoteCard` / `NoteEntry` / `noteEntries`，`NotesPanel` 改用 `NoteCard variant="sidebar"`**（两处原本传给 `NoteItem` 的 props 原样传过去），删除 `NoteItem`。CSS：`.sc-note-card[data-variant="inline"]` 为整宽卡片，`margin: 12px 0`，`border: 1px solid var(--border-subtle)`，`border-radius: 6px`，`background: var(--bg-elevated)`，`font-size: 13px`，`line-height: 1.6`，并把正文排版（首行缩进、段距）重置掉，避免继承 `.prose-cn` 的样式。

- [ ] **Step 4: 运行前端全部测试**

Run: `cd web && npm test`
Expected: 全部 PASS（`notes-panel.test.tsx` 的其余用例不变）。

- [ ] **Step 5: Commit**

```bash
git add web/src/components/note-card.tsx web/src/components/note-card.test.tsx web/src/components/notes-panel.tsx web/src/components/notes-panel.test.tsx web/src/styles/globals.css
git commit -m "feat(web): note card with shell and entries, replacing NoteItem"
```

---

### Task 3: `Reader` 插入卡片槽位并渲染 portal

**Files:**
- Create: `web/src/lib/inline-slots.ts`
- Create: `web/src/lib/inline-slots.test.ts`
- Modify: `web/src/lib/text-index.ts`（`SLOT_ATTR`；槽位内的边界映射为 `null`）
- Modify: `web/src/lib/text-index.test.ts`
- Modify: `web/src/components/reader.tsx`
- Modify: `web/src/components/reader.test.tsx`

**Interfaces:**
- Consumes: 第 1 期的 `buildTextIndex`、`blockAt`、`UI_ATTR`、`locateAnchor`、`Located`。
- Produces:
  ```ts
  // text-index.ts
  export const SLOT_ATTR = 'data-sc-slot';
  // boundaryToOffset：container 在 [data-sc-slot] 子树内时返回 null（因此 rangeToOffsets 也返回 null）

  // inline-slots.ts
  export const SLOT_BLOCK: Set<string>;   // P H1..H6 LI BLOCKQUOTE PRE TABLE
  export function slotHost(blockEl: HTMLElement, root: HTMLElement): HTMLElement;   // 槽位归属的段落级元素；找不到时返回 root
  export function placeSlot(slot: HTMLElement, host: HTMLElement, root: HTMLElement): void;
  //   host === root 或 host 是 LI → host.appendChild(slot)；否则插到 host 之后。已在正确位置时不动。
  export interface SlotGroup { host: HTMLElement; ids: string[] }   // ids 按 start 升序
  export function groupSlots(index: TextIndex, items: { id: string; start: number; end: number }[]): SlotGroup[];
  //   每项用 blockAt(index, end).el 作为起点调用 slotHost

  // reader.tsx
  export const DRAFT_ID = '__draft__';
  // ReaderProps 新增
  draft?: NoteAnchor | null;
  renderInline?: (ids: string[]) => ReactNode;   // 传了就是内嵌视图
  ```

**行为：**
- 注入 effect 末尾（标记和图标之后）：只有传了 `renderInline` 时执行。把已定位的评论，加上用 `locateAnchor` 定位到的 `draft`（`id` 为 `DRAFT_ID`，不画标记、不进 `onNotesLocated`）一起分组。
- **槽位复用**：用一个 `Map<HTMLElement, HTMLElement>`（host → 槽位元素）的 ref。对每组：已有就复用，并用 `placeSlot` 确认位置；没有就新建 `<div data-sc-ui data-sc-slot="<递增序号>">`。之后删除正文里所有不在本轮用到的 `[data-sc-slot]` 元素（包括正文内容变化后留下的）。
- 把 `{ el, key, ids }[]` 存进 state；只有分组或元素变了才 `setState`。渲染时对每组 `createPortal(renderInline(ids), el, key)`，portal 放在 `<article>` 之外的 JSX 位置。
- `renderInline` 不进 effect 依赖（每次渲染都会是新函数），effect 依赖里加 `draft` 和 `!!renderInline`。
- **卡片里的操作不触发正文入口**：`handleMouseUp`、`handleMouseDown`、`handleContextMenu`、`c` 键处理在 `target.closest('[data-sc-slot]')` 时直接返回（右键保留原生菜单）。

- [ ] **Step 1: 写失败的测试**

```ts
// inline-slots.test.ts（用 innerHTML 搭 DOM）
it('slot goes after a paragraph', () => { /* <p>a</p><p>b</p>，项落在第一个 p → 槽位是第一个 p 的下一个兄弟 */ });
it('slot goes inside the end of a list item', () => { /* <ul><li>a</li></ul> → 槽位是 li 的最后一个子元素 */ });
it('slot goes after a table, not inside the cell', () => { /* <table>…<td>a</td>…</table> → 槽位是 table 的下一个兄弟 */ });
it('slot placement in nested structures', () => {
  // <ul><li><p>a</p><ul><li>b</li></ul></li></ul>：落在 a → host 是 a 的 <p>；落在 b → host 是内层 li
  // <blockquote><p>c</p></blockquote>：host 是 <p>
  // <ul><li><table><tbody><tr><td>d</td></tr></tbody></table></li></ul>：host 是 table
});
it('groups notes of one block into one slot sorted by start', () => {
  // 同一个 p 的两项 start 分别为 5、1 → 一组，ids 顺序为 [第二项, 第一项]
});

// text-index.test.ts
it('range inside a slot maps to null', () => {
  // <p>正文</p><div data-sc-ui data-sc-slot="1"><p>卡片文字</p></div>
  // boundaryToOffset(index, 卡片文字的文本节点, 1) === null
});

// reader.test.tsx
const content = '第一段有个观点在这里。\n\n- 列表项一\n- 列表项二\n\n| a | b |\n|---|---|\n| 单元格 | x |';
it('inline view renders cards in slots under their blocks', () => {
  const notes = [{ id: 'p', anchor: '观点' }, { id: 'l', anchor: '列表项二' }, { id: 't', anchor: '单元格' }];
  const { container } = render(<Reader content={content} notes={notes}
    renderInline={(ids) => ids.map((id) => <i key={id} data-card={id} />)} />);
  expect(container.querySelector('p + [data-sc-slot] [data-card="p"]')).not.toBeNull();
  expect(container.querySelector('li:last-child > [data-sc-slot]:last-child [data-card="l"]')).not.toBeNull();
  expect(container.querySelector('table + [data-sc-slot] [data-card="t"]')).not.toBeNull();
});
it('no renderInline means no slots', () => {
  const { container } = render(<Reader content={content} notes={[{ id: 'p', anchor: '观点' }]} />);
  expect(container.querySelector('[data-sc-slot]')).toBeNull();
});
it('draft gets a slot but no mark', () => {
  const draft = { anchor: '', prefix: '有个观点', suffix: '在这里。', position: 7 };
  const { container } = render(<Reader content={content} notes={[]} draft={draft}
    renderInline={(ids) => ids.map((id) => <i key={id} data-card={id} />)} />);
  expect(container.querySelector(`[data-card="${DRAFT_ID}"]`)).not.toBeNull();
  expect(container.querySelector('.vdl-note-point, mark.vdl-note-anchor')).toBeNull();
});
it('reuses slot elements when notes change', () => {
  // 先渲染 notes=[p]，记下槽位元素；rerender notes=[p, 同段另一条] → 槽位元素是同一个对象（===），且 portal 里两张卡片
});
it('content change leaves one slot per block', () => {
  // rerender 换一段新内容（同样有一条评论能定位）→ container.querySelectorAll('[data-sc-slot]').length === 1
});
it('c inside a card does nothing', () => {
  // renderInline 渲染一个 <button>；在 button 上 keyDown 'c' → onCommentDraft 未被调用
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd web && npx vitest run src/lib/inline-slots.test.ts src/lib/text-index.test.ts src/components/reader.test.tsx`
Expected: 新用例 FAIL。

- [ ] **Step 3: 实现**（行为见上）

- [ ] **Step 4: 运行前端全部测试**

Run: `cd web && npm test`
Expected: 全部 PASS（第 1 期的标记、图标、入口用例不变）。

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/inline-slots.ts web/src/lib/inline-slots.test.ts web/src/lib/text-index.ts web/src/lib/text-index.test.ts web/src/components/reader.tsx web/src/components/reader.test.tsx
git commit -m "feat(web): inline card slots under anchored blocks via portals"
```

---

### Task 4: 内嵌卡片容器、待写卡片、未定位区

**Files:**
- Create: `web/src/components/inline-notes.tsx`
- Create: `web/src/components/inline-notes.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `NoteCard`；Task 3 的 `DRAFT_ID`；`useAddNote / useUpdateNote / useDeleteNote`（`@/hooks/use-tasks`）；`usePlayerStore` 的 `currentTime`。
- Produces:
  ```ts
  interface CardsCommon {
    taskId: string;
    hasMedia: boolean;
    collapsed: Set<string>;
    onToggle: (id: string) => void;
    hoveredNoteId: string | null;
    onHover: (id: string | null) => void;
  }
  export function DraftCard(props: { taskId: string; hasMedia: boolean; anchor: NoteAnchor; onDone: () => void }): JSX.Element;
  export function InlineCards(props: CardsCommon & {
    ids: string[];                         // Reader 给的一个槽位的 id 列表，可能含 DRAFT_ID
    notes: Note[];
    located: Record<string, Located>;
    draft: NoteAnchor | null;
    onDraftDone: () => void;
  }): JSX.Element;
  export function UnlocatedZone(props: CardsCommon & { notes: Note[] }): JSX.Element;   // notes = 未定位的那些
  ```

**行为：**
- **`DraftCard`**：内嵌样式的卡片，头部显示锚点标签（规则同第 1 期右栏的 `anchorLabel`：选区 `锚点：…`、点评论 `插入点：…`，无锚点不显示），一个自动聚焦的 textarea，`保存` 按钮。⌘↵ 或点保存：正文非空时 `addNote.mutate({ ...anchor, body, ...(hasMedia && currentTime > 0 ? { mediaTimestamp: Math.floor(currentTime) } : {}) })`，然后 `onDone()`；Esc：`onDone()`。
- **`InlineCards`**：按 `ids` 顺序渲染；`DRAFT_ID` 渲染 `DraftCard`（`draft` 为 null 时跳过），其余渲染 `NoteCard variant="inline"`，`approximate` 取 `located[id]?.grade === 'approximate'`，`collapsed` 取 `collapsed.has(id)`。找不到对应 note 的 id 跳过。
- **`UnlocatedZone`**：头部是一个切换按钮 `未定位评论（n）`（区域自身的展开状态，默认展开）和一个 `添加评论` 按钮。点 `添加评论` 在区域内显示 `DraftCard`，`anchor` 为 `{ anchor: '' }`。展开时用 `NoteCard variant="inline"` 列出 `notes`。

- [ ] **Step 1: 写失败的测试**（用 `QueryClientProvider` 包一层，照 `notes-panel.test.tsx` 的 `renderWithClient`；`vi.spyOn(api, 'addNote')` 捕获请求）

```ts
it('draft card saves with anchor fields and calls onDone', async () => {
  const add = vi.spyOn(api, 'addNote').mockResolvedValue({} as Note);
  const done = vi.fn();
  const anchor = { anchor: '', prefix: '前文', suffix: '后文', position: 3 };
  const { getByRole, getByText } = renderWithClient(<DraftCard taskId="t" hasMedia={false} anchor={anchor} onDone={done} />);
  expect(getByText(/插入点：…前文/)).toBeInTheDocument();
  fireEvent.change(getByRole('textbox'), { target: { value: '想法' } });
  fireEvent.keyDown(getByRole('textbox'), { key: 'Enter', metaKey: true });
  await waitFor(() => expect(add).toHaveBeenCalledWith('t', expect.objectContaining({ ...anchor, body: '想法' })));
  expect(done).toHaveBeenCalled();
});
it('escape discards the draft without saving', () => { /* Esc → onDone 被调用，addNote 未被调用 */ });
it('inline cards render draft and notes in slot order', () => {
  // ids = ['b', DRAFT_ID, 'a'] → DOM 顺序：b 的卡片、草稿卡片、a 的卡片
});
it('collapsed state survives notes refetch', () => {
  // collapsed = new Set(['a'])；rerender 时 notes 换成新数组（a 的 body 不变）→ a 仍只显示头部
});
it('unlocated zone lists notes and adds an anchorless note', async () => {
  // notes = [无锚点评论]；显示 '未定位评论（1）' 和该评论；点 '添加评论' → 出现 textarea；保存 → addNote 收到 anchor: ''
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd web && npx vitest run src/components/inline-notes.test.tsx`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**（行为见上）

- [ ] **Step 4: 运行，确认通过**

Run: `cd web && npx vitest run src/components/inline-notes.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add web/src/components/inline-notes.tsx web/src/components/inline-notes.test.tsx
git commit -m "feat(web): inline cards container, draft card and unlocated zone"
```

---

### Task 5: 页面接入

**Files:**
- Modify: `web/src/routes/tasks.$id.tsx`
- Modify: `web/src/routes/tasks.$id.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `commentView` / `CommentViewToggle`；Task 3 的 `Reader` 新 props 和 `DRAFT_ID`；Task 4 的 `InlineCards`、`UnlocatedZone`。

**行为：**
- 头部：`<CommentViewToggle />` 放在 `<ProseThemePicker />` 之后。
- 页面状态新增 `collapsed: Set<string>`（初始空集）。`toggleCollapsed(id)` 用 `useCallback` 保持稳定。
- **内嵌视图**（`commentView === 'inline'`）：
  - 不渲染 `<aside className="notes-col">`。
  - `article-col` 内、`Reader` 之前渲染 `UnlocatedZone`，`notes` 为 `notes.filter((n) => !located[n.id])`。
  - `Reader` 传 `draft={draft}` 和 `renderInline={(ids) => <InlineCards … ids={ids} onDraftDone={() => setDraft(null)} />}`。
  - `onNoteAnchorClick` 传 `toggleCollapsed`。
  - `onCommentDraft` 总是传 `setDraft`（包括 Mode A）。
  - tab 栏右侧、"复制"之前：有评论时显示一个按钮。只要有一条评论不在 `collapsed` 里，按钮就是 `全部收起`（点了把所有评论 id 放进 `collapsed`）；否则是 `全部展开`（点了清空）。
- **右栏视图**：与第 1 期完全相同（`NotesPanel`、`onNoteAnchorClick={setFocusNoteId}`、Mode A 不传 `onCommentDraft`）。
- 切换 tab 仍清空 `draft`（第 1 期已有）。

- [ ] **Step 1: 写失败的测试**（在现有 mock 上补：`@/components/inline-notes` mock 成把 props 记到 `h` 里的空组件；`useNotes` 改成从 `h.notes` 取数据；每个用例前 `useUiStore.setState({ commentView: … })`）

```ts
it('inline view hides the right column and passes renderInline', () => {
  useUiStore.setState({ commentView: 'inline', layoutMode: 'E' });
  h.mediaInfo = { video: { exists: false }, audio: { exists: false } };
  const { container } = renderTask('article-x');
  expect(container.querySelector('.notes-col')).toBeNull();
  expect(h.readerProps.renderInline).toBeTypeOf('function');
});
it('sidebar view keeps the right column and no renderInline', () => {
  useUiStore.setState({ commentView: 'sidebar' });
  // 同上渲染 → .notes-col 存在，renderInline 为 undefined
});
it('mode A in inline view gives Reader the comment entry', () => {
  useUiStore.setState({ commentView: 'inline' });
  h.mediaInfo = { video: { exists: true }, audio: { exists: false } };
  renderTask('vid1');
  expect(h.readerProps.onCommentDraft).toBeTypeOf('function');
});
it('collapse all then expand all', () => {
  // h.notes = [两条评论]；点 '全部收起' → 传给 InlineCards/UnlocatedZone 的 collapsed 含两条 id，按钮变 '全部展开'；再点 → 空集
});
it('unlocated zone gets the notes Reader did not locate', () => {
  // h.notes = [a, b]；Reader mock 在渲染后调用 props.onNotesLocated({ a: { start: 0, end: 1, grade: 'exact' } })
  // → UnlocatedZone 收到的 notes 只有 b（无锚点、未定位、doc 不同的评论都由 Reader 不报出而落到这里）
});
```

现有的 `mode A gives Reader no comment entry` 用例在开头加 `useUiStore.setState({ commentView: 'sidebar' })`，断言不变；`switching tab clears draft` 和 `other layouts and articles give Reader the comment entry` 两个用例同样固定为 `'sidebar'`。

- [ ] **Step 2: 运行，确认失败**

Run: `cd web && npx vitest run src/routes`
Expected: 新用例 FAIL。

- [ ] **Step 3: 实现**（行为见上）

- [ ] **Step 4: 前端全部测试 + 类型检查**

Run: `cd web && npm test && npx tsc --noEmit -p .`
Expected: 全部 PASS，没有类型错误。

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/tasks.\$id.tsx web/src/routes/tasks.\$id.test.tsx
git commit -m "feat(web): wire inline comment view into the task page"
```

---

### Task 6: 整体验证

**Files:** 无代码改动。

- [ ] **Step 1: 全量测试与构建**

Run: `npm test && (cd web && npm test && npm run build)`
Expected: 后端全部 `✓`，前端全部 PASS，构建成功。

- [ ] **Step 2: 在真实应用里走一遍**（用临时目录里的文章和视频任务副本，不碰真实数据）

1. 默认是内嵌视图：段落、列表项、表格、代码块下方各有一张卡片，右栏不出现。
2. 收起和展开：点卡片箭头、点正文标记或图标都能切换单张卡片；`全部收起` / `全部展开` 生效；刷新页面后全部展开。
3. 新建：选区气泡、右键"在此处评论"、`c` 键各建一条，草稿卡片出现在所在段落下方；⌘↵ 保存后变成正常卡片，Esc 放弃后消失。在一张卡片编辑时保存另一条，编辑中的文字不丢。
4. 未定位区：无锚点评论、改原文后找不到的评论、视频页另一个 tab 的评论都在这里；`添加评论` 能建无锚点评论，视频播放中会带上时间点。
5. 视图切换：切到右栏后与第 1 期行为一致；刷新后仍是右栏；切回内嵌恢复。Mode A：内嵌视图下三个入口可用、左栏列表仍在；右栏视图下与第 1 期相同。
6. 在卡片里选文字、右键、按 `c`：不会产生新的评论草稿，右键是浏览器原生菜单。

- [ ] **Step 3: 记录**：把 6 项结果写进交接文档的自测记录（pass / fail + 简短说明；做不了的写明原因）。
