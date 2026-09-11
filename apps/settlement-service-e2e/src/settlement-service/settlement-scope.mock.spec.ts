import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import {
  SEEDED_AGREEMENT_ID,
  SEEDED_OTHER_AGREEMENT_ID,
  SEEDED_PAYOUT_ID,
  startMockService,
} from '../support/mock-service';
import {
  bearerFor,
  E2E_ORGANIZATION_ID,
  E2E_OTHER_ORGANIZATION_ID,
  operatorBearerFor,
  signTokenFor,
} from '../support/tokens';

/**
 * Who reads whose commercial terms.
 *
 * This is the suite that justifies the read grant existing at all. ADR 0054
 * withheld `payment-management:payment:read` from every role but `admin` because
 * a `Payment` carries nobody to key a predicate on; every record here carries a
 * `vendorId`, so the predicate is available — and a commission rate is a
 * negotiated term a competitor learning is an injury with no undo.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'SETTLEMENT_SERVICE_URL',
  startMock: startMockService,
  authorization: () => bearerFor(['admin']),
});

const as = (authorization: string) => ({
  headers: { Authorization: authorization },
});

describe('reading as a vendor', () => {
  it('returns their own agreement and nobody else’s', async () => {
    const res = await service.client.get('/api/agreement');

    expect(res.status).toBe(200);
    expect(res.data.data.items.map((row: { id: string }) => row.id)).toEqual([
      SEEDED_AGREEMENT_ID,
    ]);
  });

  /**
   * ⚠️ **The predicate is conjoined, never substituted.** `vendorId` is
   * filterable, so a client can already name one in `rsql` — and a client that
   * can name one can name somebody else's. What makes the route safe is that the
   * scope is added to the caller's expression rather than trusted to replace it,
   * so no `or` in a query string can widen past it.
   */
  it('cannot widen the scope through the query string', async () => {
    const res = await service.client.get(
      `/api/agreement?rsql=vendorId==${E2E_OTHER_ORGANIZATION_ID}`,
    );

    expect(res.status).toBe(200);
    expect(res.data.data.items).toEqual([]);
  });

  /**
   * ⚠️ **`404`, not `403`.** A `403` confirms to a competitor that the vendor
   * they named has an agreement on file, which is the fact being protected.
   */
  it('gets a 404 for another vendor’s agreement, not a 403', async () => {
    const res = await service.client.get(
      `/api/agreement/${SEEDED_OTHER_AGREEMENT_ID}`,
    );

    expect(res.status).toBe(404);
    expect(res.data.code).toBe('notFound');
  });

  it('reads its own agreement by id', async () => {
    const res = await service.client.get(
      `/api/agreement/${SEEDED_AGREEMENT_ID}`,
    );

    expect(res.status).toBe(200);
    expect(res.data.data.vendorId).toBe(E2E_ORGANIZATION_ID);
  });

  it('narrows the ledger and the payouts the same way', async () => {
    const entries = await service.client.get('/api/commission-entry');
    const payouts = await service.client.get('/api/vendor-payout');

    expect(
      entries.data.data.items.map((row: { vendorId: string }) => row.vendorId),
    ).toEqual([E2E_ORGANIZATION_ID]);
    expect(
      payouts.data.data.items.map((row: { id: string }) => row.id),
    ).toEqual([SEEDED_PAYOUT_ID]);
  });
});

describe('reading as platform staff', () => {
  it('reads across vendors', async () => {
    const res = await service.client.get(
      '/api/agreement',
      as(await operatorBearerFor(['admin'])),
    );

    expect(res.status).toBe(200);
    expect(res.data.data.items).toHaveLength(2);
  });

  it('reads another vendor’s agreement by id', async () => {
    const res = await service.client.get(
      `/api/agreement/${SEEDED_OTHER_AGREEMENT_ID}`,
      as(await operatorBearerFor(['admin'])),
    );

    expect(res.status).toBe(200);
    expect(res.data.data.vendorId).toBe(E2E_OTHER_ORGANIZATION_ID);
  });
});

describe('reading with no organization', () => {
  /**
   * ⚠️ **An empty page, not `409 noActiveOrganization`.** That error belongs to
   * a tenant-plane store where the claim picks a database handle. This store is
   * control plane and single: there is no handle to fail to resolve, and holding
   * the read grant while owning no records is not an error.
   */
  it('answers an empty page rather than an error', async () => {
    const token = await signTokenFor(['admin'], 'user-1', null);
    const res = await service.client.get(
      '/api/agreement',
      as(`Bearer ${token}`),
    );

    expect(res.status).toBe(200);
    expect(res.data.data.items).toEqual([]);
  });

  /**
   * Whether a query is well-formed must not depend on who asked, so the empty
   * page still parses the request and still refuses a malformed one.
   */
  it('still rejects a malformed query with 400', async () => {
    const token = await signTokenFor(['admin'], 'user-1', null);
    const res = await service.client.get(
      '/api/agreement?rsql=commissionBasisPoints=gibberish',
      as(`Bearer ${token}`),
    );

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalidQuery');
  });

  it('answers 404 for a by-id read without loading anything', async () => {
    const token = await signTokenFor(['admin'], 'user-1', null);
    const res = await service.client.get(
      `/api/agreement/${SEEDED_AGREEMENT_ID}`,
      as(`Bearer ${token}`),
    );

    expect(res.status).toBe(404);
  });
});

describe('reading as a buyer', () => {
  /**
   * ⚠️ **There is no buyer arm in the scope, and this is what says so.** In
   * order-service a buyer falls through to their own receipts; settlement holds
   * nothing a buyer is party to, so the same fall-through would be a bug wearing
   * the shape of symmetry.
   */
  it('reads nothing, even holding the grant', async () => {
    const token = await signTokenFor(
      ['admin'],
      'user-3',
      E2E_ORGANIZATION_ID,
      'customer',
    );
    const res = await service.client.get(
      '/api/agreement',
      as(`Bearer ${token}`),
    );

    expect(res.status).toBe(200);
    expect(res.data.data.items).toEqual([]);
  });
});
