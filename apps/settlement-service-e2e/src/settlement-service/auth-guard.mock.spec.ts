import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { SEEDED_AGREEMENT_ID, startMockService } from '../support/mock-service';
import { bearerFor, operatorBearerFor, signTokenFor } from '../support/tokens';

/**
 * What each route accepts, and what no role may do.
 *
 * ⚠️ **The grant table under this is the real one.** `makeStaticPolicyDecision`
 * is what `requirePermission` consults in the mock composition root, so these
 * assertions are about the shipped policy rather than about a fixture.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'SETTLEMENT_SERVICE_URL',
  startMock: startMockService,
  authorization: () => bearerFor(['admin']),
});

const anonymous = { headers: { Authorization: undefined } };
const as = (authorization: string) => ({
  headers: { Authorization: authorization },
});

const agreementBody = (data: Record<string, unknown> = {}) => ({
  meta: { type: 'entity', entity: 'agreement' },
  data: {
    vendorId: 'e2e-organization',
    commissionBasisPoints: 800,
    ...data,
  },
});

describe('anonymous callers', () => {
  it.each([
    '/api/agreement',
    '/api/commission-entry',
    '/api/settlement-run',
    '/api/vendor-payout',
  ])('cannot read %s', async path => {
    const res = await service.client.get(path, anonymous);

    expect(res.status).toBe(401);
  });

  it('cannot write an agreement', async () => {
    const res = await service.client.post(
      '/api/agreement',
      agreementBody(),
      anonymous,
    );

    expect(res.status).toBe(401);
  });
});

describe('a signed-in user with no settlement grant', () => {
  it('is refused the reads', async () => {
    const token = await signTokenFor(['user']);
    const res = await service.client.get(
      '/api/agreement',
      as(`Bearer ${token}`),
    );

    expect(res.status).toBe(403);
  });
});

describe('writing an agreement', () => {
  /**
   * ⚠️ **No role holds `agreement:write`, and that is the decision rather than
   * an oversight.** An `admin` who could write this row could set their own
   * commission to zero. Setting what the platform charges a vendor is one half
   * of a negotiation and the vendor's own administrator is the other half of it,
   * so it is an operator act reached through `super-admin`'s wildcard.
   */
  it('is refused to an admin', async () => {
    const res = await service.client.post('/api/agreement', agreementBody());

    expect(res.status).toBe(403);
  });

  it('is allowed to super-admin', async () => {
    const token = await signTokenFor(['super-admin']);
    const res = await service.client.post(
      '/api/agreement',
      agreementBody(),
      as(`Bearer ${token}`),
    );

    expect(res.status).toBe(200);
    expect(res.data.data.commissionBasisPoints).toBe(800);
  });

  /**
   * ⚠️ **A `PUT` cannot rename a record.** The route owns the id the way
   * order-service's place route owns its own, so a body claiming a different one
   * is overwritten rather than honoured.
   */
  it('takes the id from the path, not the body', async () => {
    const token = await signTokenFor(['super-admin']);
    const res = await service.client.put(
      `/api/agreement/${SEEDED_AGREEMENT_ID}`,
      agreementBody({ id: 'some-other-agreement', commissionBasisPoints: 900 }),
      as(`Bearer ${token}`),
    );

    expect(res.status).toBe(200);
    expect(res.data.data.id).toBe(SEEDED_AGREEMENT_ID);
  });
});

describe('opening a settlement run', () => {
  /**
   * ⚠️ **Also granted to no role.** A run moves money for every vendor on the
   * platform at once, which is not a tenant-scoped act in any sense — an `admin`
   * reaching it would be settling other organizations.
   */
  it('is refused to an admin', async () => {
    const res = await service.client.post('/api/settlement-run', {});

    expect(res.status).toBe(403);
  });

  it('is allowed to super-admin', async () => {
    const token = await operatorBearerFor(['super-admin']);
    const res = await service.client.post('/api/settlement-run', {}, as(token));

    expect(res.status).toBe(200);
  });
});

describe('$metadata', () => {
  /**
   * ⚠️ **`404` for a caller without the read, never `403`.** A `403` would make
   * the endpoint an oracle for which entities exist.
   */
  it('is withheld from a caller who may not read the entity', async () => {
    const token = await signTokenFor(['user']);
    const res = await service.client.get(
      '/api/agreement/$metadata',
      as(`Bearer ${token}`),
    );

    expect(res.status).toBe(404);
  });

  /**
   * ⚠️ **Registered before `/:id`.** `find-my-way-ts` prefers a static segment
   * over a parametric one and does not backtrack — but only when the static
   * route is declared first. Registered after, this path is swallowed by `/:id`
   * and answers a `404` for an entity named `$metadata`, which looks exactly
   * like the assertion above passing for the wrong reason.
   */
  it('is not swallowed by the by-id route', async () => {
    const res = await service.client.get('/api/agreement/$metadata');

    expect(res.status).toBe(200);
    expect(res.data.meta.entity).toBe('agreement');
  });

  /**
   * The descriptor is what a screen reads to decide whether to offer Save, and
   * read-only is a fact the server states rather than a flag the screen sets
   * (ADR 0033). An `admin` may read a payout and may not write one, so the
   * document must say so.
   */
  it('withholds write on a record a fold produces', async () => {
    const res = await service.client.get('/api/vendor-payout/$metadata');

    expect(res.status).toBe(200);
    expect(res.data.data.actions).toEqual(['read']);
  });

  it('withholds write on an agreement for an admin', async () => {
    const res = await service.client.get('/api/agreement/$metadata');

    expect(res.status).toBe(200);
    expect(res.data.data.actions).toEqual(['read']);
  });

  it('offers write on an agreement to super-admin', async () => {
    const token = await signTokenFor(['super-admin']);
    const res = await service.client.get(
      '/api/agreement/$metadata',
      as(`Bearer ${token}`),
    );

    expect(res.status).toBe(200);
    expect(res.data.data.actions).toContain('write');
  });
});
