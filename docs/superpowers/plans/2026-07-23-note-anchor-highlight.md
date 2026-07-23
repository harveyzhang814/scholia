# 笔记锚点正文标记 + 侧栏双向联动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给笔记锚点文字在正文里加一套区别于高亮的独立标记样式，并让正文标记与侧栏笔记卡片双向悬停联动、点击正文标记可跳转到对应笔记卡片并进入编辑态。

**Architecture:** `reader.tsx` 现有的高亮 DOM 注入算法（`TreeWalker` 定位 anchor 文本 → `splitText` → 包 `<mark>`）被抽成参数化的共享 helper，同时给 `highlights` 和新增的 `notes` 两条数据各用一次。悬停/点击的联动状态（`hoveredNoteId`/`focusNoteId`）提升到 `tasks.$id.tsx`，通过 props 在 `Reader` 和 `NotesPanel` 之间双向传递。

**Tech Stack:** React 19 + TypeScript，Vite，Zustand（不涉及本次改动），vitest + `@testing-library/react`（现有测试框架）。

**Spec:** `docs/superpowers/specs/2026-07-23-note-anchor-highlight-design.md`（本计划的所有设计决策以此文档为准，如有冲突以 spec 为准）。

## Global Constraints

- 笔记锚点标记不得使用紫色或任何新色相——`DESIGN.md` 明确「无紫色/渐变」是反 AI-slop 约束。标记用暖灰色块（`rgba(207, 203, 192, 0.34)`）+ 点状下划线；联动强调态复用品牌唯一 accent（`--accent-9`/`--accent-3`，sage green）。
- 锚点文本在正文中找不到匹配时静默跳过（`continue`），不抛错、不打印警告——与现有高亮逻辑行为一致。
- 卡片进入编辑态时不叠加 `.is-linked`/背景强调——只保留 `textarea` 自身的 `border: 1px solid var(--accent-9)`，避免"绿框套绿框"。
- 不新增自动化测试覆盖悬停/点击交互回调（`onNoteHover`/`onNoteAnchorClick`/`isLinked`/`autoEdit`）——现有代码库对这类交互没有测试先例，只对 DOM 标记注入结果（`reader.test.tsx` 已有模式）补测试，交互本身用手动验证。

---

### Task 1: 把高亮标记注入算法抽成共享 helper（纯重构，不改变行为）

**Files:**
- Modify: `web/src/components/reader.tsx:1-184`（`import` 增加 `useEffect` 已存在；`COLORS` 常量之后新增 `injectAnchorMarks` 函数；133-184 行的高亮注入 `useEffect` 改为调用它）
- Test: `web/src/components/reader.test.tsx`（现有文件，本任务不新增用例，只用来验证不回归）

**Interfaces:**
- Produces: 模块级函数
  ```ts
  interface AnchorMarkItem {
    id: string;
    anchor: string;
  }

  function injectAnchorMarks<T extends AnchorMarkItem>(
    article: HTMLElement,
    items: T[],
    markClass: string,
    decorate: (mark: HTMLElement, item: T) => void,
  ): void
  ```
  Task 2 会在 `reader.tsx` 同一个模块作用域里调用它。

- [ ] **Step 1: 运行现有测试，确认重构前的基线**

Run: `cd web && npx vitest run src/components/reader.test.tsx`
Expected: `Test Files  1 passed (1)` / `Tests  2 passed (2)`

- [ ] **Step 2: 在 `reader.tsx` 里新增 `injectAnchorMarks` helper，并把高亮注入 effect 改成调用它**

在 `const COLORS: ...` 常量声明之后、`export function Reader(...)` 之前插入：

```ts
interface AnchorMarkItem {
  id: string;
  anchor: string;
}

function injectAnchorMarks<T extends AnchorMarkItem>(
  article: HTMLElement,
  items: T[],
  markClass: string,
  decorate: (mark: HTMLElement, item: T) => void,
) {
  // Unwrap all previously injected marks of this class
  article.querySelectorAll(`mark.${markClass}`).forEach((mark) => {
    mark.replaceWith(...Array.from(mark.childNodes));
  });

  for (const item of items) {
    // Search across the full concatenated text so an anchor that spans
    // multiple text nodes (e.g. selection crossing into/out of a <strong>
    // or <a>) can still be found — a single node's textContent won't
    // contain it even though the anchor exists in the rendered text.
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let fullText = '';
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      textNodes.push(node);
      fullText += node.textContent ?? '';
    }
    const idx = fullText.indexOf(item.anchor);
    if (idx === -1) continue;
    const end = idx + item.anchor.length;

    let pos = 0;
    for (const tn of textNodes) {
      const nodeStart = pos;
      const nodeEnd = pos + (tn.textContent?.length ?? 0);
      pos = nodeEnd;
      if (nodeEnd <= idx || nodeStart >= end) continue;

      let target = tn;
      const sliceStart = Math.max(0, idx - nodeStart);
      const sliceEnd = Math.min(nodeEnd, end) - nodeStart;
      if (sliceStart > 0) target = target.splitText(sliceStart);
      if (sliceEnd - sliceStart < (target.textContent?.length ?? 0)) target.splitText(sliceEnd - sliceStart);

      const mark = document.createElement('mark');
      mark.className = markClass;
      decorate(mark, item);
      target.parentNode?.insertBefore(mark, target);
      mark.appendChild(target);
    }
  }
}
```

把原来 133-184 行的 `// ── Post-render highlight injection ─────────────────────────` 整段 `useEffect` 替换成：

```ts
  // ── Post-render highlight injection ─────────────────────────
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const sorted = highlights?.length ? [...highlights].sort((a, b) => a.createdAt - b.createdAt) : [];
    injectAnchorMarks(article, sorted, 'vdl-hl', (mark, hl) => {
      mark.dataset.hlId = hl.id;
      mark.dataset.color = hl.color;
    });
  }, [highlights, md]);
```

- [ ] **Step 3: 重新运行测试，确认没有回归**

Run: `cd web && npx vitest run src/components/reader.test.tsx`
Expected: `Test Files  1 passed (1)` / `Tests  2 passed (2)`（和 Step 1 结果一致）

- [ ] **Step 4: Commit**

```bash
git add web/src/components/reader.tsx
git commit -m "refactor(web): extract shared anchor-mark injection helper from highlight effect"
```

---

### Task 2: 笔记锚点标记渲染（`notes` prop + 注入 effect + CSS）

**Files:**
- Modify: `web/src/components/reader.tsx`（`import` 增加 `type Note`；`ReaderProps` 新增 `notes` 字段；组件参数解构新增 `notes`；新增笔记锚点注入 `useEffect`）
- Modify: `web/src/styles/globals.css:411`（在高亮样式块之后新增 `.vdl-note-anchor` 规则）
- Test: `web/src/components/reader.test.tsx`（新增 `describe('Reader note-anchor rendering', ...)`）

**Interfaces:**
- Consumes: Task 1 的 `injectAnchorMarks`（同一文件模块作用域，直接调用）
- Produces: `Reader` 组件新增 prop `notes?: Pick<Note, 'id' | 'anchor'>[]`，渲染出 `<mark class="vdl-note-anchor" data-note-id="...">`。Task 3、Task 5 会用到这个 prop。

- [ ] **Step 1: 在 `reader.test.tsx` 里新增失败的测试**

在文件末尾（现有 `describe('Reader highlight rendering', ...)` 之后）新增：

```tsx
describe('Reader note-anchor rendering', () => {
  it('renders a mark for a note anchor entirely within one text node', () => {
    const content = '这首歌是 Rick Astley 的 **Never Gonna Give You Up**，经典金曲。';
    const notes = [{ id: 'n1', anchor: 'Never Gonna Give You Up' }];
    const { container } = render(<Reader content={content} notes={notes} />);
    expect(container.querySelectorAll('mark.vdl-note-anchor').length).toBeGreaterThan(0);
  });

  it('renders a mark for a note anchor that spans across a <strong> boundary', () => {
    const content = '这首歌是 Rick Astley 的 **Never Gonna Give You Up**，经典金曲。';
    const notes = [{ id: 'n1', anchor: '的 Never Gonna Give You Up，经典' }];
    const { container } = render(<Reader content={content} notes={notes} />);
    expect(container.querySelectorAll('mark.vdl-note-anchor').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd web && npx vitest run src/components/reader.test.tsx`
Expected: 新增的 2 条用例 FAIL（`expected 0 to be greater than 0` —— 此时 `Reader` 还不认识 `notes` prop，正文里不会出现 `mark.vdl-note-anchor`）

- [ ] **Step 3: 在 `globals.css` 里新增笔记锚点标记样式**

在 `mark.vdl-hl[data-color="blue"]   { background: transparent; border-bottom: 2px solid rgba(59, 130, 246, 0.9); }`（第 411 行）之后新增：

```css

/* ── 笔记锚点标记（区别于高亮：暖灰色块 + 点状下划线，不引入新色相——
   DESIGN.md 明确「无紫色/渐变」，联动强调态复用品牌唯一 accent） ── */
mark.vdl-note-anchor {
  background: rgba(207, 203, 192, 0.34);
  border-bottom: 1px dotted var(--text-tertiary);
  border-radius: 2px;
  cursor: pointer;
  padding: 0 1px;
  transition: background 120ms, box-shadow 120ms;
}
mark.vdl-note-anchor.is-linked {
  background: var(--accent-3);
  border-bottom-color: var(--accent-9);
  box-shadow: inset 0 0 0 1px var(--accent-9);
}
```

- [ ] **Step 4: 在 `reader.tsx` 里新增 `notes` prop 和注入 effect**

把 `import { api, type Highlight } from '@/lib/api';` 改成：

```ts
import { api, type Highlight, type Note } from '@/lib/api';
```

把 `ReaderProps` 接口：

```ts
interface ReaderProps {
  taskId?: string;
  content: string;
  frontmatter?: Record<string, unknown>;
  highlights?: Highlight[];
  onAnchorSelect?: (anchor: string) => void;
  onAddHighlight?: (anchor: string, color: 'yellow' | 'green' | 'red' | 'blue') => void;
  onDeleteHighlight?: (id: string) => void;
}
```

改成：

```ts
interface ReaderProps {
  taskId?: string;
  content: string;
  frontmatter?: Record<string, unknown>;
  highlights?: Highlight[];
  notes?: Pick<Note, 'id' | 'anchor'>[];
  onAnchorSelect?: (anchor: string) => void;
  onAddHighlight?: (anchor: string, color: 'yellow' | 'green' | 'red' | 'blue') => void;
  onDeleteHighlight?: (id: string) => void;
}
```

把组件签名：

```ts
export function Reader({ taskId, content, frontmatter, highlights, onAnchorSelect, onAddHighlight, onDeleteHighlight }: ReaderProps) {
```

改成：

```ts
export function Reader({ taskId, content, frontmatter, highlights, notes, onAnchorSelect, onAddHighlight, onDeleteHighlight }: ReaderProps) {
```

在 Task 1 里的高亮注入 `useEffect` **之后**紧接着新增一个 effect：

```ts
  // ── Post-render note-anchor injection ────────────────────────
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const anchored = notes?.length ? notes.filter((n) => n.anchor) : [];
    injectAnchorMarks(article, anchored, 'vdl-note-anchor', (mark, note) => {
      mark.dataset.noteId = note.id;
    });
  }, [notes, md]);
```

- [ ] **Step 5: 重新运行测试，确认通过**

Run: `cd web && npx vitest run src/components/reader.test.tsx`
Expected: `Test Files  1 passed (1)` / `Tests  4 passed (4)`（原 2 条高亮测试 + 新增 2 条笔记锚点测试）

- [ ] **Step 6: Commit**

```bash
git add web/src/components/reader.tsx web/src/components/reader.test.tsx web/src/styles/globals.css
git commit -m "feat(web): render note-anchor marks in article, distinct from highlights"
```

---

### Task 3: 正文锚点悬停/点击联动（Reader 侧）

**Files:**
- Modify: `web/src/components/reader.tsx`（`ReaderProps` 新增 `hoveredNoteId`/`onNoteHover`/`onNoteAnchorClick`；组件参数解构同步；Task 2 的笔记注入 effect 里给每个 mark 挂监听；新增一个 `hoveredNoteId` 同步 effect）

**Interfaces:**
- Consumes: Task 2 产出的 `<mark class="vdl-note-anchor" data-note-id="...">`
- Produces: `Reader` 组件新增 props：
  ```ts
  hoveredNoteId?: string | null;
  onNoteHover?: (id: string | null) => void;
  onNoteAnchorClick?: (id: string) => void;
  ```
  Task 5 会把 `tasks.$id.tsx` 里的状态传给这三个 prop。

无自动化测试（本任务范围内的交互回调不写单元测试，见 Global Constraints）——用 Step 2 的 `tsc` 类型检查代替，交互本身在 Task 6 手动验证。

- [ ] **Step 1: 更新 `ReaderProps`、组件签名，并给笔记标记挂事件、新增 `hoveredNoteId` 同步 effect**

把 `ReaderProps` 里 Task 2 新增的 `notes?: ...` 那一行之后加三行：

```ts
  notes?: Pick<Note, 'id' | 'anchor'>[];
  hoveredNoteId?: string | null;
  onNoteHover?: (id: string | null) => void;
  onNoteAnchorClick?: (id: string) => void;
```

组件签名（Task 2 结果基础上）加上新参数：

```ts
export function Reader({ taskId, content, frontmatter, highlights, notes, onAnchorSelect, onAddHighlight, onDeleteHighlight, hoveredNoteId, onNoteHover, onNoteAnchorClick }: ReaderProps) {
```

把 Task 2 新增的笔记锚点注入 effect：

```ts
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const anchored = notes?.length ? notes.filter((n) => n.anchor) : [];
    injectAnchorMarks(article, anchored, 'vdl-note-anchor', (mark, note) => {
      mark.dataset.noteId = note.id;
    });
  }, [notes, md]);
```

改成（`decorate` 回调里给每个新建的 mark 挂原生事件监听——mark 元素是每次 effect 重跑时重新 `document.createElement` 出来的，旧的会随 `injectAnchorMarks` 里的 `replaceWith` 一起被整体替换掉，不需要手动 `removeEventListener`）：

```ts
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const anchored = notes?.length ? notes.filter((n) => n.anchor) : [];
    injectAnchorMarks(article, anchored, 'vdl-note-anchor', (mark, note) => {
      mark.dataset.noteId = note.id;
      mark.addEventListener('mouseenter', () => onNoteHover?.(note.id));
      mark.addEventListener('mouseleave', () => onNoteHover?.(null));
      mark.addEventListener('click', () => onNoteAnchorClick?.(note.id));
    });
  }, [notes, md, onNoteHover, onNoteAnchorClick]);
```

紧接着（在这个 effect **之后**，保证声明顺序在后——React 保证同一组件内多个 effect 按声明顺序执行，这样每次 marks 被重新创建之后，这个 effect 才会重新按当前 `hoveredNoteId` 补上 `is-linked`）新增：

```ts
  // ── Reverse hover sync: sidebar card → article mark ──────────
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    article.querySelectorAll('mark.vdl-note-anchor').forEach((el) => {
      const markEl = el as HTMLElement;
      markEl.classList.toggle('is-linked', !!hoveredNoteId && markEl.dataset.noteId === hoveredNoteId);
    });
  }, [hoveredNoteId, notes, md]);
```

- [ ] **Step 2: 类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: 无报错输出（exit code 0）

- [ ] **Step 3: 运行现有 Reader 测试，确认没有回归**

Run: `cd web && npx vitest run src/components/reader.test.tsx`
Expected: `Test Files  1 passed (1)` / `Tests  4 passed (4)`

- [ ] **Step 4: Commit**

```bash
git add web/src/components/reader.tsx
git commit -m "feat(web): wire note-anchor hover/click callbacks and reverse hover sync"
```

---

### Task 4: 笔记卡片联动样式（`NoteItem` 的 `isLinked`/`autoEdit`）

**Files:**
- Modify: `web/src/components/notes-panel.tsx`（`NotesPanelProps` 新增字段；`NoteItem` 函数新增 props + effect + `<li>` 样式/事件；`NotesPanel` 函数体新增 fallback 常量；两处 `<NoteItem>` 调用点新增 props）

**Interfaces:**
- Consumes: 无（本任务只新增 prop，不依赖其他任务的产出）
- Produces: `NotesPanel` 组件新增 props：
  ```ts
  hoveredNoteId?: string | null;
  onNoteHover?: (id: string | null) => void;
  focusNoteId?: string | null;
  onFocusConsumed?: () => void;
  ```
  Task 5 会把 `tasks.$id.tsx` 里的状态传给这四个 prop。

无自动化测试（`notes-panel.tsx` 目前没有任何测试文件先例，见 Global Constraints）——用 `tsc` 类型检查 + Task 6 手动验证代替。

- [ ] **Step 1: 更新 `NotesPanelProps` 接口**

把：

```ts
interface NotesPanelProps {
  taskId: string;
  hasMedia: boolean;
  pendingAnchor?: string;
  onAnchorConsumed?: () => void;
  articleRef?: RefObject<HTMLDivElement | null>;
}
```

改成：

```ts
interface NotesPanelProps {
  taskId: string;
  hasMedia: boolean;
  pendingAnchor?: string;
  onAnchorConsumed?: () => void;
  articleRef?: RefObject<HTMLDivElement | null>;
  hoveredNoteId?: string | null;
  onNoteHover?: (id: string | null) => void;
  focusNoteId?: string | null;
  onFocusConsumed?: () => void;
}
```

- [ ] **Step 2: 更新 `NoteItem` 函数签名，新增 `autoEdit` effect**

把：

```tsx
function NoteItem({
  note,
  onUpdate,
  onDelete,
  onHeightChange,
}: {
  note: Note;
  onUpdate: (body: string) => void;
  onDelete: () => void;
  onHeightChange: (id: string, h: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const liRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!liRef.current) return;
    const li = liRef.current;
    const ro = new ResizeObserver(() => {
      onHeightChange(note.id, li.offsetHeight);
    });
    ro.observe(li);
    return () => ro.disconnect();
  }, [note.id, onHeightChange]);
```

改成：

```tsx
function NoteItem({
  note,
  onUpdate,
  onDelete,
  onHeightChange,
  isLinked,
  onHover,
  autoEdit,
  onAutoEditConsumed,
}: {
  note: Note;
  onUpdate: (body: string) => void;
  onDelete: () => void;
  onHeightChange: (id: string, h: number) => void;
  isLinked: boolean;
  onHover: (id: string | null) => void;
  autoEdit: boolean;
  onAutoEditConsumed: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const liRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!liRef.current) return;
    const li = liRef.current;
    const ro = new ResizeObserver(() => {
      onHeightChange(note.id, li.offsetHeight);
    });
    ro.observe(li);
    return () => ro.disconnect();
  }, [note.id, onHeightChange]);

  useEffect(() => {
    if (!autoEdit) return;
    setEditing(true);
    liRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    onAutoEditConsumed();
  }, [autoEdit, onAutoEditConsumed]);
```

- [ ] **Step 3: 更新 `<li>` 的样式和事件**

把：

```tsx
  return (
    <li
      ref={liRef}
      className="px-4 py-3 group"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
```

改成：

```tsx
  return (
    <li
      ref={liRef}
      className="px-4 py-3 group"
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        background: isLinked ? 'var(--accent-3)' : undefined,
        boxShadow: isLinked ? 'inset 2px 0 0 var(--accent-9)' : undefined,
        transition: 'background 120ms, box-shadow 120ms',
      }}
      onMouseEnter={() => onHover(note.id)}
      onMouseLeave={() => onHover(null)}
    >
```

- [ ] **Step 4: 更新 `NotesPanel` 函数签名和两处 `<NoteItem>` 调用点**

把：

```tsx
export function NotesPanel({ taskId, hasMedia, pendingAnchor, onAnchorConsumed, articleRef }: NotesPanelProps) {
```

改成：

```tsx
export function NotesPanel({ taskId, hasMedia, pendingAnchor, onAnchorConsumed, articleRef, hoveredNoteId, onNoteHover, focusNoteId, onFocusConsumed }: NotesPanelProps) {
```

在 `const [positions, setPositions] = useState<Record<string, number>>({});` 之后新增两个 fallback 常量：

```tsx
  const handleNoteHover = onNoteHover ?? (() => {});
  const handleFocusConsumed = onFocusConsumed ?? (() => {});
```

第一处 `<NoteItem>`（unanchored 分组内）：

```tsx
          {unanchored.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              onHeightChange={onHeightChange}
              onUpdate={(body) => updateNote.mutate({ noteId: note.id, body })}
              onDelete={() => deleteNote.mutate(note.id)}
            />
          ))}
```

改成：

```tsx
          {unanchored.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              onHeightChange={onHeightChange}
              onUpdate={(body) => updateNote.mutate({ noteId: note.id, body })}
              onDelete={() => deleteNote.mutate(note.id)}
              isLinked={hoveredNoteId === note.id}
              onHover={handleNoteHover}
              autoEdit={focusNoteId === note.id}
              onAutoEditConsumed={handleFocusConsumed}
            />
          ))}
```

第二处 `<NoteItem>`（anchored 分组内）：

```tsx
              <NoteItem
                note={note}
                onHeightChange={onHeightChange}
                onUpdate={(body) => updateNote.mutate({ noteId: note.id, body })}
                onDelete={() => deleteNote.mutate(note.id)}
              />
```

改成：

```tsx
              <NoteItem
                note={note}
                onHeightChange={onHeightChange}
                onUpdate={(body) => updateNote.mutate({ noteId: note.id, body })}
                onDelete={() => deleteNote.mutate(note.id)}
                isLinked={hoveredNoteId === note.id}
                onHover={handleNoteHover}
                autoEdit={focusNoteId === note.id}
                onAutoEditConsumed={handleFocusConsumed}
              />
```

- [ ] **Step 5: 类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: 无报错输出（exit code 0）

- [ ] **Step 6: Commit**

```bash
git add web/src/components/notes-panel.tsx
git commit -m "feat(web): add hover-link and auto-edit states to NoteItem"
```

---

### Task 5: 在 `tasks.$id.tsx` 里接上共享状态

**Files:**
- Modify: `web/src/routes/tasks.$id.tsx`（`import` 增加 `useNotes`；新增 `notes`/`hoveredNoteId`/`focusNoteId` 状态；`<Reader>`/`<NotesPanel>` 渲染处新增 props）

**Interfaces:**
- Consumes:
  - `useNotes(taskId: string | undefined)` from `@/hooks/use-tasks`（已存在，返回 `{ data: Note[] | undefined, ... }`，与 `NotesPanel` 内部调用共享 React Query 缓存，不会多发请求）
  - Task 3 产出的 `Reader` props：`notes`、`hoveredNoteId`、`onNoteHover`、`onNoteAnchorClick`
  - Task 4 产出的 `NotesPanel` props：`hoveredNoteId`、`onNoteHover`、`focusNoteId`、`onFocusConsumed`
- Produces: 无（本任务是最终的状态接线，其他任务不依赖它）

- [ ] **Step 1: 新增 `useNotes` import**

把第 3 行：

```ts
import { useTask, useContent, useReveal, useMediaInfo, useHighlights, useAddHighlight, useDeleteHighlight } from '@/hooks/use-tasks';
```

改成：

```ts
import { useTask, useContent, useReveal, useMediaInfo, useHighlights, useAddHighlight, useDeleteHighlight, useNotes } from '@/hooks/use-tasks';
```

- [ ] **Step 2: 新增状态**

把：

```ts
  const [pendingAnchor, setPendingAnchor] = useState<string>('');
  const articleRef = useRef<HTMLDivElement>(null);
```

改成：

```ts
  const [pendingAnchor, setPendingAnchor] = useState<string>('');
  const { data: notes = [] } = useNotes(id);
  const [hoveredNoteId, setHoveredNoteId] = useState<string | null>(null);
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
  const articleRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 3: 更新 `<Reader>` 渲染**

把：

```tsx
                    <Reader
                      taskId={id}
                      content={content}
                      frontmatter={tab === 'article' ? task.frontmatter : undefined}
                      highlights={highlights}
                      onAnchorSelect={(anchor) => setPendingAnchor(anchor)}
                      onAddHighlight={(anchor, color) => addHighlight.mutate({ anchor, color })}
                      onDeleteHighlight={(hlId) => deleteHighlight.mutate(hlId)}
                    />
```

改成：

```tsx
                    <Reader
                      taskId={id}
                      content={content}
                      frontmatter={tab === 'article' ? task.frontmatter : undefined}
                      highlights={highlights}
                      notes={notes}
                      onAnchorSelect={(anchor) => setPendingAnchor(anchor)}
                      onAddHighlight={(anchor, color) => addHighlight.mutate({ anchor, color })}
                      onDeleteHighlight={(hlId) => deleteHighlight.mutate(hlId)}
                      hoveredNoteId={hoveredNoteId}
                      onNoteHover={setHoveredNoteId}
                      onNoteAnchorClick={setFocusNoteId}
                    />
```

- [ ] **Step 4: 更新 `<NotesPanel>` 渲染**

把：

```tsx
                    <NotesPanel
                      taskId={id}
                      hasMedia={!!mediaKind}
                      pendingAnchor={pendingAnchor}
                      onAnchorConsumed={() => setPendingAnchor('')}
                      articleRef={articleRef}
                    />
```

改成：

```tsx
                    <NotesPanel
                      taskId={id}
                      hasMedia={!!mediaKind}
                      pendingAnchor={pendingAnchor}
                      onAnchorConsumed={() => setPendingAnchor('')}
                      articleRef={articleRef}
                      hoveredNoteId={hoveredNoteId}
                      onNoteHover={setHoveredNoteId}
                      focusNoteId={focusNoteId}
                      onFocusConsumed={() => setFocusNoteId(null)}
                    />
```

- [ ] **Step 5: 类型检查 + 完整前端测试套件**

Run: `cd web && npx tsc --noEmit`
Expected: 无报错输出（exit code 0）

Run: `cd web && npm test`
Expected: 所有测试文件通过，`reader.test.tsx` 显示 4 passed（Task 2 新增的 2 条），其余文件数量与改动前一致

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/tasks.$id.tsx
git commit -m "feat(web): wire note-anchor highlight state through tasks.\$id.tsx"
```

---

### Task 6: 手动 QA + 完整回归

**Files:** 无代码改动（除非手动验证发现问题，需要回到对应任务的文件修复）

**Interfaces:** 无

- [ ] **Step 1: 前端构建**

Run: `cd web && npm run build`
Expected: 构建成功（`tsc` 类型检查 + `vite build` 都无错误），产物写入 `web/dist/`

- [ ] **Step 2: 前端完整测试套件**

Run: `cd web && npm test`
Expected: 全部通过，测试总数比改动前多 2（Task 2 新增的 note-anchor 用例）

- [ ] **Step 3: 后端测试套件（本次未改动后端，确认没有意外回归）**

Run: `npm test`（项目根目录）
Expected: `33 passed, 0 failed` + `7 passed, 0 failed`（与 Task 开始前的基线一致）

- [ ] **Step 4: 手动走查（`cd web && npm run dev`，打开一篇有正文的文章任务）**

逐条确认：
- 选中一段正文文字并创建笔记 → 正文出现暖灰色块 + 点状下划线的标记，和黄/绿/红实色块、蓝色下划线的高亮明显不同。
- 鼠标悬停在正文的笔记标记上 → 侧栏对应笔记卡片背景变浅绿、左侧出现强调条；如果卡片本来不在可视区域，会自动滚动到可见。
- 鼠标悬停在侧栏的笔记卡片上 → 正文里对应的锚点标记同步高亮（背景加深、下划线变绿、外圈出现细边框）。
- 点击正文里的笔记标记 → 对应笔记卡片滚动到可见并进入编辑态（`textarea` 出现，带绿色描边），卡片本身不叠加多余的绿色背景/边框。
- 已有高亮功能不受影响：选中文字后能正常选颜色打高亮；右键高亮标记仍能弹出"删除高亮"并生效。
- 不选中正文、直接在底部输入框写的笔记（无 anchor）→ 正常出现在"unanchored"分组，正文里没有任何标记，控制台没有报错。

- [ ] **Step 5: 如果手动走查发现问题**

回到对应任务的文件修复，重新跑该任务的验证步骤（Step 1-5 视具体任务而定），修复完成后单独提交：

```bash
git add <fixed files>
git commit -m "fix(web): <具体描述>"
```

如果手动走查全部通过，本任务无需提交。
