import { Failure, foldText } from '@entifix/core';
import { Schema } from 'effect';

/**
 * The dimensions a product's variants differ along
 * ([ADR 0085](../../../../../../docs/adr/0085-variants-are-offerings.md)).
 *
 * A closed list rather than vendor-authored names: an axis is labelled on the
 * storefront through the catalog, and two vendors' `color` are then one
 * facet rather than `color` and `colour`. The values are the vendor's own
 * words. The list moves onto the platform dictionary when ADR 0014 is built.
 */
export const VARIANT_AXES = ['color', 'size', 'finish', 'capacity'] as const;

export type VariantAxis = (typeof VARIANT_AXES)[number];

/** One axis and the value this offering takes on it: `color` = `negro`. */
export const VariantValue = Schema.Struct({
  axis: Schema.Literals(VARIANT_AXES),
  value: Schema.String,
});

export type VariantValue = typeof VariantValue.Type;

/** A variant differs along at most this many axes. */
export const MAX_VARIANT_AXES = 3;

/** A value is a word or two, never a description. */
export const MAX_VARIANT_VALUE_LENGTH = 40;

export const VariantProblems = [
  'presentation',
  'axis',
  'value',
  'repeatedAxis',
  'tooMany',
  'axesMismatch',
  'combinationTaken',
  'productChanged',
] as const;

export type VariantProblem = (typeof VariantProblems)[number];

/**
 * A variant that cannot be recorded: the offering is a presentation, an axis
 * is unknown or named twice, a value is blank or too long, there are too many
 * axes, the axes differ from the rest of the product's variants, or another
 * variant of the product already takes this combination, or a save would move a
 * variant to another product.
 */
export class VariantInvalid extends Failure.invalid<VariantInvalid>()(
  'VariantInvalid',
  'variantInvalid',
  { problem: Schema.Literals(VariantProblems) },
  { message: ({ problem }) => `variant is refused: ${problem}` },
) {}

const isAxis = (value: unknown): value is VariantAxis =>
  typeof value === 'string' &&
  (VARIANT_AXES as readonly string[]).includes(value);

/**
 * What is wrong with a set of values on its own, before any sibling is read,
 * or `undefined` when nothing is. An empty set is no variant, which is legal.
 */
export const variantShapeRefusal = (
  values: readonly { readonly axis: unknown; readonly value: unknown }[],
): VariantProblem | undefined => {
  if (values.length > MAX_VARIANT_AXES) return 'tooMany';
  const seen = new Set<string>();
  for (const { axis, value } of values) {
    if (!isAxis(axis)) return 'axis';
    if (seen.has(axis)) return 'repeatedAxis';
    seen.add(axis);
    if (
      typeof value !== 'string' ||
      value.trim().length === 0 ||
      value.trim().length > MAX_VARIANT_VALUE_LENGTH
    )
      return 'value';
  }
  return undefined;
};

/**
 * The values in the list's axis order, each trimmed — the form a record
 * stores, so two saves of one choice store one thing.
 */
export const normalizedVariant = (
  values: readonly VariantValue[],
): VariantValue[] =>
  [...values]
    .map(({ axis, value }) => ({ axis, value: value.trim() }))
    .sort(
      (a, b) => VARIANT_AXES.indexOf(a.axis) - VARIANT_AXES.indexOf(b.axis),
    );

/** The axes a variant differs along, in list order: `color+size`. */
export const variantAxesKey = (values: readonly VariantValue[]): string =>
  normalizedVariant(values)
    .map(({ axis }) => axis)
    .join('+');

/**
 * The combination, accent- and case-blind: `Café` and `cafe` are one colour,
 * so a second offering cannot take it under another spelling.
 */
export const variantKeyOf = (values: readonly VariantValue[]): string =>
  normalizedVariant(values)
    .map(({ axis, value }) => `${axis}=${foldText(value)}`)
    .join('|');

/**
 * Whether `candidate` fits beside the product's other variants: the same
 * axes as every one of them, and a combination none of them takes.
 */
export const variantSiblingRefusal = (
  candidate: readonly VariantValue[],
  siblings: readonly (readonly VariantValue[])[],
): VariantProblem | undefined => {
  const axes = variantAxesKey(candidate);
  if (siblings.some(sibling => variantAxesKey(sibling) !== axes))
    return 'axesMismatch';
  const key = variantKeyOf(candidate);
  return siblings.some(sibling => variantKeyOf(sibling) === key)
    ? 'combinationTaken'
    : undefined;
};

/**
 * The variant a stored, announced or stated record holds, or `undefined` when
 * it holds none or not a well-formed one. Shape only.
 */
export const variantValuesOf = (
  value: unknown,
): readonly VariantValue[] | undefined => {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const entries = value as readonly { axis?: unknown; value?: unknown }[];
  if (
    entries.some(entry => typeof entry !== 'object' || entry === null) ||
    variantShapeRefusal(
      entries.map(entry => ({ axis: entry.axis, value: entry.value })),
    ) !== undefined
  )
    return undefined;
  return normalizedVariant(entries as readonly VariantValue[]);
};
