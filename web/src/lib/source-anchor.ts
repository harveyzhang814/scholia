// Text index over the Markdown source (same parser as the renderer), and where to insert sc markers.
// Only exact, char-for-char positions get markers; anything doubtful returns null — a missing
// marker only means text-based locating, a wrong one would corrupt the user's file.

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { MarkerEdge, MarkerInsertion, NoteAnchor } from './api';
import { anchorKind, fits, locateAnchor, occurrences, type AnchorKind } from './anchor';
import { SC_MARKER_RE } from './sc-marker';
import type { PlainIndex } from './text-index';

export interface SourceSegment { start: number; text: string; srcStart: number; insertable: boolean }
export interface SourceIndex extends PlainIndex { segments: SourceSegment[] }

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const parser = unified().use(remarkParse).use(remarkGfm);
const parse = (md: string) => parser.parse(md) as unknown as MdNode;

const BLOCKS = new Set(['paragraph', 'heading', 'tableCell', 'code']);
const INLINE_HOSTS = new Set(['paragraph', 'heading', 'tableCell']);
const INLINE_WRAPPERS = new Set(['emphasis', 'strong', 'delete', 'link']);
// Placeholder id for the local trial insertion; real ids have the same shape.
const PLACEHOLDER_ID = '00000000';

const isScMarker = (n: MdNode) => n.type === 'html' && SC_MARKER_RE.test(n.value ?? '');

export function buildSourceIndex(md: string): SourceIndex {
  let text = '';
  const blocks: PlainIndex['blocks'] = [];
  const segments: SourceSegment[] = [];
  let block: PlainIndex['blocks'][number] | null = null;

  // Blocks open lazily, like the DOM index: a block without text adds no separator.
  const emit = (value: string, node: MdNode, insertable: boolean) => {
    if (!value) return;
    if (!block) {
      if (blocks.length) text += '\n';
      block = { start: text.length, end: text.length };
      blocks.push(block);
    }
    segments.push({ start: text.length, text: value, srcStart: node.position!.start.offset!, insertable });
    text += value;
    block.end = text.length;
  };

  const visit = (node: MdNode) => {
    const isBlock = BLOCKS.has(node.type);
    if (isBlock) block = null;
    const value = node.value ?? '';
    switch (node.type) {
      case 'text':
        emit(value, node, md.slice(node.position!.start.offset, node.position!.end.offset) === value);
        break;
      case 'inlineCode':
        emit(value, node, false);
        break;
      case 'code':
        emit(value && value + '\n', node, false);   // the rendered <code> ends with a newline
        break;
      case 'break':
        emit('\n', node, false);                   // the rendered <br> is followed by a newline text node
        break;
      case 'html':
        if (!isScMarker(node)) emit(value, node, false);   // shown as literal text in the browser
        break;
      default:
        node.children?.forEach(visit);
    }
    if (isBlock) block = null;
  };
  visit(parse(md));
  return { text, blocks, segments };
}

// Start/point: the segment holding the offset's character; end: the one holding the character before it.
function toSource(index: SourceIndex, offset: number, edge: MarkerEdge): number | null {
  const seg = index.segments.find((s) => (edge === 'end'
    ? offset > s.start && offset <= s.start + s.text.length
    : offset >= s.start && offset < s.start + s.text.length));
  return seg?.insertable ? seg.srcStart + (offset - seg.start) : null;
}

// Line start: only container syntax (blockquote `>`, list bullets / numbers, indentation) before the
// offset on its line — a marker there would open an html block instead of staying inline.
const CONTAINER_PREFIX_RE = /^[ \t]*(?:(?:>|[-+*]|\d{1,9}[.)])[ \t]*)*$/;

export function applyLineStartRule(md: string, offset: number, edge: MarkerEdge): number {
  const lineStart = md.lastIndexOf('\n', offset - 1) + 1;
  if (!CONTAINER_PREFIX_RE.test(md.slice(lineStart, offset))) return offset;
  if (edge === 'end') {
    if (lineStart === 0) return offset;
    return md[lineStart - 2] === '\r' ? lineStart - 2 : lineStart - 1;
  }
  return isSurrogatePair(md, offset) ? offset + 2 : offset + 1;
}

function isSurrogatePair(md: string, i: number): boolean {
  const hi = md.charCodeAt(i);
  const lo = md.charCodeAt(i + 1);
  return hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff;
}

// Same order as the server's applyInsertions: largest offset first.
function insertMarkers(md: string, plan: MarkerInsertion[], id: string): string {
  let out = md;
  for (const { offset, edge } of [...plan].sort((a, b) => b.offset - a.offset)) {
    out = out.slice(0, offset) + (edge === 'end' ? `<!-- /sc:${id} -->` : `<!-- sc:${id} -->`) + out.slice(offset);
  }
  return out;
}

// The source index is not always identical to the rendered one (task-list items, footnotes, mermaid
// blocks differ), so when the same text and context occur twice, the locator's position tie-break can
// pick the other copy here than on the page. Only accept a match the stored context singles out.
// "Fits" is the locator's own rule: an empty side (captured at a block edge) only fits at a block
// edge, so empty context never matches mid-block copies of the text and can't make a unique anchor
// look repeated. Legacy notes without context are held to the same rule.
function isUniqueMatch(index: SourceIndex, note: NoteAnchor, kind: AnchorKind, at: number): boolean {
  const prefix = note.prefix ?? '';
  const suffix = note.suffix ?? '';
  const len = kind === 'range' ? note.anchor.length : 0;
  const candidates = kind === 'range'
    ? occurrences(index.text, note.anchor)
    : [...new Set([
        ...(prefix ? occurrences(index.text, prefix).map((i) => i + prefix.length) : []),
        ...(suffix ? occurrences(index.text, suffix) : []),
      ])];
  const full = candidates.filter((p) => fits(index, prefix, p, -1) && fits(index, suffix, p + len, 1));
  if (full.length) return full.length === 1 && full[0] === at;
  // No copy carries the full context (it was captured from slightly different text): trust the
  // match only if the text itself occurs nowhere else.
  return candidates.length === 1 && candidates[0] === at;
}

export function planMarkerInsertions(md: string, note: NoteAnchor): MarkerInsertion[] | null {
  const kind = anchorKind(note);
  if (kind === 'none') return null;
  const index = buildSourceIndex(md);
  const loc = locateAnchor(index, note);
  if (!loc || loc.grade !== 'exact' || !isUniqueMatch(index, note, kind, loc.start)) return null;

  const wanted: MarkerInsertion[] = kind === 'point'
    ? [{ offset: loc.start, edge: 'point' }]
    : [{ offset: loc.start, edge: 'start' }, { offset: loc.end, edge: 'end' }];
  const plan: MarkerInsertion[] = [];
  for (const { offset, edge } of wanted) {
    const src = toSource(index, offset, edge);
    if (src === null) return null;
    const at = applyLineStartRule(md, src, edge);
    // Still within (or at an edge of) a verbatim text node, and not between the halves of a surrogate pair.
    const verbatim = index.segments.some((s) => s.insertable && at >= s.srcStart && at <= s.srcStart + s.text.length);
    if (!verbatim || isSurrogatePair(md, at - 1)) return null;
    plan.push({ offset: at, edge });
  }
  if (plan.length === 2 && plan[0].offset >= plan[1].offset) return null;
  return checkReparse(md, insertMarkers(md, plan, PLACEHOLDER_ID), plan.length) ? plan : null;
}

// Tree with positions dropped, sc markers removed and the text around them merged back together.
function canonical(node: MdNode): MdNode {
  const out: MdNode = { ...node };
  delete out.position;
  if (!node.children) return out;
  const children: MdNode[] = [];
  for (const child of node.children) {
    if (isScMarker(child)) continue;
    const c = canonical(child);
    const prev = children[children.length - 1];
    if (c.type === 'text' && prev?.type === 'text') prev.value = (prev.value ?? '') + (c.value ?? '');
    else children.push(c);
  }
  out.children = children;
  return out;
}

// `after` is `before` with markerCount placeholder markers inserted. Each must parse as an inline html
// node in a paragraph/heading/tableCell (possibly inside emphasis/strong/delete/link), and apart from
// sc markers the tree must be unchanged — which also keeps the top-level block sequence, and catches
// inline syntax a marker could break (emphasis flanking, autolinks, link references, ...).
export function checkReparse(before: string, after: string, markerCount: number): boolean {
  const tree = parse(after);
  let found = 0;
  let inline = true;
  const visit = (node: MdNode, ancestors: MdNode[]) => {
    const m = node.type === 'html' ? SC_MARKER_RE.exec(node.value ?? '') : null;
    if (m && m[2] === PLACEHOLDER_ID) {
      found++;
      let i = ancestors.length - 1;
      while (i >= 0 && INLINE_WRAPPERS.has(ancestors[i].type)) i--;
      if (i < 0 || !INLINE_HOSTS.has(ancestors[i].type)) inline = false;
    }
    node.children?.forEach((c) => visit(c, [...ancestors, node]));
  };
  visit(tree, []);
  if (!inline || found !== markerCount) return false;
  return JSON.stringify(canonical(parse(before))) === JSON.stringify(canonical(tree));
}
