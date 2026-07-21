import type { Task, Article } from './api';

export type SortField = 'date' | 'title' | 'author';
export type SortDirection = 'asc' | 'desc';

export interface SortState {
  field: SortField;
  direction: SortDirection;
}

export const DEFAULT_SORT: SortState = { field: 'date', direction: 'desc' };

function isMissing(v: string | number | undefined): boolean {
  return v === undefined || v === '';
}

export function compareBy<T>(
  a: T,
  b: T,
  getValue: (item: T) => string | number | undefined,
  direction: SortDirection
): number {
  const av = getValue(a);
  const bv = getValue(b);
  const aMissing = isMissing(av);
  const bMissing = isMissing(bv);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

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
