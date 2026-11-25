import { foldText } from '@entifix/core';
import {
  VARIANT_AXES,
  type VariantAxis,
  type VariantValue,
} from '@r10c/business-ts-sales-vocabulary';

/** What a variant picker needs of a published offering. */
export interface VariantOffering {
  readonly offeringId: string;
  readonly availableHint: boolean;
  readonly variantValues?: readonly VariantValue[];
}

/** One value a buyer can pick on an axis, and the offering it leads to. */
export interface VariantChoice {
  readonly value: string;
  readonly offeringId: string;
  readonly current: boolean;
  readonly available: boolean;
}

/** One axis of a product's variants, with every value its variants take. */
export interface VariantAxisChoices {
  readonly axis: VariantAxis;
  readonly choices: readonly VariantChoice[];
}

const valueOn = (offering: VariantOffering, axis: VariantAxis) =>
  offering.variantValues?.find(one => one.axis === axis)?.value;

/** How many axes two offerings agree on, accent- and case-blind. */
const agreement = (a: VariantOffering, b: VariantOffering) =>
  (a.variantValues ?? []).filter(({ axis, value }) => {
    const other = valueOn(b, axis);
    return other !== undefined && foldText(other) === foldText(value);
  }).length;

/**
 * The picker for one offering among its product's variants (ADR 0085): per
 * axis, every value a sibling takes, each leading to the sibling that keeps
 * the most of the current choice — so switching the colour keeps the size
 * where that combination exists. Every choice is a real offering, so the
 * picker is a set of links and needs no script.
 *
 * Nothing to pick — no variant, or a product with one variant — is no axes.
 */
export const variantChoices = (
  current: VariantOffering,
  siblings: readonly VariantOffering[],
): readonly VariantAxisChoices[] => {
  const variants = siblings.filter(one => (one.variantValues?.length ?? 0) > 0);
  if (variants.length < 2 || current.variantValues === undefined) return [];
  return VARIANT_AXES.filter(axis => valueOn(current, axis) !== undefined).map(
    axis => {
      const byValue = new Map<string, VariantOffering>();
      for (const sibling of variants) {
        const value = valueOn(sibling, axis);
        if (value === undefined) continue;
        const key = foldText(value);
        const held = byValue.get(key);
        if (
          held === undefined ||
          agreement(sibling, current) > agreement(held, current)
        )
          byValue.set(key, sibling);
      }
      const chosen = foldText(valueOn(current, axis) as string);
      return {
        axis,
        choices: [...byValue.entries()].map(([key, offering]) => ({
          value: valueOn(offering, axis) as string,
          offeringId: key === chosen ? current.offeringId : offering.offeringId,
          current: key === chosen,
          available:
            key === chosen ? current.availableHint : offering.availableHint,
        })),
      };
    },
  );
};

/**
 * What a cart or a review line says about the variant it holds — "Color:
 * negro · Talla: 40" — or nothing for an offering that is no variant. The
 * name alone is the vendor's, and two variants may share it.
 */
export const variantLabel = (
  axisLabel: (axis: VariantAxis) => string,
  values: readonly VariantValue[] | undefined,
): string | undefined =>
  values === undefined || values.length === 0
    ? undefined
    : values
        .map(({ axis, value }) => `${axisLabel(axis)}: ${value}`)
        .join(' · ');
