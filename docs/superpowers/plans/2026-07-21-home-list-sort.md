# Web 列表排序选项 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-tab sort controls (date/title/[video-only]author, with asc/desc toggle) to the web home list, persisted per tab in `localStorage`.

**Architecture:** All sorting happens client-side on the already-fetched `Task[]`/`Article[]` arrays, after the existing search filter. A new pure module (`web/src/lib/sort.ts`) holds the comparator and per-entity sort-value extraction. Sort preference (field + direction) is new state in the existing `useUiStore` zustand store, one independent slice per tab, following the same manual-localStorage-sync pattern already used for `proseTheme`/`subtitleScale`. A new `SortSelect` component (native `<select>` + direction-toggle button) renders next to the existing search box in `web/src/routes/_index.tsx` and swaps its bound state/options based on the active tab.

**Tech Stack:** React 19 + TypeScript, Zustand (state), Vitest + @testing-library/react (tests). No new dependencies.

## Global Constraints

- Video tab "date" sort field is `Task.upload_date` (string `YYYYMMDD`) — **no fallback** to `created_at`; a task missing `upload_date` sorts to the end.
- Article tab "date" sort field is `Article.date`; when missing (or unparseable), falls back to `Article.updatedAt`.
- Article tab never offers an "author" sort option — there is no author field on `Article`. The `SortField` type still includes `'author'` (shared type with video), but `sortArticles` defensively treats `'author'` the same as `'title'` and the UI never passes `'author'` into the article `fields` list.
- Any sort field's value that is missing/`undefined` sorts to the end of the list, **regardless of sort direction**.
- Default sort for both tabs: `{ field: 'date', direction: 'desc' }`.
- Sort preference persists to `localStorage` under keys `home-sort-video` and `home-sort-article`, independently per tab — matches the existing `proseTheme`/`subtitleScale` persistence pattern in `web/src/stores/ui-store.ts` (init-from-localStorage + write-through setter, no zustand `persist` middleware).
- Malformed/invalid persisted JSON falls back to the default sort, never throws.

---

### Task 1: Sort utilities (`web/src/lib/sort.ts`)

**Files:**
- Create: `web/src/lib/sort.ts`
- Test: `web/src/lib/sort.test.ts`

**Interfaces:**
- Consumes: `Task`, `Article` types from `web/src/lib/api.ts` (already exist — `Task.title?`, `Task.uploader?`, `Task.upload_date?`; `Article.title`, `Article.date?`, `Article.updatedAt`).
- Produces (used by Tasks 2, 3, 4):
  - `export type SortField = 'date' | 'title' | 'author';`
  - `export type SortDirection = 'asc' | 'desc';`
  - `export interface SortState { field: SortField; direction: SortDirection; }`
  - `export const DEFAULT_SORT: SortState = { field: 'date', direction: 'desc' };`
  - `export function compareBy<T>(a: T, b: T, getValue: (item: T) => string | number | undefined, direction: SortDirection): number`
  - `export function sortTasks(tasks: Task[], sort: SortState): Task[]` (returns a new array, does not mutate input)
  - `export function sortArticles(articles: Article[], sort: SortState): Article[]` (returns a new array, does not mutate input)

- [ ] **Step 1: Write the failing tests**

Create `web/src/lib/sort.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { compareBy, sortTasks, sortArticles } from './sort';
import type { Task } from './api';
import type { Article } from './api';

describe('compareBy', () => {
  it('compares numbers ascending and descending', () => {
    expect(compareBy(1, 2, (n: number) => n, 'asc')).toBeLessThan(0);
    expect(compareBy(2, 1, (n: number) => n, 'asc')).toBeGreaterThan(0);
    expect(compareBy(1, 2, (n: number) => n, 'desc')).toBeGreaterThan(0);
  });

  it('compares strings with localeCompare', () => {
    expect(compareBy('a', 'b', (s: string) => s, 'asc')).toBeLessThan(0);
    expect(compareBy('b', 'a', (s: string) => s, 'desc')).toBeLessThan(0);
  });

  it('sorts undefined values to the end regardless of direction', () => {
    expect(compareBy<number | undefined>(undefined, 1, (n) => n, 'asc')).toBeGreaterThan(0);
    expect(compareBy<number | undefined>(1, undefined, (n) => n, 'asc')).toBeLessThan(0);
    expect(compareBy<number | undefined>(undefined, 1, (n) => n, 'desc')).toBeGreaterThan(0);
    expect(compareBy<number | undefined>(1, undefined, (n) => n, 'desc')).toBeLessThan(0);
  });

  it('treats two undefined values as equal', () => {
    expect(compareBy<number | undefined>(undefined, undefined, (n) => n, 'asc')).toBe(0);
  });
});

const baseTask: Task = {
  id: 't1',
  url: 'https://example.com',
  mode: 'media',
  status: 'done',
  created_at: 1000,
  updated_at: 1000,
};

describe('sortTasks', () => {
  it('sorts by date descending using upload_date', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 'a', upload_date: '20240101' },
      { ...baseTask, id: 'b', upload_date: '20240301' },
      { ...baseTask, id: 'c', upload_date: '20240201' },
    ];
    expect(sortTasks(tasks, { field: 'date', direction: 'desc' }).map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by date ascending', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 'a', upload_date: '20240101' },
      { ...baseTask, id: 'b', upload_date: '20240301' },
    ];
    expect(sortTasks(tasks, { field: 'date', direction: 'asc' }).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('sorts tasks missing upload_date to the end (no created_at fallback)', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 'a', upload_date: '20240101' },
      { ...baseTask, id: 'b' },
    ];
    expect(sortTasks(tasks, { field: 'date', direction: 'desc' }).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('sorts by title', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 'a', title: 'Zebra' },
      { ...baseTask, id: 'b', title: 'Apple' },
    ];
    expect(sortTasks(tasks, { field: 'title', direction: 'asc' }).map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('sorts by author, with missing uploader sorted last', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 'a', uploader: 'Bob' },
      { ...baseTask, id: 'b' },
      { ...baseTask, id: 'c', uploader: 'Alice' },
    ];
    expect(sortTasks(tasks, { field: 'author', direction: 'asc' }).map((t) => t.id)).toEqual(['c', 'a', 'b']);
  });

  it('does not mutate the input array', () => {
    const tasks: Task[] = [
      { ...baseTask, id: 'a', upload_date: '20240301' },
      { ...baseTask, id: 'b', upload_date: '20240101' },
    ];
    const original = tasks.map((t) => t.id);
    sortTasks(tasks, { field: 'date', direction: 'asc' });
    expect(tasks.map((t) => t.id)).toEqual(original);
  });
});

const baseArticle: Article = { id: 'a1', slug: 'a1', title: 'Article', updatedAt: 1000 };

describe('sortArticles', () => {
  it('sorts by date descending using the date field', () => {
    const articles: Article[] = [
      { ...baseArticle, id: 'a', date: '2024-01-01' },
      { ...baseArticle, id: 'b', date: '2024-03-01' },
    ];
    expect(sortArticles(articles, { field: 'date', direction: 'desc' }).map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('falls back to updatedAt when date is missing', () => {
    const articles: Article[] = [
      { ...baseArticle, id: 'a', date: '2024-01-01' },
      { ...baseArticle, id: 'b', updatedAt: 9_999_999_999_999 },
    ];
    expect(sortArticles(articles, { field: 'date', direction: 'desc' }).map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('sorts by title', () => {
    const articles: Article[] = [
      { ...baseArticle, id: 'a', title: 'Zebra' },
      { ...baseArticle, id: 'b', title: 'Apple' },
    ];
    expect(sortArticles(articles, { field: 'title', direction: 'asc' }).map((a) => a.id)).toEqual(['b', 'a']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/sort.test.ts`
Expected: FAIL — `Cannot find module './sort'` (file does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `web/src/lib/sort.ts`:

```ts
import type { Task, Article } from './api';

export type SortField = 'date' | 'title' | 'author';
export type SortDirection = 'asc' | 'desc';

export interface SortState {
  field: SortField;
  direction: SortDirection;
}

export const DEFAULT_SORT: SortState = { field: 'date', direction: 'desc' };

export function compareBy<T>(
  a: T,
  b: T,
  getValue: (item: T) => string | number | undefined,
  direction: SortDirection
): number {
  const av = getValue(a);
  const bv = getValue(b);
  if (av === undefined && bv === undefined) return 0;
  if (av === undefined) return 1;
  if (bv === undefined) return -1;

  const cmp = typeof av === 'number' && typeof bv === 'number'
    ? av - bv
    : String(av).localeCompare(String(bv));

  return direction === 'asc' ? cmp : -cmp;
}

function getTaskSortValue(field: SortField, task: Task): string | number | undefined {
  if (field === 'date') return task.upload_date ? parseInt(task.upload_date, 10) : undefined;
  if (field === 'author') return task.uploader;
  return task.title;
}

export function sortTasks(tasks: Task[], sort: SortState): Task[] {
  return [...tasks].sort((a, b) => compareBy(a, b, (t) => getTaskSortValue(sort.field, t), sort.direction));
}

function getArticleSortValue(field: SortField, article: Article): string | number | undefined {
  if (field === 'date') {
    if (article.date) {
      const parsed = Date.parse(article.date);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return article.updatedAt;
  }
  // 'author' has no backend data for articles — defensively fall back to title.
  return article.title;
}

export function sortArticles(articles: Article[], sort: SortState): Article[] {
  return [...articles].sort((a, b) => compareBy(a, b, (item) => getArticleSortValue(sort.field, item), sort.direction));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/sort.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/sort.ts web/src/lib/sort.test.ts
git commit -m "feat(web): add sort comparator utilities for home list"
```

---

### Task 2: Persisted per-tab sort state (`web/src/stores/ui-store.ts`)

**Files:**
- Modify: `web/src/stores/ui-store.ts`
- Modify: `web/src/stores/ui-store.test.ts`

**Interfaces:**
- Consumes: `SortState`, `DEFAULT_SORT` from `web/src/lib/sort.ts` (Task 1).
- Produces (used by Task 4):
  - `export function readSortState(key: string): SortState` — reads/validates a `SortState` from `localStorage[key]`, falling back to `DEFAULT_SORT`.
  - `useUiStore` state additions: `videoSort: SortState`, `setVideoSort: (sort: SortState) => void`, `articleSort: SortState`, `setArticleSort: (sort: SortState) => void`.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/stores/ui-store.test.ts` (after the existing `subtitleScale` describe block, keep the existing `import { useUiStore } from './ui-store';` line but change it to also import `readSortState`):

```ts
import { useUiStore, readSortState } from './ui-store';
```

(Replace the existing `import { useUiStore } from './ui-store';` line at the top of the file with the line above.)

Then append at the end of the file:

```ts
describe('readSortState', () => {
  beforeEach(() => localStorage.clear());

  it('returns the default sort when nothing is stored', () => {
    expect(readSortState('home-sort-video')).toEqual({ field: 'date', direction: 'desc' });
  });

  it('reads a valid stored value', () => {
    localStorage.setItem('home-sort-video', JSON.stringify({ field: 'author', direction: 'asc' }));
    expect(readSortState('home-sort-video')).toEqual({ field: 'author', direction: 'asc' });
  });

  it('falls back to the default when the stored value is malformed JSON', () => {
    localStorage.setItem('home-sort-video', 'not-json');
    expect(readSortState('home-sort-video')).toEqual({ field: 'date', direction: 'desc' });
  });

  it('falls back to the default when the stored field is invalid', () => {
    localStorage.setItem('home-sort-video', JSON.stringify({ field: 'bogus', direction: 'asc' }));
    expect(readSortState('home-sort-video')).toEqual({ field: 'date', direction: 'desc' });
  });

  it('falls back to the default when the stored direction is invalid', () => {
    localStorage.setItem('home-sort-video', JSON.stringify({ field: 'title', direction: 'sideways' }));
    expect(readSortState('home-sort-video')).toEqual({ field: 'date', direction: 'desc' });
  });
});

describe('ui-store videoSort', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ videoSort: { field: 'date', direction: 'desc' } });
  });

  it('defaults to date descending', () => {
    expect(useUiStore.getState().videoSort).toEqual({ field: 'date', direction: 'desc' });
  });

  it('setVideoSort updates state and persists to localStorage', () => {
    useUiStore.getState().setVideoSort({ field: 'author', direction: 'asc' });
    expect(useUiStore.getState().videoSort).toEqual({ field: 'author', direction: 'asc' });
    expect(localStorage.getItem('home-sort-video')).toBe(JSON.stringify({ field: 'author', direction: 'asc' }));
  });
});

describe('ui-store articleSort', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ articleSort: { field: 'date', direction: 'desc' } });
  });

  it('defaults to date descending', () => {
    expect(useUiStore.getState().articleSort).toEqual({ field: 'date', direction: 'desc' });
  });

  it('setArticleSort updates state and persists independently of videoSort', () => {
    useUiStore.getState().setArticleSort({ field: 'title', direction: 'asc' });
    expect(useUiStore.getState().articleSort).toEqual({ field: 'title', direction: 'asc' });
    expect(localStorage.getItem('home-sort-article')).toBe(JSON.stringify({ field: 'title', direction: 'asc' }));
    expect(useUiStore.getState().videoSort).toEqual({ field: 'date', direction: 'desc' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/stores/ui-store.test.ts`
Expected: FAIL — `readSortState` is not exported / `videoSort` is `undefined` on the store.

- [ ] **Step 3: Write the implementation**

In `web/src/stores/ui-store.ts`, add the import (after the existing `ThemeId` import):

```ts
import { DEFAULT_SORT, type SortState } from '@/lib/sort';
```

Add this exported helper function after `clampSubtitleScale` (before `interface UiState`):

```ts
export function readSortState(key: string): SortState {
  const raw = localStorage.getItem(key);
  if (!raw) return DEFAULT_SORT;
  try {
    const parsed = JSON.parse(raw);
    const validField = parsed?.field === 'date' || parsed?.field === 'title' || parsed?.field === 'author';
    const validDirection = parsed?.direction === 'asc' || parsed?.direction === 'desc';
    if (validField && validDirection) {
      return { field: parsed.field, direction: parsed.direction };
    }
  } catch {
    // malformed JSON — fall through to default
  }
  return DEFAULT_SORT;
}
```

In `interface UiState`, add after `setSubtitleScale`:

```ts
  videoSort: SortState;
  setVideoSort: (sort: SortState) => void;
  articleSort: SortState;
  setArticleSort: (sort: SortState) => void;
```

In the `create<UiState>((set, get) => ({ ... }))` body, add after `setSubtitleScale`:

```ts
  videoSort: readSortState('home-sort-video'),
  setVideoSort: (videoSort) => {
    localStorage.setItem('home-sort-video', JSON.stringify(videoSort));
    set({ videoSort });
  },
  articleSort: readSortState('home-sort-article'),
  setArticleSort: (articleSort) => {
    localStorage.setItem('home-sort-article', JSON.stringify(articleSort));
    set({ articleSort });
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/stores/ui-store.test.ts`
Expected: PASS (all existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/stores/ui-store.ts web/src/stores/ui-store.test.ts
git commit -m "feat(web): add persisted per-tab sort state to ui-store"
```

---

### Task 3: `SortSelect` component

**Files:**
- Create: `web/src/components/sort-select.tsx`
- Test: `web/src/components/sort-select.test.tsx`

**Interfaces:**
- Consumes: `SortField`, `SortState` types from `web/src/lib/sort.ts` (Task 1).
- Produces (used by Task 4): `export function SortSelect({ value, onChange, fields }: { value: SortState; onChange: (sort: SortState) => void; fields: { value: SortField; label: string }[] })`.

- [ ] **Step 1: Write the failing tests**

Create `web/src/components/sort-select.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SortSelect } from './sort-select';
import type { SortField, SortState } from '@/lib/sort';

const VIDEO_FIELDS: { value: SortField; label: string }[] = [
  { value: 'date', label: '日期' },
  { value: 'title', label: '标题' },
  { value: 'author', label: '作者' },
];

const ARTICLE_FIELDS: { value: SortField; label: string }[] = [
  { value: 'date', label: '日期' },
  { value: 'title', label: '标题' },
];

describe('SortSelect', () => {
  it('renders the provided field options', () => {
    const value: SortState = { field: 'date', direction: 'desc' };
    render(<SortSelect value={value} onChange={() => {}} fields={VIDEO_FIELDS} />);
    expect(screen.getByRole('option', { name: '日期' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '标题' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '作者' })).toBeInTheDocument();
  });

  it('only renders the fields passed in (no author option for articles)', () => {
    const value: SortState = { field: 'date', direction: 'desc' };
    render(<SortSelect value={value} onChange={() => {}} fields={ARTICLE_FIELDS} />);
    expect(screen.queryByRole('option', { name: '作者' })).not.toBeInTheDocument();
  });

  it('calls onChange with the new field when the select changes', () => {
    const value: SortState = { field: 'date', direction: 'desc' };
    const onChange = vi.fn();
    render(<SortSelect value={value} onChange={onChange} fields={VIDEO_FIELDS} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'title' } });
    expect(onChange).toHaveBeenCalledWith({ field: 'title', direction: 'desc' });
  });

  it('toggles direction when the direction button is clicked', () => {
    const value: SortState = { field: 'date', direction: 'desc' };
    const onChange = vi.fn();
    render(<SortSelect value={value} onChange={onChange} fields={VIDEO_FIELDS} />);
    fireEvent.click(screen.getByTitle('降序'));
    expect(onChange).toHaveBeenCalledWith({ field: 'date', direction: 'asc' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/sort-select.test.tsx`
Expected: FAIL — `Cannot find module './sort-select'`.

- [ ] **Step 3: Write the implementation**

Create `web/src/components/sort-select.tsx`:

```tsx
import type { SortField, SortState } from '@/lib/sort';

interface SortSelectProps {
  value: SortState;
  onChange: (sort: SortState) => void;
  fields: { value: SortField; label: string }[];
}

export function SortSelect({ value, onChange, fields }: SortSelectProps) {
  return (
    <div
      className="flex items-center gap-1 rounded-lg border px-2 py-1.5"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
    >
      <select
        value={value.field}
        onChange={(e) => onChange({ ...value, field: e.target.value as SortField })}
        className="text-sm bg-transparent outline-none cursor-pointer"
        style={{ color: 'var(--text-primary)' }}
        aria-label="排序方式"
      >
        {fields.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onChange({ ...value, direction: value.direction === 'asc' ? 'desc' : 'asc' })}
        className="text-sm px-1 cursor-pointer"
        style={{ color: 'var(--text-tertiary)' }}
        title={value.direction === 'asc' ? '升序' : '降序'}
      >
        {value.direction === 'asc' ? '↑' : '↓'}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/components/sort-select.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/sort-select.tsx web/src/components/sort-select.test.tsx
git commit -m "feat(web): add SortSelect component"
```

---

### Task 4: Wire sorting into the home list (`web/src/routes/_index.tsx`)

**Files:**
- Modify: `web/src/routes/_index.tsx`

**Interfaces:**
- Consumes: `sortTasks`, `sortArticles`, `SortField` from `web/src/lib/sort.ts` (Task 1); `useUiStore().videoSort/setVideoSort/articleSort/setArticleSort` (Task 2); `SortSelect` from `web/src/components/sort-select.tsx` (Task 3).
- Produces: nothing new consumed by other tasks — this is the final integration point.

- [ ] **Step 1: Add imports and field-option constants**

In `web/src/routes/_index.tsx`, replace the import block (current lines 1-7):

```ts
import { useState, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTasks } from '@/hooks/use-tasks';
import { TaskCard } from '@/components/task-card';
import { api, type Article } from '@/lib/api';
import { useUiStore } from '@/stores/ui-store';
```

with:

```ts
import { useState, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTasks } from '@/hooks/use-tasks';
import { TaskCard } from '@/components/task-card';
import { SortSelect } from '@/components/sort-select';
import { api, type Article } from '@/lib/api';
import { sortTasks, sortArticles, type SortField } from '@/lib/sort';
import { useUiStore } from '@/stores/ui-store';

const VIDEO_SORT_FIELDS: { value: SortField; label: string }[] = [
  { value: 'date', label: '日期' },
  { value: 'title', label: '标题' },
  { value: 'author', label: '作者' },
];

const ARTICLE_SORT_FIELDS: { value: SortField; label: string }[] = [
  { value: 'date', label: '日期' },
  { value: 'title', label: '标题' },
];
```

- [ ] **Step 2: Read sort state and compute sorted arrays**

Immediately after the existing `filteredArticles` declaration (the block ending `});` right after the `filteredTasks` filter block), insert:

```ts
  const videoSort = useUiStore((s) => s.videoSort);
  const setVideoSort = useUiStore((s) => s.setVideoSort);
  const articleSort = useUiStore((s) => s.articleSort);
  const setArticleSort = useUiStore((s) => s.setArticleSort);

  const sortedTasks = sortTasks(filteredTasks, videoSort);
  const sortedArticles = sortArticles(filteredArticles, articleSort);
```

- [ ] **Step 3: Add the SortSelect control next to the search box**

Replace the `<header>` block:

```tsx
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold tracking-tight">Scholia</h1>
        <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
             style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setSearchQuery(''); inputRef.current?.blur(); } }}
            placeholder="搜索…"
            className="text-sm bg-transparent outline-none w-40"
            style={{ color: 'var(--text-primary)' }}
          />
          <kbd className="text-[11px] px-1.5 py-0.5 rounded border flex-shrink-0"
               style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)',
                        color: 'var(--text-tertiary)' }}>
            ⌘K
          </kbd>
        </div>
      </header>
```

with:

```tsx
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold tracking-tight">Scholia</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
               style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setSearchQuery(''); inputRef.current?.blur(); } }}
              placeholder="搜索…"
              className="text-sm bg-transparent outline-none w-40"
              style={{ color: 'var(--text-primary)' }}
            />
            <kbd className="text-[11px] px-1.5 py-0.5 rounded border flex-shrink-0"
                 style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)',
                          color: 'var(--text-tertiary)' }}>
              ⌘K
            </kbd>
          </div>
          <SortSelect
            value={tab === 'video' ? videoSort : articleSort}
            onChange={tab === 'video' ? setVideoSort : setArticleSort}
            fields={tab === 'video' ? VIDEO_SORT_FIELDS : ARTICLE_SORT_FIELDS}
          />
        </div>
      </header>
```

- [ ] **Step 4: Render the sorted arrays instead of the filtered-only arrays**

In the video-tab render branch, replace:

```tsx
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 480px))' }}>
            {filteredTasks.map((t) => <TaskCard key={t.id} task={t} />)}
          </div>
```

with:

```tsx
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 480px))' }}>
            {sortedTasks.map((t) => <TaskCard key={t.id} task={t} />)}
          </div>
```

In the article-tab render branch, replace:

```tsx
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 480px))' }}>
            {filteredArticles.map((a) => <ArticleCard key={a.id} article={a} />)}
          </div>
```

with:

```tsx
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 480px))' }}>
            {sortedArticles.map((a) => <ArticleCard key={a.id} article={a} />)}
          </div>
```

Leave the `filteredTasks.length === 0` / `filteredArticles.length === 0` empty-state checks unchanged — sorting doesn't change array length, so they stay correct as-is.

- [ ] **Step 5: Type-check and build**

Run: `cd web && npm run build`
Expected: succeeds with no TypeScript errors (this runs `tsc --noEmit` then `vite build`).

- [ ] **Step 6: Run the full frontend test suite**

Run: `cd web && npm test`
Expected: PASS — all existing tests plus the new `sort.test.ts`, `sort-select.test.tsx`, and the new `ui-store.test.ts` cases.

- [ ] **Step 7: Manual verification**

Run: `cd web && npm run dev` (and separately, if not already running, `scholia serve --open` or the existing backend so the API has real data — see `CLAUDE.md` command list).

Verify in the browser:
- Video tab: switching the sort dropdown between 日期/标题/作者 reorders the cards; the ↑/↓ button reverses order; a task with no uploader sorts to the last position when sorting by 作者.
- Article tab: only 日期/标题 are offered (no 作者 option); switching and reversing works.
- Switching tabs preserves each tab's own sort selection (they don't overwrite each other).
- Reload the page: both tabs' sort selections are still applied as before reload.

- [ ] **Step 8: Commit**

```bash
git add web/src/routes/_index.tsx
git commit -m "feat(web): wire per-tab sort controls into home list"
```
