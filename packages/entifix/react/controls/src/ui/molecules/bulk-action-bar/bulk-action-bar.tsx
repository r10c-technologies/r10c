'use client';

import type { UseCaseDescriptor } from '@r10c/entifix-ts-core';

import { useT, useTranslateKey } from '../../../i18n';
import { Button } from '../../atoms/button';
import { cn } from '../../utils/cn';

export interface BulkActionBarProps {
  /** How many rows the action would touch. */
  count: number;
  /**
   * The collection-bound verbs this caller may run, already filtered against
   * the verified principal by the service. The bar renders what it is given and
   * re-checks nothing — hiding an action protects nothing, the route guard is
   * the enforcement (ADR 0026).
   */
  useCases: readonly UseCaseDescriptor[];
  /**
   * Offered only when the selection is a page's worth of ids *and* more rows
   * match than are shown. Absent means there is no larger set to escalate to.
   *
   * It is a **separate affordance carrying the count**, never a widening of the
   * header checkbox: "select all on this page" and "select all 3.200 matching"
   * are different actions and the second has to be chosen deliberately.
   */
  matchingTotal?: number;
  onSelectAllMatching?: () => void;
  onClear: () => void;
  onUseCase: (key: string) => void;
  /** Disables every verb while one is running. */
  busy?: boolean;
  className?: string;
}

/**
 * The bar that appears once rows are selected: what is selected, what can be
 * done to it, and the way out.
 *
 * It is `aria-live="polite"` on the count rather than on the whole region — a
 * region that re-announces its buttons every time one more row is ticked is
 * noise, and the count is the only part that changed. `role="region"` with a
 * name is what lets a screen-reader user jump to it at all, since it appears
 * without the focus moving.
 */
export function BulkActionBar({
  count,
  useCases,
  matchingTotal,
  onSelectAllMatching,
  onClear,
  onUseCase,
  busy = false,
  className,
}: BulkActionBarProps) {
  const t = useT();
  const translateKey = useTranslateKey();

  return (
    <div
      role="region"
      aria-label={t('bulk.barLabel')}
      data-testid="bulk-action-bar"
      className={cn(
        'flex flex-wrap items-center gap-2xs rounded-lg border border-border bg-surface-elevated px-s py-2xs',
        className,
      )}
    >
      <span aria-live="polite" className="text-step-sm text-content">
        {t('table.selectedCount', { count })}
      </span>

      {matchingTotal !== undefined && onSelectAllMatching && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onSelectAllMatching}
        >
          {t('table.selectAllMatching', { count: matchingTotal })}
        </Button>
      )}

      {useCases.map(descriptor => (
        <Button
          key={descriptor.key}
          type="button"
          variant={
            descriptor.confirm?.tone === 'destructive'
              ? 'destructive'
              : 'secondary'
          }
          size="sm"
          disabled={busy}
          onClick={() => onUseCase(descriptor.key)}
        >
          {/* A descriptor's label is a *runtime* catalog key — the type system
              cannot see a typo here, `@r10c/i18n-check` is what does. */}
          {translateKey(descriptor.labelKey)}
        </Button>
      ))}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={onClear}
      >
        {t('table.clearSelection')}
      </Button>
    </div>
  );
}
