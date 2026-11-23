import type { CartRefusal } from './cart-quantity';

/**
 * What the cart action that redirected to the cart did to a line, so the page
 * can announce it in a status region: an add (a3-27), a removal with its way
 * back (a4-6), or a quantity the offering does not sell, refused rather than
 * rounded (ADR 0082 §3).
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
    }
  | {
      readonly kind: 'refused';
      readonly offeringId: string;
      readonly refusal: CartRefusal;
    };

/** The refusals a notice may name: the sale refusals' `errors` keys. */
const REFUSALS: readonly CartRefusal[] = [
  'quantityUnreadable',
  'quantityBelowMinimum',
  'quantityOffStep',
  'quantityAboveMaximum',
  'lineBelowOneMinorUnit',
];

const refusalOf = (value: string | undefined): CartRefusal | undefined =>
  REFUSALS.find(refusal => refusal === value);

type Query = Readonly<Record<string, string | readonly string[] | undefined>>;

const one = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/** The query a cart action writes for `notice`. */
export const cartNoticeQuery = (notice: CartNotice): string => {
  const id = encodeURIComponent(notice.offeringId);
  switch (notice.kind) {
    case 'added':
      return `added=${id}`;
    case 'removed':
      return `removed=${id}&quantity=${String(notice.quantity)}`;
    case 'refused':
      return `refused=${id}&refusal=${notice.refusal}`;
  }
};

/**
 * Reads a notice back, refusing anything a cart action would not have written:
 * a quantity that is no positive whole number names no line anyone removed,
 * and a refusal outside the sale refusals names none anyone was refused. Only
 * an id and a key reach the page, which reads the name and the copy itself —
 * never copy from the URL.
 */
export function parseCartNotice(
  query: Query | undefined,
): CartNotice | undefined {
  const added = one(query?.['added']);
  if (added !== undefined) return { kind: 'added', offeringId: added };

  const refused = one(query?.['refused']);
  if (refused !== undefined) {
    const refusal = refusalOf(one(query?.['refusal']));
    return refusal === undefined
      ? undefined
      : { kind: 'refused', offeringId: refused, refusal };
  }

  const removed = one(query?.['removed']);
  if (removed === undefined) return undefined;
  const quantity = Number(one(query?.['quantity']));
  return Number.isSafeInteger(quantity) && quantity >= 1
    ? { kind: 'removed', offeringId: removed, quantity }
    : undefined;
}
