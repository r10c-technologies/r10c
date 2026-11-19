/**
 * The seller's tax regime — one member with three values, rather than an IVA
 * affiliation and an ISR regime as two (ADR 0078 open question 2, decided as
 * Q13 of the MVP plan). What a regime means in pesos is a {@link TaxRule}, read
 * from configuration: this set only names them.
 *
 * - `general` — IVA general: the price includes IVA and the document breaks it
 *   out.
 * - `small-taxpayer` — pequeño contribuyente: a flat rate on the gross, and a
 *   document that shows no IVA.
 * - `simplified` — régimen opcional simplificado: an ISR regime whose IVA is
 *   the general one.
 */
export const TaxRegimes = ['general', 'small-taxpayer', 'simplified'] as const;

export type TaxRegime = (typeof TaxRegimes)[number];

/** Narrow an unknown value (a request body, a Mongo document) to a regime. */
export const isTaxRegime = (value: unknown): value is TaxRegime =>
  typeof value === 'string' &&
  (TaxRegimes as readonly string[]).includes(value);
