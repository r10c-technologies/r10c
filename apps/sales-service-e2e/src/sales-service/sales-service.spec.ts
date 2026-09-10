import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';
import { bearerFor } from '../support/tokens';

/**
 * The sales-service HTTP surface, in both profiles.
 *
 * `mock` boots the service's real router in-process over a driver fake; `live`
 * talks to the process on `SALES_SERVICE_URL`. The routes, the tenant handle
 * resolution, the entity deserialization and the query translation execute
 * either way — only the connection differs.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'SALES_SERVICE_URL',
  startMock: startMockService,
  // Every route here is guarded. Whether the guards themselves work is
  // `auth-guard.mock.spec.ts`'s job.
  authorization: () => bearerFor(['admin']),
});

type Page = {
  status: number;
  data: { data: { items: Array<Record<string, unknown>>; total: number } };
};
type Single = { status: number; data: { data: Record<string, unknown> } };

/** Every collection response is an envelope, so the page sits under `data`. */
const pageOf = (res: Page) => res.data.data;

/**
 * The seeded rows these journeys **name**, from
 * `apps/sales-service/src/sales-temp-data.ts`.
 *
 * Naming them is the point: an assertion that some channel exists passes
 * against a store the seed never touched, which is a walk finding nothing and
 * passing for the wrong reason.
 */
const SEEDED = {
  storefront: { id: 'sales-channel-storefront', name: 'Marketplace' },
  counter: { id: 'sales-channel-counter', name: 'Mostrador principal' },
} as const;

/** A name no other run has used, so a create never collides with a create. */
const freshName = (label: string) =>
  `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createChannel = (name: string, type = 'counter') =>
  service.client.post('/api/sales-channel', {
    meta: { type: 'entity', entity: 'sales-channel' },
    data: { name, type, status: 'active' },
  });

describe('sales-service', () => {
  it('GET /api/health reports ok', async () => {
    const res = await service.client.get('/api/health');

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ status: 'ok', service: '@r10c/sales-service' });
  });

  it('GET /api/config reports its own parameters', async () => {
    const res = await service.client.get('/api/config');

    expect(res.status).toBe(200);
    expect(res.data.service).toBe('@r10c/sales-service');
  });

  it('GET /api/me returns the principal the token names', async () => {
    const res = await service.client.get('/api/me');

    expect(res.status).toBe(200);
    expect(res.data.roles).toContain('admin');
  });
});

describe('the seeded channels', () => {
  it.each([
    ['the implicit marketplace channel', SEEDED.storefront],
    ['the vendor`s own counter', SEEDED.counter],
    // A lab with no channel cannot ring up a counter sale at all, so these two
    // rows are what make a whole screen reachable rather than merely useful.
  ])('serves %s by id', async (_label, seeded) => {
    const res: Single = await service.client.get(
      `/api/sales-channel/${seeded.id}`,
    );

    expect(res.status).toBe(200);
    expect(res.data.data['name']).toBe(seeded.name);
    expect(res.data.data['status']).toBe('active');
  });

  it('answers 404 for an id that is not there', async () => {
    const res = await service.client.get('/api/sales-channel/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.data.code).toBe('notFound');
  });

  it('filters by the one member declared filterable for a picker', async () => {
    const res: Page = await service.client.get(
      // ⚠️ Quoted: the seeded name has a space in it, and an unquoted RSQL
      // value ends at the first one — which parses as a malformed query rather
      // than as a miss.
      `/api/sales-channel?rsql=${encodeURIComponent(
        `name=='${SEEDED.counter.name}'`,
      )}`,
    );

    expect(res.status).toBe(200);
    expect(pageOf(res).items[0]?.['id']).toBe(SEEDED.counter.id);
  });

  it('refuses a query naming a member the entity never declared filterable', async () => {
    // Member metadata is the server-side allowlist, so this is a 400 rather than
    // a scan — the same rule that makes making a member queryable a one-line
    // change on the entity.
    const res = await service.client.get(
      `/api/sales-channel?rsql=${encodeURIComponent('nonesuch==x')}`,
    );

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalidQuery');
  });

  it('serves entity metadata without a tenant handle', async () => {
    const res = await service.client.get('/api/sales-channel/$metadata');

    expect(res.status).toBe(200);
    expect(res.data.meta.entity).toBe('sales-channel');
  });
});

/**
 * ⚠️ **Every write journey uses a fresh name, never a seeded one.** The seeded
 * assertions above are exact, and they only stay exact if nothing in the suite
 * moves them — otherwise the *second* live pass on a lab fails and says nothing
 * about the code.
 */
describe('authoring a channel', () => {
  it('creates one, reads it back, renames it and retires it', async () => {
    const created: Single = await createChannel(freshName('phone'), 'phone');

    // 200, not 201: this service answers a create with the stored entity rather
    // than a `202` command receipt. A channel announces nothing on the bus and
    // takes no lock, so there is nothing to poll for.
    expect(created.status).toBe(200);
    const id = created.data.data['id'] as string;
    expect(id).toBeTruthy();

    const renamed = freshName('phone-renamed');
    const updated: Single = await service.client.put(
      `/api/sales-channel/${id}`,
      {
        meta: { type: 'entity', entity: 'sales-channel' },
        // A different id in the body: the URL is authoritative, so a record
        // cannot be renamed onto another one by editing its payload.
        data: {
          id: 'sales-channel-storefront',
          name: renamed,
          type: 'phone',
          status: 'inactive',
        },
      },
    );

    expect(updated.status).toBe(200);
    expect(updated.data.data['id']).toBe(id);
    expect(updated.data.data['name']).toBe(renamed);
    // Retiring is a state change, because every order placed through a channel
    // keeps referring to it.
    expect(updated.data.data['status']).toBe('inactive');

    const storefront: Single = await service.client.get(
      `/api/sales-channel/${SEEDED.storefront.id}`,
    );
    expect(storefront.data.data['name']).toBe(SEEDED.storefront.name);
  });

  it('refuses a channel type outside the closed set', async () => {
    const res = await service.client.post('/api/sales-channel', {
      meta: { type: 'entity', entity: 'sales-channel' },
      data: { name: freshName('bad'), type: 'kiosk', status: 'active' },
    });

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalidBody');
  });

  it('deletes the channel nobody has sold through yet', async () => {
    const created: Single = await createChannel(freshName('typo'));
    const id = created.data.data['id'] as string;

    const deleted = await service.client.delete(`/api/sales-channel/${id}`);

    expect(deleted.status).toBe(200);
    expect(deleted.data.data.id).toBe(id);
    expect((await service.client.get(`/api/sales-channel/${id}`)).status).toBe(
      404,
    );
  });
});
