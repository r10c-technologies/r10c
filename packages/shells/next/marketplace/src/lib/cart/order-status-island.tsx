'use client';

import { Button, Stack, Text } from '@entifix/react-controls/primitives';
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
  /** The settle server action: verifies, writes the receipt, clears the cart. */
  readonly settle: (
    flowId: string,
  ) => Promise<'settled' | 'pending' | 'failed'>;
  /** The retry form's server action — the checkout, under the same key. */
  readonly retry: (formData: FormData) => void | Promise<void>;
  readonly readStatus: FlowStatusRead;
}

const ENDED_BADLY = new Set(['failed', 'compensated', 'interrupted']);

/**
 * A buyer waiting on their checkout. It settles by push — the pending-flow
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
  readStatus,
}: OrderStatusIslandProps) {
  const router = useRouter();
  const store = usePendingFlowStore();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const completed = () => {
      void settle(flowId).then(result => {
        if (!live) return;
        if (result === 'settled') router.refresh();
        if (result === 'failed') setFailed(true);
      });
    };
    const release = holdCapability(capability);
    store?.add({ flowId });
    const off = store?.onSettled(flowId, outcome => {
      if (outcome.kind === 'confirmed') completed();
      else setFailed(true);
    });
    void Effect.runPromise(readStatus(statusHref)).then(
      body => {
        if (!live || body === undefined) return;
        if (body.state === 'completed') completed();
        else if (ENDED_BADLY.has(body.state)) setFailed(true);
      },
      () => undefined,
    );
    return () => {
      live = false;
      off?.();
      release();
    };
  }, [flowId, capability, statusHref, settle, store, readStatus, router]);

  return failed ? (
    <Stack gap="s" align="start">
      <Text data-testid="order-failed">{labels.failed}</Text>
      {/* The same `Idempotency-Key` the first attempt used: a retried checkout
          is that flow again, never a second one. The cart was never touched. */}
      <form action={retry}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="retry" value="1" />
        <Button type="submit" data-testid="order-retry">
          {labels.retry}
        </Button>
      </form>
    </Stack>
  ) : (
    <Text data-testid="order-pending">{labels.pending}</Text>
  );
}
