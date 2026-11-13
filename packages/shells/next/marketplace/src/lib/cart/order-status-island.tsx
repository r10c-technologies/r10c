'use client';

import { Alert, SubmitButton } from '@entifix/react-controls/primitives';
import {
  type FlowStatusRead,
  usePendingFlowStore,
} from '@entifix/react-integration';
import { Effect } from 'effect';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { holdCapability } from './flow-capabilities';

/** The page's copy, translated on the server and handed down. */
export interface OrderStatusLabels {
  readonly pending: string;
  readonly failed: string;
  readonly retry: string;
}

export interface OrderStatusIslandProps {
  readonly flowId: string;
  /** The flow capability, from the `httpOnly` ticket — a prop, never storage. */
  readonly capability: string;
  /** The flow's status link, the capability on its query string. */
  readonly statusHref: string;
  readonly locale: string;
  readonly labels: OrderStatusLabels;
  /** The settle server action: verifies how the flow ended, and records it. */
  readonly settle: (
    flowId: string,
  ) => Promise<'settled' | 'pending' | 'failed'>;
  /**
   * The retry form's server action — the checkout, under the same key. Absent,
   * a failed flow is settled too and the page moves to `failedHref`.
   */
  readonly retry?: (formData: FormData) => void | Promise<void>;
  /** Where a settled flow takes the page; absent, it re-renders in place. */
  readonly settledHref?: string;
  /** Where a failed flow takes the page when there is no retry to offer. */
  readonly failedHref?: string;
  readonly readStatus: FlowStatusRead;
}

const ENDED_BADLY = new Set(['failed', 'compensated', 'interrupted']);

/**
 * A buyer waiting on their checkout, or on a cancellation. It settles by push — the pending-flow
 * store above hears `flow.completed` or `flow.failed` on the flow's topic,
 * admitted by the capability this island holds while it waits — and by its own
 * catch-up read on mount, because an anonymous pending flow is never caught up
 * from flow-status by the store itself (ADR 0073). A completed flow asks the
 * server to settle, and the page re-renders with the receipt.
 */
export function OrderStatusIsland({
  flowId,
  capability,
  statusHref,
  locale,
  labels,
  settle,
  retry,
  settledHref,
  failedHref,
  readStatus,
}: OrderStatusIslandProps) {
  const router = useRouter();
  const store = usePendingFlowStore();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const ended = () => {
      void settle(flowId).then(result => {
        if (!live) return;
        if (result === 'settled') {
          if (settledHref === undefined) router.refresh();
          else router.replace(settledHref);
        }
        if (result === 'failed') {
          if (failedHref === undefined) setFailed(true);
          else router.replace(failedHref);
        }
      });
    };
    // With no retry to offer, a failed flow is settled like a completed one:
    // the server records it and the page moves on.
    const failedFlow = () => {
      if (failedHref === undefined) setFailed(true);
      else ended();
    };
    const release = holdCapability(capability);
    store?.add({ flowId });
    const off = store?.onSettled(flowId, outcome => {
      if (outcome.kind === 'confirmed') ended();
      else failedFlow();
    });
    void Effect.runPromise(readStatus(statusHref)).then(
      body => {
        if (!live || body === undefined) return;
        if (body.state === 'completed') ended();
        else if (ENDED_BADLY.has(body.state)) failedFlow();
      },
      () => undefined,
    );
    return () => {
      live = false;
      off?.();
      release();
    };
  }, [
    flowId,
    capability,
    statusHref,
    settle,
    settledHref,
    failedHref,
    store,
    readStatus,
    router,
  ]);

  // Both are live regions, so the outcome is announced as well as shown
  // (a4-29): waiting is polite, a failure is assertive.
  return failed ? (
    <Alert
      tone="danger"
      data-testid="order-failed"
      action={
        // The same `Idempotency-Key` the first attempt used: a retried
        // checkout is that flow again, never a second one. The cart was
        // never touched.
        retry === undefined ? undefined : (
          <form action={retry}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="retry" value="1" />
            <SubmitButton data-testid="order-retry">
              {labels.retry}
            </SubmitButton>
          </form>
        )
      }
    >
      {labels.failed}
    </Alert>
  ) : (
    <Alert tone="info" data-testid="order-pending">
      {labels.pending}
    </Alert>
  );
}
