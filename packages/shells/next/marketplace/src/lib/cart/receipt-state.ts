import { type MoneyTotal, totalsByCurrency } from '../catalog/money';

/**
 * The buyer's receipt for one checkout, kept in an `httpOnly` cookie: the
 * checkout group, and one entry per vendor order in it (ADR 0069).
 *
 * ⚠️ **It carries the cancel nonce**, the one credential that lets an
 * anonymous buyer cancel their own orders and read the group back, so it lives
 * where no script reaches it and expires when the group says the receipt does
 * — see {@link receiptCookieMaxAge}.
 */
export const RECEIPT_COOKIE = 'r10c_receipt';

const SECOND = 1000;

/**
 * How long the receipt cookie may live, in seconds: until the group's own
 * `receiptEndsAt`, the moment order-service stops reading the receipt back by
 * this nonce. The service stamps it from its own dial, so the storefront holds
 * no copy of that number (ADR 0076 §6).
 *
 * ⚠️ **No stamp, an unparseable one or one already past is `0`**, which
 * deletes the cookie. Everything in a receipt is untrusted, and a cookie with
 * no end it can name would outlive the only thing that makes it useful.
 */
export const receiptCookieMaxAge = (receipt: Receipt, now: Date): number => {
  if (receipt.receiptEndsAt === undefined) return 0;
  const endsAt = new Date(receipt.receiptEndsAt).getTime();
  if (Number.isNaN(endsAt)) return 0;
  return Math.max(0, Math.floor((endsAt - now.getTime()) / SECOND));
};

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
  /** The seller's own order number, `7KQ4-M2XD`, as they would quote it. */
  readonly number?: string;
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
  /** The purchase's number, `7KQ4-M2XD`: what the buyer quotes (ADR 0076 §5). */
  readonly number?: string;
  readonly placedAt?: string;
  readonly orders: readonly ReceiptOrder[];
  readonly totals: readonly ReceiptTotal[];
  /** The nonce whose digest the group holds: the buyer's cancel and read. */
  readonly cancelNonce?: string;
  readonly cancelWindowEndsAt?: string;
  /** Until when the nonce reads the receipt back; the cookie lives as long. */
  readonly receiptEndsAt?: string;
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
  const {
    orderId,
    number,
    vendorId,
    vendorName,
    method,
    lines,
    lineCount,
    total,
  } = value;
  const readAt = readTotal(total);
  if (!filled(orderId) || !filled(vendorId) || !filled(method))
    return undefined;
  if (typeof lineCount !== 'number' || readAt === undefined) return undefined;
  const readLines = linesOf(lines);
  return {
    orderId,
    ...(filled(number) ? { number } : {}),
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
  const {
    groupId,
    number,
    placedAt,
    orders,
    totals,
    cancelNonce,
    cancelWindowEndsAt,
    receiptEndsAt,
  } = parsed;
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
    ...(filled(number) ? { number } : {}),
    ...(filled(placedAt) ? { placedAt } : {}),
    orders: readOrders as ReceiptOrder[],
    totals: readTotals,
    ...(filled(cancelNonce) ? { cancelNonce } : {}),
    ...(filled(cancelWindowEndsAt) ? { cancelWindowEndsAt } : {}),
    ...(filled(receiptEndsAt) ? { receiptEndsAt } : {}),
  };
};

/** One order as order-service's buyer-receipt read answers it. */
const readBackOrder = (
  envelope: unknown,
  vendorNames: ReadonlyMap<string, string>,
): ReceiptOrder | undefined => {
  const data = isRecord(envelope) ? envelope['data'] : undefined;
  if (!isRecord(data)) return undefined;
  const { id, number, vendorId, paymentMethod, items } = data;
  if (!filled(id) || !filled(vendorId)) return undefined;
  const lines = linesOf(items) ?? [];
  const [total] = totalsByCurrency(lines);
  if (total === undefined) return undefined;
  const name = vendorNames.get(vendorId);
  return {
    orderId: id,
    ...(filled(number) ? { number } : {}),
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
  const { number, placedAt, cancelWindowEndsAt, receiptEndsAt } = group;
  return {
    groupId: group['id'],
    ...(filled(number) ? { number } : {}),
    ...(filled(placedAt) ? { placedAt } : {}),
    orders: readOrders,
    totals: totalsByCurrency(
      readOrders.map(order => ({ ...order.total, quantity: 1 })),
    ),
    cancelNonce,
    ...(filled(cancelWindowEndsAt) ? { cancelWindowEndsAt } : {}),
    ...(filled(receiptEndsAt) ? { receiptEndsAt } : {}),
  };
};

/** Where the parcels go and who receives them, as the receipt shows it. */
export interface ReceiptDelivery {
  readonly name: string;
  /** The phone's last four digits: the receipt never shows the whole number. */
  readonly phoneEnding: string;
  readonly municipio: string;
  readonly departamento: string;
  readonly zona?: number;
  readonly addressLine: string;
  readonly reference?: string;
}

/**
 * What the receipt reads from the server on each render rather than keeping
 * in its cookie: the delivery, and each line's stored name by order and
 * offering (#582). Personal data never enters the cookie (ADR 0076 §1), and
 * names are long while the cookie is 4 KB.
 */
/** Whom a receipt is documented to: a NIT or CUI, or consumidor final. */
export interface ReceiptBilledTo {
  readonly idType: 'nit' | 'cui' | 'cf';
  readonly taxId: string;
  readonly name: string;
}

export interface ReceiptDetails {
  readonly delivery?: ReceiptDelivery;
  /** The name each line was sold under, keyed `<orderId>/<offeringId>`. */
  readonly lineNames: ReadonlyMap<string, string>;
  /**
   * The IVA each order's price includes, keyed by order id — only for a
   * seller whose document breaks it out: a pequeño contribuyente's shows
   * none (ADR 0078 §6).
   */
  readonly ivaIncluded: ReadonlyMap<string, number>;
  readonly billedTo?: ReceiptBilledTo;
}

const billedToOf = (
  data: Record<string, unknown>,
): ReceiptBilledTo | undefined => {
  const { buyerTaxIdType: idType, buyerTaxId, buyerTaxName } = data;
  if (idType !== 'nit' && idType !== 'cui' && idType !== 'cf') return undefined;
  return {
    idType,
    taxId: typeof buyerTaxId === 'string' ? buyerTaxId : '',
    name: typeof buyerTaxName === 'string' ? buyerTaxName : '',
  };
};

/** The key {@link ReceiptDetails.lineNames} holds a line's name under. */
export const lineNameKey = (orderId: string, offeringId: string) =>
  `${orderId}/${offeringId}`;

const PHONE_ENDING = 4;

const deliveryOf = (value: unknown): ReceiptDelivery | undefined => {
  const row = Array.isArray(value) ? value[0] : undefined;
  if (!isRecord(row)) return undefined;
  const { name, phone, municipio, departamento, zona, addressLine, reference } =
    row;
  if (
    !filled(name) ||
    !filled(phone) ||
    !filled(municipio) ||
    !filled(departamento) ||
    !filled(addressLine)
  ) {
    return undefined;
  }
  return {
    name,
    phoneEnding: phone.slice(-PHONE_ENDING),
    municipio,
    departamento,
    ...(typeof zona === 'number' ? { zona } : {}),
    addressLine,
    ...(filled(reference) ? { reference } : {}),
  };
};

/**
 * The details a buyer-receipt read answers, or `undefined` when the answer is
 * not one — the page then renders from its cookie alone.
 */
export const receiptDetailsOf = (
  payload: unknown,
): ReceiptDetails | undefined => {
  if (!isRecord(payload)) return undefined;
  const group = isRecord(payload['group'])
    ? payload['group']['data']
    : undefined;
  const orders = payload['orders'];
  if (!isRecord(group) || !Array.isArray(orders)) return undefined;
  const lineNames = new Map<string, string>();
  const ivaIncluded = new Map<string, number>();
  let billedTo: ReceiptBilledTo | undefined;
  for (const envelope of orders) {
    const data = isRecord(envelope) ? envelope['data'] : undefined;
    if (!isRecord(data) || !filled(data['id'])) continue;
    billedTo ??= billedToOf(data);
    if (
      typeof data['taxAmount'] === 'number' &&
      data['sellerTaxRegime'] !== 'small-taxpayer'
    ) {
      ivaIncluded.set(data['id'], data['taxAmount']);
    }
    const items = Array.isArray(data['items']) ? data['items'] : [];
    for (const item of items) {
      if (
        isRecord(item) &&
        filled(item['offeringId']) &&
        filled(item['name'])
      ) {
        lineNames.set(
          lineNameKey(data['id'], item['offeringId']),
          item['name'],
        );
      }
    }
  }
  const delivery = deliveryOf(group['contact']);
  return {
    ...(delivery === undefined ? {} : { delivery }),
    lineNames,
    ivaIncluded,
    ...(billedTo === undefined ? {} : { billedTo }),
  };
};

/** The receipt once the buyer cancelled one of its orders. */
export const withCancelled = (receipt: Receipt, orderId: string): Receipt => ({
  ...receipt,
  orders: receipt.orders.map(order =>
    order.orderId === orderId ? { ...order, cancelled: true } : order,
  ),
});
