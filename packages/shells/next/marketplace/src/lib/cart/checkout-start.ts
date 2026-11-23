import { decodeProblem } from '@entifix/core';
import { FlowAccepted } from '@entifix/transactions';
// A value import on purpose: loading the module registers the failure with the
// codec `decodeProblem` reads, and a type-only import would leave it unknown.
import {
  VENDOR_DOES_NOT_SHIP,
  type VendorDoesNotShip,
} from '@r10c/business-ts-flow-contracts';
import type { PricePer, SaleUnit } from '@r10c/business-ts-sales-vocabulary';
import { Option, Schema } from 'effect';

import { type MoneyTotal, totalsByCurrency } from '../catalog/money';

/**
 * How a buyer pays one seller: a card at checkout, cash on delivery, or a
 * payment link the seller sends and confirms (ADR 0081).
 */
export type Tender = 'card' | 'cod' | 'link';

const TENDERS: readonly Tender[] = ['card', 'cod', 'link'];

/** The form field prefix a seller's tender travels under, `method:<id>`. */
export const TENDER_PREFIX = 'method:';

/**
 * What a form field says, narrowed — or `undefined` when it names no tender.
 * ⚠️ **No default** (ADR 0076 §7): a tender the buyer never chose is one the
 * receipt would name for them, so an absent choice stays absent.
 */
export const tenderOf = (value: unknown): Tender | undefined =>
  TENDERS.find(tender => tender === value);

/** The form field one seller's tender travels in. */
export const tenderField = (vendorId: string) => `${TENDER_PREFIX}${vendorId}`;

/**
 * The tenders a seller takes: a card always; cash on delivery only where the
 * published vendor says they collect it — a hint the checkout's own
 * eligibility step still enforces (ADR 0070); and a payment link only where it
 * says they take one, which the coordinator enforces (ADR 0081 §1).
 */
export const tendersOffered = (
  vendor:
    | { readonly acceptsCod?: boolean; readonly acceptsLink?: boolean }
    | undefined,
): readonly Tender[] => [
  'card',
  ...(vendor?.acceptsCod === true ? (['cod'] as const) : []),
  ...(vendor?.acceptsLink === true ? (['link'] as const) : []),
];

/** One cart line priced from the published offering. */
export interface PricedLine {
  readonly offeringId: string;
  /** What it is sold as: the order and the shipment keep it (#582). */
  readonly name: string;
  /** The description and specification version it was published on (ADR 0079 §3). */
  readonly description?: string;
  readonly specificationId: string;
  readonly specificationVersion: number;
  readonly vendorId: string;
  /** What one is, and how many in its scale (ADR 0082 §2). */
  readonly saleUnit: SaleUnit;
  readonly quantity: number;
  /** What `pricePer` whole units cost, as published. */
  readonly amount: number;
  readonly pricePer: PricePer;
  /**
   * The preview of what the line costs, by `lineTotal`. The coordinator
   * computes it again and its figure is the one charged (ADR 0082 §6).
   */
  readonly lineTotal: number;
  readonly currency: string;
}

/** One seller's lines in a basket, before the buyer chose how to pay them. */
export interface SellerLines {
  readonly vendorId: string;
  readonly lines: readonly PricedLine[];
}

/** One seller's part of a basket: their lines and how the buyer pays them. */
export interface SellerPart extends SellerLines {
  readonly paymentMethod: Tender;
}

/**
 * A basket split per seller, in the order each seller first appears — a
 * checkout writes one order per vendor, and the buyer picks a tender per seller
 * (ADR 0069, ADR 0070).
 */
export const sellerParts = (
  lines: readonly PricedLine[],
): readonly SellerLines[] => {
  const order: string[] = [];
  const byVendor = new Map<string, PricedLine[]>();
  for (const line of lines) {
    const existing = byVendor.get(line.vendorId);
    if (existing === undefined) {
      order.push(line.vendorId);
      byVendor.set(line.vendorId, [line]);
    } else {
      existing.push(line);
    }
  }
  return order.map(vendorId => ({
    vendorId,
    lines: byVendor.get(vendorId) as PricedLine[],
  }));
};

/**
 * Each seller's part with the tender the buyer chose for it — or the sellers
 * whose choice is missing or not one they take. A seller who takes one tender
 * is paid that way whatever the form said, since the review states it rather
 * than asking (ADR 0076 §7).
 */
export const chooseTenders = (
  parts: readonly SellerLines[],
  offered: (vendorId: string) => readonly Tender[],
  chosen: (vendorId: string) => unknown,
):
  | { readonly parts: readonly SellerPart[] }
  | { readonly missing: readonly string[] } => {
  const missing: string[] = [];
  const tendered: SellerPart[] = [];
  for (const part of parts) {
    const takes = offered(part.vendorId);
    const tender =
      takes.length === 1 ? takes[0] : tenderOf(chosen(part.vendorId));
    if (tender === undefined || !takes.includes(tender)) {
      missing.push(part.vendorId);
    } else {
      tendered.push({ ...part, paymentMethod: tender });
    }
  }
  return missing.length > 0 ? { missing } : { parts: tendered };
};

/** What the storefront asks the coordinator to start a checkout with. */
export interface CheckoutStartBody {
  /** Where the sale was made: always the storefront, from here. */
  readonly channel: { readonly type: 'storefront' };
  readonly vendors: readonly SellerPart[];
  readonly totals: readonly MoneyTotal[];
  /** The digest of the nonce the buyer's receipt cookie keeps for cancelling. */
  readonly cancelDigest: string;
  /** The digest of the nonce that lets an anonymous buyer hear the flow. */
  readonly capabilityDigest: string;
  /** Who bought and where it goes, nested as the coordinator reads it. */
  readonly contact: unknown;
  /** Whom the orders are documented to; the coordinator normalizes it. */
  readonly buyerTax?: unknown;
  /** The locale the buyer checked out in, which their mail is written in. */
  readonly locale: string;
}

export const checkoutStartBody = (input: {
  readonly parts: readonly SellerPart[];
  readonly cancelDigest: string;
  readonly capabilityDigest: string;
  readonly contact: unknown;
  readonly buyerTax?: unknown;
  readonly locale: string;
}): CheckoutStartBody => ({
  channel: { type: 'storefront' },
  vendors: input.parts,
  totals: totalsByCurrency(input.parts.flatMap(part => part.lines)),
  cancelDigest: input.cancelDigest,
  capabilityDigest: input.capabilityDigest,
  contact: input.contact,
  ...(input.buyerTax === undefined ? {} : { buyerTax: input.buyerTax }),
  locale: input.locale,
});

const decodeAccepted = Schema.decodeUnknownOption(FlowAccepted);

/**
 * The flow a `202` accepted, or `undefined` for any other answer: the
 * checkout's outcome arrives on the stream, never in this response (ADR 0073).
 * The body is a `flowAccepted` envelope, so the flow is read from its `data`.
 */
export const acceptedFlowId = (
  status: number,
  payload: unknown,
): string | undefined => {
  if (status !== 202) return undefined;
  const envelope = payload as
    { meta?: { type?: unknown }; data?: unknown } | null | undefined;
  if (envelope?.meta?.type !== 'flowAccepted') return undefined;
  return Option.getOrUndefined(decodeAccepted(envelope.data))?.flowId;
};

/**
 * The seller a refused start names, when the coordinator refused the basket
 * because that seller does not ship (`422 vendorDoesNotShip`, ADR 0076 §3) —
 * so the cart can say who, rather than "try again", which cannot help. The
 * product page already withholds Add to cart from such a seller; this is the
 * projection changing between that page and Place order (#589).
 */
export const refusedSeller = (
  status: number,
  payload: unknown,
): string | undefined => {
  // By code rather than `instanceof`: the registry that decodes it may hold
  // another copy of the class than this module imported.
  const failure = decodeProblem(payload, status);
  return failure.code === VENDOR_DOES_NOT_SHIP
    ? (failure as VendorDoesNotShip).vendorId
    : undefined;
};
