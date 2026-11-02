import { describe, it, expect, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router';
import type { NoteAnchor } from '@/lib/api';
import type { Located } from '@/lib/anchor';
import { useUiStore } from '@/stores/ui-store';
import TaskDetail from './tasks.$id';

const h = vi.hoisted(() => ({
  mediaInfo: undefined as unknown,
  notes: [] as { id: string; anchor: string }[],
  located: {} as Record<string, unknown>,
  readerProps: {} as {
    onCommentDraft?: unknown;
    renderInline?: unknown;
    draft?: unknown;
    onNoteAnchorClick?: unknown;
    notes?: { id: string }[];
    voice?: { state: string; onStart: (a: NoteAnchor) => void; onStop: () => void; onUnavailable: () => void };
  },
  inlineProps: {} as { collapsed?: Set<string>; draft?: unknown; onDraftDone?: () => void; notes?: { id: string }[] },
  zoneProps: {} as { collapsed?: Set<string>; notes?: { id: string }[] },
  voiceArgs: [] as [string, boolean][],
}));

// Stand-in for useVoiceComments: start/stop flip a local recording, as the real hook does once the server answers.
vi.mock('@/hooks/use-voice-comments', () => ({
  VOICE_PREFIX: 'voice:',
  VOICE_REC_PREFIX: 'voice-rec:',
  useVoiceComments: (taskId: string, enabled: boolean) => {
    h.voiceArgs.push([taskId, enabled]);
    const [recording, setRecording] = useState<{ id: string; anchor: NoteAnchor; startedAt: number } | null>(null);
    const noop = () => {};
    return {
      available: true,
      busy: recording !== null,
      recording,
      pending: [],
      toast: null,
      showHint: false,
      justSavedId: null,
      start: (anchor: NoteAnchor) => setRecording({ id: 's1', anchor, startedAt: Date.now() }),
      stop: () => setRecording(null),
      cancel: () => setRecording(null),
      retry: noop,
      discard: noop,
      dismissHint: noop,
      notifyUnavailable: noop,
    };
  },
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
    useNotes: () => ({ data: h.notes }),
  };
});

vi.mock('@/hooks/use-read-state', () => ({
  useMarkRead: () => ({ mutate: () => {} }),
  useMarkUnread: () => ({ mutate: () => {} }),
}));

vi.mock('@/components/subtitle-list', () => ({ SubtitleList: () => null }));
vi.mock('@/components/player', () => ({ Player: () => null }));

vi.mock('@/components/reader', () => ({
  Reader: (props: {
    onCommentDraft?: (a: NoteAnchor) => void;
    onNotesLocated?: (l: Record<string, Located>) => void;
    renderInline?: (ids: string[]) => React.ReactNode;
    onNoteAnchorClick?: (id: string) => void;
    voice?: typeof h.readerProps.voice;
  }) => {
    h.readerProps = props;
    useEffect(() => { props.onNotesLocated?.(h.located as Record<string, Located>); }); // eslint-disable-line react-hooks/exhaustive-deps
    return (
      <>
        {props.voice && <button>mic</button>}
        <button onClick={() => props.onCommentDraft?.({ anchor: '选中的文字' })}>draft</button>
        <button onClick={() => props.onNoteAnchorClick?.('a')}>anchor-a</button>
        {props.renderInline?.([])}
      </>
    );
  },
}));

vi.mock('@/components/inline-notes', () => ({
  InlineCards: (props: typeof h.inlineProps) => { h.inlineProps = props; return null; },
  UnlocatedZone: (props: typeof h.zoneProps) => { h.zoneProps = props; return <div data-testid="zone" />; },
}));

vi.mock('@/components/notes-panel', () => ({
  NotesPanel: ({ pendingAnchor, focusNoteId }: { pendingAnchor?: NoteAnchor | null; focusNoteId?: string | null }) => (
    <>
      {pendingAnchor && <div>pending:{pendingAnchor.anchor}</div>}
      {focusNoteId && <div>focus:{focusNoteId}</div>}
    </>
  ),
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
    useUiStore.setState({ layoutMode: 'B', commentView: 'sidebar' });
    const { getByText, queryByText } = renderTask('vid1');
    fireEvent.click(getByText('draft'));
    expect(getByText('pending:选中的文字')).toBeInTheDocument();
    fireEvent.click(getByText('文章'));
    expect(queryByText('pending:选中的文字')).toBeNull();
  });

  it('mode A gives Reader no comment entry', () => {
    useUiStore.setState({ commentView: 'sidebar' });
    h.mediaInfo = { video: { exists: true }, audio: { exists: false } };
    renderTask('vid1');
    expect(useUiStore.getState().layoutMode).toBe('A');
    expect(h.readerProps.onCommentDraft).toBeUndefined();
  });

  it('other layouts and articles give Reader the comment entry', () => {
    useUiStore.setState({ commentView: 'sidebar' });
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

  describe('comment view', () => {
    const noteA = { id: 'a', anchor: 'A' };
    const noteB = { id: 'b', anchor: 'B' };
    const setup = (view: 'inline' | 'sidebar', notes = [noteA, noteB], located: Record<string, unknown> = {}) => {
      h.notes = notes;
      h.located = located;
      h.mediaInfo = { video: { exists: false }, audio: { exists: false } };
      useUiStore.setState({ commentView: view, layoutMode: 'E' });
    };

    it('inline view hides the right column and passes renderInline', () => {
      setup('inline');
      const { container } = renderTask('article-x');
      expect(container.querySelector('.notes-col')).toBeNull();
      expect(h.readerProps.renderInline).toBeTypeOf('function');
    });

    it('sidebar view keeps the right column and no renderInline', () => {
      setup('sidebar');
      const { container, queryByTestId, queryByText } = renderTask('article-x');
      expect(container.querySelector('.notes-col')).not.toBeNull();
      expect(h.readerProps.renderInline).toBeUndefined();
      expect(h.readerProps.draft).toBeUndefined();
      expect(queryByTestId('zone')).toBeNull();
      expect(queryByText('全部收起')).toBeNull();
    });

    it('sidebar view routes anchor clicks to the notes panel focus', () => {
      setup('sidebar');
      const { getByText } = renderTask('article-x');
      fireEvent.click(getByText('anchor-a'));
      expect(getByText('focus:a')).toBeInTheDocument();
    });

    it('mode A in inline view gives Reader the comment entry', () => {
      setup('inline');
      h.mediaInfo = { video: { exists: true }, audio: { exists: false } };
      renderTask('vid1');
      expect(useUiStore.getState().layoutMode).toBe('A');
      expect(h.readerProps.onCommentDraft).toBeTypeOf('function');
    });

    it('inline view passes the draft state to Reader and InlineCards, and onDraftDone clears it', () => {
      setup('inline');
      const { getByText } = renderTask('article-x');
      expect(h.readerProps.draft).toBeNull();
      fireEvent.click(getByText('draft'));
      expect(h.readerProps.draft).toEqual({ anchor: '选中的文字' });
      expect(h.inlineProps.draft).toEqual({ anchor: '选中的文字' });
      act(() => h.inlineProps.onDraftDone?.());
      expect(h.readerProps.draft).toBeNull();
    });

    it('collapse all then expand all', () => {
      setup('inline');
      const { getByText, queryByText } = renderTask('article-x');
      expect(h.inlineProps.collapsed).toEqual(new Set());
      fireEvent.click(getByText('全部收起'));
      expect(h.inlineProps.collapsed).toEqual(new Set(['a', 'b']));
      expect(h.zoneProps.collapsed).toEqual(new Set(['a', 'b']));
      expect(queryByText('全部收起')).toBeNull();
      fireEvent.click(getByText('全部展开'));
      expect(h.inlineProps.collapsed).toEqual(new Set());
      expect(getByText('全部收起')).toBeInTheDocument();
    });

    it('shows collapse all again when one note is expanded via its anchor', () => {
      setup('inline');
      const { getByText } = renderTask('article-x');
      fireEvent.click(getByText('全部收起'));
      fireEvent.click(getByText('anchor-a'));
      expect(h.inlineProps.collapsed).toEqual(new Set(['b']));
      expect(getByText('全部收起')).toBeInTheDocument();
    });

    it('has no collapse button without notes', () => {
      setup('inline', []);
      const { queryByText } = renderTask('article-x');
      expect(queryByText('全部收起')).toBeNull();
      expect(queryByText('全部展开')).toBeNull();
    });

    it('unlocated zone gets the notes Reader did not locate', () => {
      setup('inline', [noteA, noteB], { a: { start: 0, end: 1, grade: 'exact' } });
      renderTask('article-x');
      expect(h.zoneProps.notes?.map((n) => n.id)).toEqual(['b']);
    });

    it('unlocated zone renders before the reader', () => {
      setup('inline');
      const { getByTestId, getByText } = renderTask('article-x');
      const zone = getByTestId('zone');
      const reader = getByText('draft');
      expect(zone.compareDocumentPosition(reader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  describe('voice comments', () => {
    it('article page shows the voice bar while recording and hides it after stop', () => {
      h.notes = [{ id: 'a', anchor: 'A' }];
      h.located = {};
      h.mediaInfo = { video: { exists: false }, audio: { exists: false } };
      h.voiceArgs = [];
      useUiStore.setState({ commentView: 'inline', layoutMode: 'E' });
      const { getByText, getByRole, queryByRole } = renderTask('article-x');
      expect(h.voiceArgs.at(-1)).toEqual(['article-x', true]);
      expect(getByText('mic')).toBeInTheDocument();
      expect(h.readerProps.voice?.state).toBe('ready');
      expect(queryByRole('status')).toBeNull();

      act(() => h.readerProps.voice!.onStart({ anchor: '选中的文字' }));
      const bar = getByRole('status');
      expect(bar).toHaveTextContent('录音中');
      expect(bar).toHaveTextContent('评论「选中的文字」');
      expect(bar.parentElement?.className).toBe('flex-1 overflow-y-auto');
      expect(bar.parentElement?.firstElementChild).toBe(bar);
      expect(h.readerProps.voice?.state).toBe('recording');
      // The recording pseudo-note reaches the Reader only; cards, the zone and collapse-all see real notes.
      expect(h.readerProps.notes?.map((n) => n.id)).toEqual(['a', 'voice-rec:s1']);
      expect(h.inlineProps.notes?.map((n) => n.id)).toEqual(['a']);
      expect(h.zoneProps.notes?.map((n) => n.id)).toEqual(['a']);
      fireEvent.click(getByText('全部收起'));
      expect(h.inlineProps.collapsed).toEqual(new Set(['a']));

      fireEvent.click(getByRole('button', { name: /结束并保存/ }));
      expect(queryByRole('status')).toBeNull();
      expect(h.readerProps.voice?.state).toBe('ready');
      expect(h.readerProps.notes?.map((n) => n.id)).toEqual(['a']);
    });

    it('video page passes no voice prop and renders no mic button', () => {
      h.notes = [];
      h.mediaInfo = { video: { exists: true }, audio: { exists: false } };
      h.voiceArgs = [];
      useUiStore.setState({ commentView: 'sidebar' });
      const { queryByText } = renderTask('vid1');
      expect(h.readerProps.voice).toBeUndefined();
      expect(queryByText('mic')).toBeNull();
      expect(h.voiceArgs.length).toBeGreaterThan(0);
      expect(h.voiceArgs.every(([taskId, enabled]) => taskId === 'vid1' && enabled === false)).toBe(true);
    });

    it('switching task drops the previous task\'s recording in the same render', () => {
      h.notes = [];
      h.located = {};
      h.mediaInfo = { video: { exists: false }, audio: { exists: false } };
      useUiStore.setState({ commentView: 'inline', layoutMode: 'E' });
      const Next = () => {
        const navigate = useNavigate();
        return <button onClick={() => navigate('/tasks/article-y')}>next</button>;
      };
      const { getByText, getByRole, queryByRole } = render(
        <MemoryRouter initialEntries={['/tasks/article-x']}>
          <Routes><Route path="/tasks/:id" element={<><TaskDetail /><Next /></>} /></Routes>
        </MemoryRouter>,
      );
      act(() => h.readerProps.voice!.onStart({ anchor: '选中的文字' }));
      expect(getByRole('status')).toBeInTheDocument();
      fireEvent.click(getByText('next'));
      expect(queryByRole('status')).toBeNull();
      expect(h.readerProps.notes).toEqual([]);
    });
  });
});
