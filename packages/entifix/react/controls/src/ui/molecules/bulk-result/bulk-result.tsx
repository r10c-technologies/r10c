'use client';

import {
  type BulkOutcome,
  type EntityId,
  failedIds,
  succeededCount,
} from '@r10c/entifix-ts-core';

import { useT, useTranslateKey } from '../../../i18n';
import { Button } from '../../atoms/button';
import { cn } from '../../utils/cn';

export interface BulkResultProps {
  outcomes: readonly BulkOutcome[];
  /**
   * How a failed row is named to the user. An id is not an answer to "which
   * ones failed" — the caller holds the rows and can render the same label the
   * table shows. Falls back to the id when the row is no longer on the page.
   */
  labelFor?: (id: EntityId) => string | undefined;
  /** Re-runs the failures **only**. Absent hides the affordance. */
  onRetryFailed?: (ids: EntityId[]) => void;
  onDismiss: () => void;
  busy?: boolean;
  className?: string;
}

/**
 * What a bulk action actually did, per row.
 *
 * The requirement this exists for: 40 selected, 3 fail. A single notice lies
 * whichever way it is written — as a failure it hides the 37 rows that were
 * written, and as a success it hides the 3 that were not, which is worse
 * because the user walks away believing the work is done. So both counts are
 * always stated, and every failure is named with its own reason.
 *
 * `role="status"`, not `role="alert"`: a partial failure is an outcome to read,
 * not an interruption, and `alert` on a list this long is hostile. The region
 * is `tabIndex={-1}` so the caller can move focus to it once the run ends,
 * which is the only reliable way a keyboard user learns the result arrived.
 */
export function BulkResult({
  outcomes,
  labelFor,
  onRetryFailed,
  onDismiss,
  busy = false,
  className,
}: BulkResultProps) {
  const t = useT();
  const translateKey = useTranslateKey();

  const failed = outcomes.filter(outcome => !outcome.ok);
  const succeeded = succeededCount(outcomes);

  return (
    <div
      role="status"
      tabIndex={-1}
      aria-label={t('bulk.resultLabel')}
      data-testid="bulk-result"
      className={cn(
        'flex flex-col gap-2xs rounded-lg border border-border bg-surface-elevated px-s py-2xs',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2xs">
        <span className="text-step-sm text-content">
          {t('bulk.succeeded', { count: succeeded })}
        </span>
        {failed.length > 0 && (
          <span className="text-step-sm text-danger">
            {t('bulk.failed', { count: failed.length })}
          </span>
        )}
        {failed.length > 0 && onRetryFailed && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => onRetryFailed(failedIds(outcomes))}
          >
            {t('bulk.retryFailed')}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onDismiss}
        >
          {t('bulk.dismiss')}
        </Button>
      </div>

      {failed.length > 0 && (
        <ul className="flex flex-col gap-3xs">
          {failed.map(outcome => (
            <li
              key={String(outcome.id)}
              className="text-step-sm text-content-muted"
            >
              <span className="text-content">
                {labelFor?.(outcome.id) ?? String(outcome.id)}
              </span>
              {' — '}
              {/* The reason is a *code*, resolved through the shared `errors`
                  catalog — the same vocabulary a service's `{ error, code }`
                  body is rendered from, so a new failure reason is
                  translatable rather than English, and `@r10c/i18n-check`
                  fails the build on one the catalog lacks. `unexpected` is the
                  browser-side fallback the catalog already carries. */}
              {translateKey(`errors:${outcome.code ?? 'unexpected'}`)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
