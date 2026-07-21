import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Reader } from './reader';
import type { Highlight } from '@/lib/api';

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
