import { cookies } from 'next/headers';

import {
  parseTicket,
  RECEIPT_COOKIE,
  type ReceiptTicket,
} from './receipt-state';

/**
 * The receipt ticket this request carries, if it still has one.
 *
 * Server-only, because `cookies()` is — and unlike the cart's, this cookie is
 * `httpOnly`, so the server is the only side that can read it at all. Nothing
 * in the browser needs it: the receipt page is rendered, not hydrated from a
 * client-side store.
 *
 * `undefined` covers every way there can be no receipt — never checked out,
 * expired, another browser, a cleared jar — and the page renders one expired
 * state for all of them. Distinguishing them would need a record of the visit,
 * which is the buyer identity this whole arrangement exists to avoid demanding.
 */
export async function readReceiptTicket(): Promise<ReceiptTicket | undefined> {
  return parseTicket((await cookies()).get(RECEIPT_COOKIE)?.value);
}
