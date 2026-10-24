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

/**
 * The most units one line may hold. The cookie is visitor-writable and the
 * quantity box is a plain number field, so a figure past this is clamped
 * rather than trusted: no buyer means 10⁹ lamps, and stock would refuse it
 * at checkout anyway.
 */
export const MAX_QUANTITY = 99;

/** One more unit of `offeringId`, as a new line when the cart has none. */
export function withAdded(
  lines: readonly CartLine[],
  offeringId: string,
): CartLine[] {
  const existing = lines.find(line => line.offeringId === offeringId);
  return existing
    ? withQuantity(lines, offeringId, existing.quantity + 1)
    : [...lines, { offeringId, quantity: 1 }];
}

/**
 * The cart with `offeringId`'s line set to `quantity`: floored, clamped to
 * {@link MAX_QUANTITY}, and removed at zero or below. A quantity that is not
 * a number leaves the cart as it was, because a form that sent garbage did
 * not ask for anything.
 */
export function withQuantity(
  lines: readonly CartLine[],
  offeringId: string,
  quantity: number,
): CartLine[] {
  if (!Number.isFinite(quantity)) return [...lines];
  const next = Math.min(Math.floor(quantity), MAX_QUANTITY);
  return next < 1
    ? lines.filter(line => line.offeringId !== offeringId)
    : lines.map(line =>
        line.offeringId === offeringId ? { ...line, quantity: next } : line,
      );
}
