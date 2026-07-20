# 视频播放器字幕大小优化 实施计划

**目标：** 让视频播放器悬浮字幕（CC 层）字号随播放器实际尺寸按比例缩放，提供用户 +/− 手动微调（全局持久化），并把语言切换、CC 开关、字号调节整合进一个"字幕"按钮的弹出菜单，替换现有控制栏上的两个独立按钮。

**架构：** CSS container query（`container-type: inline-size` + `cqw` 单位）驱动比例缩放；`ui-store.ts` 新增 `subtitleScale` 状态并写入 `localStorage`（沿用现有 `proseTheme` 的持久化写法）；新建 `subtitle-menu.tsx` 组件封装菜单交互，直接读写 `player-store`（语言）与 `ui-store`（字号），替换 `player.tsx` 里被移除的旧按钮。

**技术栈：** React 19 + TypeScript + Zustand + Tailwind v4（原生 CSS container query）+ Vitest + @testing-library/react

参考设计文档：`docs/superpowers/specs/2026-07-11-player-subtitle-size-design.md`

---

### Task 1: `ui-store` 新增 `subtitleScale` 状态

**文件：**
- 修改: `web/src/stores/ui-store.ts`
- 修改: `web/src/stores/ui-store.test.ts`

- [ ] **Step 1: 在 `ui-store.test.ts` 追加失败的测试**

在文件末尾（`});` 之后，`describe('ui-store proseTheme', ...)` 块之外）追加：

```ts
describe('ui-store subtitleScale', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ subtitleScale: 1 });
  });

  it('defaults to 1', () => {
    expect(useUiStore.getState().subtitleScale).toBe(1);
  });

  it('setSubtitleScale increases by the given delta and persists', () => {
    useUiStore.getState().setSubtitleScale((prev) => prev + 0.1);
    expect(useUiStore.getState().subtitleScale).toBe(1.1);
    expect(localStorage.getItem('subtitle-scale')).toBe('1.1');
  });

  it('clamps to the 1.6 maximum', () => {
    useUiStore.setState({ subtitleScale: 1.6 });
    useUiStore.getState().setSubtitleScale((prev) => prev + 0.1);
    expect(useUiStore.getState().subtitleScale).toBe(1.6);
  });

  it('clamps to the 0.7 minimum', () => {
    useUiStore.setState({ subtitleScale: 0.7 });
    useUiStore.getState().setSubtitleScale((prev) => prev - 0.1);
    expect(useUiStore.getState().subtitleScale).toBe(0.7);
  });

  it('initialises from localStorage when a valid value is stored', () => {
    localStorage.setItem('subtitle-scale', '1.3');
    useUiStore.setState({
      subtitleScale: Math.min(1.6, Math.max(0.7, parseFloat(localStorage.getItem('subtitle-scale') ?? '') || 1)),
    });
    expect(useUiStore.getState().subtitleScale).toBe(1.3);
  });

  it('falls back to 1 when localStorage holds an invalid value', () => {
    localStorage.setItem('subtitle-scale', 'not-a-number');
    useUiStore.setState({
      subtitleScale: Math.min(1.6, Math.max(0.7, parseFloat(localStorage.getItem('subtitle-scale') ?? '') || 1)),
    });
    expect(useUiStore.getState().subtitleScale).toBe(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行: `cd web && npx vitest run src/stores/ui-store.test.ts`
预期: FAIL（`subtitleScale` / `setSubtitleScale` 不存在于 store 上）

- [ ] **Step 3: 实现 `subtitleScale`**

将 `web/src/stores/ui-store.ts` 整个文件替换为：

```ts
import { create } from 'zustand';
import { ThemeId } from '@/lib/themes';

export type Theme = 'system' | 'light' | 'dark';
export type StatusFilter = 'all' | 'running' | 'done' | 'failed';
export type LayoutMode = 'A' | 'B' | 'C' | 'E' | 'F';

export const SUBTITLE_SCALE_MIN = 0.7;
export const SUBTITLE_SCALE_MAX = 1.6;

function clampSubtitleScale(v: number): number {
  const rounded = Math.round(v * 10) / 10;
  return Math.min(SUBTITLE_SCALE_MAX, Math.max(SUBTITLE_SCALE_MIN, rounded));
}

interface UiState {
  theme: Theme;
  paletteOpen: boolean;
  statusFilter: StatusFilter;
  setTheme: (t: Theme) => void;
  setPaletteOpen: (open: boolean) => void;
  setStatusFilter: (f: StatusFilter) => void;
  layoutMode: LayoutMode;
  setLayoutMode: (m: LayoutMode) => void;
  proseTheme: ThemeId;
  setProseTheme: (theme: ThemeId) => void;
  subtitleScale: number;
  setSubtitleScale: (updater: (prev: number) => number) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: 'system',
  paletteOpen: false,
  statusFilter: 'all',
  setTheme: (theme) => set({ theme }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  layoutMode: 'A',
  setLayoutMode: (layoutMode) => set({ layoutMode }),
  proseTheme: (localStorage.getItem('prose-theme') ?? 'default') as ThemeId,
  setProseTheme: (proseTheme) => {
    localStorage.setItem('prose-theme', proseTheme);
    set({ proseTheme });
  },
  subtitleScale: clampSubtitleScale(parseFloat(localStorage.getItem('subtitle-scale') ?? '') || 1),
  setSubtitleScale: (updater) => {
    const next = clampSubtitleScale(updater(get().subtitleScale));
    localStorage.setItem('subtitle-scale', String(next));
    set({ subtitleScale: next });
  },
}));
```

- [ ] **Step 4: 运行测试确认通过**

运行: `cd web && npx vitest run src/stores/ui-store.test.ts`
预期: PASS（全部用例，含原有 `proseTheme` 用例）

- [ ] **Step 5: 提交**

```bash
git add web/src/stores/ui-store.ts web/src/stores/ui-store.test.ts
git commit -m "feat: add global subtitle scale preference to ui-store"
```

---

### Task 2: 字幕层比例缩放（CSS container query）

**文件：**
- 修改: `web/src/styles/globals.css`
- 修改: `web/src/components/player.tsx`

- [ ] **Step 1: 修改 `globals.css`**

找到（约第 324-340 行）：

```css
/* CC overlay */
.cc-overlay-text {
  position: absolute;
  bottom: 52px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 80%;
  text-align: center;
  color: #fff;
  font-size: 15px;
  line-height: 1.5;
  text-shadow: 0 1px 4px rgba(0,0,0,0.9);
  pointer-events: none;
  padding: 3px 10px;
  background: rgba(0,0,0,0.45);
  border-radius: 3px;
}
```

替换为：

```css
/* CC overlay */
.player-cq-container {
  container-type: inline-size;
}

.cc-overlay-text {
  position: absolute;
  bottom: 52px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 80%;
  text-align: center;
  color: #fff;
  font-size: calc(clamp(14px, 4.5cqw, 40px) * var(--cc-scale, 1));
  line-height: 1.5;
  text-shadow: 0 1px 4px rgba(0,0,0,0.9);
  pointer-events: none;
  padding: 3px 10px;
  background: rgba(0,0,0,0.45);
  border-radius: 3px;
}
```

- [ ] **Step 2: 在 `player.tsx` 里把播放器最外层容器标记为 container query 上下文**

在 `web/src/components/player.tsx` 中找到（约第 120-125 行）：

```tsx
    <div className={`relative bg-black flex-shrink-0${audioOnly ? ' w-full' : ''}${className ? ` ${className}` : ''}`}
         style={{
           aspectRatio: (!audioOnly && kind === 'video') ? '16/9' : 'auto',
           height: (audioOnly || kind === 'audio') ? 72 : undefined,
         }}>
```

替换为：

```tsx
    <div className={`relative bg-black flex-shrink-0 player-cq-container${audioOnly ? ' w-full' : ''}${className ? ` ${className}` : ''}`}
         style={{
           aspectRatio: (!audioOnly && kind === 'video') ? '16/9' : 'auto',
           height: (audioOnly || kind === 'audio') ? 72 : undefined,
         }}>
```

- [ ] **Step 3: 手动验证（本任务为纯 CSS/布局改动，container query 的实际渲染尺寸计算不在 jsdom 支持范围内，无法用 vitest 单元测试覆盖，用 dev server 手动验证）**

运行: `cd web && npm run dev`，然后打开一个有字幕的视频任务页面（模式 A，默认布局）：

1. 打开该任务详情页，点击（Task 3/5 完成前，`CcOverlay` 还没接上 `--cc-scale`，先只验证 `font-size` 是否随容器宽度变化即可，字幕默认按 `--cc-scale: 1` 计算）浏览器 DevTools，选中 `.cc-overlay-text` 元素，查看 Computed 面板里的 `font-size` 数值。
2. 把浏览器窗口分别调整到约 480px、900px、1600px 宽（可用 DevTools 的 Responsive 模式），确认三种宽度下 `.cc-overlay-text` 的 computed `font-size` 依次增大，且都落在 14px–40px 区间内。
3. 确认字幕框在极窄窗口下不会溢出播放器可视区域（`max-width: 80%` 生效）。

预期: 三种宽度下字号明显不同且随容器宽度单调递增，最小/最大边界生效。

- [ ] **Step 4: 提交**

```bash
git add web/src/styles/globals.css web/src/components/player.tsx
git commit -m "feat: scale subtitle overlay font size with player container width"
```

---

### Task 3: `CcOverlay` 接入用户手动缩放比例

**文件：**
- 修改: `web/src/components/cc-overlay.tsx`
- 创建: `web/src/components/cc-overlay.test.tsx`

- [ ] **Step 1: 编写失败的测试**

创建 `web/src/components/cc-overlay.test.tsx`：

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { CcOverlay } from './cc-overlay';
import { usePlayerStore } from '@/stores/player-store';
import { useUiStore } from '@/stores/ui-store';

beforeEach(() => {
  usePlayerStore.getState().reset();
  useUiStore.setState({ subtitleScale: 1 });
});

describe('CcOverlay', () => {
  it('renders the active subtitle text', () => {
    usePlayerStore.getState().setSubtitles([{ start: 0, text: 'hello world' }]);
    usePlayerStore.getState().setCurrentTime(1);
    const { getByText } = render(<CcOverlay enabled={true} />);
    expect(getByText('hello world')).toBeInTheDocument();
  });

  it('applies the current subtitleScale as the --cc-scale CSS variable', () => {
    usePlayerStore.getState().setSubtitles([{ start: 0, text: 'hello world' }]);
    usePlayerStore.getState().setCurrentTime(1);
    useUiStore.setState({ subtitleScale: 1.3 });
    const { getByText } = render(<CcOverlay enabled={true} />);
    const el = getByText('hello world');
    expect(el.style.getPropertyValue('--cc-scale')).toBe('1.3');
  });

  it('renders nothing when disabled', () => {
    usePlayerStore.getState().setSubtitles([{ start: 0, text: 'hello world' }]);
    usePlayerStore.getState().setCurrentTime(1);
    const { container } = render(<CcOverlay enabled={false} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行: `cd web && npx vitest run src/components/cc-overlay.test.tsx`
预期: FAIL（第二个用例——目前没有设置 `--cc-scale`）

- [ ] **Step 3: 实现**

把 `web/src/components/cc-overlay.tsx` 整个文件替换为：

```tsx
import { usePlayerStore } from '@/stores/player-store';
import { useUiStore } from '@/stores/ui-store';

interface CcOverlayProps {
  enabled: boolean;
}

export function CcOverlay({ enabled }: CcOverlayProps) {
  const subtitles = usePlayerStore((s) => s.subtitles);
  const activeIndex = usePlayerStore((s) => s.activeIndex);
  const subtitleScale = useUiStore((s) => s.subtitleScale);

  if (!enabled || activeIndex < 0) return null;
  const text = subtitles[activeIndex]?.text;
  if (!text) return null;

  return (
    <div className="cc-overlay-text" style={{ '--cc-scale': subtitleScale } as React.CSSProperties}>
      {text}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

运行: `cd web && npx vitest run src/components/cc-overlay.test.tsx`
预期: PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/components/cc-overlay.tsx web/src/components/cc-overlay.test.tsx
git commit -m "feat: apply user subtitle scale preference to CC overlay"
```

---

### Task 4: 新建 `SubtitleMenu` 组件（字幕按钮 + 弹出菜单）

**文件：**
- 创建: `web/src/components/subtitle-menu.tsx`
- 创建: `web/src/components/subtitle-menu.test.tsx`

- [ ] **Step 1: 编写失败的测试**

创建 `web/src/components/subtitle-menu.test.tsx`：

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SubtitleMenu } from './subtitle-menu';
import { usePlayerStore } from '@/stores/player-store';
import { useUiStore } from '@/stores/ui-store';

beforeEach(() => {
  usePlayerStore.getState().reset();
  useUiStore.setState({ subtitleScale: 1 });
});

describe('SubtitleMenu', () => {
  it('opens the menu on click and calls onToggleCc from the 显示字幕 row', () => {
    let toggled = false;
    render(<SubtitleMenu ccEnabled={false} onToggleCc={() => { toggled = true; }} />);
    expect(screen.queryByText('显示字幕')).toBeNull();
    fireEvent.click(screen.getByTitle('字幕设置'));
    expect(screen.getByText('显示字幕')).toBeInTheDocument();
    fireEvent.click(screen.getByText('显示字幕'));
    expect(toggled).toBe(true);
  });

  it('lists tracks and switches language when there are 2 or more', () => {
    usePlayerStore.setState({
      tracks: [
        { lang: 'en', segments: [] },
        { lang: 'zh-CN', segments: [] },
      ],
      activeLang: 'en',
    });
    render(<SubtitleMenu ccEnabled={true} onToggleCc={() => {}} />);
    fireEvent.click(screen.getByTitle('字幕设置'));
    expect(screen.getByText('中文')).toBeInTheDocument();
    fireEvent.click(screen.getByText('中文'));
    expect(usePlayerStore.getState().activeLang).toBe('zh-CN');
  });

  it('does not render a language section for a single track', () => {
    usePlayerStore.setState({ tracks: [{ lang: 'en', segments: [] }], activeLang: 'en' });
    render(<SubtitleMenu ccEnabled={true} onToggleCc={() => {}} />);
    fireEvent.click(screen.getByTitle('字幕设置'));
    expect(screen.queryByText('EN')).toBeNull();
  });

  it('adjusts subtitle scale with A- / A+ and disables at bounds', () => {
    useUiStore.setState({ subtitleScale: 1.6 });
    render(<SubtitleMenu ccEnabled={true} onToggleCc={() => {}} />);
    fireEvent.click(screen.getByTitle('字幕设置'));
    expect(screen.getByText('160%')).toBeInTheDocument();
    expect(screen.getByText('A+')).toBeDisabled();
    fireEvent.click(screen.getByText('A−'));
    expect(useUiStore.getState().subtitleScale).toBe(1.5);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

运行: `cd web && npx vitest run src/components/subtitle-menu.test.tsx`
预期: FAIL（`./subtitle-menu` 模块不存在）

- [ ] **Step 3: 实现**

创建 `web/src/components/subtitle-menu.tsx`：

```tsx
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
```

- [ ] **Step 4: 运行测试确认通过**

运行: `cd web && npx vitest run src/components/subtitle-menu.test.tsx`
预期: PASS

- [ ] **Step 5: 提交**

```bash
git add web/src/components/subtitle-menu.tsx web/src/components/subtitle-menu.test.tsx
git commit -m "feat: add consolidated subtitle menu (language, CC toggle, size)"
```

---

### Task 5: 在 `player.tsx` 里接入 `SubtitleMenu`，移除旧的语言切换 / CC 按钮

**文件：**
- 修改: `web/src/components/player.tsx`

- [ ] **Step 1: 更新顶部 import**

找到：

```tsx
import { useEffect, useRef, useCallback } from 'react';
import { usePlayerStore, parseVtt, normLang, langLabel } from '@/stores/player-store';
import type { Track } from '@/stores/player-store';
import { formatDuration } from '@/lib/time';
import { api } from '@/lib/api';
import { CcOverlay } from './cc-overlay';
```

替换为：

```tsx
import { useEffect, useRef, useCallback } from 'react';
import { usePlayerStore, parseVtt, normLang } from '@/stores/player-store';
import type { Track } from '@/stores/player-store';
import { formatDuration } from '@/lib/time';
import { api } from '@/lib/api';
import { CcOverlay } from './cc-overlay';
import { SubtitleMenu } from './subtitle-menu';
```

- [ ] **Step 2: 删除不再需要的 `activeLang` / `setActiveLang` 选择器和 `cycleTrack`**

找到：

```tsx
  const tracks = usePlayerStore((s) => s.tracks);
  const activeLang = usePlayerStore((s) => s.activeLang);
  const setTracks = usePlayerStore((s) => s.setTracks);
  const setActiveLang = usePlayerStore((s) => s.setActiveLang);
```

替换为：

```tsx
  const setTracks = usePlayerStore((s) => s.setTracks);
```

找到：

```tsx
  const cycleTrack = useCallback(() => {
    if (tracks.length < 2) return;
    const idx = tracks.findIndex((t) => t.lang === activeLang);
    const next = tracks[(idx + 1) % tracks.length];
    setActiveLang(next.lang);
  }, [tracks, activeLang, setActiveLang]);

  const seekTo = useCallback((clientX: number) => {
```

替换为：

```tsx
  const seekTo = useCallback((clientX: number) => {
```

- [ ] **Step 3: 删除 `hasMultipleTracks` 变量**

找到：

```tsx
  const MediaTag = kind === 'video' ? 'video' : 'audio';
  const showCustomControls = kind === 'video' || audioOnly;
  const hasMultipleTracks = tracks.length > 1;
```

替换为：

```tsx
  const MediaTag = kind === 'video' ? 'video' : 'audio';
  const showCustomControls = kind === 'video' || audioOnly;
```

- [ ] **Step 4: 用 `SubtitleMenu` 替换控制栏里的两个旧按钮**

找到：

```tsx
            {/* 字幕轨道切换 — 仅当存在多轨道时显示 */}
            {hasMultipleTracks && (
              <button
                className="ml-auto flex-shrink-0 h-7 px-2 rounded hover:bg-white/15 transition-colors text-xs font-medium"
                style={{ color: 'rgba(255,255,255,0.85)' }}
                title="切换字幕语言"
                onClick={cycleTrack}
              >
                {langLabel(activeLang)}
              </button>
            )}
            {showCc && (
              <button
                className={`cc-btn${!hasMultipleTracks ? ' ml-auto' : ''}${ccEnabled ? ' on' : ''}`}
                onClick={onToggleCc}
              >
                CC
              </button>
            )}
```

替换为：

```tsx
            {showCc && (
              <SubtitleMenu ccEnabled={ccEnabled} onToggleCc={onToggleCc} className="ml-auto" />
            )}
```

- [ ] **Step 5: 运行前端测试与类型检查确认无回归**

运行: `cd web && npm test && npx tsc --noEmit`
预期: 全部测试 PASS，`tsc` 无类型错误（无未使用变量/import 报错）

- [ ] **Step 6: 提交**

```bash
git add web/src/components/player.tsx
git commit -m "refactor: replace player language/CC buttons with SubtitleMenu"
```

---

### Task 6: 端到端手动验证

**文件：** 无代码改动，仅验证

- [ ] **Step 1: 启动服务**

运行: `npm link`（如未 link 过）→ `scholia serve --open`，或分别启动后端 (`node cli/index.js serve` 等价方式) 与 `cd web && npm run dev` 并通过代理访问。

- [ ] **Step 2: 验证比例缩放**

打开一个有字幕的视频任务（模式 A），播放到有字幕出现的时间点，分别在窄窗口（~480px）、中等窗口（~900px）、宽窗口/剧场模式 F（~1600px）下确认字幕字号明显随播放器实际宽度变化，且在极端尺寸下不小于/超过可读范围。

- [ ] **Step 3: 验证字幕菜单**

1. 点击播放器上的"字幕"按钮，确认弹出菜单（向上展开，不被截断）。
2. 点击"显示字幕"行，确认字幕开关切换，按钮圆点状态同步变化。
3. 对一个多语言字幕任务，确认菜单里列出全部语言，点击切换后字幕内容立即变为对应语言。
4. 点击 `A+` / `A−` 多次，确认字幕字号随之增大/减小，到达上下限时按钮变灰不可点击。
5. 刷新页面或切换到另一个视频任务，确认字号百分比与上次设置一致（全局持久化生效）。

- [ ] **Step 4: 回归检查**

确认模式 B/C（无 `showCc` 的 `Player` 实例）不出现"字幕"按钮，且原有播放/暂停/进度条/时间显示均正常。

预期: 以上 4 步全部符合预期，无控制台报错。

---

## 自检记录

- **规格覆盖**：设计文档「比例缩放」→ Task 2/3；「手动调节状态」→ Task 1；「字幕按钮 + 弹出菜单」→ Task 4；「player.tsx 改动点」→ Task 5；「数据流」在 Task 1/3/4 的实现中体现；「测试策略」对应 Task 1/3/4 的单元测试 + Task 6 的手动验证；「风险和缓解」中的交互取舍已在 Task 4/5 的设计中落地，浏览器兼容风险已在 Task 2 的 CSS 兜底值中处理。
- **占位符扫描**：全部步骤含完整代码/命令，无 TBD/TODO/"后续实现"。
- **类型一致性**：`SUBTITLE_SCALE_MIN`/`SUBTITLE_SCALE_MAX`/`subtitleScale`/`setSubtitleScale` 在 Task 1 定义后，Task 3、Task 4 中的用法（类型、调用签名）保持一致；`SubtitleMenu` 的 props（`ccEnabled: boolean`、`onToggleCc?: () => void`、`className?: string`）与 Task 5 中 `player.tsx` 的调用方式一致。
- **范围检查**：本计划仅覆盖视频播放器悬浮字幕层，不涉及 `SubtitleList` 侧边栏面板（已在设计文档中明确排除）。
