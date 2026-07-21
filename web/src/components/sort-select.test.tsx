import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SortSelect } from './sort-select';
import type { SortField, SortState } from '@/lib/sort';

const VIDEO_FIELDS: { value: SortField; label: string }[] = [
  { value: 'date', label: '日期' },
  { value: 'title', label: '标题' },
  { value: 'author', label: '作者' },
];

const ARTICLE_FIELDS: { value: SortField; label: string }[] = [
  { value: 'date', label: '日期' },
  { value: 'title', label: '标题' },
];

describe('SortSelect', () => {
  it('renders the provided field options', () => {
    const value: SortState = { field: 'date', direction: 'desc' };
    render(<SortSelect value={value} onChange={() => {}} fields={VIDEO_FIELDS} />);
    expect(screen.getByRole('option', { name: '日期' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '标题' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '作者' })).toBeInTheDocument();
  });

  it('only renders the fields passed in (no author option for articles)', () => {
    const value: SortState = { field: 'date', direction: 'desc' };
    render(<SortSelect value={value} onChange={() => {}} fields={ARTICLE_FIELDS} />);
    expect(screen.queryByRole('option', { name: '作者' })).not.toBeInTheDocument();
  });

  it('calls onChange with the new field when the select changes', () => {
    const value: SortState = { field: 'date', direction: 'desc' };
    const onChange = vi.fn();
    render(<SortSelect value={value} onChange={onChange} fields={VIDEO_FIELDS} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'title' } });
    expect(onChange).toHaveBeenCalledWith({ field: 'title', direction: 'desc' });
  });

  it('toggles direction when the direction button is clicked', () => {
    const value: SortState = { field: 'date', direction: 'desc' };
    const onChange = vi.fn();
    render(<SortSelect value={value} onChange={onChange} fields={VIDEO_FIELDS} />);
    fireEvent.click(screen.getByTitle('降序'));
    expect(onChange).toHaveBeenCalledWith({ field: 'date', direction: 'asc' });
  });
});
