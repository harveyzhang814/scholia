import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pill } from './pill';

describe('Pill', () => {
  it('renders children text', () => {
    render(<Pill>MIT OpenCourseWare</Pill>);
    expect(screen.getByText('MIT OpenCourseWare')).toBeInTheDocument();
  });

  it('applies the title attribute when provided', () => {
    render(<Pill title="rlhf, survey">+2</Pill>);
    expect(screen.getByText('+2')).toHaveAttribute('title', 'rlhf, survey');
  });

  it('defaults to the default variant styling', () => {
    render(<Pill>author</Pill>);
    expect(screen.getByText('author')).toHaveStyle({ background: 'var(--bg-elevated)' });
  });

  it('applies tag variant styling', () => {
    render(<Pill variant="tag">claude</Pill>);
    expect(screen.getByText('claude')).toHaveStyle({ background: 'var(--accent-3)' });
  });
});
