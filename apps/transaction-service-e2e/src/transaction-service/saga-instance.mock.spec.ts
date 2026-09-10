import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import {
  SEEDED_SAGA_ID,
  SEEDED_SAGA_ORGANIZATION,
  startMockService,
} from '../support/mock-service';
import { signTokenFor } from '../support/tokens';

/**
 * `GET /api/saga/:id` — where a flow stopped and what has been reversed.
 *
 * The store could answer this since the coordinator was built; nothing served
 * it until #233 made the coordinator resumable, at which point "why is this one
 * still here" became a question with an owner.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'TRANSACTION_SERVICE_URL',
  startMock: startMockService,
});

const cookieFor = async (organizationId: string | null) => ({
  Cookie: `r10c_at=${await signTokenFor(['admin'], 'user-1', organizationId)}`,
});

describe('GET /api/saga/:id', () => {
  it('rejects a request with no token', async () => {
    const res = await service.client.get(`/api/saga/${SEEDED_SAGA_ID}`);

    expect(res.status).toBe(401);
    expect(res.data.code).toBe('unauthenticated');
  });

  it('answers the instance to an organization the flow acted for', async () => {
    const res = await service.client.get(`/api/saga/${SEEDED_SAGA_ID}`, {
      headers: await cookieFor(SEEDED_SAGA_ORGANIZATION),
    });

    expect(res.status).toBe(200);
    expect(res.data.meta.type).toBe('sagaInstance');
    expect(res.data.data.state).toBe('COMPENSATED');
    // The whole point of the read: which step was reached, and what has been
    // given back.
    expect(res.data.data.outcomes[0]).toMatchObject({
      stepId: 'reserve',
      compensated: true,
    });
  });

  // `404`, not `403`. A saga id is a `randomUUID`, so a distinguishable status
  // would let a caller confirm that a given checkout happened.
  it('answers 404 to an organization the flow never touched', async () => {
    const res = await service.client.get(`/api/saga/${SEEDED_SAGA_ID}`, {
      headers: await cookieFor('another-organization'),
    });

    expect(res.status).toBe(404);
  });

  // Fails closed, the same direction the sibling route fails in: an instance
  // that belongs to nobody must not belong to everybody.
  it('answers 404 to a caller with no organization at all', async () => {
    const res = await service.client.get(`/api/saga/${SEEDED_SAGA_ID}`, {
      headers: await cookieFor(null),
    });

    expect(res.status).toBe(404);
  });

  it('answers 404 for an id that does not exist', async () => {
    const res = await service.client.get('/api/saga/no-such-flow', {
      headers: await cookieFor(SEEDED_SAGA_ORGANIZATION),
    });

    expect(res.status).toBe(404);
  });
});
