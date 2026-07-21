import type { SortField, SortState } from '@/lib/sort';

interface SortSelectProps {
  value: SortState;
  onChange: (sort: SortState) => void;
  fields: { value: SortField; label: string }[];
}

export function SortSelect({ value, onChange, fields }: SortSelectProps) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg border px-3.5 py-2"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
    >
      <select
        value={value.field}
        onChange={(e) => onChange({ ...value, field: e.target.value as SortField })}
        className="text-sm bg-transparent outline-none cursor-pointer"
        style={{ color: 'var(--text-primary)' }}
        aria-label="排序方式"
      >
        {fields.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onChange({ ...value, direction: value.direction === 'asc' ? 'desc' : 'asc' })}
        className="text-sm pl-1.5 border-l cursor-pointer"
        style={{ color: 'var(--text-tertiary)', borderColor: 'var(--border-subtle)' }}
        title={value.direction === 'asc' ? '升序' : '降序'}
      >
        {value.direction === 'asc' ? '↑' : '↓'}
      </button>
    </div>
  );
}
