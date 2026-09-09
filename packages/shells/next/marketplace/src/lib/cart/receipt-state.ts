/**
 * What a buyer is shown after a checkout, and how it travels.
 *
 * ⚠️ **The receipt is carried, not read back.** The storefront holds no session
 * and order-service's reads take a session and no token, so a confirmation page
 * that re-fetched the order would need either a buyer account the storefront has
 * not got or a public read surface on a platform-plane store. The saga's `201`
 * already contains the whole order, so nothing needs fetching: what the page
 * renders is what the write returned.
 *
 * The consequence is stated rather than hidden: **the receipt lives as long as
 * its cookie**, is per-browser, and is not a history. "My orders" needs a buyer
 * identity, and `buyerId` is optional precisely so a counter walk-in is not made
 * to invent one ([ADR 0024](../../../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
 *
 * Free of every import for the same reason `cart-state.ts` is: the wire format
 * is read on the server and the shape is named by components, and a single
 * module that also read `next/headers` would drag a server-only API into the
 * browser bundle.
 */
export const RECEIPT_COOKIE = 'r10c_receipt';

/**
 * How long a receipt stays readable.
 *
 * Long enough to read it, come back to the tab and reload; short enough that a
 * shared machine does not show the next person somebody's purchase. The page
 * degrades to an expired state rather than an error when it lapses.
 */
export const RECEIPT_TTL_SECONDS = 30 * 60;

/**
 * How many lines the cookie carries.
 *
 * ⚠️ **A cookie is 4KB total**, headers and encoding included, and a basket has
 * no upper bound. Past this the receipt keeps the order id, the totals and the
 * line count, and the page says so — a truncated list rendered as if it were the
 * whole order would be a receipt that lies. The bound is on lines rather than on
 * bytes because it is the number a page has to explain.
 */
export const RECEIPT_LINE_CAP = 12;

/** One line of the receipt, as the order recorded it. */
export interface ReceiptLine {
  readonly offeringId: string;
  readonly quantity: number;
  /** Minor units, the currency below, captured at checkout. */
  readonly amount: number;
  readonly currency: string;
}

/** What an order comes to in one currency, in that currency's minor units. */
export interface ReceiptTotal {
  readonly currency: string;
  readonly amount: number;
}

export interface Receipt {
  readonly orderId: string;
  readonly placedAt?: string;
  /**
   * The lines, or **none of them** when the order is larger than the cap.
   * Absent is not empty: an order always has at least one line, so a receipt
   * with no lines is one whose lines did not fit.
   */
  readonly lines?: readonly ReceiptLine[];
  /** Always the whole order's count, whether or not the lines are carried. */
  readonly lineCount: number;
  /**
   * One total per currency, always for the whole order.
   *
   * ⚠️ **A list rather than a number, because a basket can span currencies.**
   * A marketplace's vendors price independently, and the storefront happily
   * carries a `GTQ` line and a `USD` line in one cart — summing those into a
   * single figure and labelling it with whichever currency came first is a
   * receipt that states a price nobody was charged. There is no exchange rate
   * anywhere in this system, and inventing one on a receipt would be worse than
   * showing two lines.
   */
  readonly totals: readonly ReceiptTotal[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readLine = (value: unknown): ReceiptLine | undefined => {
  if (!isRecord(value)) return undefined;
  const { offeringId, quantity, amount, currency } = value;
  if (typeof offeringId !== 'string') return undefined;
  if (typeof quantity !== 'number' || typeof amount !== 'number') {
    return undefined;
  }
  if (typeof currency !== 'string') return undefined;
  return { offeringId, quantity, amount, currency };
};

const readTotal = (value: unknown): ReceiptTotal | undefined => {
  if (!isRecord(value)) return undefined;
  const { currency, amount } = value;
  return typeof currency === 'string' && typeof amount === 'number'
    ? { currency, amount }
    : undefined;
};

/**
 * Build the receipt from an order's own members.
 *
 * The totals are summed here rather than re-derived on the page, so the figures
 * a buyer reads are the ones the lines add up to even when the lines themselves
 * did not fit in the cookie — and they are grouped by currency, in the order
 * each currency first appears, because a basket can span vendors pricing in
 * different ones.
 */
export const receiptFromOrder = (
  orderId: string,
  placedAt: string | undefined,
  lines: readonly ReceiptLine[],
): Receipt => {
  const byCurrency = new Map<string, number>();
  for (const line of lines) {
    byCurrency.set(
      line.currency,
      (byCurrency.get(line.currency) ?? 0) + line.amount * line.quantity,
    );
  }

  return {
    ...(lines.length > RECEIPT_LINE_CAP ? {} : { lines }),
    ...(placedAt === undefined ? {} : { placedAt }),
    orderId,
    lineCount: lines.length,
    totals: [...byCurrency].map(([currency, amount]) => ({
      currency,
      amount,
    })),
  };
};

/** The cookie value for a receipt. */
export const serializeReceipt = (receipt: Receipt): string =>
  JSON.stringify(receipt);

/**
 * Read a receipt back, or `undefined`.
 *
 * ⚠️ **Everything here is untrusted.** The cookie is `httpOnly`, so a page
 * cannot write it — but a browser's owner can, and the parse must therefore
 * treat the value as input rather than as something this module wrote. It
 * discloses nothing either way: the worst a forged cookie achieves is showing
 * its author a receipt they made up.
 */
export const parseReceipt = (
  value: string | undefined,
): Receipt | undefined => {
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;

  const { orderId, placedAt, lines, lineCount, totals } = parsed;
  if (typeof orderId !== 'string' || orderId === '') return undefined;
  if (typeof lineCount !== 'number') return undefined;
  if (!Array.isArray(totals)) return undefined;

  const readTotals = totals
    .map(readTotal)
    .filter((total): total is ReceiptTotal => total !== undefined);
  // A receipt that cannot say what the order came to is not a receipt.
  if (readTotals.length === 0) return undefined;

  const readLines = Array.isArray(lines)
    ? lines
        .map(readLine)
        .filter((line): line is ReceiptLine => line !== undefined)
    : undefined;

  return {
    ...(readLines === undefined ? {} : { lines: readLines }),
    ...(typeof placedAt === 'string' ? { placedAt } : {}),
    orderId,
    lineCount,
    totals: readTotals,
  };
};
