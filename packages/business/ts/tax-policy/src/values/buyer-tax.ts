/**
 * How a buyer identifies themselves on a fiscal document: a NIT, a CUI (the
 * DPI number), or `cf` — consumidor final, the default when they give none.
 */
export const BuyerTaxIdTypes = ['nit', 'cui', 'cf'] as const;

export type BuyerTaxIdType = (typeof BuyerTaxIdTypes)[number];

export const isBuyerTaxIdType = (value: unknown): value is BuyerTaxIdType =>
  typeof value === 'string' &&
  (BuyerTaxIdTypes as readonly string[]).includes(value);

/** The buyer's fiscal identity as stored on an order. */
export interface BuyerTax {
  readonly idType: BuyerTaxIdType;
  /** The normalized NIT or CUI; `CF` for a consumidor final. */
  readonly taxId: string;
  /** The name the document is issued to. */
  readonly name: string;
}

/** The id a consumidor final is documented under. */
export const CONSUMIDOR_FINAL = 'CF';

/** Strip the separators people type into a NIT or a CUI, and upper-case it. */
export const normalizeTaxId = (value: string): string =>
  value.replace(/[\s-]/g, '').toUpperCase();

/**
 * The check character of a NIT body: weights 2, 3, 4… from the rightmost
 * digit, `11 − (sum mod 11)` mod 11, and `K` for ten. Guatemala's public
 * mechanism, used here so a mistyped NIT is caught before a document is issued
 * to nobody.
 */
export const nitCheckCharacter = (body: string): string => {
  const sum = [...body]
    .reverse()
    .reduce((acc, digit, index) => acc + Number(digit) * (index + 2), 0);
  const check = (11 - (sum % 11)) % 11;
  return check === 10 ? 'K' : String(check);
};

/** Whether a value is a NIT whose check character matches its body. */
export const isValidNit = (value: string): boolean => {
  const nit = normalizeTaxId(value);
  if (!/^\d{1,12}[\dK]$/.test(nit)) return false;
  return nitCheckCharacter(nit.slice(0, -1)) === nit.slice(-1);
};

/** Whether a value is a CUI: thirteen digits. */
export const isValidCui = (value: string): boolean =>
  /^\d{13}$/.test(normalizeTaxId(value));

/** Why a buyer's fiscal identity was refused. */
export type BuyerTaxProblem =
  'invalidTaxIdType' | 'invalidTaxId' | 'missingName';

/**
 * Normalize what a buyer typed into a {@link BuyerTax}. Nothing given at all is
 * a consumidor final under `fallbackName`; a NIT or CUI must validate, and an
 * identified buyer must give the name the document is issued to.
 */
export const buyerTaxOf = (
  input: {
    readonly idType?: unknown;
    readonly taxId?: unknown;
    readonly name?: unknown;
  },
  fallbackName = '',
):
  | { readonly ok: true; readonly value: BuyerTax }
  | { readonly ok: false; readonly problem: BuyerTaxProblem } => {
  const idType = input.idType ?? 'cf';
  const name = (typeof input.name === 'string' ? input.name : '').trim();
  if (!isBuyerTaxIdType(idType))
    return { ok: false, problem: 'invalidTaxIdType' };
  if (idType === 'cf')
    return {
      ok: true,
      value: {
        idType,
        taxId: CONSUMIDOR_FINAL,
        name: name === '' ? fallbackName.trim() : name,
      },
    };
  const taxId = typeof input.taxId === 'string' ? input.taxId : '';
  const valid = idType === 'nit' ? isValidNit(taxId) : isValidCui(taxId);
  if (!valid) return { ok: false, problem: 'invalidTaxId' };
  if (name === '') return { ok: false, problem: 'missingName' };
  return { ok: true, value: { idType, taxId: normalizeTaxId(taxId), name } };
};
