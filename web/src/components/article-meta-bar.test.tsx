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
});
