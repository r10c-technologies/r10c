'use server';

import { cookies } from 'next/headers';

import { CANCEL_COOKIE } from './cancel-ticket';
import { readCancelTicket } from './cancel-ticket-cookie';
import { realtimeServiceUrl } from './checkout-config';
import { settleDecision } from './settle-decision';

/**
 * Settle a cancellation the receipt heard end: verify, server side, how the
 * flow really ended — by its capability against realtime-service's
 * flow-status, never by trusting the browser — then drop the ticket. The
 * receipt shows the order cancelled because order-service says so on its next
 * read; a failed flow lets the buyer ask again. Idempotent: a ticket already
 * settled is gone.
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
  return decided === 'failed' ? 'failed' : 'settled';
}
