import { useEffect, useRef } from 'react';
import { TweetCard } from './tweet-card';
import type { XTweet } from '@/lib/api';
import { useMarkRead } from '@/hooks/use-read-state';

export function TweetCardTracked({ tweet, ownerHandle, isRead, onMarkUnread }: {
  tweet: XTweet; ownerHandle: string; isRead: boolean; onMarkUnread: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const markRead = useMarkRead();
  const id = `tweet-${tweet.tweet_id}`;

  useEffect(() => {
    if (isRead) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        markRead.mutate(id);
        observer.disconnect();
      }
    }, { threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isRead]);

  return (
    <div ref={ref}>
      <TweetCard tweet={tweet} ownerHandle={ownerHandle} unread={!isRead} onMarkUnread={onMarkUnread} />
    </div>
  );
}
