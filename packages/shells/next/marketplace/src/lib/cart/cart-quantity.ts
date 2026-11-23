import type { Locale } from '@entifix/core';
import {
  parseQuantity,
  type SaleLineRefusal,
  saleLineRefusal,
  type SaleRule,
  type UnitPrice,
} from '@r10c/business-ts-sales-vocabulary';

/** What the cart reads of a published offering to decide a line. */
export type CartTerms = SaleRule &
  UnitPrice & {
    readonly offeringId: string;
  };

/** Why a line was refused: one of the sale refusals' `errors` keys. */
export type CartRefusal = SaleLineRefusal['code'];

/** A line's quantity as the cart should hold it, or why it may not. */
export type CartDecision =
  { readonly quantity: number } | { readonly refusal: CartRefusal };

const decide = (offering: CartTerms, quantity: number): CartDecision => {
  const refused = saleLineRefusal(
    offering.offeringId,
    quantity,
    offering,
    offering,
  );
  return refused === undefined ? { quantity } : { refusal: refused.code };
};

/** The text a form sent, or `undefined` for a field it did not send. */
const sent = (value: FormDataEntryValue | null): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

/**
 * The line an add leaves, decided against the published terms
 * (ADR 0082 §3): what the form asked for on top of what the cart holds, or —
 * from a card's form, which asks for nothing — the minimum for a new line and
 * one step more for one already there. Refused rather than rounded; text that
 * is no quantity in the offering's unit is refused as unreadable.
 */
export const addedLine = (
  offering: CartTerms,
  held: number | undefined,
  asked: FormDataEntryValue | null,
  locale: Locale,
): CartDecision => {
  const text = sent(asked);
  if (text === undefined) {
    return decide(
      offering,
      held === undefined
        ? offering.quantityMinimum
        : held + offering.quantityStep,
    );
  }
  const quantity = parseQuantity(text, offering.saleUnit, locale);
  return quantity === undefined
    ? { refusal: 'quantityUnreadable' }
    : decide(offering, (held ?? 0) + quantity);
};

/**
 * The line the cart's own field sets, decided the same way. Zero is the one
 * quantity that is not checked: it removes the line.
 */
export const setLine = (
  offering: CartTerms,
  asked: FormDataEntryValue | null,
  locale: Locale,
): CartDecision => {
  const text = sent(asked);
  const quantity =
    text === undefined
      ? undefined
      : parseQuantity(text, offering.saleUnit, locale);
  if (quantity === undefined) return { refusal: 'quantityUnreadable' };
  return quantity === 0 ? { quantity } : decide(offering, quantity);
};

/**
 * Why a line the cart already holds can no longer be bought — the seller
 * changed the step or the minimum since it was added — or `undefined`. The
 * cart says so beside the line, and the checkout refuses to start until it is
 * changed (ADR 0082 §3).
 */
export const heldLineRefusal = (
  offering: CartTerms,
  quantity: number,
): CartRefusal | undefined => {
  const decided = decide(offering, quantity);
  return 'refusal' in decided ? decided.refusal : undefined;
};
