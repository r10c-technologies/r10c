/**
 * The cart's wire format, and nothing else.
 *
 * Deliberately free of every import — this module is read by **both** sides:
 * the server, which parses the cookie off the request, and the header badge,
 * which parses the same string out of `document.cookie`. Keeping the reader
 * (`readCart`, which needs `next/headers`) in a separate module is not tidiness;
 * a single file would drag a server-only API into the browser bundle and Next
 * refuses to build it.
 *
 * The format is `offeringId:qty` pairs. The key is the **offering id**, not a
 * product code: offering and specification are 1:N, so two vendors publishing
 * against one specification share a code and would share a cart line — one
 * vendor's item silently added to the other's. It is also the address the
 * storefront already uses (ADR 0049), so a cart line and a product URL name the
 * same thing.
 *
 * A real cart moves server-side keyed by session, with only an id in the cookie
 * — and nothing above this module would change.
 */
export const CART_COOKIE = 'r10c_cart';

export interface CartLine {
  readonly offeringId: string;
  readonly quantity: number;
}

export function parseCart(value: string | undefined): CartLine[] {
  if (!value) return [];

  return value.split(',').flatMap(entry => {
    const [offeringId, quantity] = entry.split(':');
    const parsed = Number(quantity);
    if (!offeringId || !Number.isFinite(parsed) || parsed < 1) return [];
    return [{ offeringId, quantity: Math.floor(parsed) }];
  });
}

export function serializeCart(lines: readonly CartLine[]): string {
  return lines.map(line => `${line.offeringId}:${line.quantity}`).join(',');
}

export function cartCount(lines: readonly CartLine[]): number {
  return lines.reduce((total, line) => total + line.quantity, 0);
}
