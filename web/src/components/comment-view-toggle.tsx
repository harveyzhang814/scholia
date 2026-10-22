import { useUiStore, type CommentView } from '@/stores/ui-store';

const OPTIONS: { id: CommentView; label: string }[] = [
  { id: 'inline', label: '内嵌' },
  { id: 'sidebar', label: '右栏' },
];

export function CommentViewToggle() {
  const commentView = useUiStore((s) => s.commentView);
  const setCommentView = useUiStore((s) => s.setCommentView);

  return (
    <div className="flex items-center">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          onClick={() => setCommentView(o.id)}
          aria-pressed={commentView === o.id}
          className="text-sm px-2 py-1 rounded hover:opacity-70 transition-opacity"
          style={{ color: commentView === o.id ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
