import { it as effectIt } from '@effect/vitest';
import type {
  EventBus,
  LockService,
  SequenceService,
  TransactionEvent,
} from '@r10c/entifix-transactions';
import { Duration, Effect, Exit, Fiber, TestClock } from 'effect';
import { describe, expect, it } from 'vitest';

const run = <TValue, TError>(effect: Effect.Effect<TValue, TError>) =>
  Effect.runPromise(effect);

/**
 * What every {@link LockService} must guarantee: exclusivity while held,
 * availability after release, and a release that only frees the caller's own
 * lock. The last one is why `release` takes a handle rather than a key — a lock
 * that lapsed and was re-acquired by someone else must not be freed by the
 * previous holder.
 */
export const describeLockServiceContract = (
  name: string,
  makeLockService: () => LockService | Promise<LockService>,
): void => {
  describe(`LockService contract: ${name}`, () => {
    it('acquires an uncontended key', async () => {
      const locks = await makeLockService();

      const handle = await run(locks.acquire('contract:free'));

      expect(handle.key).toBe('contract:free');
      expect(handle.token).toBeTruthy();
    });

    // An implementation may retry before giving up (the Redis adapter waits out
    // a bounded budget), so this runs on a TestClock: the assertion is about
    // exclusivity, and it should not cost seconds of wall clock to make.
    effectIt.effect('refuses a key that is already held', () =>
      Effect.gen(function* () {
        const locks = yield* Effect.promise(async () => makeLockService());
        yield* locks.acquire('contract:taken');

        const fiber = yield* Effect.fork(locks.acquire('contract:taken'));
        yield* TestClock.adjust(Duration.minutes(1));
        const exit = yield* Fiber.await(fiber);

        expect(Exit.isFailure(exit)).toBe(true);
      }),
    );

    it('makes the key available again after release', async () => {
      const locks = await makeLockService();
      const handle = await run(locks.acquire('contract:cycle'));

      await run(locks.release(handle));
      const reacquired = await run(locks.acquire('contract:cycle'));

      expect(reacquired.key).toBe('contract:cycle');
    });

    effectIt.effect('ignores a release whose token does not match', () =>
      Effect.gen(function* () {
        const locks = yield* Effect.promise(async () => makeLockService());
        const handle = yield* locks.acquire('contract:stolen');

        yield* locks.release({ key: handle.key, token: 'not-mine' });

        // Still held, so a fresh acquisition must fail.
        const fiber = yield* Effect.fork(locks.acquire('contract:stolen'));
        yield* TestClock.adjust(Duration.minutes(1));
        const exit = yield* Fiber.await(fiber);

        expect(Exit.isFailure(exit)).toBe(true);
      }),
    );
  });
};

/**
 * What every {@link SequenceService} must guarantee: strictly increasing values
 * per name, never repeating, with names independent of one another. This is the
 * property incremental codes rest on.
 */
export const describeSequenceServiceContract = (
  name: string,
  makeSequenceService: () => SequenceService | Promise<SequenceService>,
): void => {
  describe(`SequenceService contract: ${name}`, () => {
    it('starts at 1', async () => {
      const sequences = await makeSequenceService();

      expect(await run(sequences.next('contract:fresh'))).toBe(1);
    });

    it('never returns the same value twice for a name', async () => {
      const sequences = await makeSequenceService();

      const drawn = [
        await run(sequences.next('contract:codes')),
        await run(sequences.next('contract:codes')),
        await run(sequences.next('contract:codes')),
      ];

      expect(drawn).toEqual([1, 2, 3]);
      expect(new Set(drawn).size).toBe(drawn.length);
    });

    it('keeps separate names independent', async () => {
      const sequences = await makeSequenceService();
      await run(sequences.next('contract:a'));
      await run(sequences.next('contract:a'));

      expect(await run(sequences.next('contract:b'))).toBe(1);
    });
  });
};

export interface EventBusContractHarness {
  bus: EventBus;
  /** Delivers `event` to whatever subscribed, as the broker would. */
  deliver(event: TransactionEvent): Promise<void>;
  /** Everything the bus published, decoded back into events. */
  published(): TransactionEvent[];
}

const anEvent = (transactionId: string): TransactionEvent => ({
  transactionId,
  entity: 'contract-widget',
  state: 'PENDING',
  step: 'accepted',
  at: new Date('2026-01-01T00:00:00.000Z').toISOString(),
});

/**
 * What every {@link EventBus} must guarantee: what goes out comes back
 * unchanged, and subscribers receive deliveries. The transports differ wildly
 * (an array here, a fanout exchange in RabbitMQ) — the observable contract does
 * not.
 */
export const describeEventBusContract = (
  name: string,
  makeHarness: () => EventBusContractHarness | Promise<EventBusContractHarness>,
): void => {
  describe(`EventBus contract: ${name}`, () => {
    it('publishes an event verbatim', async () => {
      const harness = await makeHarness();
      const event = anEvent('tx-1');

      await run(harness.bus.publish(event));

      expect(harness.published()).toEqual([event]);
    });

    it('delivers published events to a subscriber', async () => {
      const harness = await makeHarness();
      const received: TransactionEvent[] = [];
      await run(
        harness.bus.subscribe((event) =>
          Effect.sync(() => {
            received.push(event);
          }),
        ),
      );

      await harness.deliver(anEvent('tx-2'));

      expect(received.map((event) => event.transactionId)).toEqual(['tx-2']);
    });

    it('preserves publication order', async () => {
      const harness = await makeHarness();

      await run(harness.bus.publish(anEvent('tx-3')));
      await run(harness.bus.publish(anEvent('tx-4')));

      expect(harness.published().map((event) => event.transactionId)).toEqual([
        'tx-3',
        'tx-4',
      ]);
    });
  });
};
