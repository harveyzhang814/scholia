import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildTextIndex,
  blockAt,
  offsetToPoint,
  boundaryToOffset,
  rangeToOffsets,
  caretRangeAt,
} from './text-index';

describe('text-index', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
  });

  it('joins blocks with a single \\n and skips inter-block whitespace', () => {
    root.innerHTML = '<p>甲乙</p>\n<ul>\n<li>丙</li>\n<li><p>丁</p></li>\n</ul>';
    const ix = buildTextIndex(root);
    expect(ix.text).toBe('甲乙\n丙\n丁');
    expect(ix.blocks.map((b) => [b.start, b.end])).toEqual([[0, 2], [3, 4], [5, 6]]);
  });

  it('inline elements stay in the same block', () => {
    root.innerHTML = '<p>a <strong>b</strong> <a>c</a></p>';
    expect(buildTextIndex(root).text).toBe('a b c');
  });

  it('pre/code spans form one block', () => {
    root.innerHTML = '<pre><code><span>const</span> x = <span>1</span></code></pre><p>y</p>';
    const ix = buildTextIndex(root);
    expect(ix.text).toBe('const x = 1\ny');
    expect(ix.blocks).toHaveLength(2);
  });

  it('td is its own block', () => {
    root.innerHTML = '<table><tbody><tr><td>左</td><td>右</td></tr></tbody></table>';
    expect(buildTextIndex(root).text).toBe('左\n右');
  });

  it('skips data-sc-ui subtrees and svg', () => {
    root.innerHTML = '<p>前<span data-sc-ui>图标</span>后</p><svg><text>t</text></svg>';
    expect(buildTextIndex(root).text).toBe('前后');
  });

  it('text without a block ancestor belongs to root', () => {
    root.innerHTML = 'a<em>b</em>';
    const ix = buildTextIndex(root);
    expect(ix.text).toBe('ab');
    expect(ix.blocks).toHaveLength(1);
    expect(ix.blocks[0].el).toBe(root);
  });

  it('blockAt includes the end offset of a block', () => {
    root.innerHTML = '<p>甲乙</p><p>丙</p>';
    const ix = buildTextIndex(root);
    expect(blockAt(ix, 0)).toBe(ix.blocks[0]);
    expect(blockAt(ix, 2)).toBe(ix.blocks[0]);
    expect(blockAt(ix, 3)).toBe(ix.blocks[1]);
    expect(blockAt(ix, 99)).toBeNull();
  });

  it('boundary inside data-sc-ui maps to its position', () => {
    root.innerHTML = '<p>前<span data-sc-ui>图标</span>后</p>';
    const ix = buildTextIndex(root);
    const icon = root.querySelector('[data-sc-ui]')!;
    expect(boundaryToOffset(ix, icon.firstChild!, 1)).toBe(1);
  });

  it('boundary on an element maps to the next indexed text node', () => {
    root.innerHTML = '<p>甲</p><p>乙</p>';
    const ix = buildTextIndex(root);
    expect(boundaryToOffset(ix, root, 1)).toBe(2);
    expect(boundaryToOffset(ix, root.firstChild!, 0)).toBe(0);
  });

  it('boundary after the last indexed text node maps to text.length', () => {
    root.innerHTML = '<p>甲</p><p data-sc-ui>图标</p>';
    const ix = buildTextIndex(root);
    expect(boundaryToOffset(ix, root, 2)).toBe(ix.text.length);
  });

  it('offsetToPoint and rangeToOffsets round-trip across a <strong>', () => {
    root.innerHTML = '<p>ab<strong>cd</strong>ef</p>';
    const ix = buildTextIndex(root);
    const s = offsetToPoint(ix, 1)!, e = offsetToPoint(ix, 5)!;
    const r = document.createRange(); r.setStart(s.node, s.offset); r.setEnd(e.node, e.offset);
    expect(rangeToOffsets(ix, r)).toEqual({ start: 1, end: 5 });
  });

  it('boundary outside root returns null', () => {
    const other = document.createTextNode('x');
    expect(boundaryToOffset(buildTextIndex(root), other, 0)).toBeNull();
  });

  describe('caretRangeAt', () => {
    const doc = document as unknown as Record<string, unknown>;
    afterEach(() => {
      delete doc.caretPositionFromPoint;
      delete doc.caretRangeFromPoint;
    });

    it('returns null when neither API exists', () => {
      expect(caretRangeAt(1, 2)).toBeNull();
    });

    it('uses caretPositionFromPoint when available', () => {
      const text = document.createTextNode('abc');
      doc.caretPositionFromPoint = vi.fn(() => ({ offsetNode: text, offset: 2 }));
      const r = caretRangeAt(1, 2)!;
      expect(r.startContainer).toBe(text);
      expect(r.startOffset).toBe(2);
      expect(r.collapsed).toBe(true);
    });

    it('falls back to caretRangeFromPoint', () => {
      const range = document.createRange();
      doc.caretRangeFromPoint = vi.fn(() => range);
      expect(caretRangeAt(1, 2)).toBe(range);
    });
  });
});
