import { openStruct } from '@entifix/core';
import { Schema } from 'effect';

/**
 * A fragment's failure contract: the refusals its participant answers, as
 * they cross the wire — the problem body's permanent `code` and its
 * `category` (ADR 0065).
 *
 * Over the codes rather than over a domain's failure classes, on purpose. A
 * code is an `errors` catalog key and never changes meaning; a class may be
 * rewritten into a tagged failure without the wire moving, and a contract
 * fingerprinted on the class would force every fragment to a new version for
 * a change nobody can observe.
 */
export const participantRefusal = <const Codes extends readonly string[]>(
  codes: Codes,
) =>
  openStruct({
    code: codes.length === 0 ? Schema.Never : Schema.Literals(codes),
    category: Schema.String,
  });
