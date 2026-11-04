'use server';

import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import { loadVendors } from '@r10c/implementation-marketplace-vendor-next';
import { cookies } from 'next/headers';

import { runRead } from '../catalog/catalog-reads';
import { CART_COOKIE } from './cart-state';
import { orderServiceUrl, realtimeServiceUrl } from './checkout-config';
import { FLOW_COOKIE } from './flow-ticket';
import { readFlowTicket } from './flow-ticket-cookie';
import { readReceipt } from './receipt-cookie';
import {
  RECEIPT_COOKIE,
  RECEIPT_TTL_SECONDS,
  receiptFromReadBack,
  serializeReceipt,
} from './receipt-state';
import { settleDecision } from './settle-decision';

/**
 * Settle a checkout the order-status page heard confirmed: verify, server
 * side, that the flow really completed — by its capability against
 * realtime-service's flow-status, never by trusting the browser — then read the
 * checkout group back by its cancel nonce, write the group receipt, and clear
 * the cart. Idempotent: a receipt already written for this group is the answer
 * (ADR 0073).
 *
 * The group's id is the flow's, so the flow id is all it needs to find it.
 */
export async function settleCheckout(
  flowId: string,
): Promise<'settled' | 'pending' | 'failed'> {
  if ((await readReceipt())?.groupId === flowId) return 'settled';
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

  const readBack = await fetch(
    `${orderServiceUrl()}/checkout-group/${encodeURIComponent(
      flowId,
    )}/buyer-receipt`,
    { headers: { 'x-cancel-nonce': ticket.cancelNonce }, cache: 'no-store' },
  )
    .then(async response =>
      response.ok ? ((await response.json()) as unknown) : undefined,
    )
    .catch(() => undefined);
  const vendors = await runRead(PublishedVendor, loadVendors(), []);
  const receipt = receiptFromReadBack(
    readBack,
    ticket.cancelNonce,
    new Map(vendors.map(vendor => [vendor.vendorId, vendor.displayName])),
  );
  if (receipt === undefined) return 'pending';

  const jar = await cookies();
  jar.set(RECEIPT_COOKIE, serializeReceipt(receipt), {
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: RECEIPT_TTL_SECONDS,
  });
  jar.set(CART_COOKIE, '', { path: '/', maxAge: 0 });
  jar.set(FLOW_COOKIE, '', { path: '/', maxAge: 0 });
  return 'settled';
}
