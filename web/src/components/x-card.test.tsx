import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { XCard } from './x-card';
import type { XTimelineSummary } from '@/lib/api';

const base: XTimelineSummary = { handle: 'trq212', tweetCount: 20 };

function renderCard(timeline: XTimelineSummary) {
  return render(<MemoryRouter><XCard timeline={timeline} /></MemoryRouter>);
}

describe('XCard', () => {
  it('renders the handle and tweet count', () => {
    renderCard(base);
    expect(screen.getByText('@trq212')).toBeInTheDocument();
    expect(screen.getByText('20 条推文')).toBeInTheDocument();
  });

  it('renders the preview text when present', () => {
    renderCard({ ...base, latestPreview: 'everything truly is code' });
    expect(screen.getByText('everything truly is code')).toBeInTheDocument();
  });

  it('renders without a preview paragraph when latestPreview is absent', () => {
    const { container } = renderCard(base);
    expect(container.querySelector('p')).toBeNull();
  });

  it('links to the handle detail route', () => {
    renderCard(base);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/x/trq212');
  });

  it('shows the relative time derived from latestAt', () => {
    renderCard({ ...base, latestAt: new Date().toISOString() });
    expect(screen.getByText('刚刚')).toBeInTheDocument();
  });
});
