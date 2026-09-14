'use client';

import { Button, cn, useT } from '@r10c/entifix-react-controls/primitives';
import type { PendingEntry } from '@r10c/entifix-transactions';

export interface PendingNoticeProps {
  /** This entity's in-flight and failed writes, newest last. */
  entries: readonly PendingEntry[];
  /** Retires a failure the operator has read. */
  onDismiss: (transactionId: string) => void;
  className?: string;
}

/**
 * What became of the writes this browser started but the server has not
 * finished.
 *
 * ⚠️ **This is the list's surface because the tab strip cannot be.** Only
 * creates are transactional (`create: 'command'` fires on `isCreate` alone), and
 * a create has no workspace tab — `EntityEditorTab` takes a required id, so
 * `master:<key>` is the list and there is no address for a record that does not
 * exist yet. A badge keyed on a pending record id would therefore be unreachable
 * by construction, which is exactly the "declared, styled, never produced"
 * defect ADR 0043 was written about. It renders here instead, where
 * `afterSave()` actually puts the operator.
 *
 * `role="status"`, not `role="alert"` — the `BulkResult` reasoning: an outcome
 * to read, not an interruption.
 *
 * The failure headline is a catalog key and never `entry.reason`, which is free
 * text from whatever threw, in whatever language that code was written in. The
 * reason is kept as secondary, explicitly-unlocalized detail; a translatable
 * failure needs an error *code* on the event, which is ADR 0043's residual.
 */
export function PendingNotice({
  entries,
  onDismiss,
  className,
}: PendingNoticeProps) {
  // The `shell` namespace: this copy lives in `shell.ts`, and `useT()` with no
  // argument reads `controls` — which resolves nothing and renders the key.
  const t = useT('shell');

  const saving = entries.filter(entry => entry.state === 'pending');
  const failed = entries.filter(entry => entry.state === 'failed');

  if (saving.length === 0 && failed.length === 0) return null;

  return (
    <div
      role="status"
      aria-label={t('workspace.pendingLabel')}
      data-testid="pending-notice"
      className={cn(
        'flex flex-col gap-2xs rounded-lg border border-border bg-surface-elevated px-s py-2xs',
        className,
      )}
    >
      {saving.length > 0 && (
        <span className="text-step-sm text-content-muted">
          {t('workspace.savePending', { count: saving.length })}
        </span>
      )}

      {failed.map(entry => (
        <div
          key={entry.transactionId}
          className="flex flex-wrap items-center gap-2xs"
        >
          <span className="text-step-sm text-danger">
            {t('workspace.saveFailed')}
          </span>
          {entry.reason !== undefined && (
            // Untranslated on purpose, and marked as such: it is a server
            // exception string, shown because a reason nobody can read is worse
            // than one in the wrong language.
            <span
              lang="und"
              className="text-step-sm text-content-muted"
              data-testid="pending-notice-reason"
            >
              {entry.reason}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onDismiss(entry.transactionId)}
          >
            {t('workspace.saveFailedDismiss')}
          </Button>
        </div>
      ))}
    </div>
  );
}
