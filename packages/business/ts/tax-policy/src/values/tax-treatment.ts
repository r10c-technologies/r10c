/**
 * Whether a line is taxed. Values beyond these two are ADR 0078 open
 * question 3; until an offering declares its treatment, the coordinator states
 * every line `taxed`.
 */
export const TaxTreatments = ['taxed', 'exempt'] as const;

export type TaxTreatment = (typeof TaxTreatments)[number];

export const isTaxTreatment = (value: unknown): value is TaxTreatment =>
  typeof value === 'string' &&
  (TaxTreatments as readonly string[]).includes(value);

/** What a line sells. A FEL document distinguishes goods (`B`) from services (`S`). */
export const ItemKinds = ['good', 'service'] as const;

export type ItemKind = (typeof ItemKinds)[number];

export const isItemKind = (value: unknown): value is ItemKind =>
  typeof value === 'string' && (ItemKinds as readonly string[]).includes(value);
