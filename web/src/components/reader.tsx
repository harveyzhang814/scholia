import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { MermaidChart } from './mermaid-chart';
import { ArticleMetaBar } from './article-meta-bar';
import { api, type Highlight, type Note } from '@/lib/api';

interface ReaderProps {
  taskId?: string;
  content: string;
  frontmatter?: Record<string, unknown>;
  highlights?: Highlight[];
  notes?: Pick<Note, 'id' | 'anchor'>[];
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
  anchor: string;
}

function injectAnchorMarks<T extends AnchorMarkItem>(
  article: HTMLElement,
  items: T[],
  markClass: string,
  decorate: (mark: HTMLElement, item: T) => void,
) {
  // Unwrap all previously injected marks of this class
  article.querySelectorAll(`mark.${markClass}`).forEach((mark) => {
    mark.replaceWith(...Array.from(mark.childNodes));
  });

  for (const item of items) {
    // Search across the full concatenated text so an anchor that spans
    // multiple text nodes (e.g. selection crossing into/out of a <strong>
    // or <a>) can still be found — a single node's textContent won't
    // contain it even though the anchor exists in the rendered text.
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let fullText = '';
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      textNodes.push(node);
      fullText += node.textContent ?? '';
    }
    const idx = fullText.indexOf(item.anchor);
    if (idx === -1) continue;
    const end = idx + item.anchor.length;

    let pos = 0;
    for (const tn of textNodes) {
      const nodeStart = pos;
      const nodeEnd = pos + (tn.textContent?.length ?? 0);
      pos = nodeEnd;
      if (nodeEnd <= idx || nodeStart >= end) continue;

      let target = tn;
      const sliceStart = Math.max(0, idx - nodeStart);
      const sliceEnd = Math.min(nodeEnd, end) - nodeStart;
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

export function Reader({ taskId, content, frontmatter, highlights, notes, onAnchorSelect, onAddHighlight, onDeleteHighlight }: ReaderProps) {
  const md = useMemo(() => content ?? '', [content]);
  const articleRef = useRef<HTMLElement>(null);
  const isArticleTask = taskId?.startsWith('article-') ?? false;

  const mdComponents: Components = useMemo(() => ({
    code({ className, children, ...props }) {
      const lang = /language-(\w+)/.exec(className ?? '')?.[1];
      if (lang === 'mermaid') {
        return <MermaidChart code={String(children).trim()} />;
      }
      return <code className={className} {...props}>{children}</code>;
    },
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
    const article = articleRef.current;
    if (!article) return;
    const sorted = highlights?.length ? [...highlights].sort((a, b) => a.createdAt - b.createdAt) : [];
    injectAnchorMarks(article, sorted, 'vdl-hl', (mark, hl) => {
      mark.dataset.hlId = hl.id;
      mark.dataset.color = hl.color;
    });
  }, [highlights, md]);

  // ── Post-render note-anchor injection ────────────────────────
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const anchored = notes?.length ? notes.filter((n) => n.anchor) : [];
    injectAnchorMarks(article, anchored, 'vdl-note-anchor', (mark, note) => {
      mark.dataset.noteId = note.id;
    });
  }, [notes, md]);

  return (
    <>
      <article ref={articleRef} className="prose-cn" onMouseUp={handleMouseUp} onContextMenu={handleContextMenu}>
        <ArticleMetaBar frontmatter={frontmatter} />
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={mdComponents}
        >
          {md}
        </ReactMarkdown>
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
