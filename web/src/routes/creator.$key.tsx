import { Link, useParams, useNavigate } from 'react-router';
import { useCreator } from '@/hooks/use-creator';
import { Pill } from '@/components/pill';

export default function CreatorDetail() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const goBack = () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/videos');
  };
  const { data: creator, isLoading } = useCreator(key);

  if (isLoading) return <div className="p-8 text-sm" style={{ color: 'var(--text-tertiary)' }}>加载中…</div>;
  if (!creator) return <div className="p-8 text-sm" style={{ color: 'var(--status-err)' }}>未找到该创作者</div>;

  return (
    <div className="h-screen flex flex-col">
      <header className="h-12 flex items-center gap-4 px-5 border-b flex-shrink-0"
              style={{ borderColor: 'var(--border-subtle)' }}>
        <button type="button" onClick={goBack} className="text-sm" style={{ color: 'var(--text-tertiary)' }}>←</button>
        <h1 className="text-sm font-medium">{creator.display_name}</h1>
        <Pill variant={creator.watched ? 'tag' : 'default'}>
          {creator.watched ? '关注中' : '未关注'}
        </Pill>
      </header>
      <div className="flex-1 overflow-y-auto" style={{ background: 'var(--bg-canvas)' }}>
        <div className="mx-auto py-7 pb-10" style={{ maxWidth: 640 }}>
          {creator.uploader_url && (
            <a
              href={creator.uploader_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs mb-4 inline-block"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {creator.uploader_url}
            </a>
          )}
          {creator.videos.length === 0 ? (
            <div className="text-sm py-16 text-center" style={{ color: 'var(--text-tertiary)' }}>暂无深读视频</div>
          ) : (
            <ul className="flex flex-col gap-2">
              {creator.videos.map((v) => (
                <li key={v.task_id}>
                  <Link
                    to={`/tasks/${v.task_id}`}
                    className="block rounded-lg border p-3 text-sm hover:opacity-80 transition-opacity"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="chinese line-clamp-1">{v.title}</div>
                    <div className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{v.upload_date}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
