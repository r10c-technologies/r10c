import { Effect, TestClock, TestContext } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ShutdownHook, ShutdownRegistry } from './shutdown-registry.js';
import { makeShutdownRegistry } from './shutdown-registry.js';

/** Records the order hooks ran in, which is the whole contract. */
const recorder = () => {
  const ran: string[] = [];
  const hook = (
    name: string,
    phase: ShutdownHook['phase'],
    run: Effect.Effect<void> = Effect.void,
  ): ShutdownHook => ({
    name,
    phase,
    run: Effect.andThen(
      Effect.sync(() => {
        ran.push(name);
      }),
      run,
    ),
  });
  return { ran, hook };
};

const register = (registry: ShutdownRegistry, hooks: readonly ShutdownHook[]) =>
  Effect.forEach(hooks, hook => registry.register(hook), { discard: true });

describe('ShutdownRegistry', () => {
  it('is not terminating before anything happens', async () => {
    const { registry } = makeShutdownRegistry();

    expect(await Effect.runPromise(registry.terminating)).toBe(false);
  });

  it('terminates the moment the latch is pulled, before any hook runs', async () => {
    const { registry, begin } = makeShutdownRegistry();

    begin();

    expect(await Effect.runPromise(registry.terminating)).toBe(true);
  });

  it('drains with nothing registered', async () => {
    const { registry } = makeShutdownRegistry();

    await Effect.runPromise(registry.drain);

    expect(await Effect.runPromise(registry.terminating)).toBe(true);
  });

  it('runs every stop-intake hook before any flush hook', async () => {
    const { registry } = makeShutdownRegistry();
    const { ran, hook } = recorder();

    await Effect.runPromise(
      register(registry, [
        hook('relay', 'flush'),
        hook('consumers', 'stop-intake'),
        hook('sweep', 'stop-intake'),
      ]).pipe(Effect.andThen(registry.drain)),
    );

    // Registration order within a phase, phases in declared order — so a hook
    // registered first is not thereby run first when it belongs to `flush`.
    expect(ran).toEqual(['consumers', 'sweep', 'relay']);
  });

  it('runs the hooks behind one that fails', async () => {
    const { registry } = makeShutdownRegistry();
    const { ran, hook } = recorder();

    await Effect.runPromise(
      register(registry, [
        hook('broken', 'stop-intake', Effect.fail('no channel') as never),
        hook('after', 'stop-intake'),
        hook('relay', 'flush'),
      ]).pipe(Effect.andThen(registry.drain)),
    );

    expect(ran).toEqual(['broken', 'after', 'relay']);
  });

  it('runs the hooks behind one that dies', async () => {
    const { registry } = makeShutdownRegistry();
    const { ran, hook } = recorder();

    await Effect.runPromise(
      register(registry, [
        hook(
          'defect',
          'stop-intake',
          Effect.sync(() => {
            throw new Error('driver blew up');
          }),
        ),
        hook('after', 'stop-intake'),
      ]).pipe(Effect.andThen(registry.drain)),
    );

    expect(ran).toEqual(['defect', 'after']);
  });

  it('bounds a hook that never finishes, and still runs the next phase', async () => {
    const { registry } = makeShutdownRegistry();
    const { ran, hook } = recorder();

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* register(registry, [
          hook('hangs', 'stop-intake', Effect.never),
          hook('relay', 'flush'),
        ]);
        const draining = yield* Effect.fork(registry.drain);
        // Past the hook's own bound. Without one the drain would sit here until
        // the kubelet's SIGKILL, and `relay` would never run at all.
        yield* TestClock.adjust('11 seconds');
        yield* draining.await;
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(ran).toEqual(['hangs', 'relay']);
  });
});
