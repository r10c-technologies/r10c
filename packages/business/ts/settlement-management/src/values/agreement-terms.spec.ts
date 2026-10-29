import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { Agreement } from '../entities/agreement/index.js';
import { validateAgreement } from './agreement-terms.js';

const agreementWith = (fields: Partial<Agreement>) =>
  Object.assign(new Agreement(), { commissionBasisPoints: 1000, ...fields });

/** The reason a refused agreement names, or `undefined` when it passes. */
const refusalOf = (agreement: Agreement) =>
  Effect.runSync(
    validateAgreement(agreement).pipe(
      Effect.as(undefined),
      Effect.catch(refused => Effect.succeed(refused.reason)),
    ),
  );

describe('validateAgreement', () => {
  it('accepts whole basis points within the sale, per channel too', () => {
    expect(refusalOf(agreementWith({}))).toBeUndefined();
    expect(
      refusalOf(
        agreementWith({
          channelCommissionBasisPoints: {
            counter: 500,
            phone: undefined,
          } as never,
        }),
      ),
    ).toBeUndefined();
  });

  it('refuses a default rate that is not a whole number within the sale', () => {
    expect(
      refusalOf(agreementWith({ commissionBasisPoints: 10_001 })),
    ).toBeDefined();
    expect(
      refusalOf(agreementWith({ commissionBasisPoints: -1 })),
    ).toBeDefined();
    expect(
      refusalOf(agreementWith({ commissionBasisPoints: 2.5 })),
    ).toBeDefined();
  });

  it('refuses a channel that is not a sales channel type, and a channel rate out of range', () => {
    expect(
      refusalOf(
        agreementWith({
          channelCommissionBasisPoints: { kiosk: 100 } as never,
        }),
      ),
    ).toBeDefined();
    expect(
      refusalOf(
        agreementWith({
          channelCommissionBasisPoints: { counter: 20_000 } as never,
        }),
      ),
    ).toBeDefined();
  });
});
