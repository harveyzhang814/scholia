// Where inline comment cards live in the rendered article: one slot element per paragraph-level host.

import { blockAt, type TextIndex } from './text-index';

export const SLOT_BLOCK = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE']);

// The paragraph-level element a slot belongs to: the nearest SLOT_BLOCK around `blockEl`, except that
// anything inside a table cell belongs to the table (a slot can't sit between rows).
export function slotHost(blockEl: HTMLElement, root: HTMLElement): HTMLElement {
  const cell = blockEl.closest('td, th');
  const table = cell && root.contains(cell) ? cell.closest('table') : null;
  if (table && root.contains(table)) return table;
  for (let el: HTMLElement | null = blockEl; el && el !== root; el = el.parentElement) {
    if (SLOT_BLOCK.has(el.tagName)) return el;
  }
  return root;
}

// root and list items hold the slot as their last child; other hosts get it as the next sibling.
export function placeSlot(slot: HTMLElement, host: HTMLElement, root: HTMLElement): void {
  if (host === root || host.tagName === 'LI') {
    if (host.lastChild !== slot) host.appendChild(slot);
  } else if (host.nextSibling !== slot) {
    host.after(slot);
  }
}

export interface SlotGroup { host: HTMLElement; ids: string[] }  // ids by ascending start

export function groupSlots(index: TextIndex, items: { id: string; start: number; end: number }[]): SlotGroup[] {
  const groups = new Map<HTMLElement, SlotGroup>();
  for (const item of [...items].sort((a, b) => a.start - b.start)) {
    const block = blockAt(index, item.end);
    if (!block) continue;
    const host = slotHost(block.el, index.root);
    const group = groups.get(host);
    if (group) group.ids.push(item.id);
    else groups.set(host, { host, ids: [item.id] });
  }
  return [...groups.values()];
}
