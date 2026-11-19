import { Invalid } from '@entifix/core';
import {
  buyerTaxOf,
  isTaxRegime,
  taxDocument,
  type TaxRules,
} from '@r10c/business-ts-tax-policy';
import { Context } from 'effect';

type Body = Readonly<Record<string, unknown>>;

/** Every regime's rule, read from the `tax` configuration group at boot. */
export class TaxRulesTag extends Context.Service<TaxRulesTag, TaxRules>()(
  'TaxRulesTag',
) {}

/** A seller as the published vendor projection describes it. */
export type SellerRecord = Readonly<Record<string, unknown>>;

const recordOf = (value: unknown): Body | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Body)
    : undefined;

const filled = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

/**
 * The buyer's fiscal identity a checkout documents its orders under: what the
 * caller sent, normalized, or consumidor final under the contact's name when
 * it sent none. A NIT that does not validate is refused here, before anything
 * is composed — never quietly documented as CF.
 */
export const buyerTaxOfStart = (input: Body) => {
  const contactName = recordOf(input['contact'])?.['name'];
  const stated = buyerTaxOf(
    recordOf(input['buyerTax']) ?? {},
    typeof contactName === 'string' ? contactName : '',
  );
  return stated.ok
    ? stated
    : {
        ok: false as const,
        refusal: new Invalid({
          errors: [
            {
              pointer: '/buyerTax',
              detail: `the buyer's fiscal identity is not valid (${stated.problem})`,
              code: stated.problem,
            },
          ],
        }),
      };
};

/**
 * One vendor part with its tax **stated by the coordinator**: the seller's
 * fiscal identity copied from the published vendor projection, and each line's
 * tax computed once per document under the seller's regime (ADR 0078 §6).
 * Whatever the caller sent for these is overwritten, as its entitlements are.
 *
 * Every line is a `taxed` good until an offering declares its treatment — ADR
 * 0078 open question 3. A seller the projection holds no fiscal identity for is
 * stated without one, and its order write refuses it: an order is documented
 * at placement or never.
 */
export const taxedPart = (
  part: Body,
  seller: SellerRecord | undefined,
  rules: TaxRules,
): Body => {
  const regime = seller?.['taxRegime'];
  const lines = Array.isArray(part['lines'])
    ? (part['lines'] as unknown[]).map(line => recordOf(line) ?? {})
    : [];
  const grosses = lines.map(
    line => Number(line['amount']) * Number(line['quantity']),
  );
  if (
    // A line that is not whole minor units is the start's decoding to refuse;
    // nothing is stated for it here.
    !grosses.every(Number.isSafeInteger) ||
    seller === undefined ||
    !filled(seller['taxId']) ||
    !filled(seller['legalName']) ||
    !filled(seller['establishmentCode']) ||
    !isTaxRegime(regime)
  ) {
    const { sellerTax: _ignored, ...rest } = part;
    return rest;
  }
  const document = taxDocument(
    grosses.map(gross => ({ gross, treatment: 'taxed' as const })),
    rules[regime],
  );
  return {
    ...part,
    sellerTax: {
      taxId: seller['taxId'],
      legalName: seller['legalName'],
      taxRegime: regime,
      establishmentCode: seller['establishmentCode'],
    },
    netAmount: document.netAmount,
    taxAmount: document.taxAmount,
    totalAmount: document.totalAmount,
    lines: lines.map((line, index) => ({
      ...line,
      kind: 'good',
      taxTreatment: 'taxed',
      ...document.lines[index],
    })),
  };
};
