import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { MermaidChart } from './mermaid-chart';
import type { Highlight } from '@/lib/api';

interface ReaderProps {
  content: string;
  highlights?: Highlight[];
  onAnchorSelect?: (anchor: string) => void;
  onAddHighlight?: (anchor: string, color: 'yellow' | 'green' | 'red' | 'blue') => void;
  onDeleteHighlight?: (id: string) => void;
}

const COLORS: { key: 'yellow' | 'green' | 'red' | 'blue'; bg?: string; underline?: string }[] = [
  { key: 'yellow', bg: 'rgba(255, 214, 0, 0.8)' },
  { key: 'green',  bg: 'rgba(74, 222, 128, 0.8)' },
  { key: 'red',    bg: 'rgba(248, 113, 113, 0.8)' },
  { key: 'blue',   underline: 'rgba(59, 130, 246, 0.9)' },
];

const mdComponents: Components = {
  code({ className, children, ...props }) {
    const lang = /language-(\w+)/.exec(className ?? '')?.[1];
    if (lang === 'mermaid') {
      return <MermaidChart code={String(children).trim()} />;
    }
    return <code className={className} {...props}>{children}</code>;
  },
};

export function Reader({ content, highlights, onAnchorSelect, onAddHighlight, onDeleteHighlight }: ReaderProps) {
  const md = useMemo(() => content ?? '', [content]);
  const articleRef = useRef<HTMLElement>(null);

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

    // Unwrap all previously injected marks
    article.querySelectorAll('mark.vdl-hl').forEach((mark) => {
      mark.replaceWith(...Array.from(mark.childNodes));
    });

    if (!highlights?.length) return;

    const sorted = [...highlights].sort((a, b) => a.createdAt - b.createdAt);

    for (const hl of sorted) {
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        const idx = node.textContent?.indexOf(hl.anchor) ?? -1;
        if (idx === -1) continue;
        const mid = node.splitText(idx);
        mid.splitText(hl.anchor.length);
        const mark = document.createElement('mark');
        mark.className = 'vdl-hl';
        mark.dataset.hlId = hl.id;
        mark.dataset.color = hl.color;
        mid.parentNode?.insertBefore(mark, mid);
        mark.appendChild(mid);
        break;
      }
    }
  }, [highlights, md]);

  return (
    <>
      <article ref={articleRef} className="prose-cn" onMouseUp={handleMouseUp} onContextMenu={handleContextMenu}>
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
