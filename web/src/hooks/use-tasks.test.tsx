import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api, type Note } from '@/lib/api';
import * as markerWrite from '@/lib/marker-write';
import { useAddNote } from './use-tasks';

const note: Note = { id: 'n', anchor: '', prefix: '第一段', suffix: '文字。', body: 'b', createdAt: 0, updatedAt: 0 };

function setup(taskId: string, saved: Note, md?: string) {
  const qc = new QueryClient();
  if (md !== undefined) qc.setQueryData(['task', taskId, 'content', saved.doc ?? 'article'], md);
  vi.spyOn(api, 'addNote').mockResolvedValue(saved);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useAddNote(taskId), { wrapper });
  return { qc, result };
}

afterEach(() => vi.restoreAllMocks());

describe('useAddNote marker writing', () => {
  it('writes a marker from the cached content and invalidates the content cache on success', async () => {
    const write = vi.spyOn(markerWrite, 'writeMarker').mockResolvedValue(true);
    const { qc, result } = setup('article-x', note, '第一段文字。');
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await act(() => result.current.mutateAsync({ body: 'b' }));
    expect(write).toHaveBeenCalledWith('article-x', note, '第一段文字。');
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['task', 'article-x', 'content', 'article'] }));
  });

  it('does not invalidate the content cache when the marker was not written', async () => {
    const write = vi.spyOn(markerWrite, 'writeMarker').mockResolvedValue(false);
    const { qc, result } = setup('article-x', note, '第一段文字。');
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await act(() => result.current.mutateAsync({ body: 'b' }));
    await waitFor(() => expect(write).toHaveBeenCalled());
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['task', 'article-x', 'content', 'article'] });
  });

  it('swallows a rejected writeMarker: no unhandled rejection, no content invalidation', async () => {
    const write = vi.spyOn(markerWrite, 'writeMarker').mockRejectedValue(new Error('boom'));
    const { qc, result } = setup('article-x', note, '第一段文字。');
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await act(() => result.current.mutateAsync({ body: 'b' }));
    await waitFor(() => expect(write).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));  // let the rejection settle; vitest fails the run on an unhandled one
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['task', 'article-x', 'content', 'article'] });
    expect(result.current.isError).toBe(false);
  });

  it.each([
    ['an anchorless note', 'article-x', { ...note, prefix: '', suffix: '' }, '第一段文字。'],
    ['a video page note without doc', 'task-1', note, '第一段文字。'],
    ['missing cached content', 'article-x', note, undefined],
  ])('skips %s', async (_name, taskId, saved, md) => {
    const write = vi.spyOn(markerWrite, 'writeMarker').mockResolvedValue(true);
    const { qc, result } = setup(taskId, saved, md);
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    await act(() => result.current.mutateAsync({ body: 'b' }));
    expect(write).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['task', taskId, 'notes'] });
  });

  it('writes for a video note that has a doc, keyed by that doc', async () => {
    const write = vi.spyOn(markerWrite, 'writeMarker').mockResolvedValue(true);
    const { result } = setup('task-1', { ...note, doc: 'summary' }, '第一段文字。');
    await act(() => result.current.mutateAsync({ body: 'b' }));
    expect(write).toHaveBeenCalledWith('task-1', { ...note, doc: 'summary' }, '第一段文字。');
  });
});
