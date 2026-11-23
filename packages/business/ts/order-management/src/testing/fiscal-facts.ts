import {
  lineTotal,
  type PricePer,
  type SaleUnit,
} from '@r10c/business-ts-sales-vocabulary';
import { taxDocument } from '@r10c/business-ts-tax-policy';

import type { ProductOrder } from '../entities/product-order';

/** The seller every documented fixture sells as: the general regime, 12 %. */
export const FIXTURE_SELLER_TAX = {
  sellerTaxId: '10000003',
  sellerLegalName: 'Demo Vendor, S.A.',
  sellerTaxRegime: 'general',
  sellerEstablishmentCode: '1',
} as const;

const GENERAL = { rateBasisPoints: 1200, basis: 'inclusive' } as const;

interface LineLike {
  readonly amount: number;
  readonly quantity: number;
  readonly currency?: string;
  readonly saleUnit?: SaleUnit | undefined;
  readonly pricePer?: PricePer | undefined;
}

/**
 * What a coordinator states for each line: its unit and price basis — one
 * piece, priced for one, unless the line already says — and the total they
 * make, computed once by `lineTotal` (ADR 0082 §6).
 */
const termsOf = (line: LineLike) => {
  const terms = {
    saleUnit: line.saleUnit ?? ('UN' as const),
    pricePer: line.pricePer ?? (1 as const),
  };
  return {
    ...terms,
    lineTotal: lineTotal({
      amount: line.amount,
      quantity: line.quantity,
      ...terms,
    }),
  };
};

/**
 * The facts a coordinator would state for these lines — each line's terms and
 * total, the seller above, a consumidor final, and each line's tax under the
 * general rule — as plain members, for a JSON body or an entity alike.
 */
export const fiscalFactsFor = (lines: readonly LineLike[]) => {
  const terms = lines.map(termsOf);
  const document = taxDocument(
    terms.map(line => ({
      gross: line.lineTotal,
      treatment: 'taxed' as const,
    })),
    GENERAL,
  );
  return {
    order: {
      ...FIXTURE_SELLER_TAX,
      buyerTaxIdType: 'cf',
      buyerTaxId: 'CF',
      buyerTaxName: 'Consumidor final',
      netAmount: document.netAmount,
      taxAmount: document.taxAmount,
      totalAmount: document.totalAmount,
      currency: lines[0]?.currency ?? 'GTQ',
    },
    lines: document.lines.map((line, index) => ({
      ...terms[index],
      kind: 'good',
      taxTreatment: 'taxed',
      ...line,
    })),
  };
};

/** Documents an order entity in place, as a placed order is. */
export const documentOrder = <T extends ProductOrder>(order: T): T => {
  const facts = fiscalFactsFor(order.items);
  Object.assign(order, facts.order);
  order.items.forEach((item, index) => Object.assign(item, facts.lines[index]));
  return order;
};

/** Documents a step's JSON body (`items` beside the order's members). */
export const documentOrderBody = <T extends Record<string, unknown>>(
  body: T,
): T => {
  const items = Array.isArray(body['items'])
    ? (body['items'] as Array<Record<string, unknown>>)
    : [];
  const facts = fiscalFactsFor(
    items.map(item => ({
      amount: Number(item['amount']),
      quantity: Number(item['quantity']),
      currency: String(item['currency']),
      saleUnit: item['saleUnit'] as SaleUnit | undefined,
      pricePer: item['pricePer'] as PricePer | undefined,
    })),
  );
  return {
    ...body,
    ...facts.order,
    items: items.map((item, index) => ({ ...item, ...facts.lines[index] })),
  };
};
