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
  /**
   * A whole number in the scale of the offering's unit: `3500` is 3.5 m
   * (ADR 0082 §2). What it means is the published offering's to say, so this
   * module never reads it as a count of anything.
   */
  readonly quantity: number;
}

/** A quantity this format can hold: a positive whole number, never a fraction. */
const isHeld = (quantity: number) =>
  Number.isSafeInteger(quantity) && quantity >= 1;

export function parseCart(value: string | undefined): CartLine[] {
  if (!value) return [];

  return value.split(',').flatMap(entry => {
    const [offeringId, quantity] = entry.split(':');
    const parsed = Number(quantity);
    // A fraction is dropped rather than floored: in the scale it is stored in
    // it is no quantity at all, and flooring would sell something nobody asked
    // for (ADR 0082 §3).
    if (!offeringId || !isHeld(parsed)) return [];
    return [{ offeringId, quantity: parsed }];
  });
}

export function serializeCart(lines: readonly CartLine[]): string {
  return lines.map(line => `${line.offeringId}:${line.quantity}`).join(',');
}

/**
 * How many lines the cart holds — what the header badge counts. Never the sum
 * of the quantities: 3.5 m of cable and two lamps are two things, not 3,502.
 */
export function cartCount(lines: readonly CartLine[]): number {
  return lines.length;
}

/**
 * The cart with `offeringId`'s line at `quantity`, appended when the cart has
 * none. A quantity that is not a positive whole number leaves the cart as it
 * was; one the offering does not sell is the cart action's to refuse before
 * this.
 */
export function withLine(
  lines: readonly CartLine[],
  offeringId: string,
  quantity: number,
): CartLine[] {
  if (!isHeld(quantity)) return [...lines];
  return lines.some(line => line.offeringId === offeringId)
    ? withQuantity(lines, offeringId, quantity)
    : [...lines, { offeringId, quantity }];
}

/**
 * The cart with `offeringId`'s line set to `quantity`, and removed at zero.
 * Anything else that is not a positive whole number leaves the cart as it
 * was: a form that sent garbage did not ask for anything. Nothing is floored
 * or clamped — the action refuses what the offering does not sell.
 */
export function withQuantity(
  lines: readonly CartLine[],
  offeringId: string,
  quantity: number,
): CartLine[] {
  if (quantity === 0)
    return lines.filter(line => line.offeringId !== offeringId);
  if (!isHeld(quantity)) return [...lines];
  return lines.map(line =>
    line.offeringId === offeringId ? { ...line, quantity } : line,
  );
}
