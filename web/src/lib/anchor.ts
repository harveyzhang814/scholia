// Text-quote anchors with in-block context: capture from a TextIndex, locate again after edits.

import search from 'approx-string-match';
import type { NoteAnchor, NoteDoc } from './api';
import { blockAt, type TextBlock, type TextIndex } from './text-index';

export const CONTEXT_LEN = 32;
export const ANCHOR_MAX = 200;

export type AnchorKind = 'range' | 'point' | 'none';
export type Grade = 'exact' | 'approximate';
export interface Located { start: number; end: number; grade: Grade }  // point: start === end

export function anchorKind(a: Pick<NoteAnchor, 'anchor' | 'prefix' | 'suffix'>): AnchorKind {
  if (a.anchor) return 'range';
  return a.prefix || a.suffix ? 'point' : 'none';
}

export function captureAnchor(index: TextIndex, start: number, end: number, doc?: NoteDoc): NoteAnchor {
  const { text } = index;
  const origin = start;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (start === end) start = end = origin;
  end = Math.min(end, start + ANCHOR_MAX);
  const from = blockAt(index, start)?.start ?? start;
  const to = blockAt(index, end)?.end ?? end;
  const a: NoteAnchor = {
    anchor: text.slice(start, end),
    prefix: text.slice(Math.max(from, start - CONTEXT_LEN), start),
    suffix: text.slice(end, Math.min(to, end + CONTEXT_LEN)),
    position: start,
  };
  if (doc) a.doc = doc;
  return a;
}

type Dir = -1 | 1;  // -1: context before `at` (prefix), 1: after (suffix)

// Stored context sits right next to `at` inside at's block; an empty side fits only on the block edge.
function fits(index: TextIndex, side: string, at: number, dir: Dir): boolean {
  const b = blockAt(index, at);
  if (!b) return false;
  if (!side) return at === (dir < 0 ? b.start : b.end);
  return dir < 0
    ? at - side.length >= b.start && index.text.slice(at - side.length, at) === side
    : at + side.length <= b.end && index.text.slice(at, at + side.length) === side;
}

// A side shorter than CONTEXT_LEN hit a block edge at capture time; reaching an edge here too is a clue.
function score(index: TextIndex, side: string, at: number, dir: Dir): number {
  const b = blockAt(index, at);
  const edge = b && side.length < CONTEXT_LEN && at + dir * side.length === (dir < 0 ? b.start : b.end);
  return (fits(index, side, at, dir) ? 1 : 0) + (edge ? 0.5 : 0);
}

function occurrences(text: string, s: string): number[] {
  const out: number[] = [];
  for (let i = text.indexOf(s); i !== -1; i = text.indexOf(s, i + 1)) out.push(i);
  return out;
}

interface Fuzzy { start: number; end: number; errors: number; block: TextBlock }

function fuzzy(index: TextIndex, side: string): Fuzzy[] {
  if (!side) return [];
  return search(index.text, side, Math.floor(side.length * 0.25)).flatMap((m) => {
    const block = blockAt(index, m.start);
    return block && m.end <= block.end ? [{ ...m, block }] : [];
  });
}

function best(ms: Fuzzy[], dist: (m: Fuzzy) => number): Fuzzy | undefined {
  return ms.reduce<Fuzzy | undefined>(
    (b, m) => (!b || m.errors < b.errors || (m.errors === b.errors && dist(m) < dist(b)) ? m : b),
    undefined,
  );
}

export function locateAnchor(index: TextIndex, a: NoteAnchor): Located | null {
  const { text } = index;
  const kind = anchorKind(a);
  if (kind === 'none') return null;

  // Legacy note: only the quoted text, captured via selection.toString().
  if (a.prefix === undefined && a.suffix === undefined && a.position === undefined) {
    const anchor = a.anchor.replace(/\s*\n\s*/g, '\n');
    const start = text.indexOf(anchor);
    return start === -1 ? null : { start, end: start + anchor.length, grade: 'exact' };
  }

  const prefix = a.prefix ?? '';
  const suffix = a.suffix ?? '';
  const len = a.anchor.length;
  const pos = a.position ?? 0;
  const near = (x: number) => Math.abs(x - pos);

  // Step 1: exact text, context picks the candidate.
  if (kind === 'range') {
    let found: { start: number; score: number } | null = null;
    for (const start of occurrences(text, a.anchor)) {
      const s = score(index, prefix, start, -1) + score(index, suffix, start + len, 1);
      if (!found || s > found.score || (s === found.score && near(start) < near(found.start))) found = { start, score: s };
    }
    if (found) return { start: found.start, end: found.start + len, grade: 'exact' };
  } else {
    const points = [
      ...(prefix ? occurrences(text, prefix).map((i) => i + prefix.length) : []),
      ...(suffix ? occurrences(text, suffix) : []),
    ].filter((p) => (!prefix || fits(index, prefix, p, -1)) && (!suffix || fits(index, suffix, p, 1)));
    if (points.length) {
      const p = points.reduce((b, x) => (near(x) < near(b) ? x : b));
      return { start: p, end: p, grade: 'exact' };
    }
  }

  // Step 2: fuzzy-find each side on its own, within a single block.
  const p = best(fuzzy(index, prefix), (m) => near(m.end));
  const suffixes = fuzzy(index, suffix);
  const paired = p
    ? suffixes.filter((m) => m.block === p.block && m.start >= p.end && m.start - p.end <= len + 200)
    : [];
  const s = best(paired.length ? paired : suffixes, (m) => near(m.start - len));
  if (p && s && paired.includes(s)) {
    return { start: p.end, end: kind === 'point' ? p.end : s.start, grade: 'approximate' };
  }
  if (p && (!s || p.errors <= s.errors)) {
    return { start: p.end, end: Math.min(p.end + len, p.block.end), grade: 'approximate' };
  }
  if (s) return { start: Math.max(s.start - len, s.block.start), end: s.start, grade: 'approximate' };

  // Step 3: the text is gone; fall back to the stored offset.
  if (a.position !== undefined && a.position <= text.length) {
    return { start: a.position, end: a.position, grade: 'approximate' };
  }
  return null;
}
