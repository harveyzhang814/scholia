import { useMemo, useRef, useState, useCallback, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MarkdownPreview } from '@harveyzhang814/markdown-preview-core';
import type { Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { ArticleMetaBar } from './article-meta-bar';
import { api, type Highlight, type Note, type NoteAnchor, type NoteDoc } from '@/lib/api';
import { buildTextIndex, caretRangeAt, markerOffsets, offsetToPoint, rangeToOffsets, SLOT_ATTR, UI_ATTR, type TextIndex } from '@/lib/text-index';
import { captureAnchor, locateAnchor, type Located } from '@/lib/anchor';
import { groupSlots, placeSlot } from '@/lib/inline-slots';
import { remarkScMarkers } from '@/lib/sc-marker';

// Module-level so the reference stays stable across renders.
const REMARK_PLUGINS = [remarkScMarkers];

// Id under which the in-progress comment's anchor is grouped into a slot (it never gets a mark).
export const DRAFT_ID = '__draft__';

interface ReaderProps {
  taskId?: string;
  content: string;
  frontmatter?: Record<string, unknown>;
  highlights?: Highlight[];
  doc?: NoteDoc;
  notes?: (Pick<Note, 'id'> & NoteAnchor)[];
  onNotesLocated?: (located: Record<string, Located>) => void;
  draft?: NoteAnchor | null;
  renderInline?: (ids: string[]) => ReactNode;   // given: inline view, cards render in slots under their blocks
  hoveredNoteId?: string | null;
  onNoteHover?: (id: string | null) => void;
  onNoteAnchorClick?: (id: string) => void;
  onCommentDraft?: (a: NoteAnchor) => void;
  onAddHighlight?: (anchor: string, color: 'yellow' | 'green' | 'red' | 'blue') => void;
  onDeleteHighlight?: (id: string) => void;
  voice?: {   // given (article page): voice comment entries — `v`, bubble mic, context menu
    state: 'ready' | 'recording' | 'unavailable';
    onStart: (a: NoteAnchor) => void;
    onStop: () => void;
    onUnavailable: () => void;
  };
}

type VoiceState = NonNullable<ReaderProps['voice']>['state'];

// Why the voice entries are disabled, by state.
const VOICE_REASON: Record<Exclude<VoiceState, 'ready'>, string> = {
  recording: '正在录音',
  unavailable: 'CocoScribe 未运行',
};

// Article images are often referenced via paths relative to the source .md
// file (e.g. ../Image/img_1.jpg), which the browser can't resolve on its
// own. Route them through the content-asset endpoint, which resolves the
// path relative to the article file's own directory.
function resolveArticleImageSrc(taskId: string, src: string): string {
  if (/^(https?:)?\/\//.test(src) || src.startsWith('data:')) return src;
  const token = api.token();
  const params = new URLSearchParams({ path: src, ...(token ? { token } : {}) });
  return `/api/tasks/${taskId}/content/asset?${params.toString()}`;
}

const COLORS: { key: 'yellow' | 'green' | 'red' | 'blue'; bg?: string; underline?: string }[] = [
  { key: 'yellow', bg: 'rgba(255, 214, 0, 0.8)' },
  { key: 'green',  bg: 'rgba(74, 222, 128, 0.8)' },
  { key: 'red',    bg: 'rgba(248, 113, 113, 0.8)' },
  { key: 'blue',   underline: 'rgba(59, 130, 246, 0.9)' },
];

interface AnchorMarkItem {
  id: string;
  start: number;
  end: number;
}

// Small speech-bubble icon for point notes; no text, so it stays out of the text index.
const POINT_ICON_SVG =
  '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">'
  + '<path d="M2.5 3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H7l-3 2.5V11h-.5a1 1 0 0 1-1-1z" '
  + 'stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';

function injectAnchorMarks<T extends AnchorMarkItem>(
  root: HTMLElement,
  items: T[],
  markClass: string,
  decorate: (mark: HTMLElement, item: T) => void,
) {
  // Unwrap all previously injected marks of this class
  root.querySelectorAll(`mark.${markClass}`).forEach((mark) => {
    mark.replaceWith(...Array.from(mark.childNodes));
  });

  for (const item of items) {
    // Wrapping splits text nodes but keeps the text, so offsets stay valid;
    // re-index to map them onto the current nodes. A range may span several
    // text nodes (e.g. into a <strong>, or across blocks) — wrap each slice.
    const index = buildTextIndex(root);
    for (const { node: tn, start: nodeStart } of index.segments) {
      const nodeEnd = nodeStart + tn.data.length;
      if (nodeEnd <= item.start || nodeStart >= item.end) continue;

      let target = tn;
      const sliceStart = Math.max(0, item.start - nodeStart);
      const sliceEnd = Math.min(nodeEnd, item.end) - nodeStart;
      if (sliceStart > 0) target = target.splitText(sliceStart);
      if (sliceEnd - sliceStart < (target.textContent?.length ?? 0)) target.splitText(sliceEnd - sliceStart);

      const mark = document.createElement('mark');
      mark.className = markClass;
      decorate(mark, item);
      target.parentNode?.insertBefore(mark, target);
      mark.appendChild(target);
    }
  }
}

// Offsets of the current non-empty selection, or null if there is none or it leaves the indexed root.
function selectionOffsets(index: TextIndex): { start: number; end: number } | null {
  const sel = window.getSelection();
  return sel && !sel.isCollapsed && sel.rangeCount ? rangeToOffsets(index, sel.getRangeAt(0)) : null;
}

// Keys pressed in a field are typing, not shortcuts.
function isTypingTarget(t: HTMLElement): boolean {
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
}

// Anchor for the `c` / `v` keys: the current selection, or the caret if collapsed; null if it leaves the body.
function anchorAtSelection(body: HTMLElement | null, doc?: NoteDoc): NoteAnchor | null {
  const sel = window.getSelection();
  if (!body || !sel?.rangeCount) return null;
  const index = buildTextIndex(body);
  const offsets = rangeToOffsets(index, sel.getRangeAt(0));
  return offsets && captureAnchor(index, offsets.start, offsets.end, doc);
}

// Mic button in the selection bubble. A disabled button doesn't get hover events in every
// browser, so it ignores the pointer and its wrapper carries the hover that shows the reason.
function VoiceBubbleButton({ state, onClick }: { state: VoiceState; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  const disabled = state !== 'ready';
  return (
    <span style={{ display: 'flex' }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        className="bubble-btn bubble-voice"
        onClick={onClick}
        disabled={disabled}
        title="语音评论（v）"
        style={{
          width: 22, height: 22,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: 'none', padding: 0,
          cursor: disabled ? 'default' : 'pointer',
          pointerEvents: disabled ? 'none' : undefined,
          borderRadius: 3, color: 'var(--text-secondary)',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.4"/>
          <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
      {disabled && <span className="voice-tip" hidden={!hover}>{VOICE_REASON[state]}</span>}
    </span>
  );
}

export function Reader({ taskId, content, frontmatter, highlights, doc, notes, onNotesLocated, draft, renderInline, onCommentDraft, onAddHighlight, onDeleteHighlight, hoveredNoteId, onNoteHover, onNoteAnchorClick, voice }: ReaderProps) {
  const md = useMemo(() => content ?? '', [content]);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Latest callback, kept out of the injection effect's deps: callers may pass
  // a fresh function each render, which would otherwise re-inject (and loop).
  const onNotesLocatedRef = useRef(onNotesLocated);
  useLayoutEffect(() => { onNotesLocatedRef.current = onNotesLocated; });
  // Same for voice: callers rebuild it (and its callbacks) every render; the `v` listener reads the latest.
  const voiceRef = useRef(voice);
  useLayoutEffect(() => { voiceRef.current = voice; });
  const hasVoice = !!voice;
  const isArticleTask = taskId?.startsWith('article-') ?? false;

  const mdComponents: Components = useMemo(() => ({
    ...(isArticleTask ? {
      img({ src, ...props }) {
        const resolved = typeof src === 'string' ? resolveArticleImageSrc(taskId!, src) : src;
        // eslint-disable-next-line jsx-a11y/alt-text
        return <img src={resolved} {...props} />;
      },
    } : {}),
  }), [isArticleTask, taskId]);

  // ── Selection bubble ────────────────────────────────────────
  const [bubble, setBubble] = useState<{ x: number; y: number; anchor: string; start: number; end: number } | null>(null);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if ((e.target as Element).closest(`[${SLOT_ATTR}]`)) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const text = sel.toString().trim();
    if (!text) return;
    const range = sel.getRangeAt(0);
    const body = bodyRef.current;
    const offsets = body && rangeToOffsets(buildTextIndex(body), range);
    if (!offsets) return;
    const rect = range.getBoundingClientRect();
    const anchor = text.slice(0, 200);
    setBubble({ x: rect.left + rect.width / 2, y: rect.top, anchor, ...offsets });
  }, []);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (bubble && !(e.target as Element).closest('.anchor-bubble')) {
        setBubble(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setBubble(null); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [bubble]);

  const handleColorClick = (color: 'yellow' | 'green' | 'red' | 'blue') => {
    if (!bubble) return;
    onAddHighlight?.(bubble.anchor, color);
    window.getSelection()?.removeAllRanges();
    setBubble(null);
  };

  const handleNoteClick = () => {
    if (!bubble || !bodyRef.current) return;
    onCommentDraft?.(captureAnchor(buildTextIndex(bodyRef.current), bubble.start, bubble.end, doc));
    window.getSelection()?.removeAllRanges();
    setBubble(null);
  };

  const handleVoiceClick = () => {
    if (!bubble || !bodyRef.current) return;
    voice?.onStart(captureAnchor(buildTextIndex(bodyRef.current), bubble.start, bubble.end, doc));
    window.getSelection()?.removeAllRanges();
    setBubble(null);
  };

  // ── Context menu: comment here / delete highlight ────────────
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; hlId: string; draft?: NoteAnchor } | null>(null);

  // Selection as it was at the right-button mousedown, before macOS selects the word under the cursor.
  const preClickSelRef = useRef<{ sel: { start: number; end: number } | null } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as Element).closest(`[${SLOT_ATTR}]`)) return;
    const body = bodyRef.current;
    preClickSelRef.current = e.button === 2 && body ? { sel: selectionOffsets(buildTextIndex(body)) } : null;
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if ((e.target as Element).closest(`[${SLOT_ATTR}]`)) return;  // native menu inside cards
    const snapshot = preClickSelRef.current;
    preClickSelRef.current = null;
    if (e.shiftKey) return;  // Shift+right-click keeps the native menu
    const target = e.target as Element;
    const mark = target.closest('mark.vdl-hl') as HTMLElement | null;
    const body = bodyRef.current;
    let draft: NoteAnchor | undefined;
    if ((onCommentDraft || hasVoice) && body?.contains(target)) {
      // Right-click inside a non-empty selection comments on it; anywhere else, on the caret point.
      const index = buildTextIndex(body);
      const caretRange = caretRangeAt(e.clientX, e.clientY);
      const caret = caretRange && rangeToOffsets(index, caretRange);
      const sel = snapshot ? snapshot.sel : selectionOffsets(index);
      const offsets = sel && caret && sel.start < sel.end && caret.start >= sel.start && caret.start <= sel.end ? sel : caret;
      if (offsets) draft = captureAnchor(index, offsets.start, offsets.end, doc);
    }
    if (!mark && !draft) return;
    e.preventDefault();
    const hlId = mark?.dataset.hlId ?? '';
    if (!hlId && !draft) return;
    setCtxMenu({ x: e.clientX, y: e.clientY, hlId, draft });
  }, [onCommentDraft, hasVoice, doc]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [ctxMenu]);

  const handleCommentHere = () => {
    if (!ctxMenu?.draft) return;
    onCommentDraft?.(ctxMenu.draft);
    setCtxMenu(null);
  };

  const handleVoiceHere = () => {
    if (!ctxMenu?.draft) return;
    voice?.onStart(ctxMenu.draft);
    setCtxMenu(null);
  };

  const handleDeleteHighlight = () => {
    if (!ctxMenu) return;
    onDeleteHighlight?.(ctxMenu.hlId);
    setCtxMenu(null);
  };

  // ── `c` key: comment on the current selection or caret ───────
  useEffect(() => {
    if (!onCommentDraft) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'c' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (isTypingTarget(t)) return;
      if (t.closest(`[${SLOT_ATTR}]`)) return;
      const anchor = anchorAtSelection(bodyRef.current, doc);
      if (!anchor) return;
      e.preventDefault();
      onCommentDraft(anchor);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCommentDraft, doc]);

  // ── `v` key: start voice on the selection or caret (as `c`); stop while recording ──
  useEffect(() => {
    if (!hasVoice) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const v = voiceRef.current;
      if (!v || e.key !== 'v' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (isTypingTarget(t)) return;
      if (v.state === 'recording') { e.preventDefault(); v.onStop(); return; }
      if (v.state === 'unavailable') { e.preventDefault(); v.onUnavailable(); return; }
      if (t.closest(`[${SLOT_ATTR}]`)) return;
      const anchor = anchorAtSelection(bodyRef.current, doc);
      if (!anchor) return;
      e.preventDefault();
      v.onStart(anchor);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [hasVoice, doc]);

  // ── Post-render highlight injection ─────────────────────────
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const sorted = highlights?.length ? [...highlights].sort((a, b) => a.createdAt - b.createdAt) : [];
    // First occurrence of the quoted text, as before.
    const { text } = buildTextIndex(body);
    const ranged = sorted.flatMap((hl) => {
      const start = text.indexOf(hl.anchor);
      return start === -1 ? [] : [{ ...hl, start, end: start + hl.anchor.length }];
    });
    injectAnchorMarks(body, ranged, 'vdl-hl', (mark, hl) => {
      mark.dataset.hlId = hl.id;
      mark.dataset.color = hl.color;
    });
  }, [highlights, md]);

  // ── Post-render note-anchor injection ────────────────────────
  // renderInline stays out of the effect deps (callers pass a fresh function each render); only its presence matters here.
  const hasInline = !!renderInline;
  const slotElsRef = useRef(new Map<HTMLElement, HTMLElement>());  // host block -> its slot
  const slotSeqRef = useRef(0);
  const [slots, setSlots] = useState<{ el: HTMLElement; key: string; ids: string[] }[]>([]);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const index = buildTextIndex(body);
    const markers = markerOffsets(index);
    const located: Record<string, Located> = {};
    for (const note of notes ?? []) {
      if (doc && note.doc && note.doc !== doc) continue;
      const loc = locateAnchor(index, note, markers);
      if (loc) located[note.id] = loc;
    }
    const items = Object.entries(located).map(([id, loc]) => ({ id, start: loc.start, end: loc.end }));

    const decorate = (el: HTMLElement, note: { id: string }) => {
      el.dataset.noteId = note.id;
      el.addEventListener('mouseenter', () => onNoteHover?.(note.id));
      el.addEventListener('mouseleave', () => onNoteHover?.(null));
      el.addEventListener('click', () => onNoteAnchorClick?.(note.id));
    };
    // Point notes: an icon at the offset. offsetToPoint resolves a block-edge
    // offset to a node inside that block, so the icon stays in its block.
    // Icons go in before marks are (re)wrapped, so they never end up inside a mark.
    body.querySelectorAll('span.vdl-note-point').forEach((el) => el.remove());
    for (const item of items.filter((it) => it.start === it.end)) {
      const pt = offsetToPoint(buildTextIndex(body), item.start);
      if (!pt) continue;
      const icon = document.createElement('span');
      icon.className = 'vdl-note-point';
      icon.setAttribute(UI_ATTR, '');
      icon.innerHTML = POINT_ICON_SVG;
      decorate(icon, item);
      // The icon can land inside an inline <a> (offset at the link's end); don't follow it.
      icon.addEventListener('click', (e) => e.preventDefault());
      const { node, offset } = pt;
      const before = offset === 0 ? node : offset < node.data.length ? node.splitText(offset) : node.nextSibling;
      node.parentNode?.insertBefore(icon, before);
    }
    injectAnchorMarks(body, items.filter((it) => it.start < it.end), 'vdl-note-anchor', decorate);

    // Inline view: one slot per host block, after marks and icons are in place. Slots are reused per
    // host (the map) so a card being edited in a portal isn't remounted when other notes change.
    const draftLoc = hasInline && draft && !(doc && draft.doc && draft.doc !== doc) ? locateAnchor(index, draft) : null;
    const groups = hasInline
      ? groupSlots(index, draftLoc ? [...items, { id: DRAFT_ID, start: draftLoc.start, end: draftLoc.end }] : items)
      : [];
    const next = groups.map(({ host, ids }) => {
      let el = slotElsRef.current.get(host);
      if (!el) {
        el = document.createElement('div');
        el.setAttribute(UI_ATTR, '');
        el.setAttribute(SLOT_ATTR, String(++slotSeqRef.current));
        slotElsRef.current.set(host, el);
      }
      placeSlot(el, host, body);
      return { el, key: el.getAttribute(SLOT_ATTR)!, ids };
    });
    const used = new Set(next.map((s) => s.el));
    body.querySelectorAll(`[${SLOT_ATTR}]`).forEach((el) => { if (!used.has(el as HTMLElement)) el.remove(); });
    for (const [host, el] of slotElsRef.current) if (!used.has(el)) slotElsRef.current.delete(host);
    setSlots((prev) => (
      prev.length === next.length && prev.every((s, i) => s.el === next[i].el && s.ids.join('\n') === next[i].ids.join('\n'))
        ? prev : next
    ));

    onNotesLocatedRef.current?.(located);
  }, [notes, doc, md, draft, hasInline, onNoteHover, onNoteAnchorClick]);

  // ── Reverse hover sync: sidebar card → article mark ──────────
  // NOTE: This effect depends on running AFTER the note-injection effect (deps [notes, doc, md, ...])
  // to re-apply is-linked to the fresh marks. Relies on onNoteHover/onNoteAnchorClick being stable.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.querySelectorAll('mark.vdl-note-anchor, span.vdl-note-point').forEach((el) => {
      const markEl = el as HTMLElement;
      markEl.classList.toggle('is-linked', !!hoveredNoteId && markEl.dataset.noteId === hoveredNoteId);
    });
  }, [hoveredNoteId, notes, doc, md, draft, hasInline]);

  return (
    <>
      <article className="prose-cn" onMouseDown={handleMouseDown} onMouseUp={handleMouseUp} onContextMenu={handleContextMenu}>
        <ArticleMetaBar frontmatter={frontmatter} />
        <div data-sc-body ref={bodyRef}>
          <MarkdownPreview
            key={md}
            content={md}
            remarkPlugins={REMARK_PLUGINS}
            rehypePlugins={[rehypeHighlight]}
            components={mdComponents}
          />
        </div>
      </article>

      {renderInline && slots.map(({ el, key, ids }) => createPortal(renderInline(ids), el, key))}

      {/* Selection toolbar */}
      {bubble && (
        <div
          className="anchor-bubble"
          style={{
            position: 'fixed',
            left: bubble.x,
            top: bubble.y - 40,
            transform: 'translateX(-50%)',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 6px',
            borderRadius: 6,
            background: 'var(--bg-surface)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          {COLORS.map(({ key, bg, underline }) => (
            <button
              key={key}
              onClick={() => handleColorClick(key)}
              title={key}
              style={{
                width: 22, height: 22,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                borderRadius: 3,
              }}
            >
              {underline ? (
                <span style={{
                  width: 12, height: 12, display: 'inline-block', borderRadius: 2,
                  background: 'transparent',
                  borderBottom: `2px solid ${underline}`,
                }} />
              ) : (
                <span style={{ width: 12, height: 12, display: 'inline-block', borderRadius: 2, background: bg }} />
              )}
            </button>
          ))}

          {(onCommentDraft || voice) && (
            <div style={{ width: 1, height: 14, background: 'var(--border-subtle)', margin: '0 2px' }} />
          )}
          {onCommentDraft && (
            <>
              <button
                onClick={handleNoteClick}
                title="评论"
                style={{
                  width: 22, height: 22,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  borderRadius: 3, color: 'var(--text-secondary)',
                }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M11.5 1.5a1.5 1.5 0 0 1 2.121 2.121l-8.5 8.5L2 13l.879-3.121 8.621-8.379z"
                        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </>
          )}
          {voice && <VoiceBubbleButton state={voice.state} onClick={handleVoiceClick} />}
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <div
          style={{
            position: 'fixed',
            left: ctxMenu.x,
            top: ctxMenu.y,
            zIndex: 100,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            overflow: 'hidden',
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {ctxMenu.draft && onCommentDraft && (
            <button
              onClick={handleCommentHere}
              style={{
                display: 'block', width: '100%',
                padding: '7px 14px',
                fontSize: 13, textAlign: 'left',
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-primary)',
              }}
            >
              在此处评论
            </button>
          )}
          {ctxMenu.draft && voice && (
            <button
              className="ctx-row"
              onClick={handleVoiceHere}
              disabled={voice.state !== 'ready'}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                width: '100%',
                padding: '7px 14px',
                fontSize: 13, textAlign: 'left',
                background: 'none', border: 'none',
                cursor: voice.state === 'ready' ? 'pointer' : 'default',
                color: voice.state === 'ready' ? 'var(--text-primary)' : 'var(--text-tertiary)',
              }}
            >
              <span>语音评论</span>
              {voice.state === 'ready'
                ? <span className="ctx-key" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>v</span>
                : <span className="ctx-hint" style={{ fontSize: 11 }}>{VOICE_REASON[voice.state]}</span>}
            </button>
          )}
          {ctxMenu.hlId && (
            <button
              onClick={handleDeleteHighlight}
              style={{
                display: 'block', width: '100%',
                padding: '7px 14px',
                fontSize: 13, textAlign: 'left',
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--status-err)',
              }}
            >
              删除高亮
            </button>
          )}
        </div>
      )}
    </>
  );
}
