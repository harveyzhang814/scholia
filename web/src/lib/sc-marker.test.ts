import { describe, it, expect } from 'vitest';
import type { Root } from 'mdast';
import { remarkScMarkers, stripScMarkers, SC_MARKER_RE } from './sc-marker';

describe('stripScMarkers', () => {
  it('removes all sc comments', () => {
    expect(stripScMarkers('a<!-- sc:3f9a2b1c -->b<!-- /sc:3f9a2b1c -->c<!-- other -->'))
      .toBe('abc<!-- other -->');
  });

  it('tolerates inner whitespace variations', () => {
    expect(stripScMarkers('a<!--sc:3f9a2b1c-->b<!--  /sc:3f9a2b1c  -->c')).toBe('abc');
  });
});

describe('SC_MARKER_RE', () => {
  it('captures edge and id', () => {
    expect(SC_MARKER_RE.exec('<!-- /sc:3f9a2b1c -->')?.slice(1)).toEqual(['/', '3f9a2b1c']);
    expect(SC_MARKER_RE.exec('<!-- sc:3f9a2b1c -->')?.slice(1)).toEqual(['', '3f9a2b1c']);
    expect(SC_MARKER_RE.test('<!-- note -->')).toBe(false);
  });
});

describe('remarkScMarkers', () => {
  it('replaces nested sc html nodes with scMarker nodes and leaves other html alone', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'html', value: '<!-- sc:3f9a2b1c -->' },
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'x' },
            { type: 'html', value: '<!-- /sc:3f9a2b1c -->' },
            { type: 'html', value: '<!-- note -->' },
          ],
        },
      ],
    } as unknown as Root;
    remarkScMarkers()(tree);
    const [block, para] = tree.children as unknown as Array<Record<string, unknown>>;
    expect(block).toEqual({
      type: 'scMarker',
      data: { hName: 'span', hProperties: { dataScUi: '', dataScMarker: '3f9a2b1c', dataScEdge: 'open' } },
      children: [],
    });
    const kids = (para as { children: Array<Record<string, unknown>> }).children;
    expect(kids[1]).toEqual({
      type: 'scMarker',
      data: { hName: 'span', hProperties: { dataScUi: '', dataScMarker: '3f9a2b1c', dataScEdge: 'close' } },
      children: [],
    });
    expect(kids[2]).toEqual({ type: 'html', value: '<!-- note -->' });
  });
});
