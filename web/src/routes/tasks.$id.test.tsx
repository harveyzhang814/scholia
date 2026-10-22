import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { NoteAnchor } from '@/lib/api';
import { useUiStore } from '@/stores/ui-store';
import TaskDetail from './tasks.$id';

const h = vi.hoisted(() => ({
  mediaInfo: undefined as unknown,
  readerProps: {} as { onCommentDraft?: unknown },
}));

vi.mock('@/hooks/use-tasks', () => {
  const mutation = { mutate: () => {} };
  return {
    useTask: () => ({ data: { title: 'T', url: '' }, isLoading: false }),
    useContent: () => ({ data: '' }),
    useReveal: () => mutation,
    useMediaInfo: () => ({ data: h.mediaInfo }),
    useHighlights: () => ({ data: [] }),
    useAddHighlight: () => mutation,
    useDeleteHighlight: () => mutation,
    useNotes: () => ({ data: [] }),
  };
});

vi.mock('@/hooks/use-read-state', () => ({
  useMarkRead: () => ({ mutate: () => {} }),
  useMarkUnread: () => ({ mutate: () => {} }),
}));

vi.mock('@/components/subtitle-list', () => ({ SubtitleList: () => null }));
vi.mock('@/components/player', () => ({ Player: () => null }));

vi.mock('@/components/reader', () => ({
  Reader: (props: { onCommentDraft?: (a: NoteAnchor) => void }) => {
    h.readerProps = props;
    return <button onClick={() => props.onCommentDraft?.({ anchor: '选中的文字' })}>draft</button>;
  },
}));

vi.mock('@/components/notes-panel', () => ({
  NotesPanel: ({ pendingAnchor }: { pendingAnchor?: NoteAnchor | null }) =>
    pendingAnchor ? <div>pending:{pendingAnchor.anchor}</div> : null,
}));

function renderTask(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/tasks/${id}`]}>
      <Routes><Route path="/tasks/:id" element={<TaskDetail />} /></Routes>
    </MemoryRouter>,
  );
}

describe('TaskDetail', () => {
  it('switching tab clears draft', () => {
    h.mediaInfo = undefined;
    useUiStore.setState({ layoutMode: 'B' });
    const { getByText, queryByText } = renderTask('vid1');
    fireEvent.click(getByText('draft'));
    expect(getByText('pending:选中的文字')).toBeInTheDocument();
    fireEvent.click(getByText('文章'));
    expect(queryByText('pending:选中的文字')).toBeNull();
  });

  it('mode A gives Reader no comment entry', () => {
    h.mediaInfo = { video: { exists: true }, audio: { exists: false } };
    renderTask('vid1');
    expect(useUiStore.getState().layoutMode).toBe('A');
    expect(h.readerProps.onCommentDraft).toBeUndefined();
  });

  it('other layouts and articles give Reader the comment entry', () => {
    h.mediaInfo = { video: { exists: false }, audio: { exists: true } };
    const audio = renderTask('aud1');
    expect(useUiStore.getState().layoutMode).toBe('C');
    expect(h.readerProps.onCommentDraft).toBeTypeOf('function');
    audio.unmount();

    h.mediaInfo = { video: { exists: false }, audio: { exists: false } };
    renderTask('article-x');
    expect(useUiStore.getState().layoutMode).toBe('E');
    expect(h.readerProps.onCommentDraft).toBeTypeOf('function');
  });
});
