import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TweetCard } from './tweet-card';
import type { XTweet } from '@/lib/api';

const base: XTweet = {
  tweet_id: '1', url: 'https://x.com/trq212/status/1', text: 'hello', timestamp: '2026-08-11T19:21:00.000Z',
  author_handle: '@trq212', type: 'post', reply_to_handle: null, quoted_author: null, quoted_text: null,
  quoted_timestamp: null, translated: null,
};

describe('TweetCard', () => {
  it('renders a plain card for type=post', () => {
    render(<TweetCard tweet={base} ownerHandle="trq212" />);
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('@trq212')).toBeInTheDocument();
  });

  it('shows the reply target inside the card for type=reply', () => {
    const tweet: XTweet = { ...base, type: 'reply', reply_to_handle: '@openai', text: 'replying' };
    render(<TweetCard tweet={tweet} ownerHandle="trq212" />);
    expect(screen.getByText(/回复 @openai/)).toBeInTheDocument();
    expect(screen.getByText('replying')).toBeInTheDocument();
  });

  it('nests the quoted tweet inside the main card for type=quote', () => {
    const tweet: XTweet = {
      ...base, type: 'quote', text: 'everything truly is code',
      quoted_author: '@mannay', quoted_text: 'draw faces with js', quoted_timestamp: '2026-08-12T12:50:00.000Z',
    };
    render(<TweetCard tweet={tweet} ownerHandle="trq212" />);
    expect(screen.getByText('everything truly is code')).toBeInTheDocument();
    expect(screen.getByText('@mannay')).toBeInTheDocument();
    expect(screen.getByText('draw faces with js')).toBeInTheDocument();
  });

  it('attributes repost content to the original author, not the owner handle', () => {
    const tweet: XTweet = { ...base, type: 'repost', author_handle: '@lydiahallie', text: 'original content' };
    render(<TweetCard tweet={tweet} ownerHandle="trq212" />);
    expect(screen.getByText(/trq212 转推了/)).toBeInTheDocument();
    expect(screen.getByText('@lydiahallie')).toBeInTheDocument();
    expect(screen.getByText('original content')).toBeInTheDocument();
    expect(screen.queryByText('@trq212')).toBeNull();
  });

  it('renders translated text alongside the original when present', () => {
    const tweet: XTweet = { ...base, translated: '你好' };
    render(<TweetCard tweet={tweet} ownerHandle="trq212" />);
    expect(screen.getByText('你好')).toBeInTheDocument();
  });

  it('omits the translated block when translated is null', () => {
    render(<TweetCard tweet={base} ownerHandle="trq212" />);
    expect(screen.queryByText('你好')).toBeNull();
  });

  it('falls back to post rendering for an unrecognized type', () => {
    const tweet = { ...base, type: 'boost' } as XTweet;
    render(<TweetCard tweet={tweet} ownerHandle="trq212" />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders the source link', () => {
    render(<TweetCard tweet={base} ownerHandle="trq212" />);
    expect(screen.getByRole('link', { name: /在 X 上查看/ })).toHaveAttribute('href', base.url);
  });

  it('shows an unread dot and no unmark control when unread', () => {
    const { container } = render(<TweetCard tweet={base} ownerHandle="trq212" unread onMarkUnread={() => {}} />);
    expect(container.querySelector('[aria-label="未读"]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '标记未读' })).toBeNull();
  });

  it('shows a mark-unread button instead of a dot when read', () => {
    const onMarkUnread = () => {};
    const { container } = render(<TweetCard tweet={base} ownerHandle="trq212" unread={false} onMarkUnread={onMarkUnread} />);
    expect(container.querySelector('[aria-label="未读"]')).toBeNull();
    expect(screen.getByRole('button', { name: '标记未读' })).toBeInTheDocument();
  });

  it('renders no read-state control when neither prop is passed', () => {
    const { container } = render(<TweetCard tweet={base} ownerHandle="trq212" />);
    expect(container.querySelector('[aria-label="未读"]')).toBeNull();
    expect(screen.queryByRole('button', { name: '标记未读' })).toBeNull();
  });
});
