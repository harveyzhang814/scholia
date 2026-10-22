import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { NoteCard, noteEntries } from './note-card';
import type { Note } from '@/lib/api';

const base: Note = { id: 'n1', anchor: '', body: '一条笔记', createdAt: Date.now(), updatedAt: Date.now() };
const noop = () => {};

describe('NoteCard', () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;
    HTMLElement.prototype.scrollIntoView = () => {};
  });

  it('suppresses isLinked background highlight when editing is active', () => {
    const { container } = render(<NoteCard variant="sidebar" note={{ ...base, anchor: 'a' }} isLinked autoEdit
      onAutoEditConsumed={noop} onHover={noop} onUpdate={noop} onDelete={noop} />);
    expect(container.querySelector('[data-note-card]')!.getAttribute('style') ?? '').not.toContain('var(--accent-3)');
    expect(container.querySelector('textarea')).toBeTruthy();
  });
  it('NoteCard shows 原文已变化 when approximate', () => {
    const { getByText } = render(<NoteCard variant="sidebar" note={base} approximate isLinked={false}
      onHover={noop} onUpdate={noop} onDelete={noop} />);
    expect(getByText('原文已变化')).toBeInTheDocument();
  });
  it('noteEntries turns the body into one entry', () => {
    expect(noteEntries(base)).toEqual([{ id: 'n1', kind: 'body', text: '一条笔记' }]);
  });
  it('body comes first and the meta line is last', () => {
    const n = { ...base, mediaTimestamp: 65 };
    const { container } = render(<NoteCard variant="inline" note={n} approximate isLinked={false} onHover={noop} onUpdate={noop} onDelete={noop} />);
    const card = container.querySelector('[data-note-card]')!;
    const meta = card.querySelector('[data-meta]')!;
    expect(card.lastElementChild).toBe(meta);
    expect(meta.textContent).toContain('@ 1:05');
    expect(meta.textContent).toContain('原文已变化');
    expect(meta.textContent).toContain('刚刚');
    expect(card.textContent!.indexOf('一条笔记')).toBeLessThan(card.textContent!.indexOf('@ 1:05'));
  });
  it('inline card omits the anchor excerpt but shows time point and actions', () => {
    const n = { ...base, anchor: '第一行原文\n第二行', mediaTimestamp: 65 };
    const { queryByText, getByText, container } = render(<NoteCard variant="inline" note={n} isLinked={false} onHover={noop} onUpdate={noop} onDelete={noop} />);
    expect(queryByText(/第一行原文/)).toBeNull();
    expect(container.querySelector('[data-quote]')).toBeNull();
    expect(getByText('@ 1:05')).toBeInTheDocument();
    expect(getByText('编辑')).toBeInTheDocument();
  });
  it('sidebar card quotes the first line of the anchor, clamped', () => {
    const n = { ...base, anchor: '第一行原文\n第二行' };
    const { container } = render(<NoteCard variant="sidebar" note={n} isLinked={false} onHover={noop} onUpdate={noop} onDelete={noop} />);
    const quote = container.querySelector<HTMLElement>('[data-quote]')!;
    expect(quote.textContent).toBe('第一行原文');
    expect(quote).toHaveClass('sc-quote');  // 两行截断由 globals.css 的 .sc-quote 负责（jsdom 不认 -webkit-line-clamp）
  });
  it('sidebar point card quotes 插入点, anchorless card quotes nothing', () => {
    const point = render(<NoteCard variant="sidebar" note={{ ...base, prefix: '前文', suffix: '后文' }}
      isLinked={false} onHover={noop} onUpdate={noop} onDelete={noop} />);
    expect(point.container.querySelector('[data-quote]')!.textContent).toBe('插入点');
    point.unmount();
    const none = render(<NoteCard variant="sidebar" note={base} isLinked={false} onHover={noop} onUpdate={noop} onDelete={noop} />);
    expect(none.container.querySelector('[data-quote]')).toBeNull();
  });
  it('collapsed inline card is one line with a body preview', () => {
    const toggle = vi.fn();
    const { container, getByLabelText } = render(<NoteCard variant="inline" note={{ ...base, body: '第一行\n第二行' }} collapsed
      onToggleCollapsed={toggle} isLinked={false} onHover={noop} onUpdate={noop} onDelete={noop} />);
    expect(container.querySelector('[data-preview]')!.textContent).toBe('第一行');
    expect(container.textContent).not.toContain('第二行');
    fireEvent.click(getByLabelText('展开'));
    expect(toggle).toHaveBeenCalled();
  });
  it('marks the collapsed state on the root only when collapsed', () => {
    const props = { variant: 'inline' as const, note: base, isLinked: false, onHover: noop, onUpdate: noop, onDelete: noop };
    const c = render(<NoteCard {...props} collapsed />);
    expect(c.container.querySelector('[data-note-card]')).toHaveAttribute('data-collapsed');
    c.unmount();
    const e = render(<NoteCard {...props} />);
    expect(e.container.querySelector('[data-note-card]')).not.toHaveAttribute('data-collapsed');
  });
  it('expanded inline card has no preview', () => {
    const { container } = render(<NoteCard variant="inline" note={base} isLinked={false} onHover={noop} onUpdate={noop} onDelete={noop} />);
    expect(container.querySelector('[data-preview]')).toBeNull();
  });
  it('approximate card shows the snapshot', () => {
    const n = { ...base, anchor: '旧原文', prefix: '前文', suffix: '后文' };
    const { container } = render(<NoteCard variant="inline" note={n} approximate isLinked={false}
      onHover={noop} onUpdate={noop} onDelete={noop} />);
    expect(container.textContent).toContain('前文旧原文后文');
  });
  it('cmd+enter saves an edit, escape discards it', () => {
    const update = vi.fn();
    const { getByText, container } = render(<NoteCard variant="inline" note={base} isLinked={false}
      onHover={noop} onUpdate={update} onDelete={noop} />);
    fireEvent.click(getByText('编辑'));
    const ta = container.querySelector('textarea')!;
    fireEvent.change(ta, { target: { value: '改过' } });
    fireEvent.keyDown(ta, { key: 'Enter', metaKey: true });
    expect(update).toHaveBeenCalledWith('改过');
  });
  it('escape discards an edit', () => {
    const update = vi.fn();
    const { getByText, container } = render(<NoteCard variant="inline" note={base} isLinked={false}
      onHover={noop} onUpdate={update} onDelete={noop} />);
    fireEvent.click(getByText('编辑'));
    const ta = container.querySelector('textarea')!;
    fireEvent.change(ta, { target: { value: '改过' } });
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(update).not.toHaveBeenCalled();
    expect(container.querySelector('textarea')).toBeNull();
    expect(getByText('一条笔记')).toBeInTheDocument();
  });
});
