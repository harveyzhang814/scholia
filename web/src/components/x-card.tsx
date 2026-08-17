import { Link } from 'react-router';
import type { XTimelineSummary } from '@/lib/api';
import { formatRelativeTime } from '@/lib/time';

function initials(handle: string): string {
  return handle.replace(/^@/, '').slice(0, 2).toUpperCase();
}

export function XCard({ timeline }: { timeline: XTimelineSummary }) {
  const { handle, tweetCount, latestAt, latestPreview, hasUnread } = timeline;
  return (
    <Link
      to={`/x/${handle}`}
      className="relative block rounded-xl border p-4 hover:opacity-80 transition-opacity"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
    >
      {hasUnread && (
        <span aria-label="未读" className="absolute top-3 right-3 w-2 h-2 rounded-full" style={{ background: 'var(--accent-9)' }} />
      )}
      <div className="flex items-center gap-2 mb-2">
        <span
          className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0"
          style={{ background: 'var(--accent-3)', color: 'var(--accent-11)' }}
        >
          {initials(handle)}
        </span>
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>@{handle}</span>
      </div>
      {latestPreview && (
        <p className="text-[13px] mb-3 line-clamp-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {latestPreview}
        </p>
      )}
      <div className="flex items-center justify-between text-xs"
           style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
        <span>{tweetCount} 条推文</span>
        <span>{latestAt ? formatRelativeTime(Date.parse(latestAt)) : ''}</span>
      </div>
    </Link>
  );
}
