import { useState } from 'react';
import { usePlayerStore } from '@/stores/player-store';
import { useAddNote, useUpdateNote, useDeleteNote } from '@/hooks/use-tasks';
import { NoteCard } from '@/components/note-card';
import { VoicePendingCard } from '@/components/voice-pending-card';
import { DRAFT_ID } from '@/components/reader';
import type { Located } from '@/lib/anchor';
import type { Note, NoteAnchor } from '@/lib/api';
import { VOICE_PREFIX, VOICE_REC_PREFIX, type VoicePending } from '@/hooks/use-voice-comments';

interface CardsCommon {
  taskId: string;
  hasMedia: boolean;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  hoveredNoteId: string | null;
  onHover: (id: string | null) => void;
}

// Unsaved comment: sits in the article at its anchor (so no anchor label), saved or discarded in place.
export function DraftCard({ taskId, hasMedia, anchor, onDone }: {
  taskId: string;
  hasMedia: boolean;
  anchor: NoteAnchor;
  onDone: () => void;
}) {
  const [body, setBody] = useState('');
  const currentTime = usePlayerStore((s) => s.currentTime);
  const addNote = useAddNote(taskId);

  const save = () => {
    if (!body.trim()) return;
    addNote.mutate({
      ...anchor,
      body: body.trim(),
      ...(hasMedia && currentTime > 0 ? { mediaTimestamp: Math.floor(currentTime) } : {}),
    });
    onDone();
  };

  return (
    <div className="sc-note-card" data-variant="inline" data-draft>
      <textarea
        autoFocus
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
          if (e.key === 'Escape') onDone();
        }}
        placeholder="写下评论…"
        className="sc-card-textarea"
      />
      <div className="sc-card-edit-foot">
        <span>⌘↵ 保存 · Esc 放弃</span>
        <button className="sc-card-save" onClick={save} disabled={!body.trim()}>保存</button>
      </div>
    </div>
  );
}

// Inline-variant cards wired to the note mutations; shared by the slot list and the unlocated zone.
function useInlineCard({ taskId, collapsed, onToggle, hoveredNoteId, onHover }: CardsCommon) {
  const updateNote = useUpdateNote(taskId);
  const deleteNote = useDeleteNote(taskId);
  return (note: Note, approximate = false, flash = false) => (
    <NoteCard
      key={note.id}
      variant="inline"
      note={note}
      approximate={approximate}
      flash={flash}
      collapsed={collapsed.has(note.id)}
      onToggleCollapsed={() => onToggle(note.id)}
      isLinked={hoveredNoteId === note.id}
      onHover={onHover}
      onUpdate={(body) => updateNote.mutate({ noteId: note.id, body })}
      onDelete={() => deleteNote.mutate(note.id)}
    />
  );
}

export function InlineCards(props: CardsCommon & {
  ids: string[];
  notes: Note[];
  located: Record<string, Located>;
  draft: NoteAnchor | null;
  onDraftDone: () => void;
  voicePending?: VoicePending[];
  onVoiceRetry?: (id: string) => void;
  onVoiceDiscard?: (id: string) => void;
  flashNoteId?: string | null;
}) {
  const { ids, notes, located, draft, onDraftDone, taskId, hasMedia, voicePending, onVoiceRetry, onVoiceDiscard, flashNoteId } = props;
  const renderCard = useInlineCard(props);
  return (
    <>
      {ids.map((id) => {
        if (id === DRAFT_ID) {
          return draft && <DraftCard key={id} taskId={taskId} hasMedia={hasMedia} anchor={draft} onDone={onDraftDone} />;
        }
        if (id.startsWith(VOICE_REC_PREFIX)) return null;  // the recording's anchor is marked in the text; no card yet
        if (id.startsWith(VOICE_PREFIX)) {
          const item = voicePending?.find((p) => p.id === id);
          return item && (
            <VoicePendingCard key={id} item={item} variant="inline"
              onRetry={() => onVoiceRetry?.(id)} onDiscard={() => onVoiceDiscard?.(id)} />
          );
        }
        const note = notes.find((n) => n.id === id);
        return note && renderCard(note, located[id]?.grade === 'approximate', flashNoteId === id);
      })}
    </>
  );
}

// Top-of-article zone for notes without a position; always rendered so anchorless comments can be added.
export function UnlocatedZone(props: CardsCommon & { notes: Note[] }) {
  const { notes, taskId, hasMedia } = props;
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const renderCard = useInlineCard(props);
  return (
    <div className="sc-unlocated-zone">
      <div className="sc-zone-head">
        <span className="sc-zone-title">未定位评论（{notes.length}）</span>
        <button className="sc-zone-add" onClick={() => { setOpen(true); setAdding(true); }}>添加评论</button>
        <button
          className="sc-card-toggle"
          aria-label={open ? '收起区域' : '展开区域'}
          onClick={() => setOpen(!open)}
        >
          {open ? '▾' : '▸'}
        </button>
      </div>
      {open && (adding || notes.length > 0) && (
        <div className="sc-zone-list">
          {adding && <DraftCard taskId={taskId} hasMedia={hasMedia} anchor={{ anchor: '' }} onDone={() => setAdding(false)} />}
          {notes.map((n) => renderCard(n))}
        </div>
      )}
    </div>
  );
}
