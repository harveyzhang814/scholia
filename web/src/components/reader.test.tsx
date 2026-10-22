import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, createEvent } from '@testing-library/react';
import { Reader, DRAFT_ID } from './reader';
import type { Highlight } from '@/lib/api';
import { afterEach } from 'vitest';

const MERMAID_VARS = [
  '--md-mermaid-bg', '--md-mermaid-primary', '--md-mermaid-primary-text',
  '--md-mermaid-primary-border', '--md-mermaid-line', '--md-mermaid-secondary', '--md-mermaid-tertiary',
] as const;

afterEach(() => {
  for (const v of MERMAID_VARS) document.body.style.removeProperty(v);
});

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

describe('Reader note-anchor rendering', () => {
  it('renders a mark for a note anchor entirely within one text node', () => {
    const content = '这首歌是 Rick Astley 的 **Never Gonna Give You Up**，经典金曲。';
    const notes = [{ id: 'n1', anchor: 'Never Gonna Give You Up' }];
    const { container } = render(<Reader content={content} notes={notes} />);
    expect(container.querySelectorAll('mark.vdl-note-anchor').length).toBeGreaterThan(0);
  });

  it('renders a mark for a note anchor that spans across a <strong> boundary', () => {
    const content = '这首歌是 Rick Astley 的 **Never Gonna Give You Up**，经典金曲。';
    const notes = [{ id: 'n1', anchor: '的 Never Gonna Give You Up，经典' }];
    const { container } = render(<Reader content={content} notes={notes} />);
    expect(container.querySelectorAll('mark.vdl-note-anchor').length).toBeGreaterThan(0);
  });
});

describe('Reader unified anchors', () => {
  const content = '第一段有个观点在这里。\n\n第二段。';
  it('renders a point icon for a point note', () => {
    const notes = [{ id: 'p1', anchor: '', prefix: '有个观点', suffix: '在这里。', position: 7 }];
    const { container } = render(<Reader content={content} notes={notes} />);
    const icon = container.querySelector('span.vdl-note-point[data-note-id="p1"]');
    expect(icon).not.toBeNull();
    expect(icon!.hasAttribute('data-sc-ui')).toBe(true);
    expect(icon!.textContent).toBe('');
  });
  it('clicking a point icon that lands inside a link does not follow the link', () => {
    const onNoteAnchorClick = vi.fn();
    const notes = [{ id: 'p', anchor: '', prefix: '前链接', suffix: '后', position: 3 }];
    const { container } = render(
      <Reader content={'前[链接](https://example.com)后'} notes={notes} onNoteAnchorClick={onNoteAnchorClick} />,
    );
    const icon = container.querySelector('span.vdl-note-point')!;
    expect(icon.closest('a')).not.toBeNull();
    const click = createEvent.click(icon);
    fireEvent(icon, click);
    expect(click.defaultPrevented).toBe(true);
    expect(onNoteAnchorClick).toHaveBeenCalledWith('p');
  });

  it('reports located results with grades', () => {
    const onNotesLocated = vi.fn();
    const notes = [
      { id: 'a', anchor: '观点' },
      { id: 'b', anchor: '找不到的文字' },
    ];
    render(<Reader content={content} notes={notes} onNotesLocated={onNotesLocated} />);
    const last = onNotesLocated.mock.calls.at(-1)![0];
    expect(last.a.grade).toBe('exact');
    expect(last.b).toBeUndefined();
  });
  it('skips notes whose doc differs from current doc', () => {
    const notes = [{ id: 'a', anchor: '观点', doc: 'summary' as const }];
    const { container } = render(<Reader content={content} doc="article" notes={notes} />);
    expect(container.querySelector('mark.vdl-note-anchor')).toBeNull();
  });
  it('legacy note without doc locates in any doc', () => {
    const { container } = render(<Reader content={content} doc="summary" notes={[{ id: 'a', anchor: '观点' }]} />);
    expect(container.querySelector('mark.vdl-note-anchor')).not.toBeNull();
  });
  it('marks a legacy cross-paragraph anchor', () => {
    const notes = [{ id: 'x', anchor: '在这里。\n\n第二段' }];
    const { container } = render(<Reader content={content} notes={notes} />);
    expect(container.querySelectorAll('mark.vdl-note-anchor[data-note-id="x"]').length).toBeGreaterThan(0);
  });
  it('does not re-inject when only the onNotesLocated identity changes', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cb3 = vi.fn();
    const notes = [{ id: 'a', anchor: '观点' }];
    const { container, rerender } = render(<Reader content={content} notes={notes} onNotesLocated={cb1} />);
    const mark = container.querySelector('mark.vdl-note-anchor');
    expect(cb1).toHaveBeenCalledTimes(1);

    rerender(<Reader content={content} notes={notes} onNotesLocated={cb2} />);
    expect(mark!.isConnected).toBe(true);
    expect(container.querySelector('mark.vdl-note-anchor')).toBe(mark);
    expect(cb2).not.toHaveBeenCalled();

    rerender(<Reader content={content} notes={[{ id: 'b', anchor: '第二段' }]} onNotesLocated={cb3} />);
    expect(cb3).toHaveBeenCalledTimes(1);
    expect(cb3.mock.calls[0][0].b.grade).toBe('exact');
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).not.toHaveBeenCalled();
  });
  it('frontmatter meta bar text is not matchable', () => {
    const { container } = render(<Reader content="正文" frontmatter={{ author: '作者名' }} notes={[{ id: 'm', anchor: '作者名' }]} />);
    expect(container.querySelector('mark.vdl-note-anchor')).toBeNull();
  });
});

describe('Reader comment entry points', () => {
  afterEach(() => {
    delete (document as Partial<Document>).caretRangeFromPoint;
    getSelection()?.removeAllRanges();
  });

  const content = '第一段有个观点在这里。';
  const bodyText = (c: HTMLElement) => c.querySelector('[data-sc-body] p')!.firstChild as Text;

  it('right-click shows 在此处评论 and yields a point draft', async () => {
    const onCommentDraft = vi.fn();
    const { container, getByText } = render(<Reader content={content} onCommentDraft={onCommentDraft} />);
    const t = bodyText(container);
    document.caretRangeFromPoint = () => { const r = document.createRange(); r.setStart(t, 4); r.collapse(true); return r; };
    fireEvent.contextMenu(t.parentElement!, { clientX: 10, clientY: 10 });
    fireEvent.click(getByText('在此处评论'));
    expect(onCommentDraft).toHaveBeenCalledWith({ anchor: '', prefix: '第一段有', suffix: '个观点在这里。', position: 4 });
  });
  it('right-click on a point icon at the end of a paragraph stays in that paragraph', () => {
    const onCommentDraft = vi.fn();
    const notes = [{ id: 'p', anchor: '', prefix: '观点在这里。', suffix: '', position: 11 }];
    const { container, getByText } = render(
      <Reader content={'第一段有个观点在这里。\n\n第二段。'} notes={notes} onCommentDraft={onCommentDraft} />,
    );
    const icon = container.querySelector('span.vdl-note-point')!;
    expect(icon.parentElement!.textContent).toBe('第一段有个观点在这里。');
    document.caretRangeFromPoint = () => { const r = document.createRange(); r.setStart(icon, 0); r.collapse(true); return r; };
    fireEvent.contextMenu(icon, { clientX: 10, clientY: 10 });
    fireEvent.click(getByText('在此处评论'));
    expect(onCommentDraft).toHaveBeenCalledWith({ anchor: '', prefix: '第一段有个观点在这里。', suffix: '', position: 11 });
  });
  it('right-click uses the selection from before mousedown, not a word the browser selects', () => {
    const onCommentDraft = vi.fn();
    const { container, getByText } = render(<Reader content={content} onCommentDraft={onCommentDraft} />);
    const t = bodyText(container);
    document.caretRangeFromPoint = () => { const r = document.createRange(); r.setStart(t, 4); r.collapse(true); return r; };
    getSelection()!.collapse(t, 4);
    fireEvent.mouseDown(t.parentElement!, { button: 2 });
    getSelection()!.setBaseAndExtent(t, 3, t, 6);   // macOS selects the word under the cursor
    fireEvent.contextMenu(t.parentElement!, { clientX: 10, clientY: 10 });
    fireEvent.click(getByText('在此处评论'));
    expect(onCommentDraft).toHaveBeenCalledWith(expect.objectContaining({ anchor: '', position: 4 }));
  });
  it('right-click inside a selection made before mousedown comments on it', () => {
    const onCommentDraft = vi.fn();
    const { container, getByText } = render(<Reader content={content} onCommentDraft={onCommentDraft} />);
    const t = bodyText(container);
    document.caretRangeFromPoint = () => { const r = document.createRange(); r.setStart(t, 4); r.collapse(true); return r; };
    getSelection()!.setBaseAndExtent(t, 3, t, 6);
    fireEvent.mouseDown(t.parentElement!, { button: 2 });
    fireEvent.contextMenu(t.parentElement!, { clientX: 10, clientY: 10 });
    fireEvent.click(getByText('在此处评论'));
    expect(onCommentDraft).toHaveBeenCalledWith(expect.objectContaining({ anchor: '有个观', position: 3 }));
  });
  it('shift+right-click is not intercepted', () => {
    const { container } = render(<Reader content={content} onCommentDraft={vi.fn()} />);
    const ev = createEvent.contextMenu(bodyText(container).parentElement!, { shiftKey: true });
    fireEvent(bodyText(container).parentElement!, ev);
    expect(ev.defaultPrevented).toBe(false);
  });
  it('c with caret creates point draft', () => {
    const onCommentDraft = vi.fn();
    const { container } = render(<Reader content={content} onCommentDraft={onCommentDraft} />);
    getSelection()!.collapse(bodyText(container), 4);
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(onCommentDraft).toHaveBeenCalledWith(expect.objectContaining({ anchor: '', position: 4 }));
  });
  it('c with a selection creates range draft', () => {
    const onCommentDraft = vi.fn();
    const { container } = render(<Reader content={content} onCommentDraft={onCommentDraft} />);
    getSelection()!.setBaseAndExtent(bodyText(container), 4, bodyText(container), 6);
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(onCommentDraft).toHaveBeenCalledWith(expect.objectContaining({ anchor: '个观' }));
  });
  it('c inside a textarea does nothing', () => {
    const onCommentDraft = vi.fn();
    const { container } = render(<><Reader content={content} onCommentDraft={onCommentDraft} /><textarea /></>);
    getSelection()!.collapse(bodyText(container), 4);
    fireEvent.keyDown(container.querySelector('textarea')!, { key: 'c' });
    expect(onCommentDraft).not.toHaveBeenCalled();
  });
  it('selection starting outside body yields no draft', () => {
    const onCommentDraft = vi.fn();
    const { container } = render(<Reader content={content} frontmatter={{ author: '作者' }} onCommentDraft={onCommentDraft} />);
    const meta = container.querySelector('article > :first-child')!;   // ArticleMetaBar 根元素，位于 data-sc-body 之外
    getSelection()!.setBaseAndExtent(meta, 0, bodyText(container), 3);
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(onCommentDraft).not.toHaveBeenCalled();
  });
});

describe('Reader mermaid rendering', () => {
  it('throws if --md-mermaid-* CSS variables are not set (regression guard for the CSS bridge)', () => {
    const content = '```mermaid\ngraph TD\n  A --> B\n```';
    expect(() => render(<Reader content={content} />)).toThrow(/color format/i);
  });

  it('renders mermaid code fences via MermaidBlock (not as plain code text) once the CSS bridge is present', () => {
    const values = ['transparent', '#2a2a2a', '#e5e5e5', '#4a4a4a', '#6a9fb5', '#333333', '#262626'];
    MERMAID_VARS.forEach((v, i) => document.body.style.setProperty(v, values[i]));

    const content = '```mermaid\ngraph TD\n  A --> B\n```';
    const { container } = render(<Reader content={content} />);
    expect(container.querySelector('code.language-mermaid')).toBeNull();
  });
});

describe('Reader inline card slots', () => {
  const content = '第一段有个观点在这里。\n\n- 列表项一\n- 列表项二\n\n| a | b |\n|---|---|\n| 单元格 | x |';
  const cards = (ids: string[]) => ids.map((id) => <i key={id} data-card={id} />);

  afterEach(() => {
    delete (document as Partial<Document>).caretRangeFromPoint;
    getSelection()?.removeAllRanges();
  });

  it('inline view renders cards in slots under their blocks', () => {
    const notes = [{ id: 'p', anchor: '观点' }, { id: 'l', anchor: '列表项二' }, { id: 't', anchor: '单元格' }];
    const { container } = render(<Reader content={content} notes={notes} renderInline={cards} />);
    expect(container.querySelector('p + [data-sc-slot] [data-card="p"]')).not.toBeNull();
    expect(container.querySelector('li:last-child > [data-sc-slot]:last-child [data-card="l"]')).not.toBeNull();
    expect(container.querySelector('table + [data-sc-slot] [data-card="t"]')).not.toBeNull();
    expect(container.querySelector('td [data-sc-slot]')).toBeNull();
  });

  it('slots are UI nodes that do not enter the text index', () => {
    const card = () => <b>卡片文字</b>;
    const { container } = render(<Reader content={content} notes={[{ id: 'p', anchor: '观点' }]} renderInline={card} />);
    const slot = container.querySelector('[data-sc-slot]')!;
    expect(slot.hasAttribute('data-sc-ui')).toBe(true);
    expect(slot.textContent).toBe('卡片文字');
    // a note anchored on the card text (which is really in the DOM, inside a slot) must not be located
    const onNotesLocated = vi.fn();
    const p = { id: 'p', anchor: '观点' };
    const { container: c2, rerender } = render(<Reader content={content} notes={[p]} renderInline={card} onNotesLocated={onNotesLocated} />);
    expect(c2.querySelector('[data-sc-slot]')!.textContent).toBe('卡片文字');
    rerender(<Reader content={content} notes={[p, { id: 'c', anchor: '卡片文字' }]} renderInline={card} onNotesLocated={onNotesLocated} />);
    const located = onNotesLocated.mock.calls.at(-1)![0];
    expect(located.p).toBeDefined();
    expect(located.c).toBeUndefined();
  });

  it('no renderInline means no slots', () => {
    const { container } = render(<Reader content={content} notes={[{ id: 'p', anchor: '观点' }]} />);
    expect(container.querySelector('[data-sc-slot]')).toBeNull();
  });

  it('draft gets a slot but no mark', () => {
    const draft = { anchor: '', prefix: '有个观点', suffix: '在这里。', position: 7 };
    const onNotesLocated = vi.fn();
    const { container } = render(<Reader content={content} notes={[]} draft={draft} renderInline={cards} onNotesLocated={onNotesLocated} />);
    expect(container.querySelector(`p + [data-sc-slot] [data-card="${DRAFT_ID}"]`)).not.toBeNull();
    expect(container.querySelector('.vdl-note-point, mark.vdl-note-anchor')).toBeNull();
    expect(onNotesLocated.mock.calls.at(-1)![0]).toEqual({});
  });

  it('a draft and a note on the same block share one slot, ordered by position', () => {
    const draft = { anchor: '', prefix: '第一段', suffix: '有个观点在这里。', position: 3 };
    const { container } = render(<Reader content={content} notes={[{ id: 'p', anchor: '观点' }]} draft={draft} renderInline={cards} />);
    const slots = container.querySelectorAll('[data-sc-slot]');
    expect(slots).toHaveLength(1);
    expect(Array.from(slots[0].children).map((c) => (c as HTMLElement).dataset.card)).toEqual([DRAFT_ID, 'p']);
  });

  it('reuses slot elements when notes change', () => {
    const p = { id: 'p', anchor: '观点' };
    const { container, rerender } = render(<Reader content={content} notes={[p]} renderInline={cards} />);
    const slot = container.querySelector('[data-sc-slot]')!;
    const card = slot.querySelector('[data-card="p"]')!;

    rerender(<Reader content={content} notes={[p, { id: 'q', anchor: '这里' }]} renderInline={cards} />);
    const slots = container.querySelectorAll('[data-sc-slot]');
    expect(slots).toHaveLength(1);
    expect(slots[0]).toBe(slot);
    expect(slot.querySelectorAll('[data-card]')).toHaveLength(2);
    expect(slot.querySelector('[data-card="p"]')).toBe(card);   // existing card not remounted
  });

  it('keeps the slot when only the renderInline function identity changes', () => {
    const p = { id: 'p', anchor: '观点' };
    const { container, rerender } = render(<Reader content={content} notes={[p]} renderInline={cards} />);
    const slot = container.querySelector('[data-sc-slot]')!;
    rerender(<Reader content={content} notes={[p]} renderInline={(ids) => cards(ids)} />);
    expect(container.querySelector('[data-sc-slot]')).toBe(slot);
    expect(container.querySelectorAll('[data-sc-slot]')).toHaveLength(1);
  });

  it('removes the slot of a block that no longer has notes', () => {
    const both = [{ id: 'p', anchor: '观点' }, { id: 'l', anchor: '列表项二' }];
    const { container, rerender } = render(<Reader content={content} notes={both} renderInline={cards} />);
    expect(container.querySelectorAll('[data-sc-slot]')).toHaveLength(2);
    const slot = container.querySelector('p + [data-sc-slot]')!;
    const card = slot.querySelector('[data-card="p"]')!;
    rerender(<Reader content={content} notes={[both[0]]} renderInline={cards} />);
    expect(container.querySelectorAll('[data-sc-slot]')).toHaveLength(1);
    expect(container.querySelector('[data-sc-slot]')).toBe(slot);
    expect(slot.querySelector('[data-card="p"]')).toBe(card);
    expect(container.querySelector('li [data-sc-slot]')).toBeNull();
  });

  it('removes all slots when renderInline is dropped', () => {
    const notes = [{ id: 'p', anchor: '观点' }];
    const { container, rerender } = render(<Reader content={content} notes={notes} renderInline={cards} />);
    expect(container.querySelector('[data-sc-slot]')).not.toBeNull();
    rerender(<Reader content={content} notes={notes} />);
    expect(container.querySelector('[data-sc-slot]')).toBeNull();
    expect(container.querySelector('[data-card]')).toBeNull();
  });

  it('content change leaves one slot per block', () => {
    const notes = [{ id: 'p', anchor: '观点' }];
    const { container, rerender } = render(<Reader content={content} notes={notes} renderInline={cards} />);
    rerender(<Reader content={'全新的一段也有个观点。\n\n另一段。'} notes={notes} renderInline={cards} />);
    const slots = container.querySelectorAll('[data-sc-slot]');
    expect(slots).toHaveLength(1);
    expect(slots[0].previousElementSibling!.textContent).toBe('全新的一段也有个观点。');
    expect(slots[0].querySelectorAll('[data-card="p"]')).toHaveLength(1);
  });

  it('c inside a card does nothing', () => {
    const onCommentDraft = vi.fn();
    const { container } = render(
      <Reader content={content} notes={[{ id: 'p', anchor: '观点' }]} onCommentDraft={onCommentDraft}
        renderInline={() => <button>操作</button>} />,
    );
    getSelection()!.collapse(container.querySelector('[data-sc-body] p')!.firstChild!, 2);
    fireEvent.keyDown(container.querySelector('[data-sc-slot] button')!, { key: 'c' });
    expect(onCommentDraft).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'c' });   // control: same selection outside a card does draft
    expect(onCommentDraft).toHaveBeenCalledTimes(1);
  });

  it('mouseup and right-click on a slot do not open the selection bubble or context menu', () => {
    const { container, queryByText } = render(
      <Reader content={content} notes={[{ id: 'p', anchor: '观点' }]} onCommentDraft={vi.fn()} renderInline={cards} />,
    );
    const t = container.querySelector('[data-sc-body] p')!.firstChild as Text;
    const slot = container.querySelector('[data-sc-slot]')!;
    getSelection()!.setBaseAndExtent(t, 1, t, 3);
    fireEvent.mouseUp(slot);
    expect(document.querySelector('.anchor-bubble')).toBeNull();

    document.caretRangeFromPoint = () => { const r = document.createRange(); r.setStart(t, 2); r.collapse(true); return r; };
    const ev = createEvent.contextMenu(slot, { clientX: 10, clientY: 10 });
    fireEvent(slot, ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(queryByText('在此处评论')).toBeNull();

    // control: same selection on body text shows the bubble (jsdom has no layout, so stub the rect)
    Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 10, 10);
    try {
      fireEvent.mouseUp(t.parentElement!);
      expect(document.querySelector('.anchor-bubble')).not.toBeNull();
    } finally {
      delete (Range.prototype as Partial<Range>).getBoundingClientRect;
    }
  });
});
