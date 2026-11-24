import { isSaleUnit, type SaleUnit } from '@r10c/business-ts-sales-vocabulary';

import { type MoneyTotal, totalsByCurrency } from '../catalog/money';

/**
 * The buyer's way back to one checkout, kept in an `httpOnly` cookie: the
 * checkout group, its number, and the nonce that opens it (ADR 0053, ADR 0069).
 *
 * ⚠️ **It carries the cancel nonce**, the one credential that lets an
 * anonymous buyer read the group back, cancel their own orders and attach a
 * payment receipt, so it lives where no script reaches it and expires when the
 * group says the receipt does — see {@link receiptCookieMaxAge}.
 *
 * ⚠️ **It carries nothing the read answers.** The orders, their lines, totals
 * and whether one was cancelled are read from order-service on every render
 * by that nonce. A cookie is 4 KB and a basket has no upper bound, so a cookie
 * that held the receipt was a cookie a large basket lost without a word; this
 * one is the same few hundred bytes whatever was bought.
 */
export const RECEIPT_COOKIE = 'r10c_receipt';

const SECOND = 1000;

/** What the receipt cookie holds: the capability, and what to show without it. */
export interface ReceiptTicket {
  readonly groupId: string;
  /** The purchase's number, `7KQ4-M2XD`: what the buyer quotes (ADR 0076 §5). */
  readonly number?: string;
  /** The nonce whose digest the group holds: the buyer's read, cancel and attach. */
  readonly cancelNonce: string;
  readonly cancelWindowEndsAt?: string;
  /** Until when the nonce reads the receipt back; the cookie lives as long. */
  readonly receiptEndsAt?: string;
}

/**
 * How long the receipt cookie may live, in seconds: until the group's own
 * `receiptEndsAt`, the moment order-service stops reading the receipt back by
 * this nonce. The service stamps it from its own dial, so the storefront holds
 * no copy of that number (ADR 0076 §6).
 *
 * ⚠️ **No stamp, an unparseable one or one already past is `0`**, which
 * deletes the cookie. Everything in a cookie is untrusted, and a cookie with
 * no end it can name would outlive the only thing that makes it useful.
 */
export const receiptCookieMaxAge = (
  ticket: ReceiptTicket,
  now: Date,
): number => {
  if (ticket.receiptEndsAt === undefined) return 0;
  const endsAt = new Date(ticket.receiptEndsAt).getTime();
  if (Number.isNaN(endsAt)) return 0;
  return Math.max(0, Math.floor((endsAt - now.getTime()) / SECOND));
};

/** One line of a vendor order, as the receipt shows it. */
export interface ReceiptLine {
  readonly offeringId: string;
  /** What the quantity is counted in, as the order line stated it. */
  readonly unit: SaleUnit;
  readonly quantity: number;
  /** What the line cost, as placed (ADR 0082 §6): the receipt never multiplies. */
  readonly lineTotal: number;
  /** Where the volume price the line was charged starts, when it reached one (ADR 0082 §8). */
  readonly tierFrom?: number;
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
  /** How the buyer pays this seller: `card`, `cod` or `link`. */
  readonly method: string;
  readonly lines: readonly ReceiptLine[];
  readonly total: ReceiptTotal;
  /** Present only when order-service says the order is cancelled. */
  readonly cancelled?: true;
}

/** The receipt as a render reads it back: the ticket, and what the group answers. */
export interface Receipt extends ReceiptTicket {
  readonly placedAt?: string;
  readonly orders: readonly ReceiptOrder[];
  readonly totals: readonly ReceiptTotal[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const filled = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

const readLine = (value: unknown): ReceiptLine | undefined => {
  if (!isRecord(value)) return undefined;
  const { offeringId, saleUnit, quantity, lineTotal, currency, tierFrom } =
    value;
  return filled(offeringId) &&
    isSaleUnit(saleUnit) &&
    typeof quantity === 'number' &&
    typeof lineTotal === 'number' &&
    filled(currency)
    ? {
        offeringId,
        unit: saleUnit,
        quantity,
        lineTotal,
        currency,
        ...(typeof tierFrom === 'number' ? { tierFrom } : {}),
      }
    : undefined;
};

const linesOf = (value: unknown): ReceiptLine[] =>
  Array.isArray(value)
    ? value
        .map(readLine)
        .filter((line): line is ReceiptLine => line !== undefined)
    : [];

/** The ticket a receipt is kept by: its capability and nothing it read. */
export const ticketOf = (receipt: ReceiptTicket): ReceiptTicket => ({
  groupId: receipt.groupId,
  ...(receipt.number === undefined ? {} : { number: receipt.number }),
  cancelNonce: receipt.cancelNonce,
  ...(receipt.cancelWindowEndsAt === undefined
    ? {}
    : { cancelWindowEndsAt: receipt.cancelWindowEndsAt }),
  ...(receipt.receiptEndsAt === undefined
    ? {}
    : { receiptEndsAt: receipt.receiptEndsAt }),
});

export const serializeTicket = (ticket: ReceiptTicket): string =>
  JSON.stringify(ticketOf(ticket));

/**
 * A ticket read back strictly: everything in the cookie is untrusted, so one
 * that cannot name its group and the nonce that opens it is none.
 */
export const parseTicket = (
  value: string | undefined,
): ReceiptTicket | undefined => {
  if (!value) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const { groupId, number, cancelNonce, cancelWindowEndsAt, receiptEndsAt } =
    parsed;
  if (!filled(groupId) || !filled(cancelNonce)) return undefined;
  return {
    groupId,
    ...(filled(number) ? { number } : {}),
    cancelNonce,
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
  const { id, number, vendorId, paymentMethod, items, status } = data;
  if (!filled(id) || !filled(vendorId)) return undefined;
  const lines = linesOf(items);
  const [total] = totalsByCurrency(lines);
  if (total === undefined) return undefined;
  const name = vendorNames.get(vendorId);
  return {
    orderId: id,
    ...(filled(number) ? { number } : {}),
    vendorId,
    ...(name === undefined ? {} : { vendorName: name }),
    method: filled(paymentMethod) ? paymentMethod : 'card',
    lines,
    total,
    ...(status === 'cancelled' ? { cancelled: true as const } : {}),
  };
};

/**
 * The receipt the group read back by its capability answers
 * (`GET /api/checkout-group/:id/buyer-receipt`), for the ticket that opened it
 * — `undefined` when the answer is not one, or is another group's, so a
 * malformed read never becomes a receipt or a cookie.
 */
export const receiptFromReadBack = (
  payload: unknown,
  ticket: Pick<ReceiptTicket, 'groupId' | 'cancelNonce'>,
  vendorNames: ReadonlyMap<string, string>,
): Receipt | undefined => {
  if (!isRecord(payload)) return undefined;
  const group = isRecord(payload['group'])
    ? payload['group']['data']
    : undefined;
  const orders = payload['orders'];
  if (
    !isRecord(group) ||
    group['id'] !== ticket.groupId ||
    !Array.isArray(orders)
  ) {
    return undefined;
  }
  const read = orders.map(order => readBackOrder(order, vendorNames));
  if (read.length === 0 || read.some(order => order === undefined)) {
    return undefined;
  }
  const readOrders = read as ReceiptOrder[];
  const { number, placedAt, cancelWindowEndsAt, receiptEndsAt } = group;
  return {
    groupId: ticket.groupId,
    ...(filled(number) ? { number } : {}),
    ...(filled(placedAt) ? { placedAt } : {}),
    orders: readOrders,
    totals: totalsByCurrency(
      readOrders.map(order => ({
        lineTotal: order.total.amount,
        currency: order.total.currency,
      })),
    ),
    cancelNonce: ticket.cancelNonce,
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

/**
 * Where a payment-link order stands for its buyer: waiting until when, and the
 * link the seller set, if any (ADR 0081 §10). Read back on every render, never
 * kept in the receipt cookie.
 */
export interface ReceiptPayment {
  readonly awaiting: boolean;
  readonly dueAt?: string;
  /** The order expired before its seller confirmed a payment. */
  readonly expired: boolean;
  readonly link?: {
    readonly url: string;
    readonly host: string;
    readonly providerName: string;
    /** `other`: a provider nobody vouched for, so its host is shown. */
    readonly unlisted: boolean;
  };
  /** The receipts attached whose file is still kept (ADR 0081 §6). */
  readonly evidence: readonly ReceiptEvidence[];
}

/** One attached payment receipt, as its buyer is shown it. */
export interface ReceiptEvidence {
  readonly id: string;
  readonly kind: 'image' | 'pdf';
}

/** The receipts of an order whose file is still kept, in attach order. */
const evidenceOf = (value: unknown): readonly ReceiptEvidence[] =>
  (Array.isArray(value) ? value : []).flatMap(
    (entry: Record<string, unknown>): ReceiptEvidence[] =>
      filled(entry['id']) && filled(entry['objectKey'])
        ? [
            {
              id: entry['id'],
              kind:
                entry['contentType'] === 'application/pdf' ? 'pdf' : 'image',
            },
          ]
        : [],
  );

/**
 * Where one vendor order stands on its way to the buyer, read back on every
 * render (ADR 0081 §11): its status, how it is paid, and — once the parcel
 * left — the courier and the tracking number it left with. A tracking link
 * that is not `https` is not kept: the service refuses one.
 */
export interface ReceiptTracking {
  readonly status: string;
  readonly method: string;
  readonly courierName?: string;
  readonly trackingNumber?: string;
  readonly trackingUrl?: string;
}

/**
 * The FEL document an order was certified with, as its buyer reads it
 * (#668): `pending` while the certifier has not answered for a paid order,
 * `certified` with its numbers, `voided` once a cancelled sale's document
 * was annulled. No entry for an order not yet paid for.
 */
export interface ReceiptFiscal {
  readonly state: 'pending' | 'certified' | 'voided';
  readonly type?: string;
  readonly series?: string;
  readonly number?: string;
  readonly authorization?: string;
}

/** The statuses a paid-for order's document is owed from. */
const FISCAL_OWED = new Set(['paid', 'confirmed', 'dispatched', 'fulfilled']);

/** An order's FEL document as its buyer reads it, or `undefined` when none is owed. */
const fiscalOf = (data: Record<string, unknown>): ReceiptFiscal | undefined => {
  const {
    fiscalDocumentType: type,
    fiscalSeries: series,
    fiscalNumber: number,
    fiscalAuthorization: authorization,
    fiscalVoidedAt: voidedAt,
    status,
  } = data;
  if (!filled(authorization)) {
    return filled(status) && FISCAL_OWED.has(status)
      ? { state: 'pending' }
      : undefined;
  }
  return {
    state: filled(voidedAt) ? 'voided' : 'certified',
    authorization,
    ...(filled(type) ? { type } : {}),
    ...(filled(series) ? { series } : {}),
    ...(filled(number) ? { number } : {}),
  };
};

/** One step on the way to the door, as the buyer's tracker draws it. */
export type TrackerStepKey = 'placed' | 'payment' | 'dispatched' | 'delivered';

export interface TrackerStep {
  readonly key: TrackerStepKey;
  readonly state: 'done' | 'current' | 'todo';
}

/**
 * How far along each status is: the steps before it are done, its own is the
 * current one. `pending` is still being paid for by card, so payment is the
 * current step and never a done one — a pending result never says the money
 * was taken (ADR 0073).
 */
const REACHED: Readonly<Record<string, number>> = {
  pending: 1,
  'awaiting-payment': 1,
  paid: 2,
  confirmed: 2,
  dispatched: 3,
  fulfilled: 4,
};

const STEPS: readonly TrackerStepKey[] = [
  'placed',
  'payment',
  'dispatched',
  'delivered',
];

/**
 * The steps of an order's way to the door, or none for one that left that
 * way — cancelled, being cancelled, or a status this storefront does not know.
 *
 * ⚠️ **Cash on delivery has no payment step.** Its money changes hands at the
 * door, so a done payment step would say the buyer paid before they did; the
 * page says instead that they pay when it arrives.
 */
export const trackerSteps = (
  status: string,
  method: string,
): readonly TrackerStep[] => {
  const reached = REACHED[status];
  if (reached === undefined) return [];
  return STEPS.flatMap((key, index): TrackerStep[] =>
    key === 'payment' && method === 'cod'
      ? []
      : [
          {
            key,
            state:
              index < reached ? 'done' : index === reached ? 'current' : 'todo',
          },
        ],
  );
};

export interface ReceiptDetails {
  readonly delivery?: ReceiptDelivery;
  /** Where each order stands, keyed by order id. */
  readonly tracking: ReadonlyMap<string, ReceiptTracking>;
  /** Each payment-link order's state, keyed by order id. */
  readonly payments: ReadonlyMap<string, ReceiptPayment>;
  /** Each paid-for order's FEL document, keyed by order id (#668). */
  readonly fiscal: ReadonlyMap<string, ReceiptFiscal>;
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

/** An `https` link's host, or `undefined` for anything else. */
const httpsHost = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.hostname : undefined;
  } catch {
    return undefined;
  }
};

/**
 * A payment-link order's state as its buyer reads it, or `undefined` for an
 * order paid any other way. A link that is not `https` is not shown: the
 * service refuses one, so its presence means the record was not ours.
 */
const paymentOf = (
  data: Record<string, unknown>,
): ReceiptPayment | undefined => {
  if (data['paymentMethod'] !== 'link') return undefined;
  const url = data['paymentLinkUrl'];
  const host = filled(url) ? httpsHost(url) : undefined;
  const provider = data['paymentLinkProviderName'];
  const dueAt = data['paymentDueAt'];
  return {
    awaiting: data['status'] === 'awaiting-payment',
    ...(filled(dueAt) ? { dueAt } : {}),
    expired: data['cancelCause'] === 'payment-expired',
    evidence: evidenceOf(data['paymentEvidence']),
    ...(host === undefined || !filled(url)
      ? {}
      : {
          link: {
            url,
            host,
            providerName: filled(provider) ? provider : host,
            unlisted: data['paymentLinkProviderKey'] === 'other',
          },
        }),
  };
};

/** An order's tracking as its buyer reads it, or `undefined` without a status. */
const trackingOf = (
  data: Record<string, unknown>,
): ReceiptTracking | undefined => {
  const { status, paymentMethod, courierName, trackingNumber, trackingUrl } =
    data;
  if (!filled(status)) return undefined;
  return {
    status,
    method: filled(paymentMethod) ? paymentMethod : 'card',
    ...(filled(courierName) ? { courierName } : {}),
    ...(filled(trackingNumber) ? { trackingNumber } : {}),
    ...(filled(trackingUrl) && httpsHost(trackingUrl) !== undefined
      ? { trackingUrl }
      : {}),
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
  const payments = new Map<string, ReceiptPayment>();
  const tracking = new Map<string, ReceiptTracking>();
  const fiscal = new Map<string, ReceiptFiscal>();
  let billedTo: ReceiptBilledTo | undefined;
  for (const envelope of orders) {
    const data = isRecord(envelope) ? envelope['data'] : undefined;
    if (!isRecord(data) || !filled(data['id'])) continue;
    billedTo ??= billedToOf(data);
    const payment = paymentOf(data);
    if (payment !== undefined) payments.set(data['id'], payment);
    const where = trackingOf(data);
    if (where !== undefined) tracking.set(data['id'], where);
    const document = fiscalOf(data);
    if (document !== undefined) fiscal.set(data['id'], document);
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
    payments,
    tracking,
    fiscal,
    ...(billedTo === undefined ? {} : { billedTo }),
  };
};
