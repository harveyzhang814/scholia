import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactElement } from 'react';
import { render, fireEvent, waitFor, getByText, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotesPanel } from './notes-panel';
import { api, type Note } from '@/lib/api';
import type { VoicePending } from '@/hooks/use-voice-comments';

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

  it('places a card by the code block or table cell holding its mark', async () => {
    vi.spyOn(api, 'listNotes').mockResolvedValue([{ ...note, id: 'c', anchor: 'x' }, { ...note, id: 't', anchor: 'y', body: '表格笔记' }]);
    const article = document.createElement('div');
    article.innerHTML = '<pre><code><mark data-note-id="c">x</mark></code></pre>'
      + '<table><tbody><tr><td><mark data-note-id="t">y</mark></td></tr></tbody></table>';
    const top = (el: Element, y: number) => { el.getBoundingClientRect = () => ({ top: y } as DOMRect); };
    top(article.querySelector('pre')!, 100);
    top(article.querySelector('td')!, 400);
    const located = { c: { start: 0, end: 1, grade: 'exact' as const }, t: { start: 2, end: 3, grade: 'exact' as const } };
    const { findByText } = renderWithClient(
      <NotesPanel taskId="t" hasMedia={false} articleRef={{ current: article }} located={located} />);
    const card = (await findByText(note.body)).closest('ul')!;
    const tableCard = (await findByText('表格笔记')).closest('ul')!;
    await waitFor(() => expect(card.style.top).toBe('100px'));
    expect(tableCard.style.top).toBe('400px');
  });

  it('places a pending voice card and excludes it from the note count', async () => {
    vi.spyOn(api, 'listNotes').mockResolvedValue([{ ...note, id: 'c', anchor: 'x' }]);
    const article = document.createElement('div');
    article.innerHTML = '<p><mark data-note-id="c">x</mark></p><p><mark data-note-id="voice:s1">y</mark></p>';
    const top = (el: Element, y: number) => { el.getBoundingClientRect = () => ({ top: y } as DOMRect); };
    const [p1, p2] = Array.from(article.querySelectorAll('p'));
    top(p1, 100);
    top(p2, 120);
    const located = {
      c: { start: 0, end: 1, grade: 'exact' as const },
      'voice:s1': { start: 2, end: 3, grade: 'exact' as const },
      'voice-rec:s2': { start: 2, end: 3, grade: 'exact' as const },
    };
    const voicePending: VoicePending[] = [{ id: 'voice:s1', anchor: { anchor: 'y' }, durationSec: 4, phase: 'refining' }];
    const { findByText, container } = renderWithClient(
      <NotesPanel taskId="t" hasMedia={false} articleRef={{ current: article }} located={located}
        voicePending={voicePending} onVoiceRetry={() => {}} onVoiceDiscard={() => {}} flashNoteId="c" />);
    const card = (await findByText(note.body)).closest('ul')!;
    const pending = container.querySelector('[data-voice-state="refining"]')!;
    expect(pending).toHaveAttribute('data-variant', 'sidebar');
    // Pushed below the real card: 100 + estimated 72 + gap 8.
    await waitFor(() => expect(pending.closest('ul')!.style.top).toBe('180px'));
    expect(card.style.top).toBe('100px');
    expect(container.querySelector('[data-note-card="c"]')).toHaveAttribute('data-voice-flash');
    expect(container.querySelectorAll('.sc-note-card')).toHaveLength(2);
    expect(getByText(container, (_, el) => el?.tagName === 'DIV' && el.textContent === '笔记 · 1')).toBeInTheDocument();
  });

  it('lays out the next card below a pending voice card at its measured height', async () => {
    const observed: { cb: ResizeObserverCallback; el: Element }[] = [];
    globalThis.ResizeObserver = class ResizeObserver {
      constructor(private cb: ResizeObserverCallback) {}
      observe(el: Element) { observed.push({ cb: this.cb, el }); }
      unobserve() {}
      disconnect() {}
    } as any;
    vi.spyOn(api, 'listNotes').mockResolvedValue([{ ...note, id: 'c', anchor: 'x' }]);
    const article = document.createElement('div');
    article.innerHTML = '<p><mark data-note-id="voice:s1">y</mark></p><p><mark data-note-id="c">x</mark></p>';
    const [p1, p2] = Array.from(article.querySelectorAll('p'));
    p1.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
    p2.getBoundingClientRect = () => ({ top: 120 } as DOMRect);
    const located = {
      'voice:s1': { start: 0, end: 1, grade: 'exact' as const },
      c: { start: 2, end: 3, grade: 'exact' as const },
    };
    const voicePending: VoicePending[] = [{ id: 'voice:s1', anchor: { anchor: 'y' }, durationSec: 4, phase: 'failed',
      failure: { code: 'refine_failed', canRetry: true, taskId: 'coco-1' } }];
    const { findByText, container } = renderWithClient(
      <NotesPanel taskId="t" hasMedia={false} articleRef={{ current: article }} located={located} voicePending={voicePending} />);
    const card = (await findByText(note.body)).closest('ul')!;
    await waitFor(() => expect(card.style.top).toBe('180px'));  // estimate until the pending card is measured

    const li = container.querySelector('[data-voice-state="failed"]')!.closest('li')!;
    Object.defineProperty(li, 'offsetHeight', { configurable: true, value: 150 });
    act(() => observed.filter((o) => o.el === li).forEach((o) => o.cb([], {} as ResizeObserver)));
    await waitFor(() => expect(card.style.top).toBe('258px'));  // 100 + 150 + 8
  });

  it('unlocated anchored notes render in the top list', async () => {
    vi.spyOn(api, 'listNotes').mockResolvedValue([{ ...note, id: 'u', anchor: '某段文字' }]);
    const { findByText, container } = renderWithClient(<NotesPanel taskId="t" hasMedia={false} located={{}} />);
    await findByText(note.body);
    expect(container.querySelector('[style*="position: absolute"]')).toBeNull();
  });
});
