import { useState, useRef, useEffect, useLayoutEffect, useCallback, RefObject } from 'react';
import { usePlayerStore } from '@/stores/player-store';
import { formatDuration } from '@/lib/time';
import { useNotes, useAddNote, useUpdateNote, useDeleteNote } from '@/hooks/use-tasks';
import { computePositions } from '@/lib/anchor-layout';
import { anchorKind, type Located } from '@/lib/anchor';
import { BLOCK } from '@/lib/text-index';
import { NoteCard } from '@/components/note-card';
import { VoicePendingCard } from '@/components/voice-pending-card';
import type { NoteAnchor } from '@/lib/api';
import type { VoicePending } from '@/hooks/use-voice-comments';

interface NotesPanelProps {
  taskId: string;
  hasMedia: boolean;
  pendingAnchor?: NoteAnchor | null;
  onAnchorConsumed?: () => void;
  articleRef?: RefObject<HTMLDivElement | null>;
  hoveredNoteId?: string | null;
  onNoteHover?: (id: string | null) => void;
  focusNoteId?: string | null;
  onFocusConsumed?: () => void;
  located?: Record<string, Located>;
  voicePending?: VoicePending[];
  onVoiceRetry?: (id: string) => void;
  onVoiceDiscard?: (id: string) => void;
  flashNoteId?: string | null;
}

const NO_PENDING: VoicePending[] = [];

// Top of the block holding the note's first mark/icon in the article (the mark itself if no block).
function noteMarkY(noteId: string, articleEl: HTMLElement): number | null {
  const mark = articleEl.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`);
  if (!mark) return null;
  let block: HTMLElement | null = mark;
  while (block && block !== articleEl && !BLOCK.has(block.tagName)) block = block.parentElement;
  const el = block && block !== articleEl ? block : mark;
  const elRect = el.getBoundingClientRect();
  const artRect = articleEl.getBoundingClientRect();
  return elRect.top - artRect.top + articleEl.scrollTop;
}

function anchorLabel(a: NoteAnchor): string {
  if (anchorKind(a) === 'range') return `锚点：${a.anchor.slice(0, 40)}${a.anchor.length > 40 ? '…' : ''}`;
  return a.prefix ? `插入点：…${a.prefix.slice(-12)}` : `插入点：${(a.suffix ?? '').slice(0, 12)}…`;
}

const ESTIMATED_HEIGHT = 72;
const GAP = 8;

export function NotesPanel({ taskId, hasMedia, pendingAnchor, onAnchorConsumed, articleRef, hoveredNoteId, onNoteHover, focusNoteId, onFocusConsumed, located, voicePending = NO_PENDING, onVoiceRetry, onVoiceDiscard, flashNoteId }: NotesPanelProps) {
  const [draft, setDraft] = useState('');
  const currentTime = usePlayerStore((s) => s.currentTime);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: notes = [], isLoading } = useNotes(taskId);
  const addNote = useAddNote(taskId);
  const updateNote = useUpdateNote(taskId);
  const deleteNote = useDeleteNote(taskId);

  const [heights, setHeights] = useState<Record<string, number>>({});
  const onHeightChange = useCallback((id: string, h: number) => {
    setHeights((prev) => prev[id] === h ? prev : { ...prev, [id]: h });
  }, []);

  const [positions, setPositions] = useState<Record<string, number>>({});
  const handleNoteHover = onNoteHover ?? (() => {});
  const handleFocusConsumed = onFocusConsumed ?? (() => {});
  const [articleHeight, setArticleHeight] = useState(0);

  useEffect(() => {
    if (pendingAnchor) inputRef.current?.focus();
  }, [pendingAnchor]);

  useEffect(() => {
    const el = articleRef?.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setArticleHeight(el.scrollHeight));
    ro.observe(el);
    setArticleHeight(el.scrollHeight);
    return () => ro.disconnect();
  }, [articleRef]);

  useLayoutEffect(() => {
    const el = articleRef?.current;
    if (!el) return;
    const placed = [...notes, ...voicePending].filter((n) => located?.[n.id]);
    const layouts = placed.map((n) => {
      const anchorY = noteMarkY(n.id, el) ?? 0;
      const height = heights[n.id] ?? ESTIMATED_HEIGHT;
      return { id: n.id, anchorY, height };
    });
    const computed = computePositions(layouts, GAP);
    const next: Record<string, number> = {};
    computed.forEach((p) => { next[p.id] = p.top; });
    // Only update state if positions actually changed to avoid infinite re-render loop
    setPositions((prev) => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length !== nextKeys.length) return next;
      for (const k of nextKeys) {
        if (prev[k] !== next[k]) return next;
      }
      return prev;
    });
  }, [notes, voicePending, heights, articleRef, articleHeight, located]);

  const submit = () => {
    if (!draft.trim()) return;
    addNote.mutate({
      ...(pendingAnchor ?? { anchor: '' }),
      body: draft.trim(),
      ...(hasMedia && currentTime > 0 ? { mediaTimestamp: Math.floor(currentTime) } : {}),
    });
    setDraft('');
    onAnchorConsumed?.();
  };

  const unplaced = notes.filter((n) => !located?.[n.id]);
  const placed = notes.filter((n) => located?.[n.id]);
  const unplacedPending = voicePending.filter((p) => !located?.[p.id]);
  const placedPending = voicePending.filter((p) => located?.[p.id]);
  const pendingCard = (item: VoicePending) => (
    <VoicePendingCard item={item} variant="sidebar"
      onRetry={() => onVoiceRetry?.(item.id)} onDiscard={() => onVoiceDiscard?.(item.id)} />
  );

  return (
    <div className="flex flex-col text-sm" style={{ minHeight: '100%' }}>
      {/* Header */}
      <div
        className="px-4 py-2.5 text-xs font-medium"
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          color: 'var(--text-secondary)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--bg-surface)',
        }}
      >
        笔记{notes.length > 0 && <span style={{ color: 'var(--text-tertiary)' }}> · {notes.length}</span>}
      </div>

      {/* Sticky input */}
      <div
        className="px-3 py-3"
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          position: 'sticky',
          top: 36,
          zIndex: 10,
          background: 'var(--bg-surface)',
        }}
      >
        {pendingAnchor && (
          <div
            className="mb-2 text-xs px-2 py-1 rounded"
            style={{ background: 'var(--accent-3)', color: 'var(--accent-11)' }}
          >
            {anchorLabel(pendingAnchor)}
          </div>
        )}
        <textarea
          ref={inputRef}
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            if (e.key === 'Escape' && pendingAnchor) onAnchorConsumed?.();
          }}
          placeholder="写下笔记…"
          className="w-full text-xs resize-none rounded p-2 outline-none"
          style={{
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            lineHeight: 1.6,
          }}
        />
        <div className="mt-2 flex items-center justify-between">
          {hasMedia && currentTime > 0 ? (
            <div className="text-xs" style={{ color: 'var(--accent-9)', fontFamily: 'var(--font-mono)' }}>
              @ {formatDuration(currentTime)}
            </div>
          ) : <span />}
          <button
            onClick={submit}
            disabled={!draft.trim()}
            className="text-xs px-3 py-1 rounded cursor-pointer"
            style={{
              background: draft.trim() ? 'var(--accent-9)' : 'var(--bg-elevated)',
              color: draft.trim() ? 'white' : 'var(--text-tertiary)',
              border: '1px solid var(--border-subtle)',
              cursor: draft.trim() ? 'pointer' : 'default',
              transition: 'background 0.15s',
            }}
          >
            保存
          </button>
        </div>
      </div>

      {/* Notes not located in the article (normal flow) */}
      {(isLoading || unplaced.length > 0 || unplacedPending.length > 0) && (
        <ul className="py-2">
          {isLoading && (
            <li className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
              加载中…
            </li>
          )}
          {unplaced.map((note) => (
            <li key={note.id}>
              <NoteCard
                variant="sidebar"
                note={note}
                onHeightChange={onHeightChange}
                onUpdate={(body) => updateNote.mutate({ noteId: note.id, body })}
                onDelete={() => deleteNote.mutate(note.id)}
                isLinked={hoveredNoteId === note.id}
                onHover={handleNoteHover}
                autoEdit={focusNoteId === note.id}
                onAutoEditConsumed={handleFocusConsumed}
                flash={flashNoteId === note.id}
              />
            </li>
          ))}
          {unplacedPending.map((item) => <li key={item.id}>{pendingCard(item)}</li>)}
        </ul>
      )}

      {/* Located notes (absolute layout zone) */}
      {(placed.length > 0 || placedPending.length > 0) && (
        <div style={{ position: 'relative', height: articleHeight, flexShrink: 0 }}>
          {placedPending.map((item) => (
            <ul
              key={item.id}
              style={{
                position: 'absolute',
                top: positions[item.id] ?? 0,
                width: '100%',
                margin: 0,
                padding: 0,
                listStyle: 'none',
              }}
            >
              <li>{pendingCard(item)}</li>
            </ul>
          ))}
          {placed.map((note) => (
            <ul
              key={note.id}
              style={{
                position: 'absolute',
                top: positions[note.id] ?? 0,
                width: '100%',
                margin: 0,
                padding: 0,
                listStyle: 'none',
              }}
            >
              <li>
                <NoteCard
                  variant="sidebar"
                  note={note}
                  onHeightChange={onHeightChange}
                  onUpdate={(body) => updateNote.mutate({ noteId: note.id, body })}
                  onDelete={() => deleteNote.mutate(note.id)}
                  isLinked={hoveredNoteId === note.id}
                  onHover={handleNoteHover}
                  autoEdit={focusNoteId === note.id}
                  onAutoEditConsumed={handleFocusConsumed}
                  approximate={located?.[note.id]?.grade === 'approximate'}
                  flash={flashNoteId === note.id}
                />
              </li>
            </ul>
          ))}
        </div>
      )}

      {!isLoading && notes.length === 0 && voicePending.length === 0 && (
        <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
          暂无笔记
        </div>
      )}
    </div>
  );
}
