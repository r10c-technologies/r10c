import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { Reservation } from '../entities/reservation/index.js';
import { StockMovement } from '../entities/stock-movement/index.js';
import {
  ReservationTtlSecondsTag,
  type StockLedger,
  StockLedgerTag,
} from '../ports/stock-ledger.js';
import {
  recordMovement,
  restoreStock,
  StockRefused,
  takeReservation,
} from './stock-flows.js';

const ledger: StockLedger = {
  take: (_org, reservation) => Effect.succeed({ _tag: 'held', reservation }),
  end: () => Effect.succeed('transitioned'),
  record: (_org, movement) => Effect.succeed(movement),
  restore: (_org, movement) => Effect.succeed({ _tag: 'restored', movement }),
  releaseExpired: () => Effect.succeed(0),
};

const run = <A, E>(
  effect: Effect.Effect<A, E, StockLedgerTag | ReservationTtlSecondsTag>,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(StockLedgerTag, ledger),
          Layer.succeed(ReservationTtlSecondsTag, 900),
        ),
      ),
    ),
  );

const aHold = (quantity: number) =>
  Object.assign(new Reservation(), { offeringId: 'o-1', quantity });
const aMovement = (reason: string, quantity: number) =>
  Object.assign(new StockMovement(), { offeringId: 'o-1', reason, quantity });

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

    expect(refused).toBeInstanceOf(StockRefused);
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
        commandId: 'c',
      }),
    );
    const refused = await run(
      Effect.flip(
        restoreStock({
          organizationId: 'org',
          movement: aMovement('x', -2),
          commandId: undefined,
        }),
      ),
    );

    expect((restored as { movement: StockMovement }).movement.reason).toBe(
      'cancellation',
    );
    expect(refused).toMatchObject({ code: 'inconsistentMovement' });
  });
});
