import { create } from 'zustand';
import { ThemeId } from '@/lib/themes';
import { DEFAULT_SORT, type SortState, type SortField } from '@/lib/sort';

export type Theme = 'system' | 'light' | 'dark';
export type StatusFilter = 'all' | 'running' | 'done' | 'failed';
export type LayoutMode = 'A' | 'B' | 'C' | 'E' | 'F';

export const SUBTITLE_SCALE_MIN = 0.7;
export const SUBTITLE_SCALE_MAX = 1.6;

function clampSubtitleScale(v: number): number {
  const rounded = Math.round(v * 10) / 10;
  return Math.min(SUBTITLE_SCALE_MAX, Math.max(SUBTITLE_SCALE_MIN, rounded));
}

export function readSortState(key: string, allowedFields: SortField[] = ['date', 'title', 'author']): SortState {
  const raw = localStorage.getItem(key);
  if (!raw) return DEFAULT_SORT;
  try {
    const parsed = JSON.parse(raw);
    const validField = allowedFields.includes(parsed?.field);
    const validDirection = parsed?.direction === 'asc' || parsed?.direction === 'desc';
    if (validField && validDirection) {
      return { field: parsed.field, direction: parsed.direction };
    }
  } catch {
    // malformed JSON — fall through to default
  }
  return DEFAULT_SORT;
}

interface UiState {
  theme: Theme;
  paletteOpen: boolean;
  statusFilter: StatusFilter;
  setTheme: (t: Theme) => void;
  setPaletteOpen: (open: boolean) => void;
  setStatusFilter: (f: StatusFilter) => void;
  layoutMode: LayoutMode;
  setLayoutMode: (m: LayoutMode) => void;
  proseTheme: ThemeId;
  setProseTheme: (theme: ThemeId) => void;
  subtitleScale: number;
  setSubtitleScale: (updater: (prev: number) => number) => void;
  videoSort: SortState;
  setVideoSort: (sort: SortState) => void;
  articleSort: SortState;
  setArticleSort: (sort: SortState) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: 'system',
  paletteOpen: false,
  statusFilter: 'all',
  setTheme: (theme) => set({ theme }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  layoutMode: 'A',
  setLayoutMode: (layoutMode) => set({ layoutMode }),
  proseTheme: (localStorage.getItem('prose-theme') ?? 'default') as ThemeId,
  setProseTheme: (proseTheme) => {
    localStorage.setItem('prose-theme', proseTheme);
    set({ proseTheme });
  },
  subtitleScale: clampSubtitleScale(parseFloat(localStorage.getItem('subtitle-scale') ?? '') || 1),
  setSubtitleScale: (updater) => {
    const next = clampSubtitleScale(updater(get().subtitleScale));
    localStorage.setItem('subtitle-scale', String(next));
    set({ subtitleScale: next });
  },
  videoSort: readSortState('home-sort-video'),
  setVideoSort: (videoSort) => {
    localStorage.setItem('home-sort-video', JSON.stringify(videoSort));
    set({ videoSort });
  },
  articleSort: readSortState('home-sort-article', ['date', 'title']),
  setArticleSort: (articleSort) => {
    localStorage.setItem('home-sort-article', JSON.stringify(articleSort));
    set({ articleSort });
  },
}));
