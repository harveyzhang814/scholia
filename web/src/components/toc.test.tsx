import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { Reader } from './reader';
import { Toc, extractToc } from './toc';

beforeAll(() => {
  // jsdom has no IntersectionObserver implementation at all.
  globalThis.IntersectionObserver = class IntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
});

const content = `
# Title (not counted, only h2/h3)

## First Section

Some text.

### Nested subsection

More text.

## Second Section

Final paragraph.
`;

describe('Toc heading id assignment', () => {
  it('assigns ids to h2/h3 in the same order extractToc produced from raw markdown', () => {
    const items = extractToc(content);
    expect(items.map((i) => i.text)).toEqual(['First Section', 'Nested subsection', 'Second Section']);

    const { container } = render(
      <>
        <Reader content={content} />
        <Toc items={items} />
      </>
    );

    const headings = Array.from(container.querySelectorAll('article.prose-cn h2, article.prose-cn h3'));
    expect(headings.map((h) => h.textContent)).toEqual(['First Section', 'Nested subsection', 'Second Section']);
    expect(headings.map((h) => h.id)).toEqual(items.map((i) => i.id));

    const tocLinks = Array.from(container.querySelectorAll('nav a'));
    expect(tocLinks.map((a) => a.getAttribute('href'))).toEqual(headings.map((h) => `#${h.id}`));
  });
});
