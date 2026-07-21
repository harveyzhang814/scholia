import { Link } from 'react-router';
import type { Article } from '@/lib/api';
import { Pill } from './pill';

const MAX_VISIBLE_TAGS = 3;

export function ArticleCard({ article }: { article: Article }) {
  const visibleTags = article.tags?.slice(0, MAX_VISIBLE_TAGS) ?? [];
  const hiddenTags = article.tags?.slice(MAX_VISIBLE_TAGS) ?? [];
  const hasPillRow = Boolean(article.author) || visibleTags.length > 0;

  const highlightLabel = article.highlightCount ? `${article.highlightCount} 处高亮` : null;
  const noteLabel = article.noteCount ? `${article.noteCount} 条笔记` : null;
  const annotationMeta = [highlightLabel, noteLabel].filter(Boolean).join(' · ');

  return (
    <Link
      to={`/tasks/${article.id}`}
      className="block rounded-xl border p-4 hover:opacity-80 transition-opacity"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
    >
      {hasPillRow && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {article.author && <Pill>{article.author}</Pill>}
          {visibleTags.map((tag) => (
            <Pill key={tag} variant="tag">{tag}</Pill>
          ))}
          {hiddenTags.length > 0 && (
            <Pill variant="more" title={hiddenTags.join(', ')}>+{hiddenTags.length}</Pill>
          )}
        </div>
      )}

      <div className="text-sm font-medium mb-1 line-clamp-2" style={{ color: 'var(--text-primary)' }}>
        {article.title}
      </div>
      {article.date && (
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{article.date}</div>
      )}
      <div className="text-xs mt-1 truncate" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
        {article.slug}
      </div>
      {annotationMeta && (
        <div className="text-xs mt-1.5" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
          {annotationMeta}
        </div>
      )}
    </Link>
  );
}
