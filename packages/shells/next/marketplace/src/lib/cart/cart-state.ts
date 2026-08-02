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
 * The format is `code:qty` pairs because this is a fixture cart. A real one
 * moves server-side keyed by session, with only an id in the cookie — and
 * nothing above this module would change.
 */
export const CART_COOKIE = 'r10c_cart';

export interface CartLine {
  readonly code: string;
  readonly quantity: number;
}

export function parseCart(value: string | undefined): CartLine[] {
  if (!value) return [];

  return value.split(',').flatMap(entry => {
    const [code, quantity] = entry.split(':');
    const parsed = Number(quantity);
    if (!code || !Number.isFinite(parsed) || parsed < 1) return [];
    return [{ code, quantity: Math.floor(parsed) }];
  });
}

export function serializeCart(lines: readonly CartLine[]): string {
  return lines.map(line => `${line.code}:${line.quantity}`).join(',');
}

export function cartCount(lines: readonly CartLine[]): number {
  return lines.reduce((total, line) => total + line.quantity, 0);
}
