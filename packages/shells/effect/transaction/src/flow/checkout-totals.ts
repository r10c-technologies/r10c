import {
  isPricePer,
  isSaleUnit,
  lineTotal,
  PRESENTATION_UNIT,
  stockQuantityOf,
  stockSourceOf,
} from '@r10c/business-ts-sales-vocabulary';

type Body = Readonly<Record<string, unknown>>;

const recordOf = (value: unknown): Body | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Body)
    : undefined;

const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * One line with its total **stated by the coordinator**: `lineTotal` over the
 * line's own terms, computed here once and copied everywhere after (ADR 0082
 * §6). Whatever the caller sent for it is dropped first, so a line whose terms
 * do not add up carries no total and the start's decoding refuses it.
 */
export const pricedLine = (line: Body): Body => {
  const {
    lineTotal: _stated,
    stockOfferingId: _base,
    stockFactor: _factor,
    stockUnit: _unit,
    stockQuantity: _taken,
    ...rest
  } = line;
  const { amount, quantity, saleUnit, pricePer } = rest;
  return count(amount) &&
    count(quantity) &&
    isSaleUnit(saleUnit) &&
    isPricePer(pricePer)
    ? {
        ...rest,
        lineTotal: lineTotal({ amount, quantity, saleUnit, pricePer }),
        ...drawnStock(line, quantity, saleUnit),
      }
    : rest;
};

/**
 * What a presentation's line takes from its base, **stated by the
 * coordinator**: `stockQuantityOf` over the published factor, computed here
 * once (ADR 0082 §7). The line keeps the base and its unit and drops the
 * factor, so a cancellation restores what was taken whatever the factor reads
 * by then. A line naming no whole source, or one not sold in `UN`, draws on
 * nothing: it reserves on its own id, where no stock is held, and is refused.
 */
const drawnStock = (line: Body, quantity: number, saleUnit: string): Body => {
  const source = stockSourceOf(line);
  return source === undefined || saleUnit !== PRESENTATION_UNIT
    ? {}
    : {
        stockOfferingId: source.stockOfferingId,
        stockUnit: source.stockUnit,
        stockQuantity: stockQuantityOf({
          quantity,
          saleUnit: PRESENTATION_UNIT,
          stockFactor: source.stockFactor,
        }),
      };
};

/** A vendor part with every line priced by the coordinator. */
export const pricedPart = (part: Body): Body =>
  Array.isArray(part['lines'])
    ? {
        ...part,
        lines: (part['lines'] as unknown[]).map(line =>
          pricedLine(recordOf(line) ?? {}),
        ),
      }
    : part;

/**
 * The checkout's totals, one per currency, summed from the lines the
 * coordinator priced — never the caller's, which a buyer could otherwise
 * state as anything the capture then takes (ADR 0082 §6).
 */
export const totalsOf = (
  parts: readonly Body[],
): readonly { readonly currency: string; readonly amount: number }[] => {
  const byCurrency = new Map<string, number>();
  for (const part of parts) {
    for (const line of Array.isArray(part['lines'])
      ? (part['lines'] as unknown[])
      : []) {
      const priced = recordOf(line);
      const total = priced?.['lineTotal'];
      const currency = priced?.['currency'];
      if (typeof total === 'number' && typeof currency === 'string') {
        byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + total);
      }
    }
  }
  return Array.from(byCurrency, ([currency, amount]) => ({ currency, amount }));
};
