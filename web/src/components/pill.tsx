import type { ReactNode } from 'react';

type PillVariant = 'default' | 'tag' | 'more';

const VARIANT_STYLES: Record<PillVariant, { background: string; color: string }> = {
  default: { background: 'var(--bg-elevated)', color: 'var(--text-secondary)' },
  tag:     { background: 'var(--accent-3)',    color: 'var(--accent-11)' },
  more:    { background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' },
};

export function Pill({
  children,
  variant = 'default',
  title,
}: {
  children: ReactNode;
  variant?: PillVariant;
  title?: string;
}) {
  return (
    <span
      className="inline-flex items-center text-[11px] px-2 py-0.5 rounded whitespace-nowrap"
      style={VARIANT_STYLES[variant]}
      title={title}
    >
      {children}
    </span>
  );
}
