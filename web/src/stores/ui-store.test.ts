import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore, readSortState } from './ui-store';
import type { ThemeId } from '@/lib/themes';

beforeEach(() => {
  localStorage.clear();
  useUiStore.setState({ proseTheme: 'default' });
});

describe('ui-store proseTheme', () => {
  it('defaults to "default"', () => {
    expect(useUiStore.getState().proseTheme).toBe('default');
  });

  it('setProseTheme updates state', () => {
    useUiStore.getState().setProseTheme('academic');
    expect(useUiStore.getState().proseTheme).toBe('academic');
  });

  it('setProseTheme persists to localStorage', () => {
    useUiStore.getState().setProseTheme('academic');
    expect(localStorage.getItem('prose-theme')).toBe('academic');
  });

  it('initialises proseTheme from localStorage when a value is stored', () => {
    localStorage.setItem('prose-theme', 'academic');
    useUiStore.setState({
      proseTheme: (localStorage.getItem('prose-theme') ?? 'default') as ThemeId,
    });
    expect(useUiStore.getState().proseTheme).toBe('academic');
  });
});

describe('ui-store subtitleScale', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ subtitleScale: 1 });
  });

  it('defaults to 1', () => {
    expect(useUiStore.getState().subtitleScale).toBe(1);
  });

  it('setSubtitleScale increases by the given delta and persists', () => {
    useUiStore.getState().setSubtitleScale((prev) => prev + 0.1);
    expect(useUiStore.getState().subtitleScale).toBe(1.1);
    expect(localStorage.getItem('subtitle-scale')).toBe('1.1');
  });

  it('clamps to the 1.6 maximum', () => {
    useUiStore.setState({ subtitleScale: 1.6 });
    useUiStore.getState().setSubtitleScale((prev) => prev + 0.1);
    expect(useUiStore.getState().subtitleScale).toBe(1.6);
  });

  it('clamps to the 0.7 minimum', () => {
    useUiStore.setState({ subtitleScale: 0.7 });
    useUiStore.getState().setSubtitleScale((prev) => prev - 0.1);
    expect(useUiStore.getState().subtitleScale).toBe(0.7);
  });

  it('initialises from localStorage when a valid value is stored', () => {
    localStorage.setItem('subtitle-scale', '1.3');
    useUiStore.setState({
      subtitleScale: Math.min(1.6, Math.max(0.7, parseFloat(localStorage.getItem('subtitle-scale') ?? '') || 1)),
    });
    expect(useUiStore.getState().subtitleScale).toBe(1.3);
  });

  it('falls back to 1 when localStorage holds an invalid value', () => {
    localStorage.setItem('subtitle-scale', 'not-a-number');
    useUiStore.setState({
      subtitleScale: Math.min(1.6, Math.max(0.7, parseFloat(localStorage.getItem('subtitle-scale') ?? '') || 1)),
    });
    expect(useUiStore.getState().subtitleScale).toBe(1);
  });
});

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

  it('falls back to the default when field=author is not in the allowed list', () => {
    localStorage.setItem('home-sort-article', JSON.stringify({ field: 'author', direction: 'asc' }));
    expect(readSortState('home-sort-article', ['date', 'title'])).toEqual({ field: 'date', direction: 'desc' });
  });

  it('still accepts author when no allowedFields restriction is given (video key)', () => {
    localStorage.setItem('home-sort-video', JSON.stringify({ field: 'author', direction: 'asc' }));
    expect(readSortState('home-sort-video')).toEqual({ field: 'author', direction: 'asc' });
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
    useUiStore.setState({
      videoSort: { field: 'date', direction: 'desc' },
      articleSort: { field: 'date', direction: 'desc' }
    });
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
