import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { VoicePendingCard } from './voice-pending-card';
import { NoteCard } from './note-card';
import type { VoicePending } from '@/hooks/use-voice-comments';

const rangeAnchor = { anchor: '注意力机制能够并行处理序列数据', prefix: '', suffix: '' };
const pointAnchor = { anchor: '', prefix: '长距离依赖', suffix: '。' };
const noop = () => {};

function item(over: Partial<VoicePending>): VoicePending {
  return { id: 'voice:s1', anchor: rangeAnchor, durationSec: 14, phase: 'transcribing', ...over };
}

describe('VoicePendingCard', () => {
  it('transcribing card shows 转写中 bolded and duration', () => {
    const { container } = render(
      <VoicePendingCard item={item({ phase: 'transcribing', durationSec: 74 })} variant="inline" onRetry={noop} onDiscard={noop} />,
    );
    const root = container.querySelector('.sc-note-card')!;
    expect(root.getAttribute('data-voice-state')).toBe('transcribing');
    expect(root.getAttribute('data-variant')).toBe('inline');
    expect(root.querySelector('.sc-voice-steps b')!.textContent).toBe('转写中…');
    expect(root.querySelector('.sc-voice-steps')!.textContent).toBe('转写中… → 整理');
    expect(root.querySelector('.sc-voice-dur')!.textContent).toBe('1:14');
  });

  it('refining card shows 整理中 bolded', () => {
    const { container } = render(
      <VoicePendingCard item={item({ phase: 'refining' })} variant="inline" onRetry={noop} onDiscard={noop} />,
    );
    const root = container.querySelector('.sc-note-card')!;
    expect(root.getAttribute('data-voice-state')).toBe('refining');
    expect(root.querySelector('.sc-voice-steps b')!.textContent).toBe('整理中…');
    expect(root.querySelector('.sc-voice-steps')!.textContent).toBe('转写 → 整理中…');
  });

  it('failed retryable card shows reason, hint, 重试 and 丢弃', () => {
    const onRetry = vi.fn();
    const onDiscard = vi.fn();
    const { container, getByText } = render(
      <VoicePendingCard
        item={item({ phase: 'failed', failure: { code: 'transcription_failed', canRetry: true, taskId: 't1' } })}
        variant="inline" onRetry={onRetry} onDiscard={onDiscard} />,
    );
    expect(container.querySelector('.sc-note-card')!.getAttribute('data-voice-state')).toBe('failed');
    expect(getByText('转写或整理失败')).toBeInTheDocument();
    expect(getByText('录音还在 CocoScribe 里，重试不用重录')).toBeInTheDocument();
    fireEvent.click(getByText('重试'));
    fireEvent.click(getByText('丢弃'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('failed no_audio card has only 丢弃', () => {
    const { queryByText, getByText } = render(
      <VoicePendingCard
        item={item({ phase: 'failed', failure: { code: 'no_audio', canRetry: false, taskId: null } })}
        variant="inline" onRetry={noop} onDiscard={noop} />,
    );
    expect(getByText('没有录到声音')).toBeInTheDocument();
    expect(getByText('检查麦克风后重新录一段')).toBeInTheDocument();
    expect(queryByText('重试')).toBeNull();
    expect(getByText('丢弃')).toBeInTheDocument();
  });

  it('failed unavailable card is a connection-lost card with only 丢弃', () => {
    const { queryByText, getByText } = render(
      <VoicePendingCard
        item={item({ phase: 'failed', failure: { code: 'unavailable', canRetry: false, taskId: null } })}
        variant="inline" onRetry={noop} onDiscard={noop} />,
    );
    expect(getByText('CocoScribe 连接中断')).toBeInTheDocument();
    expect(queryByText('重试')).toBeNull();
    expect(getByText('丢弃')).toBeInTheDocument();
  });

  it('failed save_failed card explains the write failure and has only 丢弃', () => {
    const { queryByText, getByText } = render(
      <VoicePendingCard
        item={item({ phase: 'failed', failure: { code: 'save_failed', canRetry: false, taskId: null } })}
        variant="inline" onRetry={noop} onDiscard={noop} />,
    );
    expect(getByText('保存失败')).toBeInTheDocument();
    expect(getByText('文字已整理好，但没能写入评论文件')).toBeInTheDocument();
    expect(queryByText('重试')).toBeNull();
    expect(getByText('丢弃')).toBeInTheDocument();
  });

  it('sidebar variant shows the anchor quote, 插入点 for point anchors', () => {
    const range = render(<VoicePendingCard item={item({})} variant="sidebar" onRetry={noop} onDiscard={noop} />);
    expect(range.container.querySelector('.sc-quote')!.textContent).toBe('注意力机制能够并行处理序列数据');
    range.unmount();

    const point = render(<VoicePendingCard item={item({ anchor: pointAnchor })} variant="sidebar" onRetry={noop} onDiscard={noop} />);
    expect(point.container.querySelector('.sc-quote')!.textContent).toBe('插入点');
    point.unmount();

    const inline = render(<VoicePendingCard item={item({})} variant="inline" onRetry={noop} onDiscard={noop} />);
    expect(inline.container.querySelector('.sc-quote')).toBeNull();
  });
});

describe('NoteCard flash', () => {
  it('NoteCard flash sets data-voice-flash only when true', () => {
    const note = { id: 'n1', anchor: '', body: '一条笔记', createdAt: Date.now(), updatedAt: Date.now() };
    const props = { note, variant: 'inline' as const, isLinked: false, onHover: noop, onUpdate: noop, onDelete: noop };
    const on = render(<NoteCard {...props} flash />);
    expect(on.container.querySelector('[data-note-card]')!.hasAttribute('data-voice-flash')).toBe(true);
    on.unmount();
    const off = render(<NoteCard {...props} />);
    expect(off.container.querySelector('[data-note-card]')!.hasAttribute('data-voice-flash')).toBe(false);
  });
});
