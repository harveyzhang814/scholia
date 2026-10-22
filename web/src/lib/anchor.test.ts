import { describe, it, expect } from 'vitest';
import { anchorKind, captureAnchor, locateAnchor } from './anchor';
import { buildTextIndex, markerOffsets } from './text-index';

function ix(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return buildTextIndex(root);
}

describe('anchorKind', () => {
  it('classifies', () => {
    expect(anchorKind({ anchor: 'a' })).toBe('range');
    expect(anchorKind({ anchor: '', prefix: 'p' })).toBe('point');
    expect(anchorKind({ anchor: '' })).toBe('none');
  });
});

describe('captureAnchor', () => {
  it('context stops at block boundary', () => {
    const i = ix('<p>第一段文字</p><p>第二段开头再往后</p>');
    const s = i.text.indexOf('开头');
    expect(captureAnchor(i, s, s + 2)).toEqual({ anchor: '开头', prefix: '第二段', suffix: '再往后', position: s });
  });
  it('context stops at table cell boundary', () => {
    const i = ix('<table><tbody><tr><td>左边</td><td>右边</td></tr></tbody></table>');
    expect(captureAnchor(i, 3, 4)).toMatchObject({ anchor: '右', prefix: '', suffix: '边' });
  });
  it('point at paragraph end has empty suffix', () => {
    const i = ix('<p>段尾</p><p>下一段</p>');
    expect(captureAnchor(i, 2, 2)).toEqual({ anchor: '', prefix: '段尾', suffix: '', position: 2 });
  });
  it('trims whitespace/separator and truncates to 200', () => {
    const long = 'x'.repeat(250);
    const i = ix(`<p>a</p><p>${long}</p>`);
    const a = captureAnchor(i, 1, i.text.length);
    expect(a.anchor).toBe('x'.repeat(200));
    expect(a.prefix).toBe('');
    expect(a.suffix).toBe('x'.repeat(32));
  });
  it('trims a trailing separator snapped past the block end', () => {
    const i = ix('<p>甲乙</p><p>丙</p>');
    expect(captureAnchor(i, 0, 3)).toEqual({ anchor: '甲乙', prefix: '', suffix: '', position: 0 });
  });
  it('a non-point range of only whitespace becomes a point at the original start', () => {
    const i = ix('<p>甲乙</p><p>丙</p>');
    expect(captureAnchor(i, 2, 3)).toEqual({ anchor: '', prefix: '甲乙', suffix: '', position: 2 });
  });
  it('passes doc through', () => {
    expect(captureAnchor(ix('<p>ab</p>'), 0, 1, 'summary').doc).toBe('summary');
  });
});

describe('locateAnchor', () => {
  it('exact: picks the occurrence whose context matches', () => {
    const i = ix('<p>甲 重复句 乙</p><p>丙 重复句 丁</p>');
    const second = i.text.lastIndexOf('重复句');
    expect(locateAnchor(i, { anchor: '重复句', prefix: '丙 ', suffix: ' 丁', position: 0 }))
      .toEqual({ start: second, end: second + 3, grade: 'exact' });
  });
  it('exact: ties broken by position', () => {
    const i = ix('<p>重复</p><p>重复</p>');
    expect(locateAnchor(i, { anchor: '重复', prefix: '', suffix: '', position: 3 })!.start).toBe(3);
  });
  it('exact: boundary bonus prefers the candidate that also hits the block edge', () => {
    // Both occurrences match prefix '甲' and miss suffix 'X'; only the second has '甲' at its block start.
    const i = ix('<p>乙甲重复</p><p>甲重复丁丁</p>');
    const second = i.text.lastIndexOf('重复');
    expect(locateAnchor(i, { anchor: '重复', prefix: '甲', suffix: 'X', position: 0 })!.start).toBe(second);
  });
  it('exact: boundary bonus only counts on a fitting side', () => {
    // First: prefix fits, no edge. Second: neither side fits but both reach block edges; position is closer to it.
    const i = ix('<p>Qab重复ZZZ</p><p>xy重复zw</p>');
    expect(locateAnchor(i, { anchor: '重复', prefix: 'ab', suffix: 'cd', position: 11 })!.start).toBe(3);
  });
  it('exact: adjacent paragraph edited still matches', () => {
    const before = captureAnchor(ix('<p>评论这句话。</p><p>旁边段落</p>'), 2, 5);
    expect(locateAnchor(ix('<p>评论这句话。</p><p>旁边段落被大改了</p>'), before)!.grade).toBe('exact');
  });
  it('approximate: anchor text edited, both sides fuzzy-found', () => {
    const i = ix('<p>前面这一段上下文很长很长 被改过的原文 后面这一段上下文也很长</p>');
    const r = locateAnchor(i, { anchor: '原来的原文', prefix: '前面这一段上下文很长很长 ', suffix: ' 后面这一段上下文也很长', position: 13 })!;
    expect(i.text.slice(r.start, r.end)).toBe('被改过的原文');
    expect(r.grade).toBe('approximate');
  });
  it('approximate: only one side found, range extends by anchor length within the block', () => {
    const i = ix('<p>前面这一段上下文很长很长被改过</p>');
    const r = locateAnchor(i, { anchor: '原来的原文', prefix: '前面这一段上下文很长很长', suffix: '完全不同的后文内容', position: 0 })!;
    expect(r).toEqual({ start: 12, end: 15, grade: 'approximate' });
  });
  it('point: both sides exact', () => {
    const i = ix('<p>插入点之前|插入点之后</p>');
    expect(locateAnchor(i, { anchor: '', prefix: '插入点之前', suffix: '|插入点之后', position: 0 }))
      .toEqual({ start: 5, end: 5, grade: 'exact' });
  });
  it('point: one-sided point at block end matches exactly', () => {
    const i = ix('<p>段尾</p><p>下一段</p>');
    expect(locateAnchor(i, { anchor: '', prefix: '段尾', suffix: '', position: 0 }))
      .toEqual({ start: 2, end: 2, grade: 'exact' });
  });
  it('point: one side exact, other changed → approximate', () => {
    const i = ix('<p>插入点之前改过的后文内容</p>');
    const r = locateAnchor(i, { anchor: '', prefix: '插入点之前', suffix: '原来的后文内容', position: 5 })!;
    expect(r).toMatchObject({ start: 5, end: 5, grade: 'approximate' });
  });
  it('fuzzy matches never cross blocks', () => {
    const i = ix('<p>上下文前</p><p>半上下文后半</p>');
    const r = locateAnchor(i, { anchor: '', prefix: '文前半上下', suffix: '', position: 99 });
    expect(r).toBeNull();
  });
  it('fuzzy: a fewer-error match across blocks does not hide an in-block match', () => {
    // 'abcd\nefgh' is 1 error from the prefix but spans a separator; 'abxyefgh' is 2 errors, inside one block.
    const i = ix('<p>abcd</p><p>efgh</p><p>abxyefgh</p>');
    expect(locateAnchor(i, { anchor: '', prefix: 'abcdefgh', suffix: '', position: 0 }))
      .toEqual({ start: 18, end: 18, grade: 'approximate' });
  });
  it('falls back to position', () => {
    const i = ix('<p>全部重写后的文字没有任何相似之处</p>');
    expect(locateAnchor(i, { anchor: 'abc', prefix: 'xyzxyz', suffix: 'qrsqrs', position: 4 }))
      .toEqual({ start: 4, end: 4, grade: 'approximate' });
  });
  it('legacy anchor: first occurrence, \\n\\n normalized', () => {
    const i = ix('<p>第一段</p><p>第二段</p>');
    expect(locateAnchor(i, { anchor: '第一段\n\n第二段' })).toEqual({ start: 0, end: 7, grade: 'exact' });
    expect(locateAnchor(i, { anchor: '不存在' })).toBeNull();
  });
  it('legacy anchor keeps blank lines and indentation inside code blocks', () => {
    const i = ix('<pre><code>foo\n\n    bar</code></pre>');
    expect(locateAnchor(i, { anchor: 'foo\n\n    bar' })).toEqual({ start: 0, end: 12, grade: 'exact' });
  });
});

const mk = (id: string, edge: 'open' | 'close') => `<span data-sc-ui data-sc-marker="${id}" data-sc-edge="${edge}"></span>`;

describe('locateAnchor with sc markers', () => {
  const stale = { anchor: '完全不同的旧文字', prefix: 'x', suffix: 'y', position: 0, markerId: 'aaaaaaaa' };

  it('marker pair wins over text', () => {
    const i = ix(`<p>甲乙${mk('aaaaaaaa', 'open')}丙丁${mk('aaaaaaaa', 'close')}戊</p>`);
    expect(locateAnchor(i, stale, markerOffsets(i))).toEqual({ start: 2, end: 4, grade: 'exact' });
  });
  it('marker pair at paragraph edges maps into the block, not the next one', () => {
    const i = ix(`<p>${mk('aaaaaaaa', 'open')}甲乙${mk('aaaaaaaa', 'close')}</p><p>丙</p>`);
    expect(locateAnchor(i, stale, markerOffsets(i))).toEqual({ start: 0, end: 2, grade: 'exact' });
  });
  it('point marker locates a point note', () => {
    const i = ix(`<p>甲乙${mk('aaaaaaaa', 'open')}丙丁</p>`);
    const point = { anchor: '', prefix: '不存在的前文', suffix: '', position: 0, markerId: 'aaaaaaaa' };
    expect(locateAnchor(i, point, markerOffsets(i))).toEqual({ start: 2, end: 2, grade: 'exact' });
  });
  it('only open marker infers end from anchor length', () => {
    const i = ix(`<p>甲乙${mk('aaaaaaaa', 'open')}丙丁戊己</p>`);
    const a = { ...stale, anchor: '旧文' };
    expect(locateAnchor(i, a, markerOffsets(i))).toEqual({ start: 2, end: 4, grade: 'exact' });
    // clamped to the end of the text
    expect(locateAnchor(i, { ...stale, anchor: '很长很长很长很长很长' }, markerOffsets(i)))
      .toEqual({ start: 2, end: i.text.length, grade: 'exact' });
  });
  it('only close marker infers start', () => {
    const i = ix(`<p>甲乙丙丁${mk('aaaaaaaa', 'close')}戊己</p>`);
    const a = { ...stale, anchor: '旧文' };
    expect(locateAnchor(i, a, markerOffsets(i))).toEqual({ start: 2, end: 4, grade: 'exact' });
    // clamped to 0
    expect(locateAnchor(i, { ...stale, anchor: '很长很长很长很长很长' }, markerOffsets(i)))
      .toEqual({ start: 0, end: 4, grade: 'exact' });
  });
  it('first occurrence wins for duplicated marker ids', () => {
    const i = ix(
      `<p>甲${mk('aaaaaaaa', 'open')}乙${mk('aaaaaaaa', 'close')}丙</p>`
      + `<p>丁${mk('aaaaaaaa', 'open')}戊${mk('aaaaaaaa', 'close')}己</p>`,
    );
    expect(markerOffsets(i).get('aaaaaaaa')).toEqual({ open: 1, close: 2 });
    expect(locateAnchor(i, stale, markerOffsets(i))).toEqual({ start: 1, end: 2, grade: 'exact' });
  });
  it('unknown markerId falls back to text', () => {
    const i = ix(`<p>甲乙${mk('bbbbbbbb', 'open')}丙丁${mk('bbbbbbbb', 'close')}戊</p>`);
    const a = { anchor: '丙丁', prefix: '甲乙', suffix: '戊', position: 2 };
    const expected = locateAnchor(i, a);
    expect(expected).toEqual({ start: 2, end: 4, grade: 'exact' });
    expect(locateAnchor(i, { ...a, markerId: 'aaaaaaaa' }, markerOffsets(i))).toEqual(expected);
  });
  it('markers are ignored when no marker map is given', () => {
    const i = ix(`<p>甲乙${mk('aaaaaaaa', 'open')}丙丁${mk('aaaaaaaa', 'close')}戊</p>`);
    expect(locateAnchor(i, stale)).not.toEqual({ start: 2, end: 4, grade: 'exact' });
  });
  it('marker spans add no text to the index', () => {
    const i = ix(`<p>甲乙${mk('aaaaaaaa', 'open')}丙丁</p>`);
    expect(i.text).toBe('甲乙丙丁');
  });
});
