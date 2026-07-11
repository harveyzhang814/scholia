import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { CcOverlay } from './cc-overlay';
import { usePlayerStore } from '@/stores/player-store';
import { useUiStore } from '@/stores/ui-store';

beforeEach(() => {
  usePlayerStore.getState().reset();
  useUiStore.setState({ subtitleScale: 1 });
});

describe('CcOverlay', () => {
  it('renders the active subtitle text', () => {
    usePlayerStore.getState().setSubtitles([{ start: 0, text: 'hello world' }]);
    usePlayerStore.getState().setCurrentTime(1);
    const { getByText } = render(<CcOverlay enabled={true} />);
    expect(getByText('hello world')).toBeInTheDocument();
  });

  it('applies the current subtitleScale as the --cc-scale CSS variable', () => {
    usePlayerStore.getState().setSubtitles([{ start: 0, text: 'hello world' }]);
    usePlayerStore.getState().setCurrentTime(1);
    useUiStore.setState({ subtitleScale: 1.3 });
    const { getByText } = render(<CcOverlay enabled={true} />);
    const el = getByText('hello world');
    expect(el.style.getPropertyValue('--cc-scale')).toBe('1.3');
  });

  it('renders nothing when disabled', () => {
    usePlayerStore.getState().setSubtitles([{ start: 0, text: 'hello world' }]);
    usePlayerStore.getState().setCurrentTime(1);
    const { container } = render(<CcOverlay enabled={false} />);
    expect(container.firstChild).toBeNull();
  });
});
