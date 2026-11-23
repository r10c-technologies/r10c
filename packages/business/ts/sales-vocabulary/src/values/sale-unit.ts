import { formatScaled, type Locale, parseScaled } from '@entifix/core';

/**
 * The units an offering can be sold in, and how many decimals each counts in
 * ([ADR 0082](../../../../../docs/adr/0082-an-offering-is-sold-in-a-unit-with-a-step.md) §1).
 *
 * A quantity is an integer in its unit's scale everywhere it is held: `3500`
 * is 3.5 `M` and 3,500 `UN`, so it never travels without its unit. A code has
 * at most three characters, which makes it the FEL `UnidadMedida` as it
 * stands.
 *
 * ⚠️ **A scale is never edited.** It would change what every stored quantity
 * means. A box, a dozen or a roll is a presentation, never a unit (§7).
 */
export const SALE_UNIT_SCALES = {
  UN: 0,
  PAR: 0,
  M: 3,
  YD: 3,
  FT: 3,
  M2: 3,
  FT2: 3,
  DM2: 3,
  KG: 3,
  LB: 3,
  L: 3,
  GAL: 3,
} as const;

export type SaleUnit = keyof typeof SALE_UNIT_SCALES;

export const SaleUnits = Object.keys(SALE_UNIT_SCALES) as readonly SaleUnit[];

/**
 * Where a unit's name and symbol are translated, by code: one namespace every
 * entity that holds a quantity points its labels at, so a unit reads the same
 * on the offering, the storefront, the stock ledger and the order.
 */
export const SALE_UNIT_NAME_KEY = 'entity:sale-unit.name';
export const SALE_UNIT_SYMBOL_KEY = 'entity:sale-unit.symbol';

/** What is sold one by one, with a scale of zero. */
export const DEFAULT_SALE_UNIT: SaleUnit = 'UN';

/** Narrow an unknown value (a request body, a Mongo document) to a unit. */
export const isSaleUnit = (value: unknown): value is SaleUnit =>
  typeof value === 'string' && Object.hasOwn(SALE_UNIT_SCALES, value);

export const saleUnitScale = (unit: SaleUnit): number => SALE_UNIT_SCALES[unit];

/** One whole unit, as a quantity: `1` in `UN`, `1000` in `M`. */
export const oneWholeUnit = (unit: SaleUnit): number =>
  10 ** saleUnitScale(unit);

/**
 * The quantity `text` stands for, or `undefined` when it stands for none or
 * could stand for two. Never rounded, and never through a float (§2).
 */
export const parseQuantity = (
  text: string,
  unit: SaleUnit,
  locale: Locale,
): number | undefined => parseScaled(text, saleUnitScale(unit), locale);

/**
 * A quantity as a reader's locale writes it, without its unit. With
 * `grouping: false` it is the text to edit, which {@link parseQuantity} reads
 * back exactly.
 */
export const formatQuantity = (
  quantity: number,
  unit: SaleUnit,
  locale: Locale,
  options?: { readonly grouping?: boolean },
): string => formatScaled(quantity, saleUnitScale(unit), locale, options);
