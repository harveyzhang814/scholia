import { create } from 'zustand';
import { ThemeId } from '@/lib/themes';

export type Theme = 'system' | 'light' | 'dark';
export type StatusFilter = 'all' | 'running' | 'done' | 'failed';
export type LayoutMode = 'A' | 'B' | 'C' | 'E' | 'F';

export const SUBTITLE_SCALE_MIN = 0.7;
export const SUBTITLE_SCALE_MAX = 1.6;

function clampSubtitleScale(v: number): number {
  const rounded = Math.round(v * 10) / 10;
  return Math.min(SUBTITLE_SCALE_MAX, Math.max(SUBTITLE_SCALE_MIN, rounded));
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
}));
