'use server';

import { cookies } from 'next/headers';

import { CANCEL_COOKIE } from './cancel-ticket';
import { readCancelTicket } from './cancel-ticket-cookie';
import { realtimeServiceUrl } from './checkout-config';
import { readReceipt } from './receipt-cookie';
import {
  RECEIPT_COOKIE,
  RECEIPT_TTL_SECONDS,
  serializeReceipt,
  withCancelled,
} from './receipt-state';
import { settleDecision } from './settle-decision';

/**
 * Settle a cancellation the receipt heard end: verify, server side, how the
 * flow really ended — by its capability against realtime-service's
 * flow-status, never by trusting the browser — then mark that vendor order
 * cancelled on the receipt, or drop the ticket so the buyer can ask again.
 * Idempotent: a ticket already settled is gone.
 */
export async function settleCancellation(
  flowId: string,
): Promise<'settled' | 'pending' | 'failed'> {
  const ticket = await readCancelTicket();
  if (ticket?.flowId !== flowId) return 'failed';

  const status = await fetch(
    `${realtimeServiceUrl()}/realtime/flow/${encodeURIComponent(
      flowId,
    )}?capability=${encodeURIComponent(ticket.capability)}`,
    { cache: 'no-store' },
  )
    .then(async response =>
      response.ok ? ((await response.json()) as unknown) : undefined,
    )
    .catch(() => undefined);
  const decided = settleDecision(status);
  if (decided === 'pending') return 'pending';

  const jar = await cookies();
  jar.set(CANCEL_COOKIE, '', { path: '/', maxAge: 0 });
  if (decided === 'failed') return 'failed';

  const receipt = await readReceipt();
  if (receipt !== undefined) {
    jar.set(
      RECEIPT_COOKIE,
      serializeReceipt(withCancelled(receipt, ticket.orderId)),
      {
        path: '/',
        sameSite: 'lax',
        httpOnly: true,
        maxAge: RECEIPT_TTL_SECONDS,
      },
    );
  }
  return 'settled';
}
