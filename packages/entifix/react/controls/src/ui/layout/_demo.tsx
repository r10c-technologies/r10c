import type { ReactNode } from 'react';

// Shared visual filler for layout stories — not exported from the package.
export function DemoBox({
  children,
  tone = 'primary',
}: {
  children?: ReactNode;
  tone?: 'primary' | 'surface';
}) {
  const cls =
    tone === 'primary'
      ? 'bg-primary text-primary-content'
      : 'border border-border bg-surface-elevated text-content';
  return (
    <div className={`rounded-md p-s text-center text-step-sm ${cls}`}>
      {children ?? 'Item'}
    </div>
  );
}
