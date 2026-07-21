# Web 列表排序选项 设计文档

## 概述

首页列表（`web/src/routes/_index.tsx`）目前视频/文章两个 tab 都按 API 返回的原始顺序展示，无任何排序能力。本设计为每个 tab 独立增加排序选项（日期/标题/[仅视频]作者），支持升降序切换，排序偏好按 tab 分别持久化到 `localStorage`。

## 背景

- 首页只有两个 tab：`video`、`article`（`web/src/stores/ui-store.ts` 的 `HomeTab` 类型），状态存于 `useUiStore.homeTab`，**不持久化**，刷新即重置为 `'video'`。
- 现有唯一的列表控制是搜索框（`_index.tsx` 内 `searchQuery`，客户端子串过滤），无任何 `.sort()` 调用。
- 数据字段：
  - `Task`（视频，`web/src/lib/api.ts`）：`title`、`uploader`、`upload_date`（字符串，可能缺失）、`created_at`（数字，导入时间）。
  - `Article`（文章）：`title`、`date`（可选字符串）、`updatedAt`（数字，文件 mtime）。**没有 author 字段**，且文章 frontmatter 也未被后端提取 author。
- 已有的"偏好持久化到 localStorage"范式：`ui-store.ts` 里的 `proseTheme` / `subtitleScale`——初始化时读 `localStorage`，setter 内先 `localStorage.setItem` 再 `set(...)`。`homeTab` 本身不走这个范式（不持久化）。
- 现有"多选一"UI 范式是按钮组（tab 栏、`filter-bar.tsx`），代码库里没有 `<select>` 组件先例。

## 用户故事

- 作为用户，在视频 tab 我可以按日期、标题或作者排序，并可以切换升序/降序。
- 作为用户，在文章 tab 我可以按日期或标题排序（无作者选项，因为文章没有作者数据），并可以切换升序/降序。
- 作为用户，我设置的排序方式在切换 tab 时互不影响，刷新页面或重新打开后仍然保留。

## 架构设计

### 1. 范围与字段（明确排除项）

- **文章 tab 不提供"按作者排序"**：现有后端完全没有 article author 数据，不在本次范围内新增后端字段提取逻辑。
- 视频 tab 的"日期"排序字段用 `upload_date`（视频在原平台的发布日期），而非 `created_at`。
- 文章 tab 的"日期"排序字段用 `date`，`date` 缺失时 fallback 到 `updatedAt`。

### 2. 排序状态（`ui-store.ts`）

新增类型与字段：

```ts
export type SortField = 'date' | 'title' | 'author';
export type SortDirection = 'asc' | 'desc';
export interface SortState {
  field: SortField;
  direction: SortDirection;
}

videoSort: SortState;      // 默认 { field: 'date', direction: 'desc' }
articleSort: SortState;    // 默认 { field: 'date', direction: 'desc' }
setVideoSort: (sort: SortState) => void;
setArticleSort: (sort: SortState) => void;
```

- 初始化：`localStorage.getItem('home-sort-video')` / `'home-sort-article'`，JSON 解析，解析失败或字段非法（`field` 不在 `['date','title','author']` 或文章拿到 `'author'`）时回退默认值。
- setter：先 `localStorage.setItem(key, JSON.stringify(sort))`，再 `set(...)`，与 `proseTheme` 写法一致。
- 文章的 `articleSort.field` 不允许为 `'author'`——由 UI 层（`SortSelect` 只渲染合法选项）保证，store 层不做强校验。

### 3. `SortSelect` 组件（新文件 `web/src/components/sort-select.tsx`）

```tsx
interface SortSelectProps {
  value: SortState;
  onChange: (sort: SortState) => void;
  fields: { value: SortField; label: string }[]; // 由调用方按 tab 传入合法选项
}
```

- 左侧一个原生 `<select>`（首个代码库里的下拉组件，样式跟随现有 `--border-subtle` / `--bg-surface` CSS 变量，贴着搜索框摆放），列出 `fields` 中的选项。
- 右侧一个方向切换图标按钮（↑/↓），点击反转 `value.direction`，与 select 变更同样调用 `onChange`。
- 纯受控组件，不直接碰 `useUiStore`，方便测试；`_index.tsx` 里按当前 tab 传入 `videoSort`/`articleSort` 及对应的 `fields`（视频三项，文章两项）。

### 4. `_index.tsx` 改动

- 引入 `SortSelect`，渲染在搜索框旁边（同一行），随 `tab` 切换传入不同的 `value`/`onChange`/`fields`。
- 新增纯函数排序比较器（可放在 `web/src/lib/sort.ts`）：
  ```ts
  function compareBy<T>(a: T, b: T, getValue: (item: T) => string | number | undefined, direction: SortDirection): number
  ```
  - `undefined`/空字符串值始终排在末尾，不受 `direction` 影响。
  - 字符串按本地化比较（`localeCompare`），数字/日期字符串按数值或字符串字典序比较（`upload_date` 形如 `YYYYMMDD`，字典序等价于时间序，无需转 Date）。
- 在现有 `filteredTasks` / `filteredArticles`（搜索过滤之后）基础上，用当前 tab 的 `SortState` 排序后再 `.map()` 渲染。

## 数据流

```
localStorage['home-sort-video' | 'home-sort-article']
        │ (初始化读取)
        ▼
ui-store.{video,article}Sort ──(setVideoSort/setArticleSort)──> SortSelect
        │
        ▼ (读取，随 homeTab 切换选取对应状态)
_index.tsx: filteredTasks/filteredArticles
        │ .sort(compareBy(..., activeSort))
        ▼
渲染的卡片列表顺序
```

## 错误处理

- `localStorage` 中的排序 JSON 损坏或字段非法 → 初始化时捕获解析异常，回退到默认 `{ field: 'date', direction: 'desc' }`，与 `subtitleScale` 对非法值做 clamp 的防御思路一致。
- 排序字段对应的值缺失（如视频没有 `uploader`、文章没有 `date` 且 `updatedAt` 也异常）→ 缺失值统一排到列表末尾，不抛错、不影响其余项排序。

## 测试策略

- `web/src/lib/sort.test.ts`（新文件）：纯函数单测覆盖 `compareBy` 的日期/标题/作者、升/降序、缺失值排末尾等分支。
- `ui-store.test.ts` 补充 `videoSort`/`articleSort` 用例：默认值、setter 更新与持久化、从 `localStorage` 初始化（含非法 JSON 回退默认值）。
- 手动验证（`cd web && npm run dev`）：
  - 视频 tab 切换日期/标题/作者三种排序，及升降序图标，确认列表顺序符合预期，缺失 `uploader` 的卡片排在最后。
  - 文章 tab 确认只有日期/标题两个选项（无作者），排序生效。
  - 切换 tab 互不影响对方排序状态；刷新页面后两个 tab 的排序偏好都保留。
- `cd web && npm test` 与 `cd web && npm run build`（tsc 检查）作为回归验证。

## 风险和缓解

- **风险**：视频 `upload_date` 格式依赖 yt-dlp 写入的 `YYYYMMDD` 字符串约定，若某些 meta.json 里格式不一致（如带分隔符），字典序比较会出错。
  **缓解**：本次不做日期解析容错，若后续发现异常格式再补齐；范围内假设现有数据格式一致（与现状 `parseDateStr` 逻辑的假设一致）。
- **风险**：新增 `<select>` 是代码库首次引入原生下拉，视觉上可能与现有按钮组风格不完全统一。
  **缓解**：样式复用现有 CSS 变量（`--border-subtle`/`--bg-surface`/`--text-primary`），视觉对齐搜索框；后续如需统一为按钮组可再迭代，不阻塞本次功能交付。
