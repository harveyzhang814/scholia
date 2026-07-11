import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from './ui-store';
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
