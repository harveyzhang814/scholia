import { describe, it, expect } from 'vitest';
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
