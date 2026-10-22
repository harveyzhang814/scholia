// Block-aware plain-text index over rendered Markdown DOM, with offset <-> DOM mapping.

export const UI_ATTR = 'data-sc-ui';

export interface TextBlock { start: number; end: number; el: HTMLElement }  // [start, end) in text, excluding separator
export interface TextIndex { root: HTMLElement; text: string; blocks: TextBlock[]; segments: { node: Text; start: number }[] }

const BLOCK = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'TD', 'TH', 'DT', 'DD', 'FIGCAPTION']);
// Whitespace-only text directly under these is formatting between blocks, not content.
const FORMAT_WS_PARENT = new Set(['DIV', 'SECTION', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR']);

function blockOf(node: Text, root: HTMLElement): HTMLElement {
  for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
    if (BLOCK.has(el.tagName)) return el;
  }
  return root;
}

export function buildTextIndex(root: HTMLElement): TextIndex {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        const el = n as Element;
        return el.hasAttribute(UI_ATTR) || el.tagName.toLowerCase() === 'svg'
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_SKIP;
      }
      const parent = n.parentElement;
      if (parent && FORMAT_WS_PARENT.has(parent.tagName) && !/\S/.test(n.nodeValue ?? '')) {
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let text = '';
  const blocks: TextBlock[] = [];
  const segments: TextIndex['segments'] = [];
  let current: TextBlock | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    const el = blockOf(node, root);
    if (!current || current.el !== el) {
      if (current) text += '\n';
      current = { start: text.length, end: text.length, el };
      blocks.push(current);
    }
    segments.push({ node, start: text.length });
    text += node.data;
    current.end = text.length;
  }
  return { root, text, blocks, segments };
}

export function blockAt(index: TextIndex, offset: number): TextBlock | null {
  return index.blocks.find((b) => offset >= b.start && offset <= b.end) ?? null;
}

export function offsetToPoint(index: TextIndex, offset: number): { node: Text; offset: number } | null {
  for (const seg of index.segments) {
    const local = offset - seg.start;
    if (local >= 0 && local <= seg.node.data.length) return { node: seg.node, offset: local };
  }
  return null;
}

export function boundaryToOffset(index: TextIndex, container: Node, offset: number): number | null {
  if (!index.root.contains(container)) return null;
  const own = index.segments.find((s) => s.node === container);
  if (own) return own.start + Math.min(offset, own.node.data.length);

  // Element boundary or skipped content: snap to the first indexed text node after it.
  const probe = index.root.ownerDocument.createRange();
  probe.setStart(container, offset);
  probe.collapse(true);
  const next = index.segments.find((s) => probe.comparePoint(s.node, 0) >= 0);
  return next ? next.start : index.text.length;
}

export function rangeToOffsets(index: TextIndex, range: Range): { start: number; end: number } | null {
  const start = boundaryToOffset(index, range.startContainer, range.startOffset);
  const end = boundaryToOffset(index, range.endContainer, range.endOffset);
  return start === null || end === null ? null : { start, end };
}

export function caretRangeAt(x: number, y: number): Range | null {
  if (typeof document.caretPositionFromPoint === 'function') {
    const pos = document.caretPositionFromPoint(x, y);
    if (!pos) return null;
    const range = document.createRange();
    range.setStart(pos.offsetNode, pos.offset);
    range.collapse(true);
    return range;
  }
  if (typeof document.caretRangeFromPoint === 'function') {
    return document.caretRangeFromPoint(x, y);
  }
  return null;
}
