import {
  isTaxRegime,
  isValidNit,
  normalizeTaxId,
  type TaxRegime,
} from '@r10c/business-ts-tax-policy';
import { Schema } from 'effect';

/** A seller's fiscal identity: what a document issued in its name carries. */
export interface FiscalIdentity {
  readonly taxId: string;
  readonly legalName: string;
  readonly taxRegime: TaxRegime;
  readonly establishmentCode: string;
}

/** What `set-fiscal-identity` accepts; every member is checked by {@link fiscalIdentityOf}. */
export const FiscalIdentityPayload = Schema.Struct({
  taxId: Schema.String,
  legalName: Schema.String,
  taxRegime: Schema.String,
  establishmentCode: Schema.String,
});

export type FiscalIdentityPayload = typeof FiscalIdentityPayload.Type;

export type FiscalIdentityField = keyof FiscalIdentity;

const LEGAL_NAME_MAX = 200;

/**
 * Normalize and check a fiscal identity. The first member that fails is
 * named; nothing is defaulted, because a guessed identity is a document issued
 * to the wrong taxpayer.
 */
export const fiscalIdentityOf = (
  payload: FiscalIdentityPayload,
):
  | { readonly ok: true; readonly value: FiscalIdentity }
  | { readonly ok: false; readonly field: FiscalIdentityField } => {
  const legalName = payload.legalName.trim();
  const establishmentCode = payload.establishmentCode.trim();
  if (!isValidNit(payload.taxId)) return { ok: false, field: 'taxId' };
  if (legalName === '' || legalName.length > LEGAL_NAME_MAX)
    return { ok: false, field: 'legalName' };
  if (!isTaxRegime(payload.taxRegime)) return { ok: false, field: 'taxRegime' };
  if (!/^\d{1,4}$/.test(establishmentCode))
    return { ok: false, field: 'establishmentCode' };
  return {
    ok: true,
    value: {
      taxId: normalizeTaxId(payload.taxId),
      legalName,
      taxRegime: payload.taxRegime,
      establishmentCode,
    },
  };
};
