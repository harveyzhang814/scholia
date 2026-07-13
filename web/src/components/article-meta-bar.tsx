function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ArticleMetaBar({ frontmatter }: { frontmatter?: Record<string, unknown> }) {
  const entries = Object.entries(frontmatter ?? {}).filter(([k]) => k !== 'title');
  if (entries.length === 0) return null;

  const scalarEntries = entries.filter(([, v]) => !Array.isArray(v));
  const arrayEntries = entries.filter(([, v]) => Array.isArray(v)) as [string, unknown[]][];

  return (
    <div className="px-12 py-3 text-xs border-b" style={{ borderColor: 'var(--border-subtle)' }}>
      {scalarEntries.length > 0 && (
        <div
          className="grid gap-x-6 gap-y-2"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}
        >
          {scalarEntries.map(([key, value]) => (
            <div key={key} className="min-w-0">
              <div className="mb-0.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', opacity: 0.7 }}>
                {humanizeKey(key)}
              </div>
              <div style={{ color: 'var(--text-secondary)' }}>{String(value)}</div>
            </div>
          ))}
        </div>
      )}

      {arrayEntries.map(([key, value]) => (
        <div key={key} className="mt-2">
          <div className="mb-0.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', opacity: 0.7 }}>
            {humanizeKey(key)}
          </div>
          <div className="flex flex-wrap gap-1">
            {value.map((item, i) => (
              <span
                key={i}
                className="px-1.5 py-0.5 rounded"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
              >
                {String(item)}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
