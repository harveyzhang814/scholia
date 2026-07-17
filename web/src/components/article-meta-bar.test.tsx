import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArticleMetaBar } from './article-meta-bar';

describe('ArticleMetaBar', () => {
  it('renders nothing when frontmatter is undefined', () => {
    const { container } = render(<ArticleMetaBar frontmatter={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when frontmatter only has title', () => {
    const { container } = render(<ArticleMetaBar frontmatter={{ title: 'Intro' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders scalar fields with humanized labels, excluding title', () => {
    render(<ArticleMetaBar frontmatter={{ title: 'Intro', fetch_date: '2024-03-15', author: 'Jane' }} />);
    expect(screen.queryByText('Title')).toBeNull();
    expect(screen.getByText('Fetch Date')).toBeInTheDocument();
    expect(screen.getByText('2024-03-15')).toBeInTheDocument();
    expect(screen.getByText('Author')).toBeInTheDocument();
    expect(screen.getByText('Jane')).toBeInTheDocument();
  });

  it('renders array fields as chips on their own row', () => {
    render(<ArticleMetaBar frontmatter={{ tags: ['ai', 'ml'] }} />);
    expect(screen.getByText('Tags')).toBeInTheDocument();
    expect(screen.getByText('ai')).toBeInTheDocument();
    expect(screen.getByText('ml')).toBeInTheDocument();
  });

  it('renders description on its own full-width row, excluded from the scalar grid', () => {
    const { container } = render(
      <ArticleMetaBar frontmatter={{ author: 'Jane', description: 'A long summary of the article.' }} />
    );
    expect(screen.getByText('Description')).toBeInTheDocument();
    expect(screen.getByText('A long summary of the article.')).toBeInTheDocument();
    const grid = container.querySelector('.grid');
    expect(grid?.textContent).not.toContain('A long summary of the article.');
  });

  it('places description after tag rows', () => {
    const { container } = render(
      <ArticleMetaBar frontmatter={{ tags: ['ai', 'ml'], description: 'A long summary.' }} />
    );
    const labels = Array.from(container.querySelectorAll('.mt-2 > div:first-child')).map((el) => el.textContent);
    expect(labels).toEqual(['Tags', 'Description']);
  });
});
