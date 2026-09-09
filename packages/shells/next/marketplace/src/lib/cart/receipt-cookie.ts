import { cookies } from 'next/headers';

import { parseReceipt, type Receipt, RECEIPT_COOKIE } from './receipt-state';

/**
 * The receipt this request carries, if it still has one.
 *
 * Server-only, because `cookies()` is — and unlike the cart's, this cookie is
 * `httpOnly`, so the server is the only side that can read it at all. Nothing
 * in the browser needs it: the confirmation page is rendered, not hydrated from
 * a client-side store.
 *
 * `undefined` covers every way there can be no receipt — never checked out,
 * expired, another browser, a cleared jar — and the page renders one expired
 * state for all of them. Distinguishing them would need a record of the visit,
 * which is the buyer identity this whole arrangement exists to avoid demanding.
 */
export async function readReceipt(): Promise<Receipt | undefined> {
  return parseReceipt((await cookies()).get(RECEIPT_COOKIE)?.value);
}
