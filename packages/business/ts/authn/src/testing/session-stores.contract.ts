import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type {
  IdTokenStore,
  LifecycleCursor,
  ProviderSessionIndex,
} from '../repository/session-stores';

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect);

/**
 * What every {@link IdTokenStore} must guarantee: the token remembered for a
 * session is handed out once, to the logout that ends it, and never again.
 *
 * `make` returns a fresh, empty store.
 */
export const describeIdTokenStoreContract = (
  name: string,
  make: () => IdTokenStore | Promise<IdTokenStore>,
) => {
  describe(`${name} honours the IdTokenStore contract`, () => {
    it('hands a remembered token out once, the latest one', async () => {
      const store = await make();
      await run(store.remember('s-1', 'first'));
      await run(store.remember('s-1', 'latest'));

      expect(await run(store.take('s-1'))).toBe('latest');
      expect(await run(store.take('s-1'))).toBeUndefined();
    });

    it('hands out nothing for a session it never saw, and keeps sessions apart', async () => {
      const store = await make();
      await run(store.remember('s-1', 'one'));

      expect(await run(store.take('s-2'))).toBeUndefined();
      expect(await run(store.take('s-1'))).toBe('one');
    });
  });
};

/**
 * What every {@link ProviderSessionIndex} must guarantee: every r10c session
 * linked to one provider session is handed to the back-channel logout that
 * ends it — all of them, once — and other provider sessions are untouched.
 *
 * `make` returns a fresh, empty index.
 */
export const describeProviderSessionIndexContract = (
  name: string,
  make: () => ProviderSessionIndex | Promise<ProviderSessionIndex>,
) => {
  describe(`${name} honours the ProviderSessionIndex contract`, () => {
    it('hands every linked session out once', async () => {
      const index = await make();
      await run(index.link('sid-1', 's-1'));
      await run(index.link('sid-1', 's-2'));
      await run(index.link('sid-2', 's-3'));

      expect([...(await run(index.take('sid-1')))].sort()).toEqual([
        's-1',
        's-2',
      ]);
      expect(await run(index.take('sid-1'))).toEqual([]);
      expect(await run(index.take('sid-2'))).toEqual(['s-3']);
      expect(await run(index.take('sid-9'))).toEqual([]);
    });
  });
};

/**
 * What every {@link LifecycleCursor} must guarantee: a read is never later
 * than the last moment written, so a provider event recorded in the same
 * millisecond as the last one handled is read again rather than lost —
 * re-reading is free, losing a deactivation is not — and before anything was
 * written it reaches back into the past.
 *
 * `make` returns a fresh cursor with nothing written.
 */
export const describeLifecycleCursorContract = (
  name: string,
  make: () => LifecycleCursor | Promise<LifecycleCursor>,
) => {
  describe(`${name} honours the LifecycleCursor contract`, () => {
    it('reaches into the past before anything was written', async () => {
      const cursor = await make();

      expect(Date.parse(await run(cursor.read))).toBeLessThan(Date.now());
    });

    it('never reads later than the last moment written', async () => {
      const cursor = await make();
      await run(cursor.write('2026-10-25T10:00:00.000Z'));
      await run(cursor.write('2026-10-25T11:00:00.000Z'));

      const since = Date.parse(await run(cursor.read));

      expect(since).toBeLessThanOrEqual(
        Date.parse('2026-10-25T11:00:00.000Z'),
      );
      expect(since).toBeGreaterThan(Date.parse('2026-10-25T10:00:00.000Z'));
    });
  });
};
