import { orderServiceUrl } from './checkout-config';
import { readReceiptTicket } from './receipt-cookie';

/** The headers a receipt file is passed on with: the service's, no others. */
const PASSED = [
  'content-type',
  'content-disposition',
  'content-security-policy',
  'x-content-type-options',
  'cache-control',
] as const;

/**
 * A receipt file read back for its buyer through the storefront's own origin
 * (ADR 0081 §7): the nonce stays in the `httpOnly` receipt cookie and goes to
 * order-service as a header, so no address the browser holds can open a file.
 * Answers `404` alike for no receipt, an order it does not name, and any
 * refusal: which one it was is nothing a stranger should learn.
 */
export async function receiptEvidenceResponse(
  orderId: string,
  evidenceId: string,
): Promise<Response> {
  const notFound = () =>
    new Response(null, {
      status: 404,
      headers: { 'cache-control': 'no-store' },
    });
  // An order the nonce does not open is refused by order-service, which
  // compares it with the digest the group holds, and answers the same 404.
  const receipt = await readReceiptTicket();
  if (receipt === undefined) return notFound();

  const upstream = await fetch(
    `${orderServiceUrl()}/product-order/${encodeURIComponent(
      orderId,
    )}/buyer-payment-evidence/${encodeURIComponent(evidenceId)}`,
    { headers: { 'x-cancel-nonce': receipt.cancelNonce }, cache: 'no-store' },
  ).catch(() => undefined);
  if (upstream?.ok !== true) return notFound();

  const headers = new Headers();
  for (const name of PASSED) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(await upstream.arrayBuffer(), { status: 200, headers });
}
