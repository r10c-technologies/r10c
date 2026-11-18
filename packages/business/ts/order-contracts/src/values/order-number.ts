/**
 * A number a person can read out: eight Crockford base-32 characters, drawn at
 * random, written `7KQ4-M2XD`
 * ([ADR 0076](../../../../../../docs/adr/0076-delivery-destination-buyer-contact-and-the-way-back.md) §5).
 *
 * Crockford's alphabet drops `I L O U`, so it reads aloud without ambiguity.
 * Random rather than a counter: a sequence tells anyone holding two receipts
 * how many orders were taken between them, and a counter is a hot row every
 * checkout contends on. The `order` store holds a unique index and redraws on a
 * collision, which at 32⁸ ≈ 10¹² is rare enough that a redraw is the whole
 * answer.
 *
 * **Stored as it is shown**, dash included, so the receipt, the back office,
 * an email and a search all hold one spelling: a vendor searching for what a
 * buyer read out finds it.
 *
 * ⚠️ **A number is not an id and not a capability.** Nothing is authorized or
 * rendered because an address names one.
 */
export const ORDER_NUMBER_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const HALF = 4;
const LENGTH = HALF * 2;

/** The shape of a number as stored and shown. */
export const ORDER_NUMBER = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

const written = (characters: string) =>
  `${characters.slice(0, HALF)}-${characters.slice(HALF)}`;

/** A fresh number, `7KQ4-M2XD`. */
export const drawOrderNumber = (): string => {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(LENGTH));
  // 256 is a multiple of 32, so taking each byte modulo 32 draws every
  // character with equal probability.
  return written(
    Array.from(
      bytes,
      byte => ORDER_NUMBER_ALPHABET[byte % ORDER_NUMBER_ALPHABET.length],
    ).join(''),
  );
};

/**
 * A number as a person typed it — any case, with or without the dash or
 * spaces, `I`/`L` for one and `O` for zero, as Crockford reads them — in its
 * stored spelling, or `undefined` when it cannot be one.
 */
export const normalizeOrderNumber = (typed: string): string | undefined => {
  const characters = typed
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  const number = written(characters);
  return characters.length === LENGTH && ORDER_NUMBER.test(number)
    ? number
    : undefined;
};
