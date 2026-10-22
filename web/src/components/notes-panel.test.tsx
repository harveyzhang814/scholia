import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactElement } from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NoteItem, NotesPanel } from './notes-panel';
import { api, type Note } from '@/lib/api';

const note: Note = {
  id: 'n1',
  anchor: '',
  body: '一条笔记',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('NoteItem isLinked/editing interaction', () => {
  beforeEach(() => {
    // Mock ResizeObserver for tests
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;

    // Mock scrollIntoView on HTMLElement
    HTMLElement.prototype.scrollIntoView = () => {};
  });

  it('suppresses isLinked background highlight when editing is active', () => {
    const note: Note = {
      id: 'test-note-1',
      anchor: 'test anchor text',
      body: 'This is a test note',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const { container } = render(
      <NoteItem
        note={note}
        onUpdate={() => {}}
        onDelete={() => {}}
        onHeightChange={() => {}}
        isLinked={true}
        onHover={() => {}}
        autoEdit={true}
        onAutoEditConsumed={() => {}}
      />
    );

    const li = container.querySelector('li');
    expect(li).toBeTruthy();

    // When editing is active (triggered by autoEdit={true}), the background
    // should not show the isLinked highlight, even though isLinked={true}
    const style = li?.getAttribute('style') || '';
    // The style should not contain the accent-3 background color when editing
    expect(style).not.toContain('var(--accent-3)');

    // Confirm that a textarea is present (edit mode is active)
    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
  });

  it('NoteItem shows 原文已变化 when approximate', () => {
    const { getByText } = render(<NoteItem note={note} approximate onUpdate={() => {}} onDelete={() => {}}
      onHeightChange={() => {}} isLinked={false} onHover={() => {}} autoEdit={false} onAutoEditConsumed={() => {}} />);
    expect(getByText('原文已变化')).toBeInTheDocument();
  });
});

describe('NotesPanel', () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;
    HTMLElement.prototype.scrollIntoView = () => {};
    vi.spyOn(api, 'listNotes').mockResolvedValue([]);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('point draft shows 插入点 chip and submits context fields', async () => {
    const add = vi.spyOn(api, 'addNote').mockResolvedValue({} as Note);
    const pending = { anchor: '', prefix: '这是前文最后十二个字符号', suffix: '后文', position: 9 };
    const { getByText, getByPlaceholderText } = renderWithClient(
      <NotesPanel taskId="t" hasMedia={false} pendingAnchor={pending} onAnchorConsumed={() => {}} />);
    expect(getByText(/插入点：…这是前文最后十二个字符号/)).toBeInTheDocument();
    fireEvent.change(getByPlaceholderText('写下笔记…'), { target: { value: '想法' } });
    fireEvent.click(getByText('保存'));
    await waitFor(() => expect(add).toHaveBeenCalledWith('t', expect.objectContaining({ ...pending, body: '想法' })));
  });

  it('unlocated anchored notes render in the top list', async () => {
    vi.spyOn(api, 'listNotes').mockResolvedValue([{ ...note, id: 'u', anchor: '某段文字' }]);
    const { findByText, container } = renderWithClient(<NotesPanel taskId="t" hasMedia={false} located={{}} />);
    await findByText(note.body);
    expect(container.querySelector('[style*="position: absolute"]')).toBeNull();
  });
});
