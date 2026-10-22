import { useMemo, useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { MarkdownPreview } from '@harveyzhang814/markdown-preview-core';
import type { Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { ArticleMetaBar } from './article-meta-bar';
import { api, type Highlight, type Note, type NoteAnchor, type NoteDoc } from '@/lib/api';
import { buildTextIndex, offsetToPoint, UI_ATTR } from '@/lib/text-index';
import { locateAnchor, type Located } from '@/lib/anchor';

interface ReaderProps {
  taskId?: string;
  content: string;
  frontmatter?: Record<string, unknown>;
  highlights?: Highlight[];
  doc?: NoteDoc;
  notes?: (Pick<Note, 'id'> & NoteAnchor)[];
  onNotesLocated?: (located: Record<string, Located>) => void;
  hoveredNoteId?: string | null;
  onNoteHover?: (id: string | null) => void;
  onNoteAnchorClick?: (id: string) => void;
  onAnchorSelect?: (anchor: string) => void;
  onAddHighlight?: (anchor: string, color: 'yellow' | 'green' | 'red' | 'blue') => void;
  onDeleteHighlight?: (id: string) => void;
}

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

export function Reader({ taskId, content, frontmatter, highlights, doc, notes, onNotesLocated, onAnchorSelect, onAddHighlight, onDeleteHighlight, hoveredNoteId, onNoteHover, onNoteAnchorClick }: ReaderProps) {
  const md = useMemo(() => content ?? '', [content]);
  const articleRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Latest callback, kept out of the injection effect's deps: callers may pass
  // a fresh function each render, which would otherwise re-inject (and loop).
  const onNotesLocatedRef = useRef(onNotesLocated);
  useLayoutEffect(() => { onNotesLocatedRef.current = onNotesLocated; });
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
  const [bubble, setBubble] = useState<{ x: number; y: number; anchor: string } | null>(null);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const text = sel.toString().trim();
    if (!text) return;
    const range = sel.getRangeAt(0);
    if (!articleRef.current?.contains(range.commonAncestorContainer)) return;
    const rect = range.getBoundingClientRect();
    const anchor = text.slice(0, 200);
    setBubble({ x: rect.left + rect.width / 2, y: rect.top, anchor });
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
    if (!bubble) return;
    onAnchorSelect?.(bubble.anchor);
    window.getSelection()?.removeAllRanges();
    setBubble(null);
  };

  // ── Context-menu delete overlay ──────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; hlId: string } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const mark = (e.target as Element).closest('mark.vdl-hl') as HTMLElement | null;
    if (!mark) return;
    e.preventDefault();
    const hlId = mark.dataset.hlId ?? '';
    if (!hlId) return;
    setCtxMenu({ x: e.clientX, y: e.clientY, hlId });
  }, []);

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

  const handleDeleteHighlight = () => {
    if (!ctxMenu) return;
    onDeleteHighlight?.(ctxMenu.hlId);
    setCtxMenu(null);
  };

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
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const index = buildTextIndex(body);
    const located: Record<string, Located> = {};
    for (const note of notes ?? []) {
      if (doc && note.doc && note.doc !== doc) continue;
      const loc = locateAnchor(index, note);
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
      const { node, offset } = pt;
      const before = offset === 0 ? node : offset < node.data.length ? node.splitText(offset) : node.nextSibling;
      node.parentNode?.insertBefore(icon, before);
    }
    injectAnchorMarks(body, items.filter((it) => it.start < it.end), 'vdl-note-anchor', decorate);

    onNotesLocatedRef.current?.(located);
  }, [notes, doc, md, onNoteHover, onNoteAnchorClick]);

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
  }, [hoveredNoteId, notes, doc, md]);

  return (
    <>
      <article ref={articleRef} className="prose-cn" onMouseUp={handleMouseUp} onContextMenu={handleContextMenu}>
        <ArticleMetaBar frontmatter={frontmatter} />
        <div data-sc-body ref={bodyRef}>
          <MarkdownPreview
            key={md}
            content={md}
            rehypePlugins={[rehypeHighlight]}
            components={mdComponents}
          />
        </div>
      </article>

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

          {onAnchorSelect && (
            <>
              <div style={{ width: 1, height: 14, background: 'var(--border-subtle)', margin: '0 2px' }} />
              <button
                onClick={handleNoteClick}
                title="添加笔记"
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
        </div>
      )}

      {/* Context-menu delete overlay */}
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
        </div>
      )}
    </>
  );
}
