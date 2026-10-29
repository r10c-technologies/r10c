import { InvalidBody } from '@r10c/business-ts-common';
import { SalesChannelTypes } from '@r10c/business-ts-sales-vocabulary';
import { Effect } from 'effect';

import type { Agreement } from '../entities/agreement';

const WHOLE_SALE_BASIS_POINTS = 10_000;

/**
 * What the deserializer will accept and an invoice will not survive.
 *
 * ⚠️ **`channelCommissionBasisPoints` is a map, and nothing about its metadata
 * constrains its keys.** The accessor declares `type: 'number'` because the
 * framework has no map type; `readEntityEnvelope` therefore assigns whatever
 * object arrives. A key that is not a real `SalesChannelType` is not a
 * validation nicety — `commissionFor` looks the sale's channel type up and finds
 * nothing, so the line silently falls through to the default rate and the vendor
 * is billed at a rate nobody agreed. A wrong invoice rather than an error, which
 * is the failure mode ADR 0024 named for this member.
 *
 * The range check is the same argument. A rate above 10000 charges more
 * commission than the sale was worth, and a negative one pays the vendor to
 * sell — both arithmetic the fold would carry out faithfully.
 *
 * ⚠️ **`0` is valid and must stay valid.** "We take nothing on your own counter"
 * is the term the per-channel map exists for, so every check here tests bounds
 * and never truthiness.
 */
export const validateAgreement = (
  agreement: Agreement,
): Effect.Effect<Agreement, InvalidBody> => {
  const outOfRange = (basisPoints: number): boolean =>
    !Number.isInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints > WHOLE_SALE_BASIS_POINTS;

  const refused = (reason: string) => Effect.fail(new InvalidBody({ reason }));

  if (outOfRange(agreement.commissionBasisPoints)) {
    return refused(
      `commissionBasisPoints must be a whole number between 0 and ${WHOLE_SALE_BASIS_POINTS}`,
    );
  }

  const rates = agreement.channelCommissionBasisPoints;
  if (rates === undefined) {
    return Effect.succeed(agreement);
  }

  for (const [channelType, basisPoints] of Object.entries(rates)) {
    if (!(SalesChannelTypes as readonly string[]).includes(channelType)) {
      return refused(
        `channelCommissionBasisPoints names "${channelType}", which is not a sales channel type`,
      );
    }
    if (basisPoints !== undefined && outOfRange(basisPoints)) {
      return refused(
        `channelCommissionBasisPoints["${channelType}"] must be a whole number between 0 and ${WHOLE_SALE_BASIS_POINTS}`,
      );
    }
  }

  return Effect.succeed(agreement);
};
