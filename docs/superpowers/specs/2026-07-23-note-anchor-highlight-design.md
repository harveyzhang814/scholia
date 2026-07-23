# 笔记锚点正文标记 + 侧栏双向联动

## 概述

笔记功能里选中一段文字创建笔记时，这段"锚点"文字目前在正文里没有任何视觉标记——只被 `notes-panel.tsx` 的 `resolveAnchorY()` 用来计算笔记卡片在侧栏的垂直位置。本设计给笔记锚点新增一套独立于高亮（`mark.vdl-hl`）的正文标记样式，并让正文标记与侧栏笔记卡片双向悬停联动、点击正文标记可跳转到对应笔记卡片并进入编辑态。

## 背景与现状确认

- `reader.tsx:133-184` 现有的高亮注入 `useEffect`：对 `highlights` prop 里每条 `Highlight` 的 `anchor`，用 `TreeWalker` 在正文文本节点里定位、`splitText` 切割后包一层 `<mark class="vdl-hl" data-color="...">`。颜色由 `data-color` 决定（黄/绿/红实色底、蓝色下划线），样式在 `globals.css:403-411`。
- `notes-panel.tsx` 里 `Note.anchor` 目前只喂给 `resolveAnchorY(anchor, articleEl)`（16-32 行），用于把笔记卡片定位到锚点所在段落的 `offsetTop`——正文里没有任何 DOM 标记，选中/保存过程都只有浏览器原生选区反馈。
- `tasks.$id.tsx` 目前只调用 `useHighlights(id)` 把 `highlights` 传给 `Reader`；`useNotes(id)` 只在 `NotesPanel` 内部调用（`notes-panel.tsx:136`），父组件并不持有 notes 数据。
- 已经通过 `/sync-design` 设计稿验证过视觉方案（`.hskill/sync-design/html/drafts/task-detail-article-web-design.html`）：笔记锚点用**暖灰色块（`border-strong` 低透明度）+ 点状下划线**标记，联动强调态复用品牌唯一 accent（sage green，`--accent-9`/`--accent-3`）。刻意不用紫色——`DESIGN.md` 明确写着"无紫色/渐变"是反 AI-slop 约束之一。设计稿迭代中还发现并修掉了一个问题：编辑态如果给卡片整体叠加 `is-linked`（背景色+边框），会和 textarea 自身的 accent 描边形成"绿框套绿框"，改为编辑态只保留正文锚点的联动色，卡片本身不再叠加。

## 用户故事

- 作为用户选中文字创建笔记后，我能在正文里一眼看出这段文字是笔记锚点，且样式和高亮明显不同，不会混淆。
- 悬停正文里的笔记锚点时，侧栏对应笔记卡片会高亮并滚动到可见，不用自己去翻侧栏找是哪条笔记。
- 反过来悬停侧栏笔记卡片时，正文里对应锚点也会高亮，方便定位回原文段落。
- 点击正文里的笔记锚点，直接跳到对应笔记卡片并进入编辑态，不用先手动滚动侧栏再点"编辑"。

## 架构设计

### 1. `reader.tsx`

- 新增 prop：`notes?: Pick<Note, 'id' | 'anchor'>[]`。
- 把现有高亮注入算法（133-184 行的 `TreeWalker` 定位 + `splitText` + 包 `mark` 逻辑）抽成一个参数化的共享 helper，例如：
  ```ts
  function injectAnchorMarks(
    article: HTMLElement,
    items: { id: string; anchor: string }[],
    markClass: string,
    setDataset: (mark: HTMLElement, item: typeof items[number]) => void,
  ) { /* 原 133-184 行逻辑，anchor/className/dataset 参数化 */ }
  ```
  分别用它处理 `highlights`（`markClass='vdl-hl'`，写入 `data-hl-id`/`data-color`）和 `notes`（`markClass='vdl-note-anchor'`，写入 `data-note-id`）。两者各自的 `useEffect` 先 `querySelectorAll('mark.<own-class>')` 解绑再重新注入，互不干扰。
- 新增 props：`hoveredNoteId?: string | null`、`onNoteHover?: (id: string | null) => void`、`onNoteAnchorClick?: (id: string) => void`。
- 笔记标记注入时，给每个 `<mark class="vdl-note-anchor" data-note-id="...">` 挂原生 `mouseenter`/`mouseleave`/`click` 监听（在注入时创建，随下次 unwrap 一起被替换，不需要显式移除）：
  - `mouseenter` → `onNoteHover?.(noteId)`
  - `mouseleave` → `onNoteHover?.(null)`
  - `click` → `onNoteAnchorClick?.(noteId)`
- 新增一个小 `useEffect`（依赖 `hoveredNoteId`）：找到 `article.querySelector('mark.vdl-note-anchor[data-note-id="' + hoveredNoteId + '"]')`，切换其 `is-linked` class（用于侧栏卡片悬停时反向点亮正文锚点）。

### 2. `globals.css` 新增（沿用设计稿最终确认的样式，未叠加多余的 `border-color`/`box-shadow` 组合）

```css
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

### 3. `notes-panel.tsx` / `NoteItem`

- `NotesPanel` 新增 props：`hoveredNoteId?: string | null`、`onNoteHover?: (id: string | null) => void`、`focusNoteId?: string | null`、`onFocusConsumed?: () => void`，逐一透传给对应 `NoteItem`。
- `NoteItem` 新增 `isLinked: boolean` prop：为真时给 `<li>` 加 `.is-linked`（只用背景色 + 左侧强调条一种手法，不叠加 `border-color`，避免圆角处描边粗细不一致）：
  ```css
  .note-item.is-linked {
    background: var(--accent-3);
    box-shadow: inset 2px 0 0 var(--accent-9);
  }
  ```
- `NoteItem` 新增 `autoEdit: boolean` + `onAutoEditConsumed: () => void` props：`autoEdit` 变为 `true` 时的 `useEffect` 调用 `setEditing(true)`、`liRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })`，然后调用 `onAutoEditConsumed()` 让父组件把 `focusNoteId` 清空（防止重渲染时重复触发，模式与现有 `pendingAnchor`/`onAnchorConsumed` 一致）。**编辑态本身不叠加 `.is-linked`**——现有编辑态样式（`textarea` 的 `border: 1px solid var(--accent-9)`）已经足够表达"可编辑"，卡片外层再套一层强调色会重复。
- `<li>` 挂 `onMouseEnter`/`onMouseLeave` 触发 `onNoteHover?.(note.id)` / `(null)`。
- `isLinked` 为真时（不论来源是正文悬停还是卡片自身悬停）统一调用 `scrollIntoView({ block: 'nearest' })`——已可见时是空操作，不会有跳动感。

### 4. `tasks.$id.tsx` 改动（父组件承担共享状态）

- 新增 `const { data: notes = [] } = useNotes(id)`——`NotesPanel` 内部也在调用同一个 hook，React Query 按 `queryKey: ['task', id, 'notes']` 去重，不会多打一次网络请求，只是共享同一份缓存（与 `highlights` 已有的用法一致）。
- 新增 `const [hoveredNoteId, setHoveredNoteId] = useState<string | null>(null)`。
- 新增 `const [focusNoteId, setFocusNoteId] = useState<string | null>(null)`。
- 传给 `Reader`：`notes={notes} hoveredNoteId={hoveredNoteId} onNoteHover={setHoveredNoteId} onNoteAnchorClick={setFocusNoteId}`。
- 传给 `NotesPanel`：`hoveredNoteId={hoveredNoteId} onNoteHover={setHoveredNoteId} focusNoteId={focusNoteId} onFocusConsumed={() => setFocusNoteId(null)}`。

## 数据流

```
useNotes(id)（React Query，与 NotesPanel 共享缓存）
        │
        ▼
tasks.$id.tsx: notes[]
        │
        ├──────────────► <Reader notes={notes} .../>
        │                    │ injectAnchorMarks(article, notes, 'vdl-note-anchor', ...)
        │                    ▼
        │                <mark class="vdl-note-anchor" data-note-id>（正文）
        │                    │ mouseenter/mouseleave/click（原生监听）
        │                    ▼
        │                onNoteHover(id|null) / onNoteAnchorClick(id)
        │                    │
        ▼                    ▼
hoveredNoteId ◄──────────────┘                  focusNoteId
        │                                              │
        ▼                                              ▼
<NotesPanel hoveredNoteId .../>                <NotesPanel focusNoteId .../>
        │                                              │
        ▼                                              ▼
<NoteItem isLinked={id===hoveredNoteId}>       <NoteItem autoEdit={id===focusNoteId}>
        │ onMouseEnter/onMouseLeave                    │ setEditing(true) + scrollIntoView
        ▼                                              ▼
onNoteHover(id|null) ──────► hoveredNoteId      onAutoEditConsumed() ──► focusNoteId=null
        │（反向：卡片→正文锚点 is-linked）
        ▼
Reader 的 hoveredNoteId effect → mark[data-note-id].classList.toggle('is-linked')
```

## 边界情况

- 无锚点的笔记（`anchor` 为空）→ 跳过标记注入，与现有 `notes.filter(n => !n.anchor)`（unanchored 分组）逻辑一致，不受影响。
- 笔记锚点文本在正文中找不到匹配（内容改动过）→ `injectAnchorMarks` 内部 `indexOf` 返回 `-1` 时 `continue`，不报错，与现有高亮逻辑一致。
- 高亮与笔记锚点文本重叠 → 两个 `<mark>` 会嵌套，颜色叠加显示，本次不做特殊冲突处理，视觉上可接受。
- 同一段文字被多条笔记标记（多个笔记锚点重叠）→ 各自生成一个 `<mark class="vdl-note-anchor">` 并嵌套，事件通过 `closest('mark.vdl-note-anchor')` 只命中最外层——已知局限，不在本次范围内解决。
- 点击/悬停触发的编辑态：不叠加卡片背景色/边框（`.is-linked`），只保留 `textarea` 自身的 accent 描边，避免"绿框套绿框"（已在设计稿中验证修复）。

## 测试策略

现有代码库对 `Reader`/`NotesPanel` 没有组件测试先例，本次也不新增（DOM 注入 + 原生事件监听的测试成本明显高于收益），采用手动验证：

- `cd web && npm run dev` 起服务，打开一篇文章任务：
  - 选中文字创建笔记 → 正文出现暖灰色 `note-anchor` 标记，与高亮（黄/绿/红/蓝）明显区分。
  - 悬停正文锚点 → 侧栏对应笔记卡片高亮 + 滚动到可见。
  - 悬停侧栏笔记卡片 → 正文对应锚点高亮。
  - 点击正文锚点 → 笔记卡片进入编辑态，且卡片本身不叠加多余的绿色边框/背景。
  - 已有高亮功能（颜色选择、右键删除）不受影响。
  - 无锚点的笔记（首页手动新增、不选中正文时写的笔记）正常显示在 unanchored 分组，无标记、无报错。
- `cd web && npm run build`（`tsc` 类型检查）+ `cd web && npm test` + 根目录 `npm test` 作为回归验证。

## 风险和缓解

- **风险**：高亮和笔记锚点各自独立的 DOM 注入 `useEffect` 在同一篇 `article` 上操作，如果两者 anchor 重叠、注入顺序变化，可能导致 `mark` 嵌套结构不稳定。
  **缓解**：两个 effect 复用同一套"先按自己的 class 解绑、再重新注入"模式（参数化的共享 helper 保证逻辑一致），高亮 effect 先于笔记 effect 声明和执行；已在设计稿中验证嵌套时的视觉效果可接受，不做更复杂的冲突解决算法（YAGNI）。
- **风险**：`tasks.$id.tsx` 新增 `notes`/`hoveredNoteId`/`focusNoteId` 三个状态，让这个已经承担较多职责的路由组件更臃肿。
  **缓解**：这三个是 `Reader` 与 `NotesPanel` 之间必须共享的最小状态集合，暂不引入 Context 或额外状态管理层；如果后续这层继续膨胀，再考虑抽取成一个专门的 `useNoteAnchorLink` hook，本次不预先设计。
