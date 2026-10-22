import { describe, it, expect, beforeEach } from 'vitest';
import { buildTextIndex } from './text-index';
import { groupSlots, placeSlot, slotHost } from './inline-slots';

describe('inline-slots', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
  });

  // Host for the block containing the first text node whose data equals `text`.
  const hostOf = (text: string) => {
    const ix = buildTextIndex(root);
    const seg = ix.segments.find((s) => s.node.data === text)!;
    const block = ix.blocks.find((b) => seg.start >= b.start && seg.start <= b.end)!;
    return slotHost(block.el, root);
  };
  const slotEl = () => {
    const s = document.createElement('div');
    s.setAttribute('data-sc-slot', '1');
    return s;
  };

  it('slot goes after a paragraph', () => {
    root.innerHTML = '<p>a</p><p>b</p>';
    const [p1, p2] = Array.from(root.children) as HTMLElement[];
    const host = hostOf('a');
    expect(host).toBe(p1);
    const slot = slotEl();
    placeSlot(slot, host, root);
    expect(p1.nextSibling).toBe(slot);
    expect(slot.nextSibling).toBe(p2);
  });

  it('slot goes inside the end of a list item', () => {
    root.innerHTML = '<ul><li>a</li></ul>';
    const li = root.querySelector('li')!;
    const host = hostOf('a');
    expect(host).toBe(li);
    const slot = slotEl();
    placeSlot(slot, host, root);
    expect(li.lastElementChild).toBe(slot);
  });

  it('slot goes after a table, not inside the cell', () => {
    root.innerHTML = '<table><tbody><tr><td>a</td></tr></tbody></table><p>z</p>';
    const table = root.querySelector('table')!;
    const host = hostOf('a');
    expect(host).toBe(table);
    const slot = slotEl();
    placeSlot(slot, host, root);
    expect(table.nextSibling).toBe(slot);
    expect(table.querySelector('[data-sc-slot]')).toBeNull();
  });

  it('a paragraph inside a table cell still goes after the table', () => {
    root.innerHTML = '<table><tbody><tr><td><p>a</p></td></tr></tbody></table>';
    expect(hostOf('a')).toBe(root.querySelector('table'));
  });

  it('slot placement in nested structures', () => {
    root.innerHTML = '<ul><li><p>a</p><ul><li>b</li></ul></li></ul>'
      + '<blockquote><p>c</p></blockquote>'
      + '<ul><li><table><tbody><tr><td>d</td></tr></tbody></table></li></ul>';
    const lis = root.querySelectorAll('li');
    expect(hostOf('a')).toBe(root.querySelector('li > p'));
    expect(hostOf('b')).toBe(lis[1]);
    expect(hostOf('c')).toBe(root.querySelector('blockquote > p'));
    expect(hostOf('d')).toBe(root.querySelector('li > table'));
  });

  it('host is root when the block has no slot-capable ancestor', () => {
    root.innerHTML = 'bare text<dl><dd>x</dd></dl>';
    expect(slotHost(root, root)).toBe(root);
    expect(hostOf('x')).toBe(root);
    const slot = slotEl();
    placeSlot(slot, root, root);
    expect(root.lastChild).toBe(slot);
  });

  it('placeSlot leaves a correctly placed slot untouched and moves a misplaced one', () => {
    root.innerHTML = '<p>a</p><p>b</p>';
    const [p1, p2] = Array.from(root.children) as HTMLElement[];
    const slot = slotEl();
    placeSlot(slot, p1, root);

    const observer = new MutationObserver(() => {});
    observer.observe(root, { childList: true });
    placeSlot(slot, p1, root);
    expect(observer.takeRecords()).toHaveLength(0);   // no remove/insert when already in place
    expect(p1.nextSibling).toBe(slot);

    placeSlot(slot, p2, root);
    observer.disconnect();
    expect(p2.nextSibling).toBe(slot);
    expect(root.querySelectorAll('[data-sc-slot]')).toHaveLength(1);
  });

  it('groups notes of one block into one slot sorted by start', () => {
    root.innerHTML = '<p>0123456789</p><p>abc</p>';
    const ix = buildTextIndex(root);
    const groups = groupSlots(ix, [
      { id: 'late', start: 5, end: 7 },
      { id: 'other', start: 11, end: 12 },
      { id: 'early', start: 1, end: 3 },
    ]);
    expect(groups.map((g) => g.ids)).toEqual([['early', 'late'], ['other']]);
    expect(groups[0].host).toBe(root.children[0]);
    expect(groups[1].host).toBe(root.children[1]);
  });

  it('uses the block where the item ends', () => {
    root.innerHTML = '<p>abc</p><p>def</p>';
    const ix = buildTextIndex(root);
    const groups = groupSlots(ix, [{ id: 'x', start: 1, end: 6 }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].host).toBe(root.children[1]);
  });
});
