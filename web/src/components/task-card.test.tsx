import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { TaskCard } from './task-card';
import type { Task } from '@/lib/api';

const baseTask: Task = {
  id: 'abc',
  url: 'https://youtube.com/watch?v=x',
  title: 'Test Video',
  mode: 'media',
  duration_seconds: 932,
  status: 'done',
  created_at: Date.now(),
  updated_at: Date.now(),
};

function renderCard(task: Task) {
  return render(<MemoryRouter><TaskCard task={task} /></MemoryRouter>);
}

describe('TaskCard', () => {
  it('renders an author pill when uploader is present', () => {
    renderCard({ ...baseTask, uploader: 'MIT OpenCourseWare' });
    expect(screen.getByText('MIT OpenCourseWare')).toBeInTheDocument();
  });

  it('renders no author pill when uploader is absent', () => {
    const { container } = renderCard(baseTask);
    expect(container.querySelector('span[title], span.rounded')).toBeNull();
  });

  it('shows both counts when highlights and notes are present', () => {
    renderCard({ ...baseTask, highlightCount: 5, noteCount: 2 });
    expect(screen.getByText(/5 处高亮/)).toBeInTheDocument();
    expect(screen.getByText(/2 条笔记/)).toBeInTheDocument();
  });

  it('shows only highlight count when note count is zero', () => {
    renderCard({ ...baseTask, highlightCount: 1, noteCount: 0 });
    expect(screen.getByText(/1 处高亮/)).toBeInTheDocument();
    expect(screen.queryByText(/条笔记/)).toBeNull();
  });

  it('hides the annotation segment entirely when both counts are zero', () => {
    renderCard({ ...baseTask, highlightCount: 0, noteCount: 0 });
    expect(screen.queryByText(/处高亮/)).toBeNull();
    expect(screen.queryByText(/条笔记/)).toBeNull();
  });
});
