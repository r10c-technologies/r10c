import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';
import { bearerFor, signTokenFor } from '../support/tokens';

/**
 * What an agreement will not accept, and why each refusal is not a nicety.
 *
 * ⚠️ **`enumValues` and a member's type are metadata, not server-side
 * validators.** `readEntityEnvelope` sets members from the body and enforces
 * only what the accessor's type demands, and
 * `channelCommissionBasisPoints` declares `type: 'number'` over a *map* because
 * the framework has no map type at all. So everything here is a check the
 * framework cannot make, guarding arithmetic that would otherwise be carried out
 * faithfully against a real vendor.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'SETTLEMENT_SERVICE_URL',
  startMock: startMockService,
  authorization: () => bearerFor(['admin']),
});

const post = async (data: Record<string, unknown>) => {
  const token = await signTokenFor(['super-admin']);
  return service.client.post(
    '/api/agreement',
    { meta: { type: 'entity', entity: 'agreement' }, data },
    { headers: { Authorization: `Bearer ${token}` } },
  );
};

const agreement = (data: Record<string, unknown> = {}) => ({
  vendorId: 'e2e-organization',
  commissionBasisPoints: 800,
  ...data,
});

describe('the default rate', () => {
  it('accepts zero, which is a real commercial term', async () => {
    const res = await post(agreement({ commissionBasisPoints: 0 }));

    expect(res.status).toBe(200);
    expect(res.data.data.commissionBasisPoints).toBe(0);
  });

  it('accepts the whole sale', async () => {
    const res = await post(agreement({ commissionBasisPoints: 10_000 }));

    expect(res.status).toBe(200);
  });

  it('refuses a rate above the whole sale', async () => {
    const res = await post(agreement({ commissionBasisPoints: 10_001 }));

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalidBody');
  });

  /** A negative rate pays the vendor to sell. */
  it('refuses a negative rate', async () => {
    const res = await post(agreement({ commissionBasisPoints: -1 }));

    expect(res.status).toBe(400);
  });

  /** Basis points are hundredths of a percent; a fraction of one is noise. */
  it('refuses a fractional rate', async () => {
    const res = await post(agreement({ commissionBasisPoints: 12.5 }));

    expect(res.status).toBe(400);
  });
});

describe('the per-channel rates', () => {
  it('accepts a zero rate for a real channel type', async () => {
    const res = await post(
      agreement({ channelCommissionBasisPoints: { counter: 0 } }),
    );

    expect(res.status).toBe(200);
    expect(res.data.data.channelCommissionBasisPoints).toEqual({ counter: 0 });
  });

  /**
   * ⚠️ **The refusal that matters most.** A key that is not a real channel type
   * is never found by `commissionFor`, so the line silently falls through to the
   * default rate and the vendor is billed at a rate nobody agreed — a wrong
   * invoice rather than an error, which is exactly the failure ADR 0024 named
   * for this member.
   */
  it('refuses a key that is not a sales channel type', async () => {
    const res = await post(
      agreement({ channelCommissionBasisPoints: { kiosk: 0 } }),
    );

    expect(res.status).toBe(400);
    expect(res.data.detail).toContain('kiosk');
  });

  it('refuses a per-channel rate above the whole sale', async () => {
    const res = await post(
      agreement({ channelCommissionBasisPoints: { counter: 10_001 } }),
    );

    expect(res.status).toBe(400);
  });

  it('accepts an agreement with no per-channel rates at all', async () => {
    const res = await post(agreement());

    expect(res.status).toBe(200);
  });
});
