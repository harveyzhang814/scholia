import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { NoteAnchor } from '@/lib/api';
import TaskDetail from './tasks.$id';

vi.mock('@/hooks/use-tasks', () => {
  const mutation = { mutate: () => {} };
  return {
    useTask: () => ({ data: { title: 'T', url: '' }, isLoading: false }),
    useContent: () => ({ data: '' }),
    useReveal: () => mutation,
    useMediaInfo: () => ({ data: undefined }),
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

vi.mock('@/components/reader', () => ({
  Reader: ({ onCommentDraft }: { onCommentDraft?: (a: NoteAnchor) => void }) => (
    <button onClick={() => onCommentDraft?.({ anchor: '选中的文字' })}>draft</button>
  ),
}));

vi.mock('@/components/notes-panel', () => ({
  NotesPanel: ({ pendingAnchor }: { pendingAnchor?: NoteAnchor | null }) =>
    pendingAnchor ? <div>pending:{pendingAnchor.anchor}</div> : null,
}));

describe('TaskDetail', () => {
  it('switching tab clears draft', () => {
    const { getByText, queryByText } = render(
      <MemoryRouter initialEntries={['/tasks/vid1']}>
        <Routes><Route path="/tasks/:id" element={<TaskDetail />} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(getByText('draft'));
    expect(getByText('pending:选中的文字')).toBeInTheDocument();
    fireEvent.click(getByText('文章'));
    expect(queryByText('pending:选中的文字')).toBeNull();
  });
});
