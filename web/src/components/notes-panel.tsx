import { useState, useRef, useEffect, useLayoutEffect, useCallback, RefObject } from 'react';
import { usePlayerStore } from '@/stores/player-store';
import { formatDuration } from '@/lib/time';
import { useNotes, useAddNote, useUpdateNote, useDeleteNote } from '@/hooks/use-tasks';
import { computePositions } from '@/lib/anchor-layout';
import { anchorKind, type Located } from '@/lib/anchor';
import { BLOCK } from '@/lib/text-index';
import type { Note, NoteAnchor } from '@/lib/api';

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
}

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

export function NoteItem({
  note,
  onUpdate,
  onDelete,
  onHeightChange,
  isLinked,
  onHover,
  autoEdit,
  onAutoEditConsumed,
  approximate,
}: {
  note: Note;
  onUpdate: (body: string) => void;
  onDelete: () => void;
  onHeightChange: (id: string, h: number) => void;
  isLinked: boolean;
  onHover: (id: string | null) => void;
  autoEdit: boolean;
  onAutoEditConsumed: () => void;
  approximate?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const liRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!liRef.current) return;
    const li = liRef.current;
    const ro = new ResizeObserver(() => {
      onHeightChange(note.id, li.offsetHeight);
    });
    ro.observe(li);
    return () => ro.disconnect();
  }, [note.id, onHeightChange]);

  useEffect(() => {
    if (!autoEdit) return;
    setEditing(true);
    liRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    onAutoEditConsumed();
  }, [autoEdit, onAutoEditConsumed]);

  useEffect(() => {
    if (!isLinked) return;
    liRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [isLinked]);

  const save = () => {
    if (draft.trim() && draft.trim() !== note.body) onUpdate(draft.trim());
    setEditing(false);
  };
  const cancel = () => { setDraft(note.body); setEditing(false); };

  return (
    <li
      ref={liRef}
      className="px-4 py-3 group"
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        background: isLinked && !editing ? 'var(--accent-3)' : undefined,
        boxShadow: isLinked && !editing ? 'inset 2px 0 0 var(--accent-9)' : undefined,
        transition: 'background 120ms, box-shadow 120ms',
      }}
      onMouseEnter={() => onHover(note.id)}
      onMouseLeave={() => onHover(null)}
    >
      {note.mediaTimestamp !== undefined && (
        <div className="text-xs mb-1" style={{ color: 'var(--accent-9)', fontFamily: 'var(--font-mono)' }}>
          @ {formatDuration(note.mediaTimestamp)}
        </div>
      )}

      {approximate && (
        <div className="text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
          原文已变化
        </div>
      )}

      {editing ? (
        <textarea
          autoFocus
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
            if (e.key === 'Escape') cancel();
          }}
          onBlur={save}
          className="w-full text-xs resize-none rounded p-2 outline-none"
          style={{
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--accent-9)',
            lineHeight: 1.6,
          }}
        />
      ) : (
        <p
          className="text-xs leading-relaxed cursor-text"
          style={{ color: 'var(--text-primary)' }}
          onClick={() => setEditing(true)}
        >
          {note.body}
        </p>
      )}

      {!editing && (
        <div className="mt-1 flex gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setEditing(true)}
            className="text-xs cursor-pointer"
            style={{ color: 'var(--text-tertiary)' }}
          >
            编辑
          </button>
          <button
            onClick={onDelete}
            className="text-xs cursor-pointer"
            style={{ color: 'var(--text-tertiary)' }}
          >
            删除
          </button>
        </div>
      )}
    </li>
  );
}

const ESTIMATED_HEIGHT = 72;
const GAP = 8;

export function NotesPanel({ taskId, hasMedia, pendingAnchor, onAnchorConsumed, articleRef, hoveredNoteId, onNoteHover, focusNoteId, onFocusConsumed, located }: NotesPanelProps) {
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
    const placed = notes.filter((n) => located?.[n.id]);
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
  }, [notes, heights, articleRef, articleHeight, located]);

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
      {(isLoading || unplaced.length > 0) && (
        <ul className="py-2">
          {isLoading && (
            <li className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
              加载中…
            </li>
          )}
          {unplaced.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              onHeightChange={onHeightChange}
              onUpdate={(body) => updateNote.mutate({ noteId: note.id, body })}
              onDelete={() => deleteNote.mutate(note.id)}
              isLinked={hoveredNoteId === note.id}
              onHover={handleNoteHover}
              autoEdit={focusNoteId === note.id}
              onAutoEditConsumed={handleFocusConsumed}
            />
          ))}
        </ul>
      )}

      {/* Located notes (absolute layout zone) */}
      {placed.length > 0 && (
        <div style={{ position: 'relative', height: articleHeight, flexShrink: 0 }}>
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
              <NoteItem
                note={note}
                onHeightChange={onHeightChange}
                onUpdate={(body) => updateNote.mutate({ noteId: note.id, body })}
                onDelete={() => deleteNote.mutate(note.id)}
                isLinked={hoveredNoteId === note.id}
                onHover={handleNoteHover}
                autoEdit={focusNoteId === note.id}
                onAutoEditConsumed={handleFocusConsumed}
                approximate={located?.[note.id]?.grade === 'approximate'}
              />
            </ul>
          ))}
        </div>
      )}

      {!isLoading && notes.length === 0 && (
        <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
          暂无笔记
        </div>
      )}
    </div>
  );
}
