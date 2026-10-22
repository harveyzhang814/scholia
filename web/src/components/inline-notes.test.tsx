import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactElement } from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DraftCard, InlineCards, UnlocatedZone } from './inline-notes';
import { DRAFT_ID } from './reader';
import { usePlayerStore } from '@/stores/player-store';
import { api, type Note } from '@/lib/api';

const mk = (id: string, body: string, anchor = 'x'): Note =>
  ({ id, anchor, body, createdAt: Date.now(), updatedAt: Date.now() });
const noop = () => {};

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (el: ReactElement) => <QueryClientProvider client={client}>{el}</QueryClientProvider>;
  const r = render(wrap(ui));
  return { ...r, rerender: (el: ReactElement) => r.rerender(wrap(el)) };
}

const common = { taskId: 't', hasMedia: false, collapsed: new Set<string>(), onToggle: noop, hoveredNoteId: null, onHover: noop };

describe('inline notes', () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;
    HTMLElement.prototype.scrollIntoView = () => {};
    usePlayerStore.setState({ currentTime: 0 });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('draft card saves with anchor fields and calls onDone', async () => {
    const add = vi.spyOn(api, 'addNote').mockResolvedValue({} as Note);
    const done = vi.fn();
    const anchor = { anchor: '', prefix: '前文', suffix: '后文', position: 3 };
    const { getByRole } = renderWithClient(<DraftCard taskId="t" hasMedia={false} anchor={anchor} onDone={done} />);
    fireEvent.change(getByRole('textbox'), { target: { value: '想法' } });
    fireEvent.keyDown(getByRole('textbox'), { key: 'Enter', metaKey: true });
    await waitFor(() => expect(add).toHaveBeenCalledWith('t', expect.objectContaining({ ...anchor, body: '想法' })));
    expect(add.mock.calls[0][1]).not.toHaveProperty('mediaTimestamp');
    expect(done).toHaveBeenCalled();
  });

  it('draft card is focused, shows the hint and no anchor label', () => {
    const { getByRole, getByText, container } = renderWithClient(
      <DraftCard taskId="t" hasMedia={false} anchor={{ anchor: '被选中的原文' }} onDone={noop} />);
    expect(getByRole('textbox')).toHaveFocus();
    expect(getByText('⌘↵ 保存 · Esc 放弃')).toBeInTheDocument();
    expect(container.textContent).not.toContain('被选中的原文');
  });

  it('draft card stamps mediaTimestamp only when hasMedia and playing past 0', async () => {
    const add = vi.spyOn(api, 'addNote').mockResolvedValue({} as Note);
    usePlayerStore.setState({ currentTime: 65.7 });
    const { getByRole, getByText, rerender } = renderWithClient(
      <DraftCard taskId="t" hasMedia anchor={{ anchor: '' }} onDone={noop} />);
    fireEvent.change(getByRole('textbox'), { target: { value: '甲' } });
    fireEvent.click(getByText('保存'));
    await waitFor(() => expect(add).toHaveBeenCalledWith('t', expect.objectContaining({ body: '甲', mediaTimestamp: 65 })));

    rerender(<DraftCard taskId="t" hasMedia={false} anchor={{ anchor: '' }} onDone={noop} />);
    fireEvent.change(getByRole('textbox'), { target: { value: '乙' } });
    fireEvent.click(getByText('保存'));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    expect(add.mock.calls[1][1]).not.toHaveProperty('mediaTimestamp');
  });

  it('escape discards the draft without saving', () => {
    const add = vi.spyOn(api, 'addNote').mockResolvedValue({} as Note);
    const done = vi.fn();
    const { getByRole } = renderWithClient(<DraftCard taskId="t" hasMedia={false} anchor={{ anchor: '' }} onDone={done} />);
    fireEvent.change(getByRole('textbox'), { target: { value: '想法' } });
    fireEvent.keyDown(getByRole('textbox'), { key: 'Escape' });
    expect(done).toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('empty body is not saved', () => {
    const add = vi.spyOn(api, 'addNote').mockResolvedValue({} as Note);
    const { getByRole } = renderWithClient(<DraftCard taskId="t" hasMedia={false} anchor={{ anchor: '' }} onDone={noop} />);
    fireEvent.change(getByRole('textbox'), { target: { value: '  ' } });
    fireEvent.keyDown(getByRole('textbox'), { key: 'Enter', metaKey: true });
    expect(add).not.toHaveBeenCalled();
  });

  it('inline cards render draft and notes in slot order', () => {
    const notes = [mk('a', '笔记A'), mk('b', '笔记B')];
    const { container } = renderWithClient(
      <InlineCards {...common} ids={['b', DRAFT_ID, 'a']} notes={notes} located={{}} draft={{ anchor: '' }} onDraftDone={noop} />);
    const order = Array.from(container.querySelectorAll('[data-note-card], textarea')).map((el) =>
      el.tagName === 'TEXTAREA' ? 'draft' : el.getAttribute('data-note-card'));
    expect(order).toEqual(['b', 'draft', 'a']);
  });

  it('inline cards skip the draft when null, skip unknown ids, and mark approximate ones', () => {
    const { container, getAllByText, queryByRole } = renderWithClient(
      <InlineCards {...common} ids={['a', DRAFT_ID, 'gone', 'b']} notes={[mk('a', '笔记A'), mk('b', '笔记B')]}
        located={{ b: { start: 0, end: 1, grade: 'approximate' } }} draft={null} onDraftDone={noop} />);
    expect(queryByRole('textbox')).toBeNull();
    expect(container.querySelectorAll('[data-note-card]')).toHaveLength(2);
    expect(getAllByText('原文已变化')).toHaveLength(1);
  });

  it('collapsed state survives notes refetch', () => {
    const collapsed = new Set(['a']);
    const props = { ...common, collapsed, ids: ['a'], located: {}, draft: null, onDraftDone: noop };
    const { container, rerender } = renderWithClient(<InlineCards {...props} notes={[mk('a', '笔记A')]} />);
    expect(container.querySelector('[data-preview]')).toHaveTextContent('笔记A');
    rerender(<InlineCards {...props} notes={[mk('a', '笔记A')]} />);
    expect(container.querySelector('[data-preview]')).toHaveTextContent('笔记A');
    expect(container.querySelector('[data-collapsed]')).toBeTruthy();
  });

  it('inline card toggle and delete are wired', async () => {
    const del = vi.spyOn(api, 'deleteNote').mockResolvedValue(undefined as any);
    const onToggle = vi.fn();
    const { getByLabelText, getByText } = renderWithClient(
      <InlineCards {...common} onToggle={onToggle} ids={['a']} notes={[mk('a', '笔记A')]} located={{}} draft={null} onDraftDone={noop} />);
    fireEvent.click(getByLabelText('收起'));
    expect(onToggle).toHaveBeenCalledWith('a');
    fireEvent.click(getByText('删除'));
    await waitFor(() => expect(del).toHaveBeenCalledWith('t', 'a'));
  });

  it('unlocated zone lists notes and adds an anchorless note', async () => {
    const add = vi.spyOn(api, 'addNote').mockResolvedValue({} as Note);
    const { getByText, getByRole, queryByRole } = renderWithClient(
      <UnlocatedZone {...common} notes={[mk('z1', '无锚点评论', '')]} />);
    expect(getByText('未定位评论（1）')).toBeInTheDocument();
    expect(getByText('无锚点评论')).toBeInTheDocument();
    expect(queryByRole('textbox')).toBeNull();
    fireEvent.click(getByText('添加评论'));
    fireEvent.change(getByRole('textbox'), { target: { value: '新评论' } });
    fireEvent.click(getByText('保存'));
    await waitFor(() => expect(add).toHaveBeenCalledWith('t', expect.objectContaining({ anchor: '', body: '新评论' })));
    await waitFor(() => expect(queryByRole('textbox')).toBeNull());
  });

  it('unlocated zone stays rendered at n = 0 and collapses its own list', () => {
    const { getByText, getByLabelText, queryByText } = renderWithClient(
      <UnlocatedZone {...common} notes={[mk('z1', '无锚点评论', '')]} />);
    fireEvent.click(getByLabelText('收起区域'));
    expect(queryByText('无锚点评论')).toBeNull();
    fireEvent.click(getByLabelText('展开区域'));
    expect(getByText('无锚点评论')).toBeInTheDocument();
    const empty = renderWithClient(<UnlocatedZone {...common} notes={[]} />);
    expect(empty.getByText('未定位评论（0）')).toBeInTheDocument();
  });
});
