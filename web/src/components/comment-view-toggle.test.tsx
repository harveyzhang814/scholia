import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { CommentViewToggle } from './comment-view-toggle';
import { useUiStore, readCommentView } from '@/stores/ui-store';

describe('CommentViewToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ commentView: readCommentView() });
  });

  it('defaults to inline when nothing is stored', () => {
    expect(readCommentView()).toBe('inline');
  });

  it('reads a stored sidebar view and ignores junk', () => {
    localStorage.setItem('comment-view', 'sidebar');
    expect(readCommentView()).toBe('sidebar');
    localStorage.setItem('comment-view', 'weird');
    expect(readCommentView()).toBe('inline');
  });

  it('clicking 右栏 switches and persists', () => {
    const { getByText } = render(<CommentViewToggle />);
    expect(getByText('内嵌')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(getByText('右栏'));
    expect(useUiStore.getState().commentView).toBe('sidebar');
    expect(localStorage.getItem('comment-view')).toBe('sidebar');
    expect(getByText('右栏')).toHaveAttribute('aria-pressed', 'true');
  });
});
