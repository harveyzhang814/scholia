import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { VoiceBar } from './voice-bar';

const anchor = { anchor: '注意力机制能够并行处理序列数据', prefix: '', suffix: '' };
const noop = () => {};

describe('VoiceBar', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('VoiceBar ticks the timer and Escape calls onCancel', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T10:00:00Z'));
    const onCancel = vi.fn();
    const { container, getByText, unmount } = render(
      <VoiceBar startedAt={Date.now()} anchor={anchor} showHint={false} onStop={noop} onCancel={onCancel} onDismissHint={noop} />,
    );
    expect(container.querySelector('.voice-timer')!.textContent).toBe('0:00');
    act(() => { vi.advanceTimersByTime(3000); });
    expect(container.querySelector('.voice-timer')!.textContent).toBe('0:03');
    act(() => { vi.advanceTimersByTime(62000); });
    expect(container.querySelector('.voice-timer')!.textContent).toBe('1:05');
    expect(container.querySelector('.voice-anchor')!.textContent).toBe('评论「注意力机制能够并行处理序列数据」');
    expect(getByText('录音中')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);

    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('VoiceBar ignores Escape from a text field but not from the body', () => {
    const onCancel = vi.fn();
    const { unmount } = render(
      <VoiceBar startedAt={Date.now()} anchor={anchor} showHint={false} onStop={noop} onCancel={onCancel} onDismissHint={noop} />,
    );
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    textarea.remove();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('VoiceBar shows the hint only when showHint and 知道了 calls onDismissHint', () => {
    const onDismissHint = vi.fn();
    const props = { startedAt: Date.now(), anchor, onStop: noop, onCancel: noop, onDismissHint };
    const off = render(<VoiceBar {...props} showHint={false} />);
    expect(off.container.querySelector('.voice-hint')).toBeNull();
    expect(off.queryByText('知道了')).toBeNull();
    off.unmount();

    const on = render(<VoiceBar {...props} showHint />);
    expect(on.container.querySelector('.voice-hint')!.textContent).toContain('第一次用语音评论');
    fireEvent.click(on.getByText('知道了'));
    expect(onDismissHint).toHaveBeenCalledTimes(1);
  });
});
