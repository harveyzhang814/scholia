import { useParams, useNavigate } from 'react-router';
import { useXTimeline } from '@/hooks/use-x-timelines';
import { TweetCardTracked } from '@/components/tweet-card-tracked';
import { useReadIds, useMarkUnread } from '@/hooks/use-read-state';

export default function XTimelineDetail() {
  const { handle = '' } = useParams();
  const navigate = useNavigate();
  const goBack = () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/x');
  };
  const { data: timeline, isLoading } = useXTimeline(handle);
  const { data: readIds } = useReadIds();
  const markUnread = useMarkUnread();

  if (isLoading) return <div className="p-8 text-sm" style={{ color: 'var(--text-tertiary)' }}>加载中…</div>;
  if (!timeline) return <div className="p-8 text-sm" style={{ color: 'var(--status-err)' }}>未找到时间线</div>;

  return (
    <div className="h-screen flex flex-col">
      <header className="h-12 flex items-center gap-4 px-5 border-b flex-shrink-0"
              style={{ borderColor: 'var(--border-subtle)' }}>
        <button type="button" onClick={goBack} className="text-sm" style={{ color: 'var(--text-tertiary)' }}>←</button>
        <h1 className="text-sm font-medium">@{timeline.handle}</h1>
      </header>
      <div className="flex-1 overflow-y-auto" style={{ background: 'var(--bg-canvas)' }}>
        <div className="mx-auto py-7 pb-10" style={{ maxWidth: 640 }}>
          {timeline.tweets.length === 0 ? (
            <div className="text-sm py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>该 handle 暂无推文</div>
          ) : (
            <div className="flex flex-col gap-3.5">
              {timeline.tweets.map((tweet) => {
                const id = `tweet-${tweet.tweet_id}`;
                return (
                  <TweetCardTracked
                    key={tweet.tweet_id}
                    tweet={tweet}
                    ownerHandle={timeline.handle}
                    isRead={readIds?.has(id) ?? false}
                    onMarkUnread={() => markUnread.mutate(id)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
