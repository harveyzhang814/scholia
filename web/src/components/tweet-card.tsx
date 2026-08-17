import type { ReactNode } from 'react';
import type { XTweet } from '@/lib/api';

function initials(handle: string): string {
  return handle.replace(/^@/, '').slice(0, 2).toUpperCase();
}

function formatTweetTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Avatar({ handle, small }: { handle: string; small?: boolean }) {
  const size = small ? 20 : 26;
  return (
    <span
      className="rounded-full flex items-center justify-center font-semibold flex-shrink-0"
      style={{ width: size, height: size, background: 'var(--accent-3)', color: 'var(--accent-11)', fontSize: small ? 9.5 : 11 }}
    >
      {initials(handle)}
    </span>
  );
}

function TweetHead({ handle, time, small }: { handle: string; time: string; small?: boolean }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Avatar handle={handle} small={small} />
      <span className={small ? 'text-[12.5px] font-semibold' : 'text-[13.5px] font-semibold'} style={{ color: 'var(--text-primary)' }}>{handle}</span>
      <span className="ml-auto text-[11.5px] flex-shrink-0" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{formatTweetTime(time)}</span>
    </div>
  );
}

function TweetBody({ text, translated }: { text: string; translated: string | null }) {
  return (
    <>
      <p className="text-sm" style={{ lineHeight: 1.7, color: 'var(--text-primary)', margin: 0 }}>{text}</p>
      {translated && (
        <p className="text-[13px] mt-2 pt-2" style={{ lineHeight: 1.7, color: 'var(--text-secondary)', borderTop: '1px dashed var(--border-subtle)' }}>
          {translated}
        </p>
      )}
    </>
  );
}

function TweetLink({ url }: { url: string }) {
  return (
    <div className="mt-2.5 flex justify-end">
      <a href={url} target="_blank" rel="noreferrer" className="text-[11.5px]" style={{ color: 'var(--text-tertiary)' }}>
        在 X 上查看 ↗
      </a>
    </div>
  );
}

function BaseCard({ handle, time, text, translated, url, extraTop }: {
  handle: string; time: string; text: string; translated: string | null; url: string; extraTop?: ReactNode;
}) {
  return (
    <div className="rounded-xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', padding: '16px 18px' }}>
      {extraTop}
      <TweetHead handle={handle} time={time} />
      <TweetBody text={text} translated={translated} />
      <TweetLink url={url} />
    </div>
  );
}

export function TweetCard({ tweet, ownerHandle }: { tweet: XTweet; ownerHandle: string }) {
  const type = tweet.type === 'reply' || tweet.type === 'quote' || tweet.type === 'repost' ? tweet.type : 'post';

  if (type === 'reply') {
    return (
      <BaseCard
        handle={tweet.author_handle}
        time={tweet.timestamp}
        text={tweet.text}
        translated={tweet.translated}
        url={tweet.url}
        extraTop={
          <div className="flex items-center gap-1.5 text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
            <span>↩</span>回复 {tweet.reply_to_handle}
          </div>
        }
      />
    );
  }

  if (type === 'quote') {
    return (
      <div className="rounded-xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)', padding: '16px 18px' }}>
        <TweetHead handle={tweet.author_handle} time={tweet.timestamp} />
        <TweetBody text={tweet.text} translated={tweet.translated} />
        <div className="mt-2.5 rounded-r-lg" style={{ padding: '10px 12px', borderLeft: '2px solid var(--border-strong)', background: 'var(--bg-elevated)' }}>
          <TweetHead handle={tweet.quoted_author ?? ''} time={tweet.quoted_timestamp ?? ''} small />
          <p className="text-[13px]" style={{ color: 'var(--text-secondary)', margin: 0 }}>{tweet.quoted_text}</p>
        </div>
        <TweetLink url={tweet.url} />
      </div>
    );
  }

  if (type === 'repost') {
    return (
      <div className="rounded-xl border" style={{ padding: 10, background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-tertiary)', margin: '0 0 8px 4px' }}>
          <span>↻</span>@{ownerHandle} 转推了
        </div>
        <BaseCard handle={tweet.author_handle} time={tweet.timestamp} text={tweet.text} translated={tweet.translated} url={tweet.url} />
      </div>
    );
  }

  return <BaseCard handle={tweet.author_handle} time={tweet.timestamp} text={tweet.text} translated={tweet.translated} url={tweet.url} />;
}
