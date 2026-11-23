'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { storePaths } from '../routing/paths';
import { CART_COOKIE } from './cart-state';
import { realtimeServiceUrl } from './checkout-config';
import { FLOW_COOKIE } from './flow-ticket';
import { readFlowTicket } from './flow-ticket-cookie';
import { readReceiptTicket } from './receipt-cookie';
import { readReceipt, writeReceiptCookie } from './receipt-write';
import { settleDecision } from './settle-decision';

/**
 * Settle a checkout the order-status page heard confirmed: verify, server
 * side, that the flow really completed — by its capability against
 * realtime-service's flow-status, never by trusting the browser — then read the
 * checkout group back by its cancel nonce, write the receipt's ticket, and
 * clear the cart. Idempotent: a receipt already written for this group is the answer
 * (ADR 0073).
 *
 * The group's id is the flow's, so the flow id is all it needs to find it.
 */
export async function settleCheckout(
  flowId: string,
): Promise<'settled' | 'pending' | 'failed'> {
  if ((await readReceiptTicket())?.groupId === flowId) return 'settled';
  const ticket = await readFlowTicket();
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
  if (decided !== 'completed') return decided;

  const read = await readReceipt({
    groupId: flowId,
    cancelNonce: ticket.cancelNonce,
  });
  if (read.kind !== 'read') return 'pending';

  await writeReceiptCookie(read.receipt);
  const jar = await cookies();
  jar.set(CART_COOKIE, '', { path: '/', maxAge: 0 });
  jar.set(FLOW_COOKIE, '', { path: '/', maxAge: 0 });
  return 'settled';
}

/**
 * The order-status page's button for a browser without script (#725): the
 * island that waits on the stream never runs there, so the buyer asks. Settles
 * as the island would, then answers with the page the outcome leads to — the
 * receipt, the same wait, or the cart a failed checkout left.
 */
export async function refreshCheckout(formData: FormData): Promise<never> {
  const locale = String(formData.get('locale') ?? '');
  const flowId = String(formData.get('flowId') ?? '');
  const outcome = await settleCheckout(flowId);
  redirect(
    `/${locale}${
      outcome === 'failed'
        ? storePaths.cart({ checkout: 'failed' })
        : storePaths.orderStatus(flowId)
    }`,
  );
}
