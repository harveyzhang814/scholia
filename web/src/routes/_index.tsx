import { useState, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTasks } from '@/hooks/use-tasks';
import { TaskCard } from '@/components/task-card';
import { api, type Article } from '@/lib/api';

function useArticles() {
  return useQuery({
    queryKey: ['articles'],
    queryFn: () => api.listArticles(),
    staleTime: 60_000,
  });
}

export default function Home() {
  const [tab, setTab] = useState<'video' | 'article'>('video');
  const { data: tasks = [], isLoading: tasksLoading } = useTasks();
  const { data: articles = [], isLoading: articlesLoading } = useArticles();
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredTasks = tasks.filter((t) => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return (t.title ?? '').toLowerCase().includes(q) || t.url.toLowerCase().includes(q);
  });

  const filteredArticles = articles.filter((a) => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return a.title.toLowerCase().includes(q) || a.slug.includes(q);
  });

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      inputRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const isLoading = tab === 'video' ? tasksLoading : articlesLoading;

  return (
    <div className="px-8 pt-16 pb-24">
      {/* Header */}
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold tracking-tight">Scholia</h1>
        <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
             style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setSearchQuery(''); inputRef.current?.blur(); } }}
            placeholder="搜索…"
            className="text-sm bg-transparent outline-none w-40"
            style={{ color: 'var(--text-primary)' }}
          />
          <kbd className="text-[11px] px-1.5 py-0.5 rounded border flex-shrink-0"
               style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)',
                        color: 'var(--text-tertiary)' }}>
            ⌘K
          </kbd>
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex border-b mb-8 -ml-3" style={{ borderColor: 'var(--border-subtle)' }}>
        {(['video', 'article'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3 py-2.5 text-sm border-b-2 transition-colors cursor-pointer"
            style={{
              borderColor: tab === t ? 'var(--accent-9)' : 'transparent',
              color: tab === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
              fontWeight: tab === t ? 500 : 400,
            }}
          >
            {t === 'video' ? '视频' : '文章'}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>加载中…</div>
      ) : tab === 'video' ? (
        tasks.length === 0 ? (
          <div className="text-sm py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>
            暂无视频<br />
            配置视频目录：<code style={{ color: 'var(--accent-11)', fontFamily: 'var(--font-mono)' }}>scholia config set work-dir ~/vdl-work</code>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="text-sm py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>无匹配结果</div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 480px))' }}>
            {filteredTasks.map((t) => <TaskCard key={t.id} task={t} />)}
          </div>
        )
      ) : (
        articles.length === 0 ? (
          <div className="text-sm py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>
            暂无文章<br />
            配置文章目录：<code style={{ color: 'var(--accent-11)', fontFamily: 'var(--font-mono)' }}>scholia config set content-dir ~/notes</code>
          </div>
        ) : filteredArticles.length === 0 ? (
          <div className="text-sm py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>无匹配结果</div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 480px))' }}>
            {filteredArticles.map((a) => <ArticleCard key={a.id} article={a} />)}
          </div>
        )
      )}
    </div>
  );
}

function ArticleCard({ article }: { article: Article }) {
  return (
    <Link
      to={`/tasks/${article.id}`}
      className="block rounded-xl border p-4 hover:opacity-80 transition-opacity"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
    >
      <div className="text-sm font-medium mb-1 line-clamp-2" style={{ color: 'var(--text-primary)' }}>
        {article.title}
      </div>
      {article.date && (
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{article.date}</div>
      )}
      <div className="text-xs mt-1 truncate" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
        {article.slug}
      </div>
    </Link>
  );
}
