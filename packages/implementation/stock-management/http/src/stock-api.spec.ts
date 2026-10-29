import {
  type EntityApiContext,
  IdempotencyKeyTag,
  OrganizationIdTag,
} from '@entifix/business';
import { makeEntityEnvelope } from '@entifix/core';
import {
  Reservation,
  ReservationTtlSecondsTag,
  StockLedgerTag,
  StockMovement,
} from '@r10c/business-ts-stock-management';
import { makeInMemoryStockLedger } from '@r10c/business-ts-stock-management/testing';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  reservationApi,
  stockCrossingEndpoints,
  stockItemApi,
  stockMovementApi,
} from './stock-api.js';

const context: EntityApiContext = {
  organizationId: 'acme',
  links: {
    record: id => [{ rel: 'self', href: `/api/x/${String(id)}` }],
    collection: () => [{ rel: 'list', href: '/api/x' }],
  },
};

/** One shelf per case, the hold's lifetime fixed. */
const world = () => {
  const ledger = makeInMemoryStockLedger();
  const layer = Layer.mergeAll(
    Layer.succeed(StockLedgerTag, ledger),
    Layer.succeed(ReservationTtlSecondsTag, 900),
    Layer.succeed(OrganizationIdTag, 'acme'),
  );
  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      StockLedgerTag | ReservationTtlSecondsTag | OrganizationIdTag
    >,
  ) => Effect.runPromise(Effect.provide(effect, layer));
  const refusal = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      StockLedgerTag | ReservationTtlSecondsTag | OrganizationIdTag
    >,
  ) => Effect.runPromise(Effect.flip(Effect.provide(effect, layer)));
  return { run, refusal };
};

const receipt = (quantity: number) =>
  makeEntityEnvelope(
    StockMovement,
    new StockMovement('o-1', quantity, 'receipt'),
  );
const hold = (quantity: number) =>
  makeEntityEnvelope(Reservation, new Reservation('o-1', quantity));

const record = stockMovementApi.options.override.create.handler;
const take = reservationApi.options.override.create.handler;
const [release, conversion, restoration] = stockCrossingEndpoints;

describe('the stock declarations', () => {
  it('read every entity in the caller’s organization, and take holds by crossing', () => {
    expect(stockItemApi.options).toEqual({
      verbs: ['list', 'get'],
      guard: { kind: 'organization' },
    });
    expect(reservationApi.options.guard).toEqual({
      read: { kind: 'organization' },
      write: { kind: 'crossing', organization: true },
    });
    expect(reservationApi.options.override.create.idempotent).toBe('unit');
  });

  it('records a movement, linked back to its item, and refuses an inconsistent one', async () => {
    const { run, refusal } = world();

    const recorded = await run(record({ payload: receipt(5) }, context));
    const inconsistent = await refusal(
      record({ payload: receipt(-5) }, context),
    );

    expect(recorded).toMatchObject({
      meta: {
        links: expect.arrayContaining([
          expect.objectContaining({ rel: 'stock-item' }),
        ]),
      },
    });
    expect(inconsistent).toMatchObject({ code: 'inconsistentMovement' });
  });

  it('takes a hold, answers a repeated key with it, and refuses what is not free', async () => {
    const { run, refusal } = world();
    await run(record({ payload: receipt(3) }, context));

    const keyed = (effect: ReturnType<typeof take>) =>
      Effect.provideService(effect, IdempotencyKeyTag, 'cmd-1');
    const held = await run(keyed(take({ payload: hold(2) }, context)));
    const again = await run(keyed(take({ payload: hold(2) }, context)));
    const short = await refusal(take({ payload: hold(2) }, context));
    const zero = await refusal(take({ payload: hold(0) }, context));

    expect(again).toEqual(held);
    expect(short).toMatchObject({
      _tag: 'InsufficientStock',
      category: 'conflict',
      requested: 2,
      available: 1,
    });
    expect(zero).toMatchObject({ code: 'invalidBody', category: 'invalid' });
  });
});

describe('the crossing endpoints', () => {
  it('end a hold, and answer an ended one not-held rather than an error', async () => {
    const { run } = world();
    await run(record({ payload: receipt(4) }, context));
    const held = (await run(take({ payload: hold(2) }, context))) as unknown as {
      data: { id: string };
    };

    const released = await run(
      release.handler({ params: { id: held.data.id } }),
    );
    const again = await run(release.handler({ params: { id: held.data.id } }));
    const converted = await run(
      conversion.handler({ params: { id: 'nobody' } }),
    );

    expect(released).toEqual({
      id: held.data.id,
      status: 'released',
      outcome: 'transitioned',
    });
    expect(again.outcome).toBe('not-held');
    expect(converted).toEqual({
      id: 'nobody',
      status: 'converted',
      outcome: 'not-held',
    });
  });

  it('put a cancelled order’s goods back as a cancellation, once per key', async () => {
    const { run, refusal } = world();
    const restore = (quantity: number) =>
      Effect.provideService(
        restoration.handler({
          payload: makeEntityEnvelope(
            StockMovement,
            new StockMovement('o-1', quantity),
          ),
        }),
        IdempotencyKeyTag,
        'cmd-restore',
      );

    const restored = await run(restore(2));
    const again = await run(restore(2));
    const negative = await refusal(
      restoration.handler({
        payload: makeEntityEnvelope(
          StockMovement,
          new StockMovement('o-1', -2),
        ),
      }),
    );

    expect(restored).toMatchObject({
      data: { reason: 'cancellation', quantity: 2 },
      meta: {
        links: expect.arrayContaining([
          expect.objectContaining({ rel: 'stock-item' }),
        ]),
      },
    });
    expect(again).toEqual(restored);
    expect(negative).toMatchObject({ code: 'inconsistentMovement' });
  });
});
