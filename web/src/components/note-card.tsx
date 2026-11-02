import { useState, useRef, useEffect, Fragment } from 'react';
import { formatDuration, formatRelativeTime } from '@/lib/time';
import { anchorKind } from '@/lib/anchor';
import type { Note } from '@/lib/api';

export type CardVariant = 'inline' | 'sidebar';

export interface NoteEntryData { id: string; kind: 'body'; text: string }

// Replies / AI answers get appended here later.
export function noteEntries(note: Note): NoteEntryData[] {
  return [{ id: note.id, kind: 'body', text: note.body }];
}

// Displays or edits one text. Markdown support would only change this component.
function NoteEntry({ entry, editing, draft, onDraftChange, onStartEdit, onSave, onCancel }: {
  entry: NoteEntryData;
  editing: boolean;
  draft: string;
  onDraftChange: (v: string) => void;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  if (editing) {
    return (
      <textarea
        autoFocus
        rows={3}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave();
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={onSave}
        className="sc-card-textarea"
      />
    );
  }
  return (
    <p className="sc-card-entry cursor-text" onClick={onStartEdit}>
      {entry.text}
    </p>
  );
}

export interface NoteCardProps {
  note: Note;
  variant: CardVariant;
  approximate?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  isLinked: boolean;
  onHover: (id: string | null) => void;
  onUpdate: (body: string) => void;
  onDelete: () => void;
  onHeightChange?: (id: string, h: number) => void;
  autoEdit?: boolean;
  onAutoEditConsumed?: () => void;
  flash?: boolean;
}

export function NoteCard({
  note,
  variant,
  approximate,
  collapsed,
  onToggleCollapsed,
  isLinked,
  onHover,
  onUpdate,
  onDelete,
  onHeightChange,
  autoEdit,
  onAutoEditConsumed,
  flash,
}: NoteCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const ref = useRef<HTMLDivElement>(null);
  const inline = variant === 'inline';
  const isCollapsed = inline && !!collapsed;
  const kind = anchorKind(note);

  useEffect(() => {
    if (!onHeightChange || !ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver(() => onHeightChange(note.id, el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [note.id, onHeightChange]);

  useEffect(() => {
    if (!autoEdit) return;
    setEditing(true);
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    onAutoEditConsumed?.();
  }, [autoEdit, onAutoEditConsumed]);

  useEffect(() => {
    if (!isLinked || inline) return;
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [isLinked, inline]);

  const save = () => {
    if (draft.trim() && draft.trim() !== note.body) onUpdate(draft.trim());
    setEditing(false);
  };
  const cancel = () => { setDraft(note.body); setEditing(false); };

  const toggle = inline && (
    <button
      className="sc-card-toggle"
      aria-label={isCollapsed ? '展开' : '收起'}
      onClick={onToggleCollapsed}
    >
      {isCollapsed ? '▸' : '▾'}
    </button>
  );

  const showSnapshot = approximate && (note.prefix !== undefined || note.suffix !== undefined);
  const metaItems = [
    note.mediaTimestamp !== undefined && <span key="ts" className="sc-card-ts">@ {formatDuration(note.mediaTimestamp)}</span>,
    approximate && <span key="approx">原文已变化</span>,
    <span key="time">{formatRelativeTime(note.createdAt)}</span>,
  ].filter(Boolean);

  return (
    <div
      ref={ref}
      className="sc-note-card"
      data-note-card={note.id}
      data-variant={variant}
      data-collapsed={isCollapsed || undefined}
      data-voice-flash={flash || undefined}
      style={{
        background: isLinked && !editing ? 'var(--accent-3)' : undefined,
        boxShadow: isLinked && !editing ? 'inset 2px 0 0 var(--accent-9)' : undefined,
      }}
      onMouseEnter={() => onHover(note.id)}
      onMouseLeave={() => onHover(null)}
    >
      {isCollapsed ? (
        <div className="sc-card-main">
          <span className="sc-card-preview" data-preview>{note.body.split('\n')[0]}</span>
          {toggle}
        </div>
      ) : (
        <>
          {!inline && kind !== 'none' && (
            <div className="sc-quote" data-quote>
              {kind === 'range' ? note.anchor.split('\n')[0] : '插入点'}
            </div>
          )}

          <div className="sc-card-main">
            <div className="sc-card-entries">
              {noteEntries(note).map((entry) => (
                <NoteEntry
                  key={entry.id}
                  entry={entry}
                  editing={editing}
                  draft={draft}
                  onDraftChange={setDraft}
                  onStartEdit={() => setEditing(true)}
                  onSave={save}
                  onCancel={cancel}
                />
              ))}
            </div>
            {toggle}
          </div>

          {showSnapshot && (
            <p className="sc-card-snapshot">
              {note.prefix}
              {kind === 'range' ? <strong>{note.anchor}</strong> : <strong>‸</strong>}
              {note.suffix}
            </p>
          )}

          <div className="sc-card-meta" data-meta>
            {metaItems.map((item, i) => (
              <Fragment key={i}>
                {i > 0 && <span className="sc-card-sep">·</span>}
                {item}
              </Fragment>
            ))}
            {!editing && (
              <span className="sc-card-actions">
                <button onClick={() => setEditing(true)}>编辑</button>
                <button onClick={onDelete}>删除</button>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
