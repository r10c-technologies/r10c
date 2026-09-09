import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';
import { signTokenFor } from '../support/tokens';

/**
 * The `transaction` slice's read surface, which until ADR 0036 was
 * unauthenticated and cross-tenant (#194).
 *
 * `mock` only: signing a token needs the private key, which the suite holds in
 * this profile alone — the same reason `auth-guard.mock.spec.ts` lives here.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'MARKETPLACE_ADMIN_SERVICE_URL',
  startMock: startMockService,
});

const cookieFor = async (organizationId: string | null) => ({
  Cookie: `r10c_at=${await signTokenFor(['admin'], 'user-1', organizationId)}`,
});

describe('GET /api/transaction', () => {
  // Deleted rather than scoped: nothing called it, and it answered
  // `store.list()` — a readable index of what every vendor is creating and what
  // is failing — to anyone.
  it('is gone', async () => {
    const res = await service.client.get('/api/transaction');

    expect(res.status).toBe(404);
  });
});

describe('GET /api/transaction/:id', () => {
  it('rejects a request with no token', async () => {
    const res = await service.client.get('/api/transaction/whatever');

    expect(res.status).toBe(401);
    expect(res.data.code).toBe('unauthenticated');
  });

  // `404`, not `403`: a transaction id is a client-minted UUID that is also the
  // entity's primary key, so a distinguishable status turns the endpoint into an
  // oracle for other tenants' ids.
  it('answers 404 for a record the caller may not read', async () => {
    const res = await service.client.get('/api/transaction/not-mine', {
      headers: await cookieFor('another-organization'),
    });

    expect(res.status).toBe(404);
  });

  it('answers 404 for a caller with no organization at all', async () => {
    const res = await service.client.get('/api/transaction/not-mine', {
      headers: await cookieFor(null),
    });

    expect(res.status).toBe(404);
  });
});

describe('GET /api/transaction/events', () => {
  it('rejects a request with no token', async () => {
    const res = await service.client.get('/api/transaction/events');

    expect(res.status).toBe(401);
  });

  /**
   * Also pins that the literal path is not shadowed by `/:id`.
   *
   * `find-my-way-ts` prefers a static segment and does not backtrack, so a
   * parametric registration would leave the by-id handler answering with
   * `id === "events"` — a `404` that reads as "this endpoint does not exist"
   * while it is mounted, which is the inverse of the `$metadata` collision
   * ADR 0026 hit and just as invisible to a test that only checks registration.
   */
  it('answers text/event-stream to an authenticated caller', async () => {
    const controller = new AbortController();
    try {
      const res = await fetch(`${service.baseUrl}/api/transaction/events`, {
        headers: await cookieFor('e2e-organization'),
        signal: controller.signal,
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(res.headers.get('cache-control')).toBe('no-store');
    } finally {
      // The response is held open by design; leaving it would hang the suite.
      controller.abort();
    }
  });
});
