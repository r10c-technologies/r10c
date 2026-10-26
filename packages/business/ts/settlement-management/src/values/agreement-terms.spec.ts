import { describe, expect, it } from 'vitest';

import { Agreement } from '../entities/agreement/index.js';
import { validateAgreement } from './agreement-terms.js';

const agreementWith = (fields: Partial<Agreement>) =>
  Object.assign(new Agreement(), { commissionBasisPoints: 1000, ...fields });

describe('validateAgreement', () => {
  it('accepts whole basis points within the sale, per channel too', () => {
    expect(validateAgreement(agreementWith({}))).toBeUndefined();
    expect(
      validateAgreement(
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
      validateAgreement(agreementWith({ commissionBasisPoints: 10_001 })),
    ).toBeDefined();
    expect(
      validateAgreement(agreementWith({ commissionBasisPoints: -1 })),
    ).toBeDefined();
    expect(
      validateAgreement(agreementWith({ commissionBasisPoints: 2.5 })),
    ).toBeDefined();
  });

  it('refuses a channel that is not a sales channel type, and a channel rate out of range', () => {
    expect(
      validateAgreement(
        agreementWith({
          channelCommissionBasisPoints: { kiosk: 100 } as never,
        }),
      ),
    ).toBeDefined();
    expect(
      validateAgreement(
        agreementWith({
          channelCommissionBasisPoints: { counter: 20_000 } as never,
        }),
      ),
    ).toBeDefined();
  });
});
