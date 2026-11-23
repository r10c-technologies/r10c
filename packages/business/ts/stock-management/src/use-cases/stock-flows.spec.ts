import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { Reservation } from '../entities/reservation/index.js';
import { StockMovement } from '../entities/stock-movement/index.js';
import {
  InsufficientStock,
  ReservationMaxHoldSecondsTag,
  ReservationTtlSecondsTag,
  type StockLedger,
  StockLedgerTag,
  UnitMismatch,
} from '../ports/stock-ledger.js';
import {
  InconsistentMovement,
  recordMovement,
  restoreStock,
  takeReservation,
} from './stock-flows.js';

const ledger: StockLedger = {
  take: (_org, reservation) => Effect.succeed({ _tag: 'held', reservation }),
  end: () => Effect.succeed('transitioned'),
  record: (_org, movement) => Effect.succeed(movement),
  restore: (_org, movement) => Effect.succeed({ _tag: 'restored', movement }),
  releaseExpired: () => Effect.succeed({ released: 0, failed: [] }),
  item: () => Effect.succeed(undefined),
};

const run = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    StockLedgerTag | ReservationTtlSecondsTag | ReservationMaxHoldSecondsTag
  >,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(StockLedgerTag, ledger),
          Layer.succeed(ReservationTtlSecondsTag, 900),
          Layer.succeed(ReservationMaxHoldSecondsTag, 3600),
        ),
      ),
    ),
  );

const aHold = (quantity: number) =>
  Object.assign(new Reservation(), {
    offeringId: 'o-1',
    unit: 'UN' as const,
    quantity,
  });
const aMovement = (reason: string, quantity: number) =>
  Object.assign(new StockMovement(), {
    offeringId: 'o-1',
    unit: 'UN' as const,
    reason,
    quantity,
  });

describe('takeReservation', () => {
  it('stamps the hold with an id, a status and an expiry the ttl sets', async () => {
    const before = Date.now();

    const outcome = await run(
      takeReservation({
        organizationId: 'org',
        reservation: aHold(2),
        commandId: 'c',
      }),
    );

    expect(outcome._tag).toBe('held');
    const reservation = (outcome as { reservation: Reservation }).reservation;
    expect(reservation.status).toBe('held');
    expect((reservation.expiresAt as Date).getTime()).toBeGreaterThanOrEqual(
      before + 900_000,
    );
  });

  it('lives as long as the step stated, within the bound', async () => {
    const before = Date.now();

    const outcome = await run(
      takeReservation({
        organizationId: 'org',
        reservation: aHold(1),
        commandId: 'c',
        holdSeconds: 3600,
      }),
    );

    const reservation = (outcome as { reservation: Reservation }).reservation;
    expect((reservation.expiresAt as Date).getTime()).toBeGreaterThanOrEqual(
      before + 3_600_000,
    );
  });

  it.each([3601, 0, 1.5, '60'])(
    'refuses a stated hold of %s seconds',
    async holdSeconds => {
      const refused = await run(
        Effect.flip(
          takeReservation({
            organizationId: 'org',
            reservation: aHold(1),
            commandId: undefined,
            holdSeconds,
          }),
        ),
      );

      expect(refused).toMatchObject({
        _tag: 'InvalidBody',
        message: 'a hold lives between 1 and 3600 seconds',
      });
    },
  );

  it('refuses a quantity that cannot be held', async () => {
    const refused = await run(
      Effect.flip(
        takeReservation({
          organizationId: 'org',
          reservation: aHold(0),
          commandId: undefined,
        }),
      ),
    );

    expect(refused).toMatchObject({
      _tag: 'InvalidBody',
      code: 'invalidBody',
      category: 'invalid',
      message: '0 is not a reservable quantity',
    });
  });
});

describe('recordMovement', () => {
  it('records a consistent movement, and refuses an unknown reason or an inconsistent one', async () => {
    const recorded = await run(
      recordMovement({
        organizationId: 'org',
        movement: aMovement('receipt', 5),
      }),
    );
    const unknown = await run(
      Effect.flip(
        recordMovement({
          organizationId: 'org',
          movement: aMovement('gift', 5),
        }),
      ),
    );
    const inconsistent = await run(
      Effect.flip(
        recordMovement({
          organizationId: 'org',
          movement: aMovement('receipt', -5),
        }),
      ),
    );

    expect(recorded.id).toBeDefined();
    expect(unknown).toMatchObject({ code: 'invalidBody' });
    expect(inconsistent).toMatchObject({ code: 'inconsistentMovement' });
  });
});

describe('restoreStock', () => {
  it('writes the reason itself, and refuses a quantity that is not going back', async () => {
    const restored = await run(
      restoreStock({
        organizationId: 'org',
        movement: aMovement('receipt', 2),
        cause: 'cancellation',
        orderId: 'order-1',
        commandId: 'c',
      }),
    );
    const returned = await run(
      restoreStock({
        organizationId: 'org',
        movement: aMovement('receipt', 1),
        cause: 'return',
        orderId: 'order-2',
        commandId: undefined,
      }),
    );
    const refused = await run(
      Effect.flip(
        restoreStock({
          organizationId: 'org',
          movement: aMovement('x', -2),
          cause: 'cancellation',
          orderId: 'order-3',
          commandId: undefined,
        }),
      ),
    );

    expect((restored as { movement: StockMovement }).movement.reason).toBe(
      'cancellation',
    );
    expect((returned as { movement: StockMovement }).movement.reason).toBe(
      'return',
    );
    expect(refused).toMatchObject({ code: 'inconsistentMovement' });
    expect((restored as { movement: StockMovement }).movement).toMatchObject({
      causeType: 'product-order',
      causeId: 'order-1',
      occurredAt: expect.any(Date),
    });
  });
});

describe('the stock refusals', () => {
  it('say what was refused', () => {
    expect(
      new InsufficientStock({ offeringId: 'o-1', requested: 3, available: 1 })
        .message,
    ).toBe('3 of o-1 asked for, 1 free');
    expect(new InconsistentMovement({ reason: 'not a receipt' }).message).toBe(
      'not a receipt',
    );
    expect(
      new UnitMismatch({ offeringId: 'o-1', unit: 'UN', stocked: 'M' }).message,
    ).toBe('o-1 is stocked in M, not UN');
  });
});

describe('a quantity’s unit (ADR 0082 §1)', () => {
  const refusal = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      StockLedgerTag | ReservationTtlSecondsTag | ReservationMaxHoldSecondsTag
    >,
  ) => run(Effect.flip(effect));
  const unknown = { unit: 'BOX' } as never;

  it('is refused when it names none r10c sells in, before the ledger is asked', async () => {
    const refusals = await Promise.all([
      refusal(
        takeReservation({
          organizationId: 'org',
          reservation: Object.assign(aHold(2), unknown),
          commandId: 'c',
        }),
      ),
      refusal(
        recordMovement({
          organizationId: 'org',
          movement: Object.assign(aMovement('receipt', 2), unknown),
        }),
      ),
      refusal(
        restoreStock({
          organizationId: 'org',
          movement: Object.assign(aMovement('cancellation', 2), unknown),
          cause: 'cancellation',
          orderId: 'order-1',
          commandId: 'c',
        }),
      ),
    ]);

    for (const refused of refusals) {
      expect(refused).toMatchObject({
        code: 'invalidBody',
        reason: '"BOX" is not a sale unit',
      });
    }
  });

  it('is refused when a body names none, never taken as one piece', async () => {
    // A body read into a `Reservation` without a unit has none: a store that
    // took it as `UN` would count an offering sold by the metre in pieces.
    const refused = await refusal(
      takeReservation({
        organizationId: 'org',
        reservation: Object.assign(new Reservation(), {
          offeringId: 'o-1',
          quantity: 2,
        }),
        commandId: 'c',
      }),
    );

    expect(refused).toMatchObject({
      code: 'invalidBody',
      reason: '"undefined" is not a sale unit',
    });
  });
});
