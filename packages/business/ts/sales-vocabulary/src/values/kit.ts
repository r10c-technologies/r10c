import { Failure } from '@entifix/core';
import { Schema } from 'effect';

import { stockQuantityOf } from './line-total';
import { isSaleUnit, type SaleUnit } from './sale-unit';
import { PRESENTATION_UNIT } from './stock-source';

/**
 * One component of a kit, as the vendor authors it
 * ([ADR 0086](../../../../../../docs/adr/0086-a-kit-sells-several-offerings-at-one-price.md)):
 * another offering of the same vendor, and how many of it one kit holds.
 */
export interface KitComponent {
  readonly offeringId: string;
  readonly quantity: number;
}

/**
 * One component of a kit as it is sold: what one kit takes from stock, read
 * when the kit is published. A component that is a presentation takes from its
 * base, so `stockOfferingId` is the base and `stockQuantity` already holds the
 * factor; any other takes from itself, in `UN`.
 *
 * The coordinator reads no catalog, so these ride the line from the
 * publication to the order, exactly as a presentation's stock source does.
 */
export interface KitStock extends KitComponent {
  readonly stockOfferingId: string;
  readonly stockUnit: SaleUnit;
  /** Scaled base quantities one kit takes. */
  readonly stockQuantity: number;
}

/** The most components a kit holds: a bundle, not a catalog. */
export const KIT_MAX_COMPONENTS = 10;

export const KitProblems = [
  'notCounted',
  'empty',
  'tooMany',
  'quantity',
  'duplicate',
  'self',
  'componentMissing',
  'componentIsKit',
  'componentNotCounted',
  'componentUnpublished',
  'isVariant',
  'isPresentation',
  'isBase',
  'isComponent',
] as const;

export type KitProblem = (typeof KitProblems)[number];

/**
 * A kit that cannot be sold: it is not sold in `UN`, holds no component or
 * too many, a quantity that is not a count, a component twice or itself, a
 * component that is missing, is a kit, is not sold in `UN` or is not
 * published; or the kit is a variant, a presentation, another offering's
 * stock base or another kit's component — one level, one stock rule each.
 */
export class KitInvalid extends Failure.invalid<KitInvalid>()(
  'KitInvalid',
  'kitInvalid',
  { problem: Schema.Literals(KitProblems) },
  { message: ({ problem }) => `kit is refused: ${problem}` },
) {}

/** Whether `value` can be a component's quantity: a positive safe integer. */
export const isKitQuantity = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/**
 * Why `components` cannot make a kit, looking at the list alone, or
 * `undefined`. What each component is, and whether it exists, is the
 * catalog's to say.
 */
export const kitShapeRefusal = (
  id: string,
  components: readonly KitComponent[],
): KitProblem | undefined => {
  if (components.length === 0) return 'empty';
  if (components.length > KIT_MAX_COMPONENTS) return 'tooMany';
  if (components.some(component => !isKitQuantity(component.quantity)))
    return 'quantity';
  if (components.some(component => component.offeringId === id)) return 'self';
  const ids = new Set(components.map(component => component.offeringId));
  return ids.size === components.length ? undefined : 'duplicate';
};

/**
 * What one kit takes from one component's stock: the component's own, one
 * per unit held, or its base's, `stockFactor` per unit held when it is a
 * presentation (ADR 0082 §7).
 */
export const kitStockOf = (
  component: KitComponent,
  source:
    | {
        readonly stockOfferingId: string;
        readonly stockFactor: number;
        readonly stockUnit: SaleUnit;
      }
    | undefined,
): KitStock =>
  source === undefined
    ? {
        ...component,
        stockOfferingId: component.offeringId,
        stockUnit: PRESENTATION_UNIT,
        stockQuantity: component.quantity,
      }
    : {
        ...component,
        stockOfferingId: source.stockOfferingId,
        stockUnit: source.stockUnit,
        stockQuantity: stockQuantityOf({
          quantity: component.quantity,
          saleUnit: PRESENTATION_UNIT,
          stockFactor: source.stockFactor,
        }),
      };

/**
 * The kit stock a stored, announced or stated record holds, or `undefined`
 * when it holds none or not a whole list. Shape only.
 */
export const kitStockListOf = (value: unknown): KitStock[] | undefined => {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const list: KitStock[] = [];
  for (const entry of value as readonly Record<string, unknown>[]) {
    const { offeringId, quantity, stockOfferingId, stockUnit, stockQuantity } =
      entry;
    if (
      typeof offeringId !== 'string' ||
      offeringId.length === 0 ||
      !isKitQuantity(quantity) ||
      typeof stockOfferingId !== 'string' ||
      stockOfferingId.length === 0 ||
      !isSaleUnit(stockUnit) ||
      !isKitQuantity(stockQuantity)
    )
      return undefined;
    list.push({
      offeringId,
      quantity,
      stockOfferingId,
      stockUnit,
      stockQuantity,
    });
  }
  return list;
};

/**
 * What a kit's line takes from each component's stock: `quantity` kits times
 * what one kit takes. The coordinator calls it once and the line copies the
 * answer, so a kit edited later corrupts no past order.
 */
export const kitLineStockOf = (
  quantity: number,
  kit: readonly KitStock[],
): KitStock[] =>
  kit.map(component => ({
    ...component,
    stockQuantity: stockQuantityOf({
      quantity,
      saleUnit: PRESENTATION_UNIT,
      stockFactor: component.stockQuantity,
    }),
  }));

/**
 * A line's kit components as plain values, `{}` when it holds none — what a
 * cancellation or a return states from a stored order or shipment line, whose
 * rows may be class instances a flow's payload must not carry.
 */
export const kitTakenOf = (line: {
  readonly kitComponents?: readonly KitStock[];
}): { readonly kitComponents?: readonly KitStock[] } =>
  line.kitComponents === undefined || line.kitComponents.length === 0
    ? {}
    : {
        kitComponents: line.kitComponents.map(component => ({
          offeringId: component.offeringId,
          quantity: component.quantity,
          stockOfferingId: component.stockOfferingId,
          stockUnit: component.stockUnit,
          stockQuantity: component.stockQuantity,
        })),
      };
