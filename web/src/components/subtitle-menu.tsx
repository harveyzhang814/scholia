import { useState, useEffect, useRef } from 'react';
import { usePlayerStore, langLabel } from '@/stores/player-store';
import { useUiStore, SUBTITLE_SCALE_MIN, SUBTITLE_SCALE_MAX } from '@/stores/ui-store';

interface SubtitleMenuProps {
  ccEnabled: boolean;
  onToggleCc?: () => void;
  className?: string;
}

export function SubtitleMenu({ ccEnabled, onToggleCc, className }: SubtitleMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const tracks = usePlayerStore((s) => s.tracks);
  const activeLang = usePlayerStore((s) => s.activeLang);
  const setActiveLang = usePlayerStore((s) => s.setActiveLang);
  const subtitleScale = useUiStore((s) => s.subtitleScale);
  const setSubtitleScale = useUiStore((s) => s.setSubtitleScale);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const atMin = subtitleScale <= SUBTITLE_SCALE_MIN;
  const atMax = subtitleScale >= SUBTITLE_SCALE_MAX;

  return (
    <div ref={ref} className={`flex-shrink-0${className ? ` ${className}` : ''}`} style={{ position: 'relative' }}>
      <button
        className={`cc-btn${ccEnabled ? ' on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="字幕设置"
      >
        字幕
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            bottom: '100%',
            marginBottom: 4,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            boxShadow: '0 2px 8px var(--border-strong)',
            minWidth: 172,
            zIndex: 50,
            padding: '6px 0',
          }}
        >
          <button
            onClick={() => onToggleCc?.()}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '7px 12px',
              fontSize: 12,
              color: 'var(--text-primary)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <span>显示字幕</span>
            <span
              style={{
                position: 'relative',
                display: 'inline-block',
                width: 32,
                height: 18,
                borderRadius: 999,
                background: ccEnabled ? 'var(--accent-9)' : 'var(--border-subtle)',
                transition: 'background 150ms ease',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  left: ccEnabled ? 16 : 2,
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#fff',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
                  transition: 'left 150ms ease',
                }}
              />
            </span>
          </button>

          {tracks.length > 1 && (
            <>
              <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '4px 12px' }}>
                {tracks.map((t) => (
                  <button
                    key={t.lang}
                    onClick={() => setActiveLang(t.lang)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: 26,
                      padding: '0 10px',
                      borderRadius: 4,
                      border: 'none',
                      background: activeLang === t.lang ? 'var(--accent-3)' : 'transparent',
                      color: activeLang === t.lang ? 'var(--accent-9)' : 'var(--text-tertiary)',
                      fontSize: 12,
                      fontWeight: activeLang === t.lang ? 500 : 400,
                      cursor: 'pointer',
                    }}
                  >
                    {langLabel(t.lang)}
                  </button>
                ))}
              </div>
            </>
          )}

          <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 12px' }}>
            <button
              onClick={() => setSubtitleScale((prev) => prev - 0.1)}
              disabled={atMin}
              style={{
                fontSize: 12,
                color: atMin ? 'var(--text-tertiary)' : 'var(--text-primary)',
                background: 'none',
                border: '1px solid var(--border-subtle)',
                borderRadius: 4,
                width: 22,
                height: 22,
                cursor: atMin ? 'default' : 'pointer',
              }}
            >
              A−
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {Math.round(subtitleScale * 100)}%
            </span>
            <button
              onClick={() => setSubtitleScale((prev) => prev + 0.1)}
              disabled={atMax}
              style={{
                fontSize: 12,
                color: atMax ? 'var(--text-tertiary)' : 'var(--text-primary)',
                background: 'none',
                border: '1px solid var(--border-subtle)',
                borderRadius: 4,
                width: 22,
                height: 22,
                cursor: atMax ? 'default' : 'pointer',
              }}
            >
              A+
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
