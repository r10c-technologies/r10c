import { FlowAccepted } from '@entifix/transactions';
import { Option, Schema } from 'effect';

import { type MoneyTotal, totalsByCurrency } from '../catalog/money';
import { TENDER_PREFIX } from '../routing/paths';

/** How a buyer pays one seller: a card at checkout, or cash on delivery. */
export type Tender = 'card' | 'cod';

/** What a form field says, narrowed: anything but `cod` is a card. */
export const tenderOf = (value: unknown): Tender =>
  value === 'cod' ? 'cod' : 'card';

/** The form field one seller's tender travels in. */
export const tenderField = (vendorId: string) => `${TENDER_PREFIX}${vendorId}`;

/** One cart line priced from the published offering. */
export interface PricedLine {
  readonly offeringId: string;
  readonly vendorId: string;
  readonly quantity: number;
  readonly amount: number;
  readonly currency: string;
}

/** One seller's part of a basket: their lines and how the buyer pays them. */
export interface SellerPart {
  readonly vendorId: string;
  readonly paymentMethod: Tender;
  readonly lines: readonly PricedLine[];
}

/**
 * A basket split per seller, in the order each seller first appears — a
 * checkout writes one order per vendor, and the buyer picks a tender per seller
 * (ADR 0069, ADR 0070).
 */
export const sellerParts = (
  lines: readonly PricedLine[],
  tender: (vendorId: string) => Tender = () => 'card',
): readonly SellerPart[] => {
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
    paymentMethod: tender(vendorId),
    lines: byVendor.get(vendorId) as PricedLine[],
  }));
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
}

export const checkoutStartBody = (input: {
  readonly parts: readonly SellerPart[];
  readonly cancelDigest: string;
  readonly capabilityDigest: string;
}): CheckoutStartBody => ({
  channel: { type: 'storefront' },
  vendors: input.parts,
  totals: totalsByCurrency(input.parts.flatMap(part => part.lines)),
  cancelDigest: input.cancelDigest,
  capabilityDigest: input.capabilityDigest,
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
