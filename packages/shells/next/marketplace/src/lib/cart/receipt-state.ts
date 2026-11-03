import { type MoneyTotal, totalsByCurrency } from '../catalog/money';

/**
 * The buyer's receipt for one checkout, kept in an `httpOnly` cookie: the
 * checkout group, and one entry per vendor order in it (ADR 0069).
 *
 * ⚠️ **It carries the cancel nonce**, the one credential that lets an
 * anonymous buyer cancel their own orders and read the group back, so it lives
 * where no script reaches it and expires with the cancel window.
 */
export const RECEIPT_COOKIE = 'r10c_receipt';

/** The receipt lives exactly as long as the cancel window it can open. */
export const RECEIPT_TTL_SECONDS = 30 * 60;

/**
 * Past this many lines in one order its lines are left out and only its count
 * and total kept: a cookie is capped at about 4 KB, and a receipt that cannot be
 * written is worse than a terse one.
 */
export const RECEIPT_LINE_CAP = 12;

/** One line of a vendor order, as the receipt shows it. */
export interface ReceiptLine {
  readonly offeringId: string;
  readonly quantity: number;
  readonly amount: number;
  readonly currency: string;
}

export type ReceiptTotal = MoneyTotal;

/** One vendor's order on the receipt. */
export interface ReceiptOrder {
  readonly orderId: string;
  readonly vendorId: string;
  /** The seller's display name, absent when the projection has none yet. */
  readonly vendorName?: string;
  /** How the buyer pays this seller: `card` or `cod`. */
  readonly method: string;
  /** Absent past {@link RECEIPT_LINE_CAP}; {@link lineCount} still says how many. */
  readonly lines?: readonly ReceiptLine[];
  readonly lineCount: number;
  readonly total: ReceiptTotal;
  /** Present only once the buyer cancelled it from this receipt. */
  readonly cancelled?: true;
}

export interface Receipt {
  readonly groupId: string;
  readonly placedAt?: string;
  readonly orders: readonly ReceiptOrder[];
  readonly totals: readonly ReceiptTotal[];
  /** The nonce whose digest the group holds: the buyer's cancel and read. */
  readonly cancelNonce?: string;
  readonly cancelWindowEndsAt?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const filled = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

const readLine = (value: unknown): ReceiptLine | undefined => {
  if (!isRecord(value)) return undefined;
  const { offeringId, quantity, amount, currency } = value;
  return filled(offeringId) &&
    typeof quantity === 'number' &&
    typeof amount === 'number' &&
    filled(currency)
    ? { offeringId, quantity, amount, currency }
    : undefined;
};

const readTotal = (value: unknown): ReceiptTotal | undefined => {
  if (!isRecord(value)) return undefined;
  const { currency, amount } = value;
  return filled(currency) && typeof amount === 'number'
    ? { currency, amount }
    : undefined;
};

const linesOf = (value: unknown): ReceiptLine[] | undefined =>
  Array.isArray(value)
    ? value
        .map(readLine)
        .filter((line): line is ReceiptLine => line !== undefined)
    : undefined;

const readOrder = (value: unknown): ReceiptOrder | undefined => {
  if (!isRecord(value)) return undefined;
  const { orderId, vendorId, vendorName, method, lines, lineCount, total } =
    value;
  const readAt = readTotal(total);
  if (!filled(orderId) || !filled(vendorId) || !filled(method))
    return undefined;
  if (typeof lineCount !== 'number' || readAt === undefined) return undefined;
  const readLines = linesOf(lines);
  return {
    orderId,
    vendorId,
    ...(filled(vendorName) ? { vendorName } : {}),
    method,
    ...(readLines === undefined ? {} : { lines: readLines }),
    lineCount,
    total: readAt,
    // `true` only, so a forged `cancelled: 'yes'` claims nothing.
    ...(value['cancelled'] === true ? { cancelled: true as const } : {}),
  };
};

export const serializeReceipt = (receipt: Receipt): string =>
  JSON.stringify(receipt);

/**
 * A receipt read back strictly: everything in the cookie is untrusted, so a
 * receipt that cannot name its group, its orders or what it came to is none.
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
  const { groupId, placedAt, orders, totals, cancelNonce, cancelWindowEndsAt } =
    parsed;
  if (!filled(groupId) || !Array.isArray(orders) || !Array.isArray(totals)) {
    return undefined;
  }
  const readOrders = orders.map(readOrder);
  if (
    readOrders.length === 0 ||
    readOrders.some(order => order === undefined)
  ) {
    return undefined;
  }
  const readTotals = totals
    .map(readTotal)
    .filter((total): total is ReceiptTotal => total !== undefined);
  if (readTotals.length === 0) return undefined;
  return {
    groupId,
    ...(filled(placedAt) ? { placedAt } : {}),
    orders: readOrders as ReceiptOrder[],
    totals: readTotals,
    ...(filled(cancelNonce) ? { cancelNonce } : {}),
    ...(filled(cancelWindowEndsAt) ? { cancelWindowEndsAt } : {}),
  };
};

/** One order as order-service's buyer-receipt read answers it. */
const readBackOrder = (
  envelope: unknown,
  vendorNames: ReadonlyMap<string, string>,
): ReceiptOrder | undefined => {
  const data = isRecord(envelope) ? envelope['data'] : undefined;
  if (!isRecord(data)) return undefined;
  const { id, vendorId, paymentMethod, items } = data;
  if (!filled(id) || !filled(vendorId)) return undefined;
  const lines = linesOf(items) ?? [];
  const [total] = totalsByCurrency(lines);
  if (total === undefined) return undefined;
  const name = vendorNames.get(vendorId);
  return {
    orderId: id,
    vendorId,
    ...(name === undefined ? {} : { vendorName: name }),
    method: filled(paymentMethod) ? paymentMethod : 'card',
    ...(lines.length > RECEIPT_LINE_CAP ? {} : { lines }),
    lineCount: lines.length,
    total,
  };
};

/**
 * The receipt a settled checkout writes, built from the group read back by its
 * capability (`GET /api/checkout-group/:id/buyer-receipt`) — `undefined` when
 * the answer is not one, so a malformed read never becomes a cookie.
 */
export const receiptFromReadBack = (
  payload: unknown,
  cancelNonce: string,
  vendorNames: ReadonlyMap<string, string>,
): Receipt | undefined => {
  if (!isRecord(payload)) return undefined;
  const group = isRecord(payload['group'])
    ? payload['group']['data']
    : undefined;
  const orders = payload['orders'];
  if (!isRecord(group) || !filled(group['id']) || !Array.isArray(orders)) {
    return undefined;
  }
  const read = orders.map(order => readBackOrder(order, vendorNames));
  if (read.length === 0 || read.some(order => order === undefined)) {
    return undefined;
  }
  const readOrders = read as ReceiptOrder[];
  const { placedAt, cancelWindowEndsAt } = group;
  return {
    groupId: group['id'],
    ...(filled(placedAt) ? { placedAt } : {}),
    orders: readOrders,
    totals: totalsByCurrency(
      readOrders.map(order => ({ ...order.total, quantity: 1 })),
    ),
    cancelNonce,
    ...(filled(cancelWindowEndsAt) ? { cancelWindowEndsAt } : {}),
  };
};

/** The receipt once the buyer cancelled one of its orders. */
export const withCancelled = (receipt: Receipt, orderId: string): Receipt => ({
  ...receipt,
  orders: receipt.orders.map(order =>
    order.orderId === orderId ? { ...order, cancelled: true } : order,
  ),
});
