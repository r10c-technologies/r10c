import { MAX_QUANTITY } from './cart-state';

/**
 * What the cart action that redirected to the cart did to a line, so the page
 * can announce it in a status region: an add (a3-27), or a removal with its
 * way back (a4-6).
 *
 * It rides the query string for the reason the checkout outcome does: the
 * action redirects, and the notice has to survive exactly one navigation. The
 * removed count travels with it because the cookie no longer holds the line,
 * and Undo restores what was there, not one.
 */
export type CartNotice =
  | { readonly kind: 'added'; readonly offeringId: string }
  | {
      readonly kind: 'removed';
      readonly offeringId: string;
      readonly quantity: number;
    };

type Query = Readonly<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined) =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** The query a cart action writes for `notice`. */
export const cartNoticeQuery = (notice: CartNotice): string =>
  notice.kind === 'added'
    ? `added=${encodeURIComponent(notice.offeringId)}`
    : `removed=${encodeURIComponent(notice.offeringId)}&quantity=${notice.quantity}`;

/**
 * Reads a notice back, refusing anything a cart action would not have written:
 * a count outside the cart's bounds names no line anyone removed. Only an id
 * reaches the page, which reads the name itself — never copy from the URL.
 */
export function parseCartNotice(
  query: Query | undefined,
): CartNotice | undefined {
  const added = one(query?.['added']);
  if (added !== undefined) return { kind: 'added', offeringId: added };

  const removed = one(query?.['removed']);
  if (removed === undefined) return undefined;
  const quantity = Number(one(query?.['quantity']));
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= MAX_QUANTITY
    ? { kind: 'removed', offeringId: removed, quantity }
    : undefined;
}
