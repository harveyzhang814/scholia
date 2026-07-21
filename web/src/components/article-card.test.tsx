import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ArticleCard } from './article-card';
import type { Article } from '@/lib/api';

const baseArticle: Article = {
  id: 'article-intro',
  slug: 'intro',
  title: 'Test Article',
  updatedAt: Date.now(),
};

function renderCard(article: Article) {
  return render(<MemoryRouter><ArticleCard article={article} /></MemoryRouter>);
}

describe('ArticleCard', () => {
  it('renders no pill row when author and tags are both absent', () => {
    const { container } = renderCard(baseArticle);
    expect(container.querySelector('span[title], span.rounded')).toBeNull();
  });

  it('renders an author pill when author is present', () => {
    renderCard({ ...baseArticle, author: 'Anthropic' });
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
  });

  it('renders up to 3 tag pills without folding', () => {
    renderCard({ ...baseArticle, tags: ['rust', '生命周期', '教程'] });
    expect(screen.getByText('rust')).toBeInTheDocument();
    expect(screen.getByText('生命周期')).toBeInTheDocument();
    expect(screen.getByText('教程')).toBeInTheDocument();
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it('folds tags beyond 3 into a +N pill with the rest in its title attribute', () => {
    renderCard({ ...baseArticle, tags: ['attention', 'transformer', 'nlp', 'rlhf', 'survey'] });
    expect(screen.getByText('attention')).toBeInTheDocument();
    expect(screen.getByText('transformer')).toBeInTheDocument();
    expect(screen.getByText('nlp')).toBeInTheDocument();
    expect(screen.queryByText('rlhf')).toBeNull();
    const more = screen.getByText('+2');
    expect(more).toHaveAttribute('title', 'rlhf, survey');
  });

  it('shows both counts when highlights and notes are present', () => {
    renderCard({ ...baseArticle, highlightCount: 3, noteCount: 1 });
    expect(screen.getByText(/3 处高亮/)).toBeInTheDocument();
    expect(screen.getByText(/1 条笔记/)).toBeInTheDocument();
  });

  it('hides the annotation row entirely when both counts are zero', () => {
    renderCard({ ...baseArticle, highlightCount: 0, noteCount: 0 });
    expect(screen.queryByText(/处高亮/)).toBeNull();
    expect(screen.queryByText(/条笔记/)).toBeNull();
  });

  it('still renders title, date and slug like before', () => {
    renderCard({ ...baseArticle, date: '2026-03-22' });
    expect(screen.getByText('Test Article')).toBeInTheDocument();
    expect(screen.getByText('2026-03-22')).toBeInTheDocument();
    expect(screen.getByText('intro')).toBeInTheDocument();
  });
});
