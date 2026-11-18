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
  fetch(
    `${orderServiceUrl()}/checkout-group/${encodeURIComponent(
      groupId,
    )}/buyer-receipt`,
    { headers: { 'x-cancel-nonce': nonce }, cache: 'no-store' },
  )
    .then(async response =>
      response.ok ? ((await response.json()) as unknown) : undefined,
    )
    .catch(() => undefined);
