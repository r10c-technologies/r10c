'use client';

import { recordTopic } from '@entifix/react-integration';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { holdCapability } from './flow-capabilities';
import { useStorefrontPushChannel } from './push-channel-context';

export interface ReceiptWatchProps {
  /**
   * The receipt's nonce, from the `httpOnly` cookie — a prop, never storage,
   * as a checkout's flow capability is. The stream admits it by the digest its
   * group keeps, which every order event carries (ADR 0081 §11).
   */
  readonly capability: string;
  /** The orders on this receipt, whose changes re-render it. */
  readonly orderIds: readonly string[];
}

/**
 * Keeps an open receipt current: a dispatch or a delivery on one of its
 * orders reaches this tab as a hint on the order's record topic, and the page
 * re-renders from a fresh read. Renders nothing — without script the page is
 * the same, one reload behind.
 */
export function ReceiptWatch({ capability, orderIds }: ReceiptWatchProps) {
  const router = useRouter();
  const channel = useStorefrontPushChannel();
  const key = orderIds.join(',');

  useEffect(() => {
    const release = holdCapability(capability);
    const refresh = () => {
      router.refresh();
    };
    const offs = key
      .split(',')
      .map(orderId =>
        channel.subscribe(recordTopic('product-order', orderId), refresh),
      );
    // A change missed while the stream was down is read again, not lost.
    const offResync = channel.onResync(refresh);
    return () => {
      for (const off of offs) off();
      offResync();
      release();
    };
  }, [capability, key, channel, router]);

  return null;
}
