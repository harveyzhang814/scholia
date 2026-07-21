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

  it('treats an empty string as missing and sorts it to the end', () => {
    expect(compareBy('', 'a', (s: string) => s, 'asc')).toBeGreaterThan(0);
    expect(compareBy('a', '', (s: string) => s, 'asc')).toBeLessThan(0);
    expect(compareBy('', 'a', (s: string) => s, 'desc')).toBeGreaterThan(0);
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
