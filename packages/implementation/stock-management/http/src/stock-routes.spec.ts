import {
  makeStaticPolicyDecision,
  makeStaticServiceCrossingPolicy,
  PolicyDecisionTag,
  ServiceCrossingPolicyTag,
} from '@entifix/authz';
import {
  EntityRepositoryFactoryTag,
  type TokenClaims,
  TokenServiceTag,
} from '@entifix/business';
import { EntifixBuildError, EntifixConnError } from '@entifix/core';
import {
  COMMAND_ID_HEADER,
  CROSSING_TOKEN_HEADER,
  ORGANIZATION_HEADER,
  ServiceCrossingTokenTag,
} from '@entifix/service-shell';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import {
  type Reservation,
  ReservationTtlSecondsTag,
  type StockLedger,
  StockLedgerTag,
  type StockMovement,
} from '@r10c/business-ts-stock-management';
import { type ServedRoutes, serveRoutes } from '@r10c/testing-http';
import { Effect, Layer } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { stockRoutes } from './stock-routes.js';

/** What the fake ledger was asked, and by whom. */
const calls: { op: string; organizationId: string; commandId?: string }[] = [];
const holds = new Map<string, Reservation>();
const restorations = new Map<string, StockMovement>();
let storeDown = false;

const down = () => Effect.fail(new EntifixConnError('store down'));

/** Holds up to five of anything; remembers each command's first answer. */
const ledger: StockLedger = {
  take: (organizationId, reservation, commandId) => {
    calls.push({ op: 'take', organizationId, commandId });
    if (storeDown) return down();
    const first = commandId === undefined ? undefined : holds.get(commandId);
    if (first !== undefined) {
      return Effect.succeed({ _tag: 'replayed' as const, reservation: first });
    }
    if (reservation.quantity > 5) {
      return Effect.succeed({ _tag: 'insufficient' as const });
    }
    if (commandId !== undefined) holds.set(commandId, reservation);
    return Effect.succeed({ _tag: 'held' as const, reservation });
  },
  end: (organizationId, reservationId) => {
    calls.push({ op: 'end', organizationId });
    return Effect.succeed(
      reservationId === 'gone'
        ? ('not-held' as const)
        : ('transitioned' as const),
    );
  },
  record: (organizationId, movement) => {
    calls.push({ op: 'record', organizationId });
    return Effect.succeed(movement);
  },
  restore: (organizationId, movement, commandId) => {
    calls.push({ op: 'restore', organizationId, commandId });
    const first =
      commandId === undefined ? undefined : restorations.get(commandId);
    if (first !== undefined) {
      return Effect.succeed({ _tag: 'replayed' as const, movement: first });
    }
    if (commandId !== undefined) restorations.set(commandId, movement);
    return Effect.succeed({ _tag: 'restored' as const, movement });
  },
  releaseExpired: () => Effect.succeed(0),
};

const vendor: TokenClaims = {
  userId: 'u-1',
  subject: 'alan',
  sessionId: 's-1',
  roles: ['admin'],
  activeOrganizationId: 'org-1',
};

let served: ServedRoutes;

beforeAll(() => {
  served = serveRoutes(
    stockRoutes,
    Layer.mergeAll(
      Layer.succeed(StockLedgerTag, ledger),
      Layer.succeed(ReservationTtlSecondsTag, 900),
      Layer.succeed(EntityRepositoryFactoryTag, {
        for: () => Effect.succeed(makeInMemoryEntityRepository()),
      }),
      Layer.succeed(TokenServiceTag, {
        sign: () => Effect.succeed('t'),
        verify: token =>
          token === 'vendor'
            ? Effect.succeed(vendor)
            : Effect.fail(new EntifixBuildError('bad token')),
      }),
      Layer.succeed(
        PolicyDecisionTag,
        makeStaticPolicyDecision({
          admin: [
            'stock-management:stock-item:read',
            'stock-management:reservation:read',
            'stock-management:stock-movement:read',
            'stock-management:stock-movement:write',
          ],
        }),
      ),
      Layer.succeed(ServiceCrossingTokenTag, 'fleet'),
      Layer.succeed(
        ServiceCrossingPolicyTag,
        makeStaticServiceCrossingPolicy([
          'stock-management:reservation:write',
          'stock-management:reservation:release',
          'stock-management:reservation:convert',
          'stock-management:stock-movement:restore',
        ]),
      ),
    ),
  );
});

afterAll(async () => {
  await served.dispose();
});

const crossing = (
  method: string,
  path: string,
  body?: unknown,
  commandId?: string,
) =>
  served.call(path, {
    method,
    headers: {
      'content-type': 'application/json',
      [CROSSING_TOKEN_HEADER]: 'fleet',
      [ORGANIZATION_HEADER]: 'org-9',
      ...(commandId ? { [COMMAND_ID_HEADER]: commandId } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const asVendor = (method: string, path: string, body?: unknown) =>
  served.call(path, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer vendor',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const hold = (quantity: unknown) => ({
  meta: { type: 'entity', entity: 'reservation' },
  data: { offeringId: 'o-1', quantity },
});

const movement = (quantity: unknown, reason: string) => ({
  meta: { type: 'entity', entity: 'stock-movement' },
  data: { offeringId: 'o-1', quantity, reason },
});

const relsOf = async (response: Response) =>
  (
    (await response.json()) as { meta: { links: { rel: string }[] } }
  ).meta.links.map(link => link.rel);

describe('POST /api/reservation', () => {
  it('takes a hold for the organization the crossing names, and links it to its item', async () => {
    const response = await crossing('POST', '/api/reservation', hold(2));

    expect(response.status).toBe(201);
    expect(await relsOf(response)).toEqual(
      expect.arrayContaining(['self', 'list', 'stock-item']),
    );
    expect(calls.at(-1)).toMatchObject({ op: 'take', organizationId: 'org-9' });
  });

  it('answers a redelivered command with 200 and the hold it already took', async () => {
    const first = await crossing('POST', '/api/reservation', hold(1), 'c-1');
    const again = await crossing('POST', '/api/reservation', hold(1), 'c-1');

    expect([first.status, again.status]).toEqual([201, 200]);
  });

  it('answers more than is free with 409, and a quantity that holds nothing with 400', async () => {
    const short = await crossing('POST', '/api/reservation', hold(9));
    const zero = await crossing('POST', '/api/reservation', hold(0));

    expect(short.status).toBe(409);
    expect(await short.json()).toMatchObject({ code: 'insufficientStock' });
    expect(zero.status).toBe(400);
    expect(await zero.json()).toMatchObject({ code: 'invalidBody' });
  });

  it('refuses a malformed envelope with 400, and a store failure with 500', async () => {
    const malformed = await crossing('POST', '/api/reservation', { nope: 1 });
    storeDown = true;
    const failed = await crossing('POST', '/api/reservation', hold(1));
    storeDown = false;

    expect(malformed.status).toBe(400);
    expect(failed.status).toBe(500);
  });

  it('accepts no session', async () => {
    const response = await asVendor('POST', '/api/reservation', hold(1));

    expect(response.status).toBe(401);
  });
});

describe('ending a hold', () => {
  it('releases and converts on the crossing, and says when the hold was already gone', async () => {
    const released = await crossing('DELETE', '/api/reservation/r-1');
    const converted = await crossing('POST', '/api/reservation/r-1/conversion');
    const gone = await crossing('DELETE', '/api/reservation/gone');

    expect(await released.json()).toEqual({
      id: 'r-1',
      status: 'released',
      outcome: 'transitioned',
    });
    expect(await converted.json()).toMatchObject({ status: 'converted' });
    expect(gone.status).toBe(200);
    expect(await gone.json()).toMatchObject({ outcome: 'not-held' });
  });
});

describe('POST /api/stock-movement', () => {
  it('records a vendor’s own movement against their session’s organization', async () => {
    const response = await asVendor(
      'POST',
      '/api/stock-movement',
      movement(5, 'receipt'),
    );

    expect(response.status).toBe(201);
    expect(await relsOf(response)).toEqual(
      expect.arrayContaining(['self', 'list', 'stock-item']),
    );
    expect(calls.at(-1)).toMatchObject({
      op: 'record',
      organizationId: 'org-1',
    });
  });

  it('refuses a reason that does not exist, and a quantity that contradicts its reason', async () => {
    const unknown = await asVendor(
      'POST',
      '/api/stock-movement',
      movement(1, 'shrinkage'),
    );
    const inconsistent = await asVendor(
      'POST',
      '/api/stock-movement',
      movement(-1, 'receipt'),
    );

    expect(await unknown.json()).toMatchObject({ code: 'invalidBody' });
    expect(inconsistent.status).toBe(400);
    expect(await inconsistent.json()).toMatchObject({
      error: 'inconsistent movement',
      code: 'inconsistentMovement',
    });
  });
});

describe('POST /api/stock-restoration', () => {
  it('restores once on the crossing, and answers a redelivery with 200', async () => {
    const first = await crossing(
      'POST',
      '/api/stock-restoration',
      movement(2, 'receipt'),
      'k-1',
    );
    const again = await crossing(
      'POST',
      '/api/stock-restoration',
      movement(2, 'receipt'),
      'k-1',
    );

    expect([first.status, again.status]).toEqual([201, 200]);
    expect(await relsOf(first)).toEqual(['self', 'list', 'stock-item']);
    expect(calls.at(-1)).toMatchObject({
      op: 'restore',
      organizationId: 'org-9',
    });
  });
});

describe('the reads', () => {
  it('serve a vendor’s own items, holds and ledger behind their session', async () => {
    const statuses = await Promise.all(
      ['/api/stock-item', '/api/reservation', '/api/stock-movement'].map(
        async path => (await asVendor('GET', path)).status,
      ),
    );

    expect(statuses).toEqual([200, 200, 200]);
  });
});
