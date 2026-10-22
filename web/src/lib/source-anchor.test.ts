import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { Reader } from '@/components/reader';
import type { MarkerInsertion, NoteAnchor } from './api';
import { captureAnchor, locateAnchor } from './anchor';
import { buildTextIndex } from './text-index';
import { applyLineStartRule, buildSourceIndex, checkReparse, planMarkerInsertions } from './source-anchor';

// Text index of md as the Reader renders it — what a real note is captured from.
function renderedIndex(md: string) {
  const { container } = render(createElement(Reader, { content: md }));
  return buildTextIndex(container.querySelector('[data-sc-body]') as HTMLElement);
}

// Range note on the first occurrence of `anchor` (prefix/suffix/position as the browser captures them).
function range(md: string, anchor: string): NoteAnchor {
  const index = renderedIndex(md);
  const s = index.text.indexOf(anchor);
  expect(s).not.toBe(-1);
  return captureAnchor(index, s, s + anchor.length);
}

// Range note on the last occurrence of `anchor`.
function rangeLast(md: string, anchor: string): NoteAnchor {
  const index = renderedIndex(md);
  const s = index.text.lastIndexOf(anchor);
  expect(s).not.toBe(-1);
  return captureAnchor(index, s, s + anchor.length);
}

// Point note right after the first occurrence of `before`.
function pointAfter(md: string, before: string): NoteAnchor {
  const index = renderedIndex(md);
  const s = index.text.indexOf(before);
  expect(s).not.toBe(-1);
  return captureAnchor(index, s + before.length, s + before.length);
}

// Same order as the backend's applyInsertions, with the placeholder id.
function insert(md: string, plan: MarkerInsertion[]): string {
  let out = md;
  for (const { offset, edge } of [...plan].sort((a, b) => b.offset - a.offset)) {
    out = out.slice(0, offset) + (edge === 'end' ? '<!-- /sc:00000000 -->' : '<!-- sc:00000000 -->') + out.slice(offset);
  }
  return out;
}

describe('buildSourceIndex', () => {
  it('source index text matches the rendered text index', () => {
    const md = '# 标题\n\n第一段 **加粗** 和 [链接](u)。\n\n- 项一\n- 项二\n\n| a | b |\n|---|---|\n| 格 | x |';
    expect(buildSourceIndex(md).text).toBe(renderedIndex(md).text);
  });

  it('matches the rendered text for breaks, code, html and sc markers too', () => {
    const md = [
      '甲  \n乙 `行内` 丙 <span>字</span> &amp; \\*',
      '```\nx = 1\n```',
      '> 引用<!-- sc:3f9a2b1c -->一段<!-- /sc:3f9a2b1c -->',
      '<!-- sc:0123abcd -->',
      '尾段',
    ].join('\n\n');
    expect(buildSourceIndex(md).text).toBe(renderedIndex(md).text);
  });

  it('marks only text nodes that map char-for-char to the source as insertable', () => {
    const md = '前 `码` &amp; 后';
    const segs = buildSourceIndex(md).segments.map(({ text, srcStart, insertable }) => ({ text, srcStart, insertable }));
    expect(segs).toEqual([
      { text: '前 ', srcStart: 0, insertable: true },
      { text: '码', srcStart: 2, insertable: false },
      { text: ' & 后', srcStart: 5, insertable: false },
    ]);
  });
});

describe('planMarkerInsertions', () => {
  it('point inside a paragraph', () => {
    const md = '第一段文字。';
    expect(planMarkerInsertions(md, pointAfter(md, '第一段'))).toEqual([{ offset: 3, edge: 'point' }]);
  });

  it('range across bold keeps markers inline', () => {
    const md = '前 **粗体字** 后';
    const plan = planMarkerInsertions(md, range(md, '粗体字'));
    const s = md.indexOf('粗体字');
    expect(plan).toEqual([{ offset: s, edge: 'start' }, { offset: s + 3, edge: 'end' }]);
    // Both inside the ** pair.
    expect(s).toBeGreaterThanOrEqual(md.indexOf('**') + 2);
    expect(s + 3).toBeLessThanOrEqual(md.lastIndexOf('**'));
    expect(checkReparse(md, insert(md, plan!), 2)).toBe(true);
  });

  it('marks text in headings, table cells and link text', () => {
    const md = '# 大标题\n\n看 [链接文字](u) 吧\n\n| a | b |\n|---|---|\n| 单元格 | x |';
    for (const anchor of ['标题', '链接', '单元']) {
      const plan = planMarkerInsertions(md, range(md, anchor));
      const s = md.indexOf(anchor);
      expect(plan).toEqual([{ offset: s, edge: 'start' }, { offset: s + anchor.length, edge: 'end' }]);
      expect(checkReparse(md, insert(md, plan!), 2)).toBe(true);
    }
  });

  it('line-start rules keep block structure', () => {
    const cases: [md: string, anchor: string, start: number, end: number][] = [
      ['段首文字', '段首', 1, 2],                                           // paragraph start
      ['- 项目文字', '项目', 3, 4],                                         // list item content start
      ['> 引用文字', '引用', 3, 4],                                         // blockquote content start
      ['第一行\n第二行文字', '第二行', 5, 7],                               // after a soft line break
    ];
    for (const [md, anchor, start, end] of cases) {
      const plan = planMarkerInsertions(md, range(md, anchor));
      expect(plan).toEqual([{ offset: start, edge: 'start' }, { offset: end, edge: 'end' }]);
      expect(checkReparse(md, insert(md, plan!), 2)).toBe(true);
    }
    // A point at the very start of a paragraph moves one character on.
    const md = '甲\n\n乙丙';
    const plan = planMarkerInsertions(md, { anchor: '', prefix: '', suffix: '乙丙', position: 2 });
    expect(plan).toEqual([{ offset: 4, edge: 'point' }]);
    expect(checkReparse(md, insert(md, plan!), 1)).toBe(true);
  });

  it('aborts when the line-start shift empties a one-character range', () => {
    const md = '甲\n\n乙';
    expect(planMarkerInsertions(md, range(md, '乙'))).toBeNull();
  });

  it('aborts inside inline code and code blocks', () => {
    const md1 = 'a `code here` b';
    expect(planMarkerInsertions(md1, range(md1, 'code'))).toBeNull();
    const md2 = '```\nx = 1\n```';
    expect(planMarkerInsertions(md2, range(md2, 'x'))).toBeNull();
  });

  it('aborts on escaped text', () => {
    const md = 'a \\*b\\* c';
    expect(planMarkerInsertions(md, range(md, '*b*'))).toBeNull();
  });

  it('aborts on entity references and inside non-sc html', () => {
    const md1 = '甲 &amp; 乙';
    expect(planMarkerInsertions(md1, range(md1, '乙'))).toBeNull();
    const md2 = '甲 <span>乙</span> 丙';
    expect(planMarkerInsertions(md2, range(md2, 'span'))).toBeNull();
  });

  it('aborts when the inserted markers would change the parse', () => {
    // CJK without spaces: a marker right inside ** breaks the strong (flanking rules).
    const md1 = '前**粗体字**后';
    expect(planMarkerInsertions(md1, range(md1, '粗体字'))).toBeNull();
    // A marker inside an autolink literal would cut the URL.
    const md2 = '访问 https://example.com 吧';
    expect(planMarkerInsertions(md2, range(md2, 'example'))).toBeNull();
  });

  it('aborts when only an approximate match exists', () => {
    const before = '第一段里有一句很重要的话在这里。';
    const note = range(before, '很重要的话');
    const after = '第一段里有一句很关键的话在这里。';
    expect(locateAnchor(buildSourceIndex(after), note)?.grade).toBe('approximate');
    expect(planMarkerInsertions(after, note)).toBeNull();
  });

  it('anchorless note → null', () => {
    expect(planMarkerInsertions('第一段文字。', { anchor: '' })).toBeNull();
    expect(planMarkerInsertions('第一段文字。', { anchor: '', prefix: '', suffix: '', position: 0 })).toBeNull();
  });

  it('aborts when the text occurs more than once with the same context', () => {
    const table = '| 项 | 结果 |\n|---|---|\n| 甲 | 是 |\n| 乙 | 是 |';
    expect(planMarkerInsertions(table, rangeLast(table, '是'))).toBeNull();
    const list = '- 同一项\n- 同一项';
    expect(planMarkerInsertions(list, rangeLast(list, '同一项'))).toBeNull();
    const para = '前文甲乙后文\n\n前文甲乙后文';
    expect(planMarkerInsertions(para, rangeLast(para, '甲乙'))).toBeNull();
    expect(planMarkerInsertions(para, pointAfter(para, '甲'))).toBeNull();
  });

  it('still marks repeated text when its context is unique', () => {
    const md = '甲说：好。\n\n乙说：好。';
    const s = md.lastIndexOf('好');
    expect(planMarkerInsertions(md, rangeLast(md, '好'))).toEqual([{ offset: s, edge: 'start' }, { offset: s + 1, edge: 'end' }]);
    // A whole-cell anchor (empty context on both sides) next to the same text inside a longer cell.
    const table = '| 项 | 结果 |\n|---|---|\n| 是否 | 是 |';
    const c = table.lastIndexOf('是');
    expect(planMarkerInsertions(table, rangeLast(table, '是'))).toEqual([{ offset: c, edge: 'start' }, { offset: c + 1, edge: 'end' }]);
    const para = '前文甲乙后文\n\n前文甲丙后文';
    const p = para.indexOf('甲') + 1;
    expect(planMarkerInsertions(para, pointAfter(para, '甲'))).toEqual([{ offset: p, edge: 'point' }]);
  });

  it('keeps existing sc markers of other notes out of the way', () => {
    const md = '甲<!-- sc:3f9a2b1c -->乙丙丁';
    const plan = planMarkerInsertions(md, range(md, '丙'));
    const s = md.indexOf('丙');
    expect(plan).toEqual([{ offset: s, edge: 'start' }, { offset: s + 1, edge: 'end' }]);
  });
});

describe('applyLineStartRule', () => {
  it('applyLineStartRule', () => {
    expect(applyLineStartRule('甲乙\n丙丁', 3, 'end')).toBe(2);     // end at line start → end of previous line
    expect(applyLineStartRule('甲乙\n丙丁', 3, 'start')).toBe(4);   // start at line start → one character on
    expect(applyLineStartRule('甲乙', 0, 'point')).toBe(1);
    expect(applyLineStartRule('甲乙\n丙丁', 1, 'start')).toBe(1);   // not at line start: unchanged
  });

  it('treats the start of list item / blockquote content as a line start', () => {
    expect(applyLineStartRule('- 项目', 2, 'start')).toBe(3);
    expect(applyLineStartRule('1. 项目', 3, 'point')).toBe(4);
    expect(applyLineStartRule('> - 项目', 4, 'start')).toBe(5);
    expect(applyLineStartRule('# 标题', 2, 'start')).toBe(2);       // heading content is inline, no shift
  });

  it('handles CRLF and surrogate pairs', () => {
    expect(applyLineStartRule('甲乙\r\n丙丁', 4, 'end')).toBe(2);   // before the \r, not between \r and \n
    expect(applyLineStartRule('😀乙', 0, 'start')).toBe(2);         // never splits a surrogate pair
  });
});

describe('checkReparse', () => {
  it('checkReparse rejects a marker that becomes a block', () => {
    expect(checkReparse('甲\n\n乙', '甲\n\n<!-- sc:00000000 -->\n\n乙', 1)).toBe(false);   // top-level blocks changed
    expect(checkReparse('甲乙', '<!-- sc:00000000 -->甲乙', 1)).toBe(false);                 // line-start marker became an html block
    expect(checkReparse('甲乙', '甲<!-- sc:00000000 -->乙', 1)).toBe(true);
    expect(checkReparse('**甲乙**', '**甲<!-- sc:00000000 -->乙**', 1)).toBe(true);          // nested in strong is still inline
  });

  it('rejects a wrong marker count and inline changes', () => {
    expect(checkReparse('甲乙', '甲<!-- sc:00000000 -->乙', 2)).toBe(false);
    expect(checkReparse('前**甲乙**后', '前**<!-- sc:00000000 -->甲乙**后', 1)).toBe(false);  // strong lost
  });
});
