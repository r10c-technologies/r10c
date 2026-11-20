import type { TaxRegime } from '@r10c/business-ts-tax-policy';

/**
 * The FEL document types an order can be certified as. Guatemala's public
 * mechanism (ADR 0025): `FACT` is a factura, `FPEQ` a pequeño contribuyente's
 * factura, which carries no IVA line.
 */
export const FiscalDocumentTypes = ['FACT', 'FPEQ'] as const;

export type FiscalDocumentType = (typeof FiscalDocumentTypes)[number];

/**
 * The document a seller in `regime` issues for a sale. The régimen opcional
 * simplificado is an income-tax regime whose IVA is the general one, so it
 * issues a `FACT` like `general` (ADR 0078 §6).
 */
export const fiscalDocumentTypeFor = (regime: TaxRegime): FiscalDocumentType =>
  regime === 'small-taxpayer' ? 'FPEQ' : 'FACT';

/** A certified document (DTE), as the certifier answers it. */
export interface FiscalDocument {
  readonly type: FiscalDocumentType;
  /** The authorization number the certifier issued: the document's identity. */
  readonly authorization: string;
  readonly series: string;
  readonly number: string;
  readonly certifiedAt: Date;
}

/** A certified document's annulment, as the certifier answers it. */
export interface FiscalVoid {
  readonly authorization: string;
  readonly voidedAt: Date;
}

/**
 * The statuses a certified document is due from: the order has been paid for.
 * `cancelling` is left out — a cancellation is mid-flight, and whichever way it
 * ends the next pass decides (certify a kept order, or nothing for one that
 * was never certified and is now cancelled).
 */
export const FISCAL_DUE_STATUSES = [
  'paid',
  'confirmed',
  'dispatched',
  'fulfilled',
] as const;
