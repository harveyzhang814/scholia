import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Reader } from './reader';
import type { Highlight } from '@/lib/api';
import { afterEach } from 'vitest';

const MERMAID_VARS = [
  '--md-mermaid-bg', '--md-mermaid-primary', '--md-mermaid-primary-text',
  '--md-mermaid-primary-border', '--md-mermaid-line', '--md-mermaid-secondary', '--md-mermaid-tertiary',
] as const;

afterEach(() => {
  for (const v of MERMAID_VARS) document.body.style.removeProperty(v);
});

describe('Reader highlight rendering', () => {
  it('renders a mark for an anchor entirely within one text node', () => {
    const content = '这首歌是 Rick Astley 的 **Never Gonna Give You Up**，经典金曲。';
    const highlights: Highlight[] = [
      { id: 'h1', anchor: 'Never Gonna Give You Up', color: 'yellow', createdAt: 1 },
    ];
    const { container } = render(<Reader content={content} highlights={highlights} />);
    expect(container.querySelectorAll('mark.vdl-hl').length).toBeGreaterThan(0);
  });

  it('renders a mark for an anchor that spans across a <strong> boundary', () => {
    const content = '这首歌是 Rick Astley 的 **Never Gonna Give You Up**，经典金曲。';
    const highlights: Highlight[] = [
      { id: 'h1', anchor: '的 Never Gonna Give You Up，经典', color: 'yellow', createdAt: 1 },
    ];
    const { container } = render(<Reader content={content} highlights={highlights} />);
    expect(container.querySelectorAll('mark.vdl-hl').length).toBeGreaterThan(0);
  });
});

describe('Reader note-anchor rendering', () => {
  it('renders a mark for a note anchor entirely within one text node', () => {
    const content = '这首歌是 Rick Astley 的 **Never Gonna Give You Up**，经典金曲。';
    const notes = [{ id: 'n1', anchor: 'Never Gonna Give You Up' }];
    const { container } = render(<Reader content={content} notes={notes} />);
    expect(container.querySelectorAll('mark.vdl-note-anchor').length).toBeGreaterThan(0);
  });

  it('renders a mark for a note anchor that spans across a <strong> boundary', () => {
    const content = '这首歌是 Rick Astley 的 **Never Gonna Give You Up**，经典金曲。';
    const notes = [{ id: 'n1', anchor: '的 Never Gonna Give You Up，经典' }];
    const { container } = render(<Reader content={content} notes={notes} />);
    expect(container.querySelectorAll('mark.vdl-note-anchor').length).toBeGreaterThan(0);
  });
});

describe('Reader unified anchors', () => {
  const content = '第一段有个观点在这里。\n\n第二段。';
  it('renders a point icon for a point note', () => {
    const notes = [{ id: 'p1', anchor: '', prefix: '有个观点', suffix: '在这里。', position: 7 }];
    const { container } = render(<Reader content={content} notes={notes} />);
    const icon = container.querySelector('span.vdl-note-point[data-note-id="p1"]');
    expect(icon).not.toBeNull();
    expect(icon!.hasAttribute('data-sc-ui')).toBe(true);
    expect(icon!.textContent).toBe('');
  });
  it('reports located results with grades', () => {
    const onNotesLocated = vi.fn();
    const notes = [
      { id: 'a', anchor: '观点' },
      { id: 'b', anchor: '找不到的文字' },
    ];
    render(<Reader content={content} notes={notes} onNotesLocated={onNotesLocated} />);
    const last = onNotesLocated.mock.calls.at(-1)![0];
    expect(last.a.grade).toBe('exact');
    expect(last.b).toBeUndefined();
  });
  it('skips notes whose doc differs from current doc', () => {
    const notes = [{ id: 'a', anchor: '观点', doc: 'summary' as const }];
    const { container } = render(<Reader content={content} doc="article" notes={notes} />);
    expect(container.querySelector('mark.vdl-note-anchor')).toBeNull();
  });
  it('legacy note without doc locates in any doc', () => {
    const { container } = render(<Reader content={content} doc="summary" notes={[{ id: 'a', anchor: '观点' }]} />);
    expect(container.querySelector('mark.vdl-note-anchor')).not.toBeNull();
  });
  it('marks a legacy cross-paragraph anchor', () => {
    const notes = [{ id: 'x', anchor: '在这里。\n\n第二段' }];
    const { container } = render(<Reader content={content} notes={notes} />);
    expect(container.querySelectorAll('mark.vdl-note-anchor[data-note-id="x"]').length).toBeGreaterThan(0);
  });
  it('does not re-inject when only the onNotesLocated identity changes', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cb3 = vi.fn();
    const notes = [{ id: 'a', anchor: '观点' }];
    const { container, rerender } = render(<Reader content={content} notes={notes} onNotesLocated={cb1} />);
    const mark = container.querySelector('mark.vdl-note-anchor');
    expect(cb1).toHaveBeenCalledTimes(1);

    rerender(<Reader content={content} notes={notes} onNotesLocated={cb2} />);
    expect(mark!.isConnected).toBe(true);
    expect(container.querySelector('mark.vdl-note-anchor')).toBe(mark);
    expect(cb2).not.toHaveBeenCalled();

    rerender(<Reader content={content} notes={[{ id: 'b', anchor: '第二段' }]} onNotesLocated={cb3} />);
    expect(cb3).toHaveBeenCalledTimes(1);
    expect(cb3.mock.calls[0][0].b.grade).toBe('exact');
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).not.toHaveBeenCalled();
  });
  it('frontmatter meta bar text is not matchable', () => {
    const { container } = render(<Reader content="正文" frontmatter={{ author: '作者名' }} notes={[{ id: 'm', anchor: '作者名' }]} />);
    expect(container.querySelector('mark.vdl-note-anchor')).toBeNull();
  });
});

describe('Reader mermaid rendering', () => {
  it('throws if --md-mermaid-* CSS variables are not set (regression guard for the CSS bridge)', () => {
    const content = '```mermaid\ngraph TD\n  A --> B\n```';
    expect(() => render(<Reader content={content} />)).toThrow(/color format/i);
  });

  it('renders mermaid code fences via MermaidBlock (not as plain code text) once the CSS bridge is present', () => {
    const values = ['transparent', '#2a2a2a', '#e5e5e5', '#4a4a4a', '#6a9fb5', '#333333', '#262626'];
    MERMAID_VARS.forEach((v, i) => document.body.style.setProperty(v, values[i]));

    const content = '```mermaid\ngraph TD\n  A --> B\n```';
    const { container } = render(<Reader content={content} />);
    expect(container.querySelector('code.language-mermaid')).toBeNull();
  });
});
