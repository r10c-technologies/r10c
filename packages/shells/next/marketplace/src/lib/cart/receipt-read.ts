import { orderServiceUrl } from './checkout-config';

/**
 * The checkout group and its vendor orders, read back from order-service by
 * the buyer's capability (`GET /api/checkout-group/:id/buyer-receipt`, nonce
 * in `x-cancel-nonce`, ADR 0053) — or `undefined` when nothing answered.
 *
 * Read once when a checkout settles, to write the receipt cookie, and on every
 * render of the receipt for what the cookie never keeps: the delivery and the
 * names each line was sold under (ADR 0076 §1, #582). Never cached: it holds
 * the buyer's personal data.
 */
export const readBuyerReceipt = (
  groupId: string,
  nonce: string,
): Promise<unknown> =>
  readBuyerReceiptAnswer(groupId, nonce).then(answer =>
    answer.kind === 'read' ? answer.body : undefined,
  );

/**
 * What order-service answered a receipt read: the body, a refusal of the
 * capability (`401` — the nonce no longer opens this group, because an access
 * link re-keyed it elsewhere, ADR 0076 §6), or no answer at all.
 */
export type BuyerReceiptAnswer =
  | { readonly kind: 'read'; readonly body: unknown }
  | { readonly kind: 'refused' }
  | { readonly kind: 'failed' };

export const readBuyerReceiptAnswer = (
  groupId: string,
  nonce: string,
): Promise<BuyerReceiptAnswer> =>
  fetch(
    `${orderServiceUrl()}/checkout-group/${encodeURIComponent(
      groupId,
    )}/buyer-receipt`,
    { headers: { 'x-cancel-nonce': nonce }, cache: 'no-store' },
  )
    .then(async (response): Promise<BuyerReceiptAnswer> => {
      if (response.ok) {
        return { kind: 'read', body: (await response.json()) as unknown };
      }
      return response.status === 401 ? { kind: 'refused' } : { kind: 'failed' };
    })
    .catch((): BuyerReceiptAnswer => ({ kind: 'failed' }));
