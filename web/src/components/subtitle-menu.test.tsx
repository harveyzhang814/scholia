import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubtitleMenu } from './subtitle-menu';
import { usePlayerStore } from '@/stores/player-store';
import { useUiStore } from '@/stores/ui-store';

beforeEach(() => {
  usePlayerStore.getState().reset();
  useUiStore.setState({ subtitleScale: 1 });
});

describe('SubtitleMenu', () => {
  it('opens the menu on click and calls onToggleCc from the 显示字幕 row', () => {
    let toggled = false;
    render(<SubtitleMenu ccEnabled={false} onToggleCc={() => { toggled = true; }} />);
    expect(screen.queryByText('显示字幕')).toBeNull();
    fireEvent.click(screen.getByTitle('字幕设置'));
    expect(screen.getByText('显示字幕')).toBeInTheDocument();
    fireEvent.click(screen.getByText('显示字幕'));
    expect(toggled).toBe(true);
  });

  it('lists tracks and switches language when there are 2 or more', () => {
    usePlayerStore.setState({
      tracks: [
        { lang: 'en', segments: [] },
        { lang: 'zh-CN', segments: [] },
      ],
      activeLang: 'en',
    });
    render(<SubtitleMenu ccEnabled={true} onToggleCc={() => {}} />);
    fireEvent.click(screen.getByTitle('字幕设置'));
    expect(screen.getByText('中文')).toBeInTheDocument();
    fireEvent.click(screen.getByText('中文'));
    expect(usePlayerStore.getState().activeLang).toBe('zh-CN');
  });

  it('does not render a language section for a single track', () => {
    usePlayerStore.setState({ tracks: [{ lang: 'en', segments: [] }], activeLang: 'en' });
    render(<SubtitleMenu ccEnabled={true} onToggleCc={() => {}} />);
    fireEvent.click(screen.getByTitle('字幕设置'));
    expect(screen.queryByText('EN')).toBeNull();
  });

  it('adjusts subtitle scale with A- / A+ and disables at bounds', () => {
    useUiStore.setState({ subtitleScale: 1.6 });
    render(<SubtitleMenu ccEnabled={true} onToggleCc={() => {}} />);
    fireEvent.click(screen.getByTitle('字幕设置'));
    expect(screen.getByText('160%')).toBeInTheDocument();
    expect(screen.getByText('A+')).toBeDisabled();
    fireEvent.click(screen.getByText('A−'));
    expect(useUiStore.getState().subtitleScale).toBe(1.5);
  });
});
